/**
 * @id PP-STR-LIB-019 (POO-1038)
 * @name funding recovery journal tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The store's spec, one describe per business rule (`docs/_hackathon/02_BRIDGE_ARCHITECTURE.md` §3.2
 * to §3.8). Everything runs against jsdom's real `localStorage`, cleared between tests: the thing
 * under test IS the persistence, so stubbing it away would test nothing. Clock is faked, so the
 * 24-hour prune and the 30-second lease are asserted rather than approximated. No network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimLease,
  createJournal,
  createJournalRecorder,
  FUNDING_JOURNAL_KEY,
  findResumableJournal,
  getJournal,
  heartbeatLease,
  JOURNAL_MAX_AGE_MS,
  JOURNAL_MAX_RECORDS,
  LEASE_TTL_MS,
  readJournals,
  releaseLease,
  retireJournal,
  updateLeg,
} from "./fundingJournal";

const WALLET = "0xC3673ADc0000000000000000000000000000BEEF";
const OTHER_WALLET = "0xDEAD00000000000000000000000000000000BEEF";
const POLYGON = 137;
const ARBITRUM = 42161;
const USDC_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const WETH_POLYGON = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
const HASH = `0x${"ab".repeat(32)}`;
const T0 = Date.parse("2026-07-25T12:00:00.000Z");

function plannedLegs() {
  return [
    {
      index: 0,
      kind: "swap-token" as const,
      chainId: POLYGON,
      tokenIn: WETH_POLYGON,
      tokenOut: USDC_POLYGON,
      amountIn: "1000000000000000000",
      minAmountOut: "2940000000",
    },
    {
      index: 1,
      kind: "bridge" as const,
      chainId: POLYGON,
      tokenIn: USDC_POLYGON,
      tokenOut: USDC_ARBITRUM,
      destChainId: ARBITRUM,
      amountIn: "3000000000",
      minAmountOut: "2996000000",
    },
  ];
}

function newJournal(overrides: { wallet?: string } = {}) {
  return createJournal({
    wallet: overrides.wallet ?? WALLET,
    operation: { kind: "invest", targetChainId: ARBITRUM, strategyId: "strat-1" },
    legs: plannedLegs(),
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("[R1] the journal covers the broadcast-but-not-yet-reflected gap only", () => {
  it("records intent per leg, in route order, all planned and none broadcast", () => {
    const journal = newJournal();

    expect(journal.legs.map((leg) => leg.index)).toEqual([0, 1]);
    expect(journal.legs.every((leg) => leg.status === "planned")).toBe(true);
    expect(journal.legs.every((leg) => leg.txHash === undefined)).toBe(true);
  });

  it("stores no calldata, no signature and no quote — nothing a replay could be built from", () => {
    const journal = newJournal();
    updateLeg(journal.journalId, 0, { status: "broadcast", txHash: HASH, broadcastAt: T0 });

    const raw = window.localStorage.getItem(FUNDING_JOURNAL_KEY) ?? "";
    for (const forbidden of ["data", "signature", "permit", "quote", "calldata"]) {
      expect(raw.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("keys the store by version, so a v2 shape can never be misread as this one", () => {
    newJournal();
    expect(FUNDING_JOURNAL_KEY).toBe("pp.funding.journal.v1");
    expect(window.localStorage.getItem(FUNDING_JOURNAL_KEY)).not.toBeNull();
  });
});

describe("[R2] write ordering: the record lands before the wallet is ever prompted", () => {
  it("flushes the leg as planned, with its nonce and destination baseline, before the prompt", async () => {
    const journal = newJournal();
    const prompts: string[] = [];
    const recorder = createJournalRecorder(journal.journalId, {
      readNonce: async () => 7,
    });

    await recorder.beginLeg({
      index: 1,
      kind: "bridge",
      chainId: POLYGON,
      tokenIn: USDC_POLYGON,
      tokenOut: USDC_ARBITRUM,
      destChainId: ARBITRUM,
      amountIn: "3000000000",
      minAmountOut: "2996000000",
      destBalanceBefore: "500000",
    });
    prompts.push("wallet");

    const persisted = getJournal(journal.journalId)?.legs[1];
    expect(persisted?.status).toBe("planned");
    expect(persisted?.nonceBefore).toBe(7);
    expect(persisted?.destBalanceBefore).toBe("500000");
    expect(prompts).toEqual(["wallet"]);
  });

  it("records the hash SYNCHRONOUSLY, so a tab that dies before the receipt still has it", () => {
    const journal = newJournal();
    const recorder = createJournalRecorder(journal.journalId, { readNonce: async () => 7 });

    // No await between the hash and the read: this is the whole safety property (§3.4 step 5).
    recorder.recordBroadcast(1, HASH);
    const persisted = getJournal(journal.journalId)?.legs[1];

    expect(persisted?.status).toBe("broadcast");
    expect(persisted?.txHash).toBe(HASH);
    expect(persisted?.broadcastAt).toBe(T0);
  });

  it("is idempotent: re-recording the same broadcast does not add a second leg", () => {
    const journal = newJournal();
    const recorder = createJournalRecorder(journal.journalId, { readNonce: async () => 7 });

    recorder.recordBroadcast(1, HASH);
    recorder.recordBroadcast(1, HASH);

    const persisted = getJournal(journal.journalId);
    expect(persisted?.legs).toHaveLength(2);
    expect(persisted?.legs.filter((leg) => leg.txHash === HASH)).toHaveLength(1);
  });

  /**
   * POO-1093 [R2]. The recorder was write-only: four methods, all writes. So nothing between a
   * "Try again" click and `eth_sendTransaction` could know a hash had already come back for that
   * leg, and the rail happily broadcast a second transaction for money already in flight.
   */
  it("[R2] reports a leg's recorded status, so a retry can refuse to re-broadcast", () => {
    const journal = newJournal();
    const recorder = createJournalRecorder(journal.journalId, { readNonce: async () => 7 });

    // An index the journal has no leg for at all.
    expect(recorder.legStatus(9)).toBeNull();
    // A leg that exists but has not moved yet.
    expect(recorder.legStatus(1)?.status).toBe("planned");
    expect(recorder.legStatus(1)?.txHash).toBeUndefined();

    recorder.recordBroadcast(1, HASH);
    expect(recorder.legStatus(1)).toMatchObject({ status: "broadcast", txHash: HASH });
  });

  /**
   * POO-1093 [R4]. `beginLeg` upserted with `{...existing, ...leg}` and `leg.status` is always
   * `"planned"`, so re-running a leg REGRESSED a `broadcast` record. That destroyed the very
   * evidence the guard depends on, and downstream it also cost `reconcileFundingJournal` its
   * strongest test (status + hash) leaving only the weaker nonce comparison.
   */
  it("[R4] a re-run never regresses a broadcast leg back to planned", async () => {
    const journal = newJournal();
    const recorder = createJournalRecorder(journal.journalId, { readNonce: async () => 7 });

    recorder.recordBroadcast(1, HASH);
    // The same shape the rail re-submits on a re-run. `destChainId` matters: a bridge leg without
    // it fails the store's own read validation and the whole journal is salvaged away, which would
    // make this test pass for entirely the wrong reason.
    await recorder.beginLeg({
      index: 1,
      kind: "bridge",
      chainId: POLYGON,
      tokenIn: USDC_POLYGON,
      tokenOut: USDC_ARBITRUM,
      destChainId: ARBITRUM,
      amountIn: "3000000000",
      minAmountOut: "2996000000",
    });

    const persisted = getJournal(journal.journalId)?.legs[1];
    expect(persisted?.status).toBe("broadcast");
    expect(persisted?.txHash).toBe(HASH);
  });

  /**
   * POO-1093 [R5]. `recordBroadcast` overwrote `txHash`, so after a double broadcast the journal
   * held only the SECOND hash and the first became invisible to the app forever. Recovery would
   * reconcile the second, retire the journal, and the first transaction would never be accounted
   * for by anything.
   */
  it("[R5] keeps the first hash when a second broadcast is recorded for the same leg", () => {
    const journal = newJournal();
    const recorder = createJournalRecorder(journal.journalId, { readNonce: async () => 7 });
    const SECOND = "0xbbbb000000000000000000000000000000000000000000000000000000000000";

    recorder.recordBroadcast(1, HASH);
    recorder.recordBroadcast(1, SECOND);

    const persisted = getJournal(journal.journalId)?.legs[1];
    expect(persisted?.txHash).toBe(HASH);
  });

  it("marks a leg settled, then failed, without ever losing its hash", async () => {
    const journal = newJournal();
    const recorder = createJournalRecorder(journal.journalId, { readNonce: async () => 7 });

    recorder.recordBroadcast(0, HASH);
    recorder.recordSettled(0);
    expect(getJournal(journal.journalId)?.legs[0]?.status).toBe("settled");
    expect(getJournal(journal.journalId)?.legs[0]?.settledAt).toBe(T0);

    recorder.recordFailed(0);
    expect(getJournal(journal.journalId)?.legs[0]?.status).toBe("failed");
    expect(getJournal(journal.journalId)?.legs[0]?.txHash).toBe(HASH);
  });
});

