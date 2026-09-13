/**
 * @id PP-CORE-LIB-107 (POO-1802), spec
 * @name on-ramp intent record, spec
 * @implements-rules-version v1 (POO-1802 rules v1)
 * @epic POO-1793 (Privy on-ramp migration)
 *
 * ADR-0007: Privy returns no identifier for a fiat purchase on any path, and its concurrency guard
 * is tab-scoped, so it survives neither a reload, nor a second tab, nor a buyer returning tomorrow.
 * This store is the only place the attempt exists. These tests run against jsdom's real
 * `localStorage`, cleared between tests, and they treat the stored blob as UNTRUSTED input, because
 * it is: any XSS or browser extension can write it, and it gates a money decision.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOnRampIntentsForTests,
  findOpenOnRampIntent,
  mintOnRampIntent,
  ONRAMP_INTENT_KEY,
  ONRAMP_INTENT_MAX_RECORDS,
  ONRAMP_INTENT_OPEN_WINDOW_MS,
  ONRAMP_INTENT_RETENTION_MS,
  ONRAMP_INTENT_SCHEMA_VERSION,
  type OnRampIntentRecord,
  readOnRampIntents,
  recordOnRampDelivery,
  updateOnRampIntent,
} from "./onRampIntent";

/** Base (8453) USDC, in the CAIP-2 + address shape POO-1801 owns the helpers for. */
const BASE = "eip155:8453";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** The SIWE-session wallet, deliberately given here in checksum casing: the store lowercases. */
const WALLET = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01";
const WALLET_LOWER = WALLET.toLowerCase();
const OTHER_WALLET = "0x1111111111111111111111111111111111111111";

/** The buyer typed 100; the buffer meant we actually passed 105. That gap is the point of [R2]. */
function mintInput() {
  return {
    wallet: WALLET,
    requested: { amount: 100, currency: "USD" },
    prefill: { amount: 105, currency: "USD" },
    destination: { chain: BASE, asset: USDC_BASE },
    // 250 USDC already in the wallet before the checkout opened, in base units at 6 decimals.
    baselineRaw: "250000000",
    decimals: 6,
    traceId: "trace-abc",
  };
}

/** A delivery as the watcher (POO-1804) reports it: the raw delta is the authority. */
function delivery(amount: number, amountRaw: string) {
  return { amount, amountRaw, asset: USDC_BASE, chain: BASE };
}

/** Write a raw store blob, bypassing the module, to simulate a tampered or foreign record. */
function writeRaw(records: unknown[], version: number = ONRAMP_INTENT_SCHEMA_VERSION): void {
  localStorage.setItem(
    ONRAMP_INTENT_KEY,
    JSON.stringify({ schemaVersion: version, intents: records }),
  );
}

/**
 * A `now` a second after {@link validRaw}'s timestamps, so a schema test asserts the SCHEMA. Reading
 * with the real clock instead prunes a 2023 record on retention and the assertion passes whatever
 * the schema does: every "drops a record" test below was green against a schema with no `wallet`
 * field at all before this was anchored.
 */
const RAW_NOW = 1_700_000_001_000;

/** A structurally valid record, so a test can vary exactly one field and nothing else. */
function validRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    attemptId: "attempt-1",
    rail: "privy",
    wallet: WALLET_LOWER,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    requested: { amount: 100, currency: "USD" },
    prefill: { amount: 105, currency: "USD" },
    destination: { chain: BASE, asset: USDC_BASE },
    baselineRaw: "250000000",
    decimals: 6,
    delivered: null,
    phase: "created",
    outcome: null,
    traceId: null,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("mintOnRampIntent (POO-1802)", () => {
  // @rule R1
  it("mints our own attempt id, unique per attempt", () => {
    const first = mintOnRampIntent(mintInput());
    const second = mintOnRampIntent(mintInput());

    expect(first.attemptId).toBeTruthy();
    expect(second.attemptId).toBeTruthy();
    expect(first.attemptId).not.toBe(second.attemptId);
  });

  // @rule R1 -- the id is OURS. A provider value must never be able to become the key, because the
  // provider gives us none and anything it did give us would be unverifiable.
  it("never takes an attempt id from its input", () => {
    const minted = mintOnRampIntent({
      ...mintInput(),
      // Deliberately shaped like a caller trying to supply one.
      attemptId: "provider-supplied",
    } as Parameters<typeof mintOnRampIntent>[0]);

    expect(minted.attemptId).not.toBe("provider-supplied");
  });

  // @rule R1
  it("starts at `created`, undelivered and unresolved", () => {
    const minted = mintOnRampIntent(mintInput());

    expect(minted.phase).toBe("created");
    expect(minted.outcome).toBeNull();
    expect(minted.delivered).toBeNull();
    expect(minted.rail).toBe("privy");
  });
});

