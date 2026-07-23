/**
 * @id PP-CORE-LIB-030 (POO-638)
 * @name blockConvergence tests
 * @implements-rules-version v1
 *
 * The deterministic post-write convergence primitives: the block comparator ([R1] converged when
 * onchain.blockNumber >= receipt.blockNumber), the per-strategy pending filter, the bounded backoff,
 * and the single decision function that folds the comparator + the hard cap into one step outcome.
 */
import { describe, expect, it } from "vitest";
import {
  CONVERGENCE_BASE_BACKOFF_MS,
  CONVERGENCE_CAP_MS,
  CONVERGENCE_MAX_BACKOFF_MS,
  convergenceBackoffMs,
  isBlockConverged,
  nextConvergenceStep,
  pendingStrategyIds,
} from "./blockConvergence";

describe("isBlockConverged", () => {
  // @rule R1: converged <=> the indexed onchain block reached (or passed) the mined receipt block.
  it("is true when the onchain block equals the receipt block", () => {
    expect(isBlockConverged(100, 100)).toBe(true);
  });

  // @rule R1
  it("is true when the onchain block is ahead of the receipt block", () => {
    expect(isBlockConverged(101, 100)).toBe(true);
  });

  // @rule R1
  it("is false when the onchain block still lags the receipt block", () => {
    expect(isBlockConverged(99, 100)).toBe(false);
  });

  // @rule R1: a strategy not yet indexed (null/undefined block) is never converged.
  it("is false for a null or undefined onchain block", () => {
    expect(isBlockConverged(null, 100)).toBe(false);
    expect(isBlockConverged(undefined, 100)).toBe(false);
  });
});

describe("pendingStrategyIds", () => {
  // @rule R1: only the strategies whose onchain block still lags stay pending (per touched strategy).
  it("drops the converged strategies and keeps the lagging ones", () => {
    const pending = ["a", "b", "c"];
    const reads = { a: 105, b: 99, c: null };
    expect(pendingStrategyIds(pending, reads, 100)).toEqual(["b", "c"]);
  });

  // @rule R1
  it("returns an empty list when every strategy has converged", () => {
    expect(pendingStrategyIds(["a", "b"], { a: 100, b: 200 }, 100)).toEqual([]);
  });

  // @rule R1: a read that omits a still-pending id keeps it pending (missing = not yet converged).
  it("keeps an id whose read is missing entirely", () => {
    expect(pendingStrategyIds(["a", "b"], { a: 100 }, 100)).toEqual(["b"]);
  });
});

describe("convergenceBackoffMs", () => {
  // @rule R1: bounded backoff — starts at the base delay, grows exponentially.
  it("starts at the base delay and doubles per attempt", () => {
    expect(convergenceBackoffMs(0)).toBe(CONVERGENCE_BASE_BACKOFF_MS);
    expect(convergenceBackoffMs(1)).toBe(CONVERGENCE_BASE_BACKOFF_MS * 2);
    expect(convergenceBackoffMs(2)).toBe(CONVERGENCE_BASE_BACKOFF_MS * 4);
  });

  // @rule R1: the backoff is capped so a long poll spaces observations evenly, never unboundedly.
  it("caps the delay at the max backoff", () => {
    expect(convergenceBackoffMs(99)).toBe(CONVERGENCE_MAX_BACKOFF_MS);
  });
});

describe("nextConvergenceStep", () => {
  const base = { pending: ["a"], targetBlock: 100, attempt: 0, elapsedMs: 0 };

  // @rule R1: all strategies converged -> terminal, reason "converged".
  it("returns done/converged once every pending strategy caught up", () => {
    const step = nextConvergenceStep({ ...base, reads: { a: 100 } });
    expect(step).toEqual({ done: true, reason: "converged" });
  });

  // @rule R1: still lagging AND under the cap -> keep polling with the next backoff delay.
  it("keeps polling with the next backoff when still lagging and under the cap", () => {
    const step = nextConvergenceStep({ ...base, reads: { a: 99 }, attempt: 1, elapsedMs: 1000 });
    expect(step).toEqual({
      done: false,
      pending: ["a"],
      nextDelayMs: convergenceBackoffMs(1),
    });
  });

  // @rule R1: the HARD CAP terminates a poll that never converges (indexer stuck past the window).
  it("returns done/capped when the elapsed time reaches the hard cap and it has not converged", () => {
    const step = nextConvergenceStep({ ...base, reads: { a: 99 }, elapsedMs: CONVERGENCE_CAP_MS });
    expect(step).toEqual({ done: true, reason: "capped" });
  });

  // @rule R1: convergence WINS over the cap — a tick that both converges and hits the cap is "converged".
  it("prefers converged over capped when both hold on the same tick", () => {
    const step = nextConvergenceStep({
      ...base,
      reads: { a: 100 },
      elapsedMs: CONVERGENCE_CAP_MS + 5000,
    });
    expect(step).toEqual({ done: true, reason: "converged" });
  });

  // @rule R1: the pending set shrinks per tick — a partially-converged multi-strategy write keeps
  // polling only the still-lagging ids.
  it("narrows the pending set to the still-lagging strategies while polling continues", () => {
    const step = nextConvergenceStep({
      pending: ["a", "b"],
      reads: { a: 100, b: 98 },
      targetBlock: 100,
      attempt: 0,
      elapsedMs: 500,
    });
    expect(step).toEqual({ done: false, pending: ["b"], nextDelayMs: convergenceBackoffMs(0) });
  });
});
