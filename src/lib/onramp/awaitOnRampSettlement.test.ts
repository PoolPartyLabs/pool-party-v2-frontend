/**
 * @id PP-CORE-LIB-110 (POO-1804), spec
 * @name on-ramp settlement observation window, spec
 * @implements-rules-version v1 (POO-1804 rules v1)
 * @epic POO-1793 (Privy on-ramp migration)
 *
 * ADR-0004 and ADR-0006. Fake timers throughout, with `sleep` and `now` injected and bound to the
 * fake clock, so the two windows are exercised at their real durations without the suite waiting.
 *
 * The assertions that matter most are the ones about what is NOT returned, and what is NOT written.
 * A watcher that reports a requested figure instead of an observed one, that says "cancelled" on a
 * path where money could have moved, or that stamps its own stale verdict over a record another
 * observer has already settled, fails silently and looks correct.
 *
 * Bigints are built with `BigInt(...)` rather than the `0n` literal: the repo targets ES2017, where
 * the literal does not compile (TS2737).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ONRAMP_PASSIVE_CEILING_MS,
  ONRAMP_VISIBLE_POLL_MAX_MS,
  ONRAMP_VISIBLE_WINDOW_MS,
  type OnRampObservationInput,
  type OnRampSettlementDeps,
  resumeOnRampObservation,
  watchOnRampSettlementVisible,
} from "./awaitOnRampSettlement";
import {
  clearOnRampIntentsForTests,
  mintOnRampIntent,
  readOnRampIntents,
  recordOnRampDelivery,
} from "./onRampIntent";

const BASE = "eip155:8453";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WALLET = "0x1111111111111111111111111111111111111111";
/** The wallet already held 25 USDC before the purchase. Base units, 6 decimals. */
const BASELINE = BigInt(25_000_000);

/** Mint a real intent so the record transitions are asserted against the shipped store. */
function seedIntent(): string {
  return mintOnRampIntent({
    wallet: WALLET,
    requested: { amount: 100, currency: "USD" },
    prefill: { amount: 105, currency: "USD" },
    destination: { chain: BASE, asset: USDC_BASE },
    baselineRaw: BASELINE.toString(),
    decimals: 6,
  }).attemptId;
}

function input(overrides: Partial<OnRampObservationInput> = {}): OnRampObservationInput {
  return {
    attemptId: seedIntent(),
    destination: { chain: BASE, asset: USDC_BASE },
    address: WALLET,
    baseline: BASELINE,
    decimals: 6,
    moved: "confirmed",
    ...overrides,
  };
}

/** Deps bound to the FAKE clock, so the module's own waits are what the test advances. */
function deps(readBalance: OnRampSettlementDeps["readBalance"]): OnRampSettlementDeps {
  return {
    readBalance,
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };
}