describe("the record shape (POO-1802 [R2])", () => {
  // @rule R2
  it("round-trips a full record through the schema", () => {
    const minted = mintOnRampIntent(mintInput());
    updateOnRampIntent(minted.attemptId, { phase: "confirmed" });
    recordOnRampDelivery(minted.attemptId, delivery(99.12, "99120000"));

    const [stored] = readOnRampIntents();
    expect(stored).toMatchObject({
      attemptId: minted.attemptId,
      rail: "privy",
      wallet: WALLET_LOWER,
      requested: { amount: 100, currency: "USD" },
      prefill: { amount: 105, currency: "USD" },
      destination: { chain: BASE, asset: USDC_BASE },
      baselineRaw: "250000000",
      decimals: 6,
      delivered: { amount: 99.12, amountRaw: "99120000", asset: USDC_BASE, chain: BASE },
      phase: "settled",
      outcome: "settled",
      traceId: "trace-abc",
    });
    expect(Number.isFinite(stored?.delivered?.observedAt)).toBe(true);
  });

  // @rule R2 -- the `-Infinity` incident the journal header records: `z.number()` ACCEPTS Infinity,
  // and `JSON.parse('{"createdAt":1e999}')` produces exactly that, which passed every age bound.
  it("drops a record whose timestamp is not finite", () => {
    localStorage.setItem(
      ONRAMP_INTENT_KEY,
      `{"schemaVersion":${ONRAMP_INTENT_SCHEMA_VERSION},"intents":[${JSON.stringify(validRaw()).replace('"createdAt":1700000000000', '"createdAt":1e999')}]}`,
    );

    expect(readOnRampIntents(RAW_NOW)).toEqual([]);
  });

  // @rule R2
  it("drops a record whose phase is not in the vocabulary", () => {
    writeRaw([validRaw({ phase: "in_progress" })]);

    expect(readOnRampIntents(RAW_NOW)).toEqual([]);
  });

  // @rule R2
  it("drops a record with a missing field", () => {
    const { prefill: _dropped, ...withoutPrefill } = validRaw();
    writeRaw([withoutPrefill]);

    expect(readOnRampIntents(RAW_NOW)).toEqual([]);
  });

  // @rule R2 -- the baseline is a BASE-UNIT integer string. A float here would be a float where the
  // watcher expects a bigint, which is the one place money math must never touch a JS number.
  it("drops a record whose baseline is not a base-unit integer string", () => {
    writeRaw([validRaw({ baselineRaw: "250.5" })]);
    expect(readOnRampIntents(RAW_NOW)).toEqual([]);

    localStorage.clear();
    writeRaw([validRaw({ baselineRaw: 250_000_000 })]);
    expect(readOnRampIntents(RAW_NOW)).toEqual([]);
  });

  // @rule R2
  it("drops a record whose decimals are not an integer", () => {
    writeRaw([validRaw({ decimals: 6.5 })]);

    expect(readOnRampIntents(RAW_NOW)).toEqual([]);
  });

  // @rule R2
  it("drops a record with no wallet", () => {
    const { wallet: _dropped, ...withoutWallet } = validRaw();
    writeRaw([withoutWallet]);

    expect(readOnRampIntents(RAW_NOW)).toEqual([]);
  });

  // @rule R2
  it("ignores a store written by a future schema version", () => {
    writeRaw([validRaw()], ONRAMP_INTENT_SCHEMA_VERSION + 1);

    expect(readOnRampIntents(RAW_NOW)).toEqual([]);
  });
});