describe("[R3] the store is untrusted input", () => {
  it("keeps nothing when nothing in the store parses", () => {
    window.localStorage.setItem(FUNDING_JOURNAL_KEY, "{not json at all");
    expect(readJournals()).toEqual([]);

    window.localStorage.setItem(
      FUNDING_JOURNAL_KEY,
      JSON.stringify({ version: 1, journals: [{ journalId: "x", legs: "not-an-array" }] }),
    );
    expect(readJournals()).toEqual([]);
  });

  it("rejects a record whose amounts are not base-unit decimal strings", () => {
    window.localStorage.setItem(
      FUNDING_JOURNAL_KEY,
      JSON.stringify({
        version: 1,
        journals: [
          {
            journalId: "x",
            wallet: WALLET.toLowerCase(),
            createdAt: T0,
            updatedAt: T0,
            operation: { kind: "invest", targetChainId: ARBITRUM },
            legs: [
              {
                index: 0,
                kind: "bridge",
                chainId: POLYGON,
                tokenIn: USDC_POLYGON,
                tokenOut: USDC_ARBITRUM,
                amountIn: 3000.5,
                minAmountOut: "2996000000",
                status: "planned",
              },
            ],
          },
        ],
      }),
    );

    expect(readJournals()).toEqual([]);
  });

  it("ignores a store written by a future version", () => {
    window.localStorage.setItem(FUNDING_JOURNAL_KEY, JSON.stringify({ version: 2, journals: [] }));
    expect(readJournals()).toEqual([]);
  });
});

