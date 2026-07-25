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
  it("discards the WHOLE store on a parse failure rather than salvaging part of it", () => {
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