describe("the record is keyed per wallet (POO-1802 [R1], precedent onRampJournal.ts:167)", () => {
  // @rule R1
  it("lowercases the wallet at mint", () => {
    const minted = mintOnRampIntent(mintInput());

    expect(minted.wallet).toBe(WALLET_LOWER);
  });

  // @rule R1 -- WalletSwitchGuard exists because a buyer switches from A to B inside one session,
  // and wagmi already persists the address in this same profile. An unscoped read would offer
  // wallet B a reconcile against wallet A's purchase.
  it("never returns another wallet's open intent", () => {
    mintOnRampIntent(mintInput());

    expect(findOpenOnRampIntent(OTHER_WALLET)).toBeNull();
    expect(findOpenOnRampIntent(WALLET)?.wallet).toBe(WALLET_LOWER);
  });

  // @rule R1
  it("matches regardless of the casing the caller passes", () => {
    const minted = mintOnRampIntent(mintInput());

    expect(findOpenOnRampIntent(WALLET_LOWER)?.attemptId).toBe(minted.attemptId);
    expect(findOpenOnRampIntent(WALLET.toUpperCase())?.attemptId).toBe(minted.attemptId);
  });
});

describe("retention (POO-1802 [R3])", () => {
  // @rule R3
  it("prunes a record older than the retention window", () => {
    const t0 = 1_700_000_000_000;
    const minted = mintOnRampIntent(mintInput(), t0);

    expect(readOnRampIntents(t0 + ONRAMP_INTENT_RETENTION_MS - 1)).toHaveLength(1);
    expect(readOnRampIntents(t0 + ONRAMP_INTENT_RETENTION_MS + 1)).toEqual([]);
    expect(minted.createdAt).toBe(t0);
  });

  // @rule R3
  it("keeps the newest when the cap is exceeded", () => {
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < ONRAMP_INTENT_MAX_RECORDS + 5; i += 1) {
      mintOnRampIntent(mintInput(), t0 + i);
    }

    const kept = readOnRampIntents(t0 + 100);
    expect(kept).toHaveLength(ONRAMP_INTENT_MAX_RECORDS);
    // Newest first, and the newest is the last minted.
    expect(kept[0]?.createdAt).toBe(t0 + ONRAMP_INTENT_MAX_RECORDS + 4);
  });

  // @rule R3 -- a terminal record is the SUPPORT REFERENCE. Completing must not delete it.
  it("keeps a settled record rather than removing it on completion", () => {
    const minted = mintOnRampIntent(mintInput());
    recordOnRampDelivery(minted.attemptId, delivery(99, "99000000"));

    const kept = readOnRampIntents();
    expect(kept).toHaveLength(1);
    expect(kept[0]?.outcome).toBe("settled");
  });

  // @rule R3 -- outlives the SESSION, not just the call: a fresh module instance against the same
  // storage still sees it. This is the reload, the second tab and the buyer returning tomorrow.
  it("survives a reload: a new module instance reads the same storage", async () => {
    const minted = mintOnRampIntent(mintInput());
    recordOnRampDelivery(minted.attemptId, delivery(99, "99000000"));

    vi.resetModules();
    const reloaded = await import("./onRampIntent");

    const kept = reloaded.readOnRampIntents();
    expect(kept).toHaveLength(1);
    expect(kept[0]?.attemptId).toBe(minted.attemptId);
    expect(kept[0]?.delivered?.amount).toBe(99);
  });
});