describe("[R6] hygiene: bounded, pruned, and never silently abandoned", () => {
  it("keeps a partially-completed journal alive so it stays resumable", () => {
    const journal = newJournal();
    updateLeg(journal.journalId, 0, { status: "settled", settledAt: T0 });

    vi.setSystemTime(T0 + 60_000);
    expect(readJournals().map((entry) => entry.journalId)).toContain(journal.journalId);
  });

  it("prunes a journal whose legs are all terminal", () => {
    const journal = newJournal();
    updateLeg(journal.journalId, 0, { status: "settled", settledAt: T0 });
    updateLeg(journal.journalId, 1, { status: "settled", settledAt: T0 });

    expect(readJournals()).toEqual([]);
  });

  it("keeps an ambiguous leg's journal, because an unknown leg has to be surfaced", () => {
    const journal = newJournal();
    updateLeg(journal.journalId, 0, { status: "settled", settledAt: T0 });
    updateLeg(journal.journalId, 1, { status: "unknown" });

    expect(readJournals()).toHaveLength(1);
  });

  it("prunes a journal older than 24 hours", () => {
    const journal = newJournal();
    vi.setSystemTime(T0 + JOURNAL_MAX_AGE_MS + 1);

    expect(readJournals()).toEqual([]);
    expect(getJournal(journal.journalId)).toBeNull();
  });

  it("bounds the store to the most recent few journals", () => {
    const created = Array.from({ length: JOURNAL_MAX_RECORDS + 2 }, (_, index) => {
      vi.setSystemTime(T0 + index * 1000);
      return newJournal();
    });

    const kept = readJournals().map((entry) => entry.journalId);
    expect(kept).toHaveLength(JOURNAL_MAX_RECORDS);
    expect(kept).not.toContain(created[0]?.journalId);
    expect(kept).toContain(created[created.length - 1]?.journalId);
  });

  it("retires a journal on demand, deleting the record", () => {
    const journal = newJournal();
    retireJournal(journal.journalId);

    expect(getJournal(journal.journalId)).toBeNull();
  });
});

describe("[R3] a journal for another wallet is never acted on", () => {
  it("is invisible to the connected wallet, and is left untouched", () => {
    const foreign = createJournal({
      wallet: OTHER_WALLET,
      operation: { kind: "invest", targetChainId: ARBITRUM },
      legs: plannedLegs(),
    });

    expect(findResumableJournal(WALLET)).toBeNull();
    expect(getJournal(foreign.journalId)).not.toBeNull();
  });

  it("matches the wallet case-insensitively, since addresses are stored lowercased", () => {
    const journal = newJournal();

    expect(journal.wallet).toBe(WALLET.toLowerCase());
    expect(findResumableJournal(WALLET.toUpperCase())?.journalId).toBe(journal.journalId);
  });
});