/** A `readBalance` that answers from a queue, repeating its last answer forever. */
function balances(...queue: bigint[]): OnRampSettlementDeps["readBalance"] {
  let i = 0;
  return vi.fn(async () => {
    const value = queue[Math.min(i, queue.length - 1)] as bigint;
    i += 1;
    return value;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  clearOnRampIntentsForTests();
  localStorage.clear();
});

describe("the delta is the only authority on amount (POO-1804 [R1], ADR-0004)", () => {
  // @rule R1
  it("settles on a delta and reports the OBSERVED figure", async () => {
    const d = deps(balances(BASELINE + BigInt(105_000_000)));
    const promise = watchOnRampSettlementVisible(input(), d);
    await vi.advanceTimersByTimeAsync(0);

    const out = await promise;
    expect(out.outcome).toBe("settled");
    if (out.outcome !== "settled") throw new Error("expected a settlement");
    expect(out.delivered.amount).toBe("105");
    expect(out.delivered.asset).toBe(USDC_BASE);
    expect(out.delivered.chain).toBe(BASE);
  });

  // @rule R1 -- the buyer retyped inside the provider's modal, or the spread bit. The observed
  // figure is what we print, and it is SMALLER than anything we asked for.
  it("settles on a SMALLER delta than was requested", async () => {
    const d = deps(balances(BASELINE + BigInt(96_400_000)));
    const promise = watchOnRampSettlementVisible(input(), d);
    await vi.advanceTimersByTimeAsync(0);

    const out = await promise;
    if (out.outcome !== "settled") throw new Error("expected a settlement");
    expect(out.delivered.amount).toBe("96.4");
  });

  // @rule R1
  it("settles on a LARGER delta too, still reporting what was observed", async () => {
    const d = deps(balances(BASELINE + BigInt(120_000_000)));
    const promise = watchOnRampSettlementVisible(input(), d);
    await vi.advanceTimersByTimeAsync(0);

    const out = await promise;
    if (out.outcome !== "settled") throw new Error("expected a settlement");
    expect(out.delivered.amount).toBe("120");
  });

  // @rule R1 -- a zero delta is "nothing has happened", never a settlement of zero.
  it("settles nothing on a zero delta, all the way to the ceiling", async () => {
    const d = deps(balances(BASELINE));
    const promise = watchOnRampSettlementVisible(input(), d);
    await vi.advanceTimersByTimeAsync(ONRAMP_VISIBLE_WINDOW_MS + 60_000);

    expect((await promise).outcome).not.toBe("settled");
  });

  // @rule R1 -- a balance that went DOWN is not a delivery.
  it("does not settle on a negative delta", async () => {
    const d = deps(balances(BASELINE - BigInt(1_000_000)));
    const promise = watchOnRampSettlementVisible(input(), d);
    await vi.advanceTimersByTimeAsync(ONRAMP_VISIBLE_WINDOW_MS + 60_000);

    expect((await promise).outcome).not.toBe("settled");
  });

  // @rule R1 -- a failed read says nothing about where the money is.
  it("retries a failed read and does not end the window on it", async () => {
    const readBalance = vi
      .fn<OnRampSettlementDeps["readBalance"]>()
      .mockRejectedValueOnce(new Error("RPC 502"))
      .mockResolvedValue(BASELINE + BigInt(100_000_000));
    const d = deps(readBalance);
    const promise = watchOnRampSettlementVisible(input(), d);
    await vi.advanceTimersByTimeAsync(ONRAMP_VISIBLE_WINDOW_MS);

    const out = await promise;
    expect(out.outcome).toBe("settled");
    expect(readBalance.mock.calls.length).toBeGreaterThan(1);
  });

  // @rule R1 -- and a window that saw nothing but failures says which failure, so a ceiling reached
  // against a dead RPC is not mistaken for one reached against a healthy chain.
  it("reports the poll count and the last read failure when every read failed", async () => {
    const readBalance = vi
      .fn<OnRampSettlementDeps["readBalance"]>()
      .mockRejectedValue(new Error("RPC 502"));
    const d = deps(readBalance);
    const promise = watchOnRampSettlementVisible(input({ moved: "maybe" }), d);
    await vi.advanceTimersByTimeAsync(ONRAMP_VISIBLE_WINDOW_MS + 60_000);

    const out = await promise;
    expect(out.outcome).toBe("unverified");
    expect(out.lastError).toBe("RPC 502");
    expect(out.polls).toBe(readBalance.mock.calls.length);
    expect(out.polls).toBeGreaterThan(1);
    expect(out.waitedMs).toBeGreaterThanOrEqual(ONRAMP_VISIBLE_WINDOW_MS);
  });

  // @rule R5 -- one `balanceOf`, on the destination only. No fan-out, so no false-zero baseline.
  it("[R5] reads only the destination chain and asset, for the given address", async () => {
    const readBalance = balances(BASELINE);
    const d = deps(readBalance);
    const promise = watchOnRampSettlementVisible(input(), d);
    await vi.advanceTimersByTimeAsync(ONRAMP_VISIBLE_WINDOW_MS + 60_000);
    await promise;

    const calls = (readBalance as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [args] of calls) {
      expect(args).toEqual({ chain: BASE, asset: USDC_BASE, address: WALLET });
    }
  });
});

describe("the visible window and its two ceilings (POO-1804 [R2], [R3])", () => {
  // @rule R3 -- proof of payment exists, so the honest word is `settling`.
  it("[R3] a claim at the visible ceiling is `settling`, never `unverified`", async () => {
    const d = deps(balances(BASELINE));
    const promise = watchOnRampSettlementVisible(input({ moved: "confirmed" }), d);
    await vi.advanceTimersByTimeAsync(ONRAMP_VISIBLE_WINDOW_MS + 60_000);

    expect((await promise).outcome).toBe("settling");
  });

  // @rule R3 -- no proof of payment. `unverified` claims only that we never saw a delta.
  it("[R3] no claim at the visible ceiling is `unverified`", async () => {
    const d = deps(balances(BASELINE));
    const promise = watchOnRampSettlementVisible(input({ moved: "maybe" }), d);
    await vi.advanceTimersByTimeAsync(ONRAMP_VISIBLE_WINDOW_MS + 60_000);

    expect((await promise).outcome).toBe("unverified");
  });

  // @rule R2 -- the visible window is bounded, so the screen is released.
  it("[R2] the visible window ends at its own bound, far short of the passive one", async () => {
    const d = deps(balances(BASELINE));
    // ELAPSED, not the absolute clock: fake timers start at the real epoch, not at zero. And the
    // moment of RESOLUTION is captured inside the promise: reading the clock after the advance
    // would only ever report the advance itself, so the assertion could not fail.
    const startedAt = Date.now();
    let resolvedAt = 0;
    const promise = watchOnRampSettlementVisible(input(), d);
    void promise.then(() => {
      resolvedAt = Date.now();
    });
    await vi.advanceTimersByTimeAsync(ONRAMP_PASSIVE_CEILING_MS);
    await promise;

    // It resolved on the VISIBLE bound even though the clock ran to the passive ceiling.
    expect(resolvedAt - startedAt).toBeGreaterThanOrEqual(ONRAMP_VISIBLE_WINDOW_MS);
    expect(resolvedAt - startedAt).toBeLessThanOrEqual(
      ONRAMP_VISIBLE_WINDOW_MS + ONRAMP_VISIBLE_POLL_MAX_MS,
    );
  });

  // The two windows are genuinely different lengths, which is what makes the split meaningful.
  it("[R2] polls the visible window more often than the passive one", async () => {
    const visibleReads = balances(BASELINE);
    const dv = deps(visibleReads);
    const pv = watchOnRampSettlementVisible(input(), dv);
    await vi.advanceTimersByTimeAsync(ONRAMP_VISIBLE_WINDOW_MS + 60_000);
    await pv;

    const passiveReads = balances(BASELINE);
    const dp = deps(passiveReads);
    const { attemptId, ...rest } = input();
    const pp = resumeOnRampObservation(attemptId, rest, dp);
    await vi.advanceTimersByTimeAsync(ONRAMP_VISIBLE_WINDOW_MS + 60_000);

    const visibleCount = (visibleReads as ReturnType<typeof vi.fn>).mock.calls.length;
    const passiveCount = (passiveReads as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(visibleCount).toBeGreaterThan(passiveCount);

    await vi.advanceTimersByTimeAsync(ONRAMP_PASSIVE_CEILING_MS);
    await pp;
  });
});

describe("the passive window (POO-1804 [R2], [R3], ADR-0006)", () => {
  // @rule R2 -- it outlives the screen and still settles on a delta.
  it("[R2] settles from the passive window when the delta lands late", async () => {
    const readBalance = vi
      .fn<OnRampSettlementDeps["readBalance"]>()
      .mockResolvedValueOnce(BASELINE)
      .mockResolvedValue(BASELINE + BigInt(99_000_000));
    const d = deps(readBalance);
    const { attemptId, ...rest } = input();
    const promise = resumeOnRampObservation(attemptId, rest, d);
    await vi.advanceTimersByTimeAsync(ONRAMP_PASSIVE_CEILING_MS);

    const out = await promise;
    expect(out.outcome).toBe("settled");
    if (out.outcome !== "settled") throw new Error("expected a settlement");
    expect(out.delivered.amount).toBe("99");
  });

  // @rule R3 -- the passive ceiling with no claim is the terminal `unverified`.
  it("[R3] the passive ceiling with no claim is `unverified`", async () => {
    const d = deps(balances(BASELINE));
    const { attemptId, ...rest } = input({ moved: "maybe" });
    const promise = resumeOnRampObservation(attemptId, { ...rest, moved: "maybe" }, d);
    await vi.advanceTimersByTimeAsync(ONRAMP_PASSIVE_CEILING_MS + 60_000);

    expect((await promise).outcome).toBe("unverified");
  });

  // @rule R3 -- a claim survives the passive ceiling as `settling`. It is not downgraded, because
  // the provider still says it charged and nothing has disproved that.
  it("[R3] the passive ceiling WITH a claim stays `settling`", async () => {
    const d = deps(balances(BASELINE));
    const { attemptId, ...rest } = input({ moved: "confirmed" });
    const promise = resumeOnRampObservation(attemptId, { ...rest, moved: "confirmed" }, d);
    await vi.advanceTimersByTimeAsync(ONRAMP_PASSIVE_CEILING_MS + 60_000);

    expect((await promise).outcome).toBe("settling");
  });

  // @rule R2 -- the ceiling belongs to the ATTEMPT, not to the call. An attempt whose budget is
  // already spent must not be handed another full 30 minutes just for being resumed.
  it("[R2] clips the passive ceiling to the attempt's age and ends at once when it is spent", async () => {
    const { attemptId, ...rest } = input({ moved: "maybe" });
    await vi.advanceTimersByTimeAsync(ONRAMP_PASSIVE_CEILING_MS + 60_000);

    // A balance that WOULD settle, to prove the window never opened rather than opened and missed.
    const readBalance = balances(BASELINE + BigInt(105_000_000));
    const d = deps(readBalance);
    const out = await resumeOnRampObservation(attemptId, { ...rest, moved: "maybe" }, d);

    expect(out.outcome).toBe("unverified");
    expect((readBalance as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect(out.polls).toBe(0);
  });
});

describe("the intent record is the substrate (POO-1804, ADR-0007)", () => {
  it("records the delivery on settlement, closing the record", async () => {
    const in1 = input();
    const d = deps(balances(BASELINE + BigInt(105_000_000)));
    const promise = watchOnRampSettlementVisible(in1, d);
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    const [record] = readOnRampIntents();
    expect(record?.attemptId).toBe(in1.attemptId);
    expect(record?.phase).toBe("settled");
    expect(record?.outcome).toBe("settled");
    // Base units are the authority the record stores; the float is its display companion.
    expect(record?.delivered?.amountRaw).toBe("105000000");
    expect(record?.delivered?.amount).toBe(105);
    expect(record?.delivered?.chain).toBe(BASE);
  });

  it("marks the record `settling` at the visible ceiling, and leaves it OPEN", async () => {
    const d = deps(balances(BASELINE));
    const promise = watchOnRampSettlementVisible(input({ moved: "confirmed" }), d);
    await vi.advanceTimersByTimeAsync(ONRAMP_VISIBLE_WINDOW_MS + 60_000);
    await promise;

    const [record] = readOnRampIntents();
    expect(record?.phase).toBe("settling");
    // Still open: the passive phase keeps observing it.
    expect(record?.outcome).toBeNull();
  });

  it("marks the record `unverified` at the visible ceiling, and still leaves it OPEN", async () => {
    const d = deps(balances(BASELINE));
    const promise = watchOnRampSettlementVisible(input({ moved: "maybe" }), d);
    await vi.advanceTimersByTimeAsync(ONRAMP_VISIBLE_WINDOW_MS + 60_000);
    await promise;

    const [record] = readOnRampIntents();
    expect(record?.phase).toBe("unverified");
    expect(record?.outcome).toBeNull();
  });

  it("closes the record as `unverified` only at the PASSIVE ceiling, and only with no claim", async () => {
    const d = deps(balances(BASELINE));
    const { attemptId, ...rest } = input({ moved: "maybe" });
    const promise = resumeOnRampObservation(attemptId, { ...rest, moved: "maybe" }, d);
    await vi.advanceTimersByTimeAsync(ONRAMP_PASSIVE_CEILING_MS + 60_000);
    await promise;

    const [record] = readOnRampIntents();
    expect(record?.phase).toBe("unverified");
    expect(record?.outcome).toBe("unverified");
  });

  it("keeps a claimed record OPEN at the passive ceiling, for support", async () => {
    const d = deps(balances(BASELINE));
    const { attemptId, ...rest } = input({ moved: "confirmed" });
    const promise = resumeOnRampObservation(attemptId, { ...rest, moved: "confirmed" }, d);
    await vi.advanceTimersByTimeAsync(ONRAMP_PASSIVE_CEILING_MS + 60_000);
    await promise;

    const [record] = readOnRampIntents();
    expect(record?.phase).toBe("settling");
    expect(record?.outcome).toBeNull();
  });

  // A second tab watches the same attempt. Its window is not synchronised with this one, so the
  // slower observer must never stamp its own stale verdict over a settled record.
  it("does not downgrade a record another observer already settled, at the VISIBLE ceiling", async () => {
    const in1 = input({ moved: "maybe" });
    let reads = 0;
    const d = deps(async () => {
      reads += 1;
      if (reads === 2) {
        recordOnRampDelivery(in1.attemptId, {
          amountRaw: "105000000",
          amount: 105,
          asset: USDC_BASE,
          chain: BASE,
        });
      }
      return BASELINE;
    });
    const promise = watchOnRampSettlementVisible(in1, d);
    await vi.advanceTimersByTimeAsync(ONRAMP_VISIBLE_WINDOW_MS + 60_000);

    // This window genuinely saw nothing, and says so to ITS caller.
    expect((await promise).outcome).toBe("unverified");
    // The record belongs to the observer that saw the money, and stays settled.
    const [record] = readOnRampIntents();
    expect(record?.phase).toBe("settled");
    expect(record?.outcome).toBe("settled");
    expect(record?.delivered?.amount).toBe(105);
  });

  it("does not close a record another observer already settled, at the PASSIVE ceiling", async () => {
    const { attemptId, ...rest } = input({ moved: "maybe" });
    let reads = 0;
    const d = deps(async () => {
      reads += 1;
      if (reads === 2) {
        recordOnRampDelivery(attemptId, {
          amountRaw: "99000000",
          amount: 99,
          asset: USDC_BASE,
          chain: BASE,
        });
      }
      return BASELINE;
    });
    const promise = resumeOnRampObservation(attemptId, { ...rest, moved: "maybe" }, d);
    await vi.advanceTimersByTimeAsync(ONRAMP_PASSIVE_CEILING_MS + 60_000);

    expect((await promise).outcome).toBe("unverified");
    const [record] = readOnRampIntents();
    expect(record?.phase).toBe("settled");
    expect(record?.outcome).toBe("settled");
    expect(record?.delivered?.amount).toBe(99);
  });
});

describe("no screen may say cancelled (POO-1804 [R4], ADR-0006)", () => {
  // @rule R4 -- exhaustive over every path this module can take.
  it("[R4] the outcome union is exactly settled, settling and unverified", async () => {
    const seen = new Set<string>();

    const settle = deps(balances(BASELINE + BigInt(1)));
    const p1 = watchOnRampSettlementVisible(input(), settle);
    await vi.advanceTimersByTimeAsync(0);
    seen.add((await p1).outcome);

    for (const moved of ["confirmed", "maybe"] as const) {
      const v = deps(balances(BASELINE));
      const pv = watchOnRampSettlementVisible(input({ moved }), v);
      await vi.advanceTimersByTimeAsync(ONRAMP_VISIBLE_WINDOW_MS + 60_000);
      seen.add((await pv).outcome);

      const p = deps(balances(BASELINE));
      const { attemptId, ...rest } = input({ moved });
      const pp = resumeOnRampObservation(attemptId, { ...rest, moved }, p);
      await vi.advanceTimersByTimeAsync(ONRAMP_PASSIVE_CEILING_MS + 60_000);
      seen.add((await pp).outcome);
    }

    expect([...seen].sort()).toEqual(["settled", "settling", "unverified"]);
    expect(seen.has("cancelled")).toBe(false);
  });
});