describe("the three questions the record answers (POO-1802 [R4])", () => {
  // @rule R4 -- (1) did the buyer change the amount inside the modal? requested vs prefill.
  //             (2) what did the spread cost? prefill vs delivered.
  //             (3) where did a failed attempt stop? phase + outcome.
  it("holds requested, prefill and delivered independently on one record", () => {
    const minted = mintOnRampIntent(mintInput());
    recordOnRampDelivery(minted.attemptId, delivery(96.4, "96400000"));

    const [record] = readOnRampIntents();
    expect(record?.requested.amount).toBe(100);
    expect(record?.prefill.amount).toBe(105);
    expect(record?.delivered?.amount).toBe(96.4);
    // The three are genuinely distinct figures, which is the whole point: the buffer is the gap
    // between the first two, the spread is the gap between the second and the third.
    expect(new Set([100, 105, 96.4]).size).toBe(3);
  });

  // @rule R4 -- where a failed attempt stopped.
  it("records the phase reached and how it ended for a failure", () => {
    const minted = mintOnRampIntent(mintInput());
    updateOnRampIntent(minted.attemptId, { phase: "exited" });
    const failed = updateOnRampIntent(minted.attemptId, { phase: "failed", outcome: "failed" });

    expect(failed?.phase).toBe("failed");
    expect(failed?.outcome).toBe("failed");
    expect(failed?.delivered).toBeNull();
  });
});

describe("the delivered figure (ADR-0004)", () => {
  // @rule R2 -- `amountRaw` is the AUTHORITY: base units, exactly as the chain reported the delta.
  // The float beside it is for a screen and a support answer, never for arithmetic, and the
  // downstream watcher (POO-1804) and hosts (POO-1807/1808) read the raw one.
  it("stores the raw base-unit delta beside the display figure", () => {
    const minted = mintOnRampIntent(mintInput());
    const settled = recordOnRampDelivery(minted.attemptId, delivery(0.1, "100000"));

    expect(settled?.delivered?.amountRaw).toBe("100000");
    expect(settled?.delivered?.amount).toBe(0.1);
  });

  // @rule R2 -- a raw figure that is not a base-unit integer is not a raw figure.
  it("drops a record whose delivered raw amount is not a base-unit integer string", () => {
    writeRaw([
      validRaw({
        delivered: {
          amount: 99,
          amountRaw: "99.0",
          asset: USDC_BASE,
          chain: BASE,
          observedAt: 1_700_000_000_000,
        },
      }),
    ]);

    expect(readOnRampIntents(RAW_NOW)).toEqual([]);
  });
});

describe("updateOnRampIntent", () => {
  it("moves `updatedAt` and leaves `createdAt` alone", () => {
    const t0 = 1_700_000_000_000;
    const minted = mintOnRampIntent(mintInput(), t0);
    const updated = updateOnRampIntent(minted.attemptId, { phase: "opened" }, t0 + 5_000);

    expect(updated?.createdAt).toBe(t0);
    expect(updated?.updatedAt).toBe(t0 + 5_000);
  });

  it("returns undefined for an unknown attempt id, and writes nothing", () => {
    mintOnRampIntent(mintInput());

    expect(updateOnRampIntent("no-such-attempt", { phase: "opened" })).toBeUndefined();
    expect(readOnRampIntents()[0]?.phase).toBe("created");
  });

  it("refuses a delivery for an unknown attempt id", () => {
    expect(recordOnRampDelivery("no-such-attempt", delivery(1, "1000000"))).toBeUndefined();
  });

  // ADR-0004: the on-chain delta is the sole authority on a funded amount, so `settled` is not a
  // phase a caller may simply assert. The type refuses it, and the runtime refuses it too, because
  // this store is reached from JavaScript that TypeScript never checked.
  it("refuses an outcome of `settled`, which only a delivery may write", () => {
    const minted = mintOnRampIntent(mintInput());

    // @ts-expect-error -- `settled` is excluded from OnRampIntentPatch on purpose.
    const refused = updateOnRampIntent(minted.attemptId, { outcome: "settled" });

    expect(refused).toBeUndefined();
    expect(readOnRampIntents()[0]?.outcome).toBeNull();
    expect(readOnRampIntents()[0]?.delivered).toBeNull();
  });
});