describe("[R7] two tabs, one journal: a lease, not a lock", () => {
  it("refuses a second tab while the first tab's heartbeat is fresh", () => {
    const journal = newJournal();

    expect(claimLease(journal.journalId, "tab-a")).toBe(true);
    vi.setSystemTime(T0 + LEASE_TTL_MS - 1);
    expect(claimLease(journal.journalId, "tab-b")).toBe(false);
  });

  it("lets the holding tab re-claim its own lease", () => {
    const journal = newJournal();
    claimLease(journal.journalId, "tab-a");

    vi.setSystemTime(T0 + 5_000);
    expect(claimLease(journal.journalId, "tab-a")).toBe(true);
  });

  it("lets another tab take a stale lease, because the holder is gone", () => {
    const journal = newJournal();
    claimLease(journal.journalId, "tab-a");

    vi.setSystemTime(T0 + LEASE_TTL_MS + 1);
    expect(claimLease(journal.journalId, "tab-b")).toBe(true);
  });

  it("keeps the lease alive across the heartbeat window", () => {
    const journal = newJournal();
    claimLease(journal.journalId, "tab-a");

    vi.setSystemTime(T0 + LEASE_TTL_MS - 1_000);
    heartbeatLease(journal.journalId, "tab-a");
    vi.setSystemTime(T0 + LEASE_TTL_MS + 1_000);

    expect(claimLease(journal.journalId, "tab-b")).toBe(false);
  });

  it("releases the lease so another tab can take it immediately", () => {
    const journal = newJournal();
    claimLease(journal.journalId, "tab-a");
    releaseLease(journal.journalId, "tab-a");

    expect(claimLease(journal.journalId, "tab-b")).toBe(true);
  });

  it("ignores a release from a tab that does not hold the lease", () => {
    const journal = newJournal();
    claimLease(journal.journalId, "tab-a");
    releaseLease(journal.journalId, "tab-b");

    expect(claimLease(journal.journalId, "tab-b")).toBe(false);
  });
});

// POO-1075 — the store used to validate as ONE object, so a single unreadable journal discarded
// every sibling, including live in-flight ones belonging to other operations. The concrete way it
// bites: the leg-kind schema widened, then the frontend rolls back, and the older build cannot read
// the newer record. Losing a journal does not lose money (the transactions are on-chain either way),
// it loses the app's memory of which bridge is still in flight, leaving the user to reconcile by
// hand from an explorer. §3.7's "no partial trust" is preserved: a journal is still validated whole
// or dropped whole; only the blast radius is contained.
describe("[R3] one unreadable journal does not take its siblings down", () => {
  const goodJournal = (journalId: string) => ({
    journalId,
    wallet: WALLET.toLowerCase(),
    createdAt: T0,
    updatedAt: T0,
    operation: { kind: "invest", targetChainId: ARBITRUM },
    legs: [
      {
        index: 0,
        kind: "bridge",
        chainId: POLYGON,
        tokenIn: USDC_POLYGON,
        tokenOut: USDC_ARBITRUM,
        destChainId: ARBITRUM,
        amountIn: "3000000000",
        minAmountOut: "2996000000",
        status: "broadcast",
      },
    ],
  });

  it("salvages the readable journals and drops only the bad one", () => {
    window.localStorage.setItem(
      FUNDING_JOURNAL_KEY,
      JSON.stringify({
        version: 1,
        journals: [
          goodJournal("keeps-me"),
          // A leg kind this build's enum does not contain. `bridge-gas` would NOT do here: it is
          // valid in this build, which is the whole asymmetry. This stands in for what a rolled-back
          // build sees when a newer one has written a kind it never knew.
          {
            ...goodJournal("unreadable"),
            legs: [{ ...goodJournal("x").legs[0], kind: "kind-from-a-newer-build" }],
          },
          goodJournal("keeps-me-too"),
        ],
      }),
    );

    expect(readJournals().map((journal) => journal.journalId)).toEqual([
      "keeps-me",
      "keeps-me-too",
    ]);
  });

  it("still refuses a whole store written by a FUTURE version, salvage included", () => {
    // Salvage applies within a version, never across one: a future build may mean something else by
    // the same fields, and a record that happens to satisfy today's schema is not thereby one today's
    // build understands.
    window.localStorage.setItem(
      FUNDING_JOURNAL_KEY,
      JSON.stringify({ version: 2, journals: [goodJournal("from-the-future")] }),
    );

    expect(readJournals()).toEqual([]);
  });
});