describe("concurrent writers (multi-tab)", () => {
  /**
   * A second tab writes between the moment we read the store and the moment we write it back. The
   * whole-array write loses that tab's record entirely; a write that re-reads and unions by
   * `attemptId` loses at most the fields of the record it is itself editing.
   *
   * The injection hangs off the FIRST `getItem` for our key, which is exactly "after we read".
   */
  function installConcurrentWriter(record: Record<string, unknown>): void {
    const realGetItem = Storage.prototype.getItem;
    let injected = false;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      const value = realGetItem.call(this, key);
      if (!injected && key === ONRAMP_INTENT_KEY) {
        injected = true;
        const existing = value ? (JSON.parse(value).intents as unknown[]) : [];
        localStorage.setItem(
          ONRAMP_INTENT_KEY,
          JSON.stringify({
            schemaVersion: ONRAMP_INTENT_SCHEMA_VERSION,
            intents: [record, ...existing],
          }),
        );
      }
      return value;
    });
  }

  it("keeps a record another tab wrote while `updateOnRampIntent` was running", () => {
    const t0 = 1_700_000_000_000;
    const mine = mintOnRampIntent(mintInput(), t0);
    const theirs = validRaw({ attemptId: "other-tab", createdAt: t0 + 1, updatedAt: t0 + 1 });
    installConcurrentWriter(theirs);

    updateOnRampIntent(mine.attemptId, { phase: "opened" }, t0 + 2);

    const ids = readOnRampIntents(t0 + 3).map((record) => record.attemptId);
    expect(ids).toContain("other-tab");
    expect(ids).toContain(mine.attemptId);
  });

  it("keeps a record another tab wrote while `mintOnRampIntent` was running", () => {
    const t0 = 1_700_000_000_000;
    const theirs = validRaw({ attemptId: "other-tab", createdAt: t0, updatedAt: t0 });
    installConcurrentWriter(theirs);

    const mine = mintOnRampIntent(mintInput(), t0 + 1);

    const ids = readOnRampIntents(t0 + 2).map((record) => record.attemptId);
    expect(ids).toContain("other-tab");
    expect(ids).toContain(mine.attemptId);
  });

  it("keeps a record another tab wrote while `recordOnRampDelivery` was running", () => {
    const t0 = 1_700_000_000_000;
    const mine = mintOnRampIntent(mintInput(), t0);
    const theirs = validRaw({ attemptId: "other-tab", createdAt: t0 + 1, updatedAt: t0 + 1 });
    installConcurrentWriter(theirs);

    recordOnRampDelivery(mine.attemptId, delivery(99, "99000000"), t0 + 2);

    const stored = readOnRampIntents(t0 + 3);
    expect(stored.map((record) => record.attemptId)).toContain("other-tab");
    expect(stored.find((record) => record.attemptId === mine.attemptId)?.outcome).toBe("settled");
  });
});

describe("findOpenOnRampIntent (the ADR-0006 reconcile-on-return hook)", () => {
  it("returns the newest intent that has not resolved", () => {
    const t0 = 1_700_000_000_000;
    mintOnRampIntent(mintInput(), t0);
    const newer = mintOnRampIntent(mintInput(), t0 + 1_000);

    expect(findOpenOnRampIntent(WALLET, t0 + 2_000)?.attemptId).toBe(newer.attemptId);
  });

  it("ignores terminal records", () => {
    const minted = mintOnRampIntent(mintInput());
    recordOnRampDelivery(minted.attemptId, delivery(99, "99000000"));

    expect(findOpenOnRampIntent(WALLET)).toBeNull();
  });

  // `unverified` is the passive-window terminal (ADR-0006): observation ended without a delta, so it
  // is resolved as far as reconcile-on-return is concerned, even though nothing was confirmed.
  it("treats `unverified` as resolved", () => {
    const minted = mintOnRampIntent(mintInput());
    updateOnRampIntent(minted.attemptId, { phase: "unverified", outcome: "unverified" });

    expect(findOpenOnRampIntent(WALLET)).toBeNull();
  });

  it("returns null with nothing stored", () => {
    expect(findOpenOnRampIntent(WALLET)).toBeNull();
  });
});

describe("the openness window is not the retention window (POO-1384's lesson)", () => {
  const t0 = 1_700_000_000_000;

  // Precedent: `ONRAMP_REQUEST_RESUMABLE_MS` (onRampJournal.ts:60) and the age bound at
  // onRampJournal.ts:187-205. A tab that died before any charge leaves an intent open forever if
  // openness is bounded only by retention, and reconcile-on-return then watches a purchase that
  // never happened, every visit, for 30 days.
  it("stops offering a never-confirmed intent once the openness window passes", () => {
    mintOnRampIntent(mintInput(), t0);

    expect(findOpenOnRampIntent(WALLET, t0 + ONRAMP_INTENT_OPEN_WINDOW_MS - 1)).not.toBeNull();
    expect(findOpenOnRampIntent(WALLET, t0 + ONRAMP_INTENT_OPEN_WINDOW_MS + 1)).toBeNull();
  });

  // The opposite case, and the reason the bound cannot simply be retention: a confirmed charge may
  // take hours to land. Expiring THAT would offer a second purchase beside money still moving.
  it("keeps a confirmed intent open with no age bound", () => {
    const minted = mintOnRampIntent(mintInput(), t0);
    updateOnRampIntent(minted.attemptId, { phase: "confirmed" }, t0 + 1_000);

    expect(findOpenOnRampIntent(WALLET, t0 + ONRAMP_INTENT_OPEN_WINDOW_MS + 1)?.attemptId).toBe(
      minted.attemptId,
    );
    expect(findOpenOnRampIntent(WALLET, t0 + ONRAMP_INTENT_RETENTION_MS - 1)?.attemptId).toBe(
      minted.attemptId,
    );
  });

  // Confirmation is durable: the phase moves on into the observation window, and the intent must
  // not become age-bounded again just because `confirmed` is no longer the current phase.
  it("keeps it open after the phase moves on from `confirmed`", () => {
    const minted = mintOnRampIntent(mintInput(), t0);
    updateOnRampIntent(minted.attemptId, { phase: "confirmed" }, t0 + 1_000);
    updateOnRampIntent(minted.attemptId, { phase: "settling" }, t0 + 2_000);

    expect(findOpenOnRampIntent(WALLET, t0 + ONRAMP_INTENT_OPEN_WINDOW_MS + 1)?.attemptId).toBe(
      minted.attemptId,
    );
  });

  // Openness is narrower than retention, never wider: retention still ends it.
  it("drops a confirmed intent once retention ends", () => {
    const minted = mintOnRampIntent(mintInput(), t0);
    updateOnRampIntent(minted.attemptId, { phase: "confirmed" }, t0 + 1_000);

    expect(findOpenOnRampIntent(WALLET, t0 + ONRAMP_INTENT_RETENTION_MS + 1)).toBeNull();
  });
});

describe("storage guards", () => {
  it("degrades to empty when localStorage access throws", () => {
    mintOnRampIntent(mintInput());
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("access denied (private mode)");
      },
    });

    // try/finally, so a failing expectation cannot leave a throwing `localStorage` behind for
    // every later test in this file.
    try {
      expect(readOnRampIntents()).toEqual([]);
      // A write must not throw either: a full or unavailable store cannot break a purchase flow.
      expect(() => mintOnRampIntent(mintInput())).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });

  it("discards a corrupt blob rather than salvaging part of it", () => {
    localStorage.setItem(ONRAMP_INTENT_KEY, "{not json");

    expect(readOnRampIntents()).toEqual([]);
  });

  it("clearOnRampIntentsForTests empties the store", () => {
    mintOnRampIntent(mintInput());
    clearOnRampIntentsForTests();

    expect(readOnRampIntents()).toEqual([]);
  });
});

describe("the record is typed as the module says", () => {
  it("exposes a record type whose delivered figure is nullable", () => {
    const minted: OnRampIntentRecord = mintOnRampIntent(mintInput());
    expect(minted.delivered).toBeNull();
  });
});
