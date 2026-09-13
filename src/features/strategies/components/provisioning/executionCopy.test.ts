/**
 * @id PP-CORE-LIB-060 — tests
 * @name executionStepCopy — tests
 * @implements-rules-version v1 (POO-1084 rules v1)
 *
 * The sub-line under each row of the Running and Step-failed screens. Two properties matter more
 * than any individual string: it always returns an i18n KEY, and every `TxErrorKind` is mapped.
 */

import { describe, expect, it } from "vitest";
import type { TxErrorKind } from "@/lib/tx/diagnostics";
import {
  currentStepPosition,
  executionStepCopy,
  FAILURE_KEYS,
  remainingStepsLabel,
  settledSafe,
} from "./executionCopy";
import type { PlanRow } from "./provisioningView";

/**
 * Every member of the union, listed by hand. A `Record<TxErrorKind, …>` already makes the SOURCE
 * exhaustive at compile time; this list is what makes the TEST fail when a kind is added, instead
 * of quietly covering one fewer case than it did yesterday.
 */
const ALL_KINDS: TxErrorKind[] = [
  "slippage",
  "deadlineExpired",
  "insufficientFunds",
  "userRejected",
  "unauthorized",
  "wrongChain",
  // POO-1385. Missing from this list since the kind was added, which is the exact drift the list is
  // hand-maintained to catch: the source stayed exhaustive by `Record`, the TEST quietly did not.
  "chainUnavailable",
  "alreadyBroadcast",
  "upstreamUnavailable",
  "gasBlocked",
  // POO-1173, the classifier reconciliation. See GENERIC_COPY_KINDS below.
  "reverted",
  "invalidParams",
  "staleState",
  "noRoute",
  "unknown",
];

/**
 * The kinds deliberately EXEMPT from "every kind has its own key", named rather than omitted.
 *
 * POO-1173 added four kinds to stop these failures folding into `unknown` in the product failure
 * rate, and pointed all four at the generic `provisioning.exec.failure.unknown` line on purpose:
 * classification and copy are different jobs, and four dedicated keys across twelve locales (two of
 * them curated rather than machine-translated) is a copy decision that does not belong inside a
 * classifier change. The exemption is written here so it is VISIBLE and expires loudly, instead of
 * being achieved by leaving the four kinds out of `ALL_KINDS` where nothing would ever say why.
 *
 * Follow-up, recorded in `executionCopy.ts`'s `FAILURE_KEYS` block: `staleState` ("refresh and try
 * again") and `noRoute` ("try a different amount") have genuinely actionable remedies and should get
 * their own line. `reverted` and `invalidParams` correctly stay generic: there is nothing the user
 * can do about either, and inventing advice is worse than the generic line. When the copy lands,
 * delete the kind from this list and the uniqueness rule below starts covering it again.
 */
const GENERIC_COPY_KINDS: TxErrorKind[] = ["reverted", "invalidParams", "staleState", "noRoute"];

describe("executionStepCopy", () => {
  it("[F1-R6] a settled step reads Done", () => {
    expect(executionStepCopy({ status: "done" })).toEqual({
      key: "provisioning.exec.status.done",
    });
  });

  it("[F1-R6] the step the wallet is waiting on says so", () => {
    expect(executionStepCopy({ status: "active" })).toEqual({
      key: "provisioning.exec.status.active",
    });
  });

  it("POO-1136: an active fiat buy points at the widget, not the wallet", () => {
    expect(executionStepCopy({ status: "active", inIframe: true })).toEqual({
      key: "provisioning.exec.status.buying",
    });
    // Every non-fiat step keeps the wallet-prompt line.
    expect(executionStepCopy({ status: "active", inIframe: false })).toEqual({
      key: "provisioning.exec.status.active",
    });
  });

  it("[F1-R6] a step that has not run yet reads Waiting while the route is alive", () => {
    expect(executionStepCopy({ status: "idle" })).toEqual({
      key: "provisioning.exec.status.waiting",
    });
  });

  it("[F1-R6] the same step reads Not started once the route has failed", () => {
    // The distinction is the whole point of the failure screen: "Waiting" would suggest the route
    // is still coming for it.
    expect(executionStepCopy({ status: "idle", routeFailed: true })).toEqual({
      key: "provisioning.exec.status.notStarted",
    });
  });

  it("[F1-R6] a skipped step says it was skipped, in both route states", () => {
    expect(executionStepCopy({ status: "skipped" })).toEqual({
      key: "provisioning.exec.status.skipped",
    });
    expect(executionStepCopy({ status: "skipped", routeFailed: true })).toEqual({
      key: "provisioning.exec.status.skipped",
    });
  });

  it("[F5-R6] a slippage failure names the plan's own tolerance, not a constant", () => {
    expect(executionStepCopy({ status: "error", errorKind: "slippage", slippagePct: 0.5 })).toEqual(
      {
        key: "provisioning.exec.failure.slippage",
        values: { pct: 0.5 },
      },
    );
  });

  it("[F5-R6] without a tolerance to quote, the slippage copy drops the figure", () => {
    // POO-799 #1: an unavailable figure is not rendered as a plausible one.
    expect(executionStepCopy({ status: "error", errorKind: "slippage" })).toEqual({
      key: "provisioning.exec.failure.slippageNoPct",
    });
  });

  it("[F5-R6] a non-finite tolerance is treated as no tolerance at all", () => {
    expect(
      executionStepCopy({ status: "error", errorKind: "slippage", slippagePct: Number.NaN }),
    ).toEqual({ key: "provisioning.exec.failure.slippageNoPct" });
  });

  it("[F1-R6] an error with no classification still gets a line", () => {
    expect(executionStepCopy({ status: "error" })).toEqual({
      key: "provisioning.exec.failure.unknown",
    });
  });

  it.each(ALL_KINDS)("[F1-R6] %s maps to a provisioning failure key", (kind) => {
    const copy = executionStepCopy({ status: "error", errorKind: kind });
    expect(copy.key.startsWith("provisioning.exec.failure.")).toBe(true);
  });

  // POO-1173: the allow-list only exempts a kind that IS actually on the generic line. Without this
  // a kind could keep its exemption after earning its own copy, and the uniqueness rule below would
  // stay silently narrower than it looks.
  it.each(GENERIC_COPY_KINDS)("[F1-R6] %s is exempt because it shares the generic line", (kind) => {
    expect(FAILURE_KEYS[kind]).toBe("provisioning.exec.failure.unknown");
  });

  it("[F1-R6] every kind outside the allow-list has its own key: no two failures read the same", () => {
    const owned = ALL_KINDS.filter((kind) => !GENERIC_COPY_KINDS.includes(kind));
    const keys = owned.map((kind) => FAILURE_KEYS[kind]);
    expect(new Set(keys).size).toBe(owned.length);
  });

  it("returns keys only, never copy", () => {
    // A raw string here would bypass i18n for 12 locales and pass every other test in this file.
    const samples = [
      executionStepCopy({ status: "done" }),
      executionStepCopy({ status: "active" }),
      executionStepCopy({ status: "idle" }),
      ...ALL_KINDS.map((kind) => executionStepCopy({ status: "error", errorKind: kind })),
    ];
    for (const copy of samples) {
      expect(copy.key).toMatch(/^provisioning\.exec\.(status|failure)\.[a-zA-Z]+$/);
    }
  });
});

/**
 * POO-1088 rules v2 — [F5-R5] / [F5-R9], the "what already settled and is safe" figure.
 *
 * The cases that matter are the ones where a naive sum of the done rows LIES. A route re-carries the
 * same money: the fixture's swap and its bridge are both $120.40, and they are the same $120.40.
 */
/** A done row of `type`, worth `amountUsd`. Only the fields the figure reads are meaningful. */
function row(
  type: PlanRow["type"],
  amountUsd: number | undefined,
  overrides: Partial<PlanRow> = {},
): PlanRow {
  return {
    key: `${type}-${overrides.index ?? 0}`,
    type,
    index: 1,
    labelKey: "provisioning.steps.op",
    isOp: type === "op",
    isGas: type === "swap-gas",
    isApproval: false,
    status: "done",
    ...(amountUsd === undefined ? {} : { amountUsd }),
    ...overrides,
  };
}

describe("settledSafe", () => {
  it("[F5-R5] nothing has settled → no figure and no claim", () => {
    expect(settledSafe([row("swap-token", 120.4, { status: "idle" })])).toEqual({ kind: "none" });
    expect(settledSafe([])).toEqual({ kind: "none" });
  });

  it("[F5-R5] one settled swap is worth exactly what it converted", () => {
    expect(settledSafe([row("swap-token", 142.1)])).toEqual({ kind: "amount", usd: 142.1 });
  });

  it("[F5-R9] two settled swaps are disjoint sources, so they add up", () => {
    const rows = [row("swap-token", 142.1, { index: 1 }), row("swap-token", 67.9, { index: 2 })];
    expect(settledSafe(rows)).toEqual({ kind: "amount", usd: 210 });
  });

  // The defect a plain sum ships: the bridge is not new money, it is the swap's proceeds moving.
  // Summed, a settled route reports double what the user actually holds.
  it("[F5-R9] a settled bridge SUPERSEDES the swaps that fed it, never adds to them", () => {
    const rows = [row("swap-token", 120.4, { index: 1 }), row("bridge", 120.4, { index: 2 })];
    expect(settledSafe(rows)).toEqual({ kind: "amount", usd: 120.4 });
  });

  it("[F5-R9] and only the swaps BEFORE it: a later source's swap is still its own money", () => {
    const rows = [
      row("swap-token", 142.1, { index: 1 }),
      row("bridge", 142.1, { index: 2 }),
      row("swap-token", 67.9, { index: 3 }),
    ];
    expect(settledSafe(rows)).toEqual({ kind: "amount", usd: 210 });
  });

  it("[F5-R5] an allowance moves nothing, so it settles nothing", () => {
    const rows = [row("swap-token", undefined, { isApproval: true, index: 1 })];
    expect(settledSafe(rows)).toEqual({ kind: "none" });
  });

  it("[F5-R5] gas is spent, not held: it is never counted as safe", () => {
    expect(settledSafe([row("swap-gas", 10)])).toEqual({ kind: "none" });
    expect(settledSafe([row("bridge-gas", 10)])).toEqual({ kind: "none" });
  });

  // [R10] The rule the whole helper exists for: a figure we cannot substantiate is not rounded
  // down, not defaulted and not guessed. The copy drops the amount instead.
  it("[F5-R5] a settled step with no priced amount yields the figure-less variant", () => {
    const rows = [row("swap-token", 142.1, { index: 1 }), row("bridge", undefined, { index: 2 })];
    expect(settledSafe(rows)).toEqual({ kind: "unknown" });
  });

  it("[F5-R5] the op row is a spend, not a settlement", () => {
    // If the op itself is done the route succeeded, and no failure screen renders at all.
    expect(settledSafe([row("op", 200)])).toEqual({ kind: "none" });
  });

  // POO-1142: the bug a blanket "reset on any bridge" ships. A multi-source route can settle a
  // target-chain swap-only source (at rest) BEFORE a foreign source that bridges its OWN balance in.
  // The planner appends each source's legs contiguously, so the swap lands before the bridge, but the
  // bridge's input is the foreign balance, not the swap's output. It carries new money and supersedes
  // nothing. `continuesPrevious === false` is how the view reports "this leg's input is a fresh
  // holding", computed from the legs' endpoints (sameEndpoint), and only a leg that continues the
  // previous one's output may supersede it.
  it("[F5-R9] a foreign bridge does NOT supersede a target-chain swap it never carried", () => {
    const rows = [
      row("swap-token", 100, { index: 1 }),
      row("bridge", 200, { index: 2, continuesPrevious: false }),
    ];
    expect(settledSafe(rows)).toEqual({ kind: "amount", usd: 300 });
  });

  it("[F5-R9] supersedes strictly within the source a leg continues, across interleaved sources", () => {
    const rows = [
      row("swap-token", 100, { index: 1 }), // source A: at rest on the target chain
      row("bridge", 200, { index: 2, continuesPrevious: false }), // source B: its own foreign balance
      row("swap-token", 50, { index: 3, continuesPrevious: false }), // source C: at rest on the target
      row("bridge", 50, { index: 4, continuesPrevious: true }), // source C's swap, now carried
    ];
    // A(100) + B(200) + C(50, carried once) = 350. The B bridge must not cancel A, and the C bridge
    // must cancel only C's swap, never A's.
    expect(settledSafe(rows)).toEqual({ kind: "amount", usd: 350 });
  });

  it("[F5-R9] a bridge supersedes the buy that funded it (the mock on-ramp route)", () => {
    // buy USDC on Base, then bridge it onward: the same money moving, so the furthest-along leg wins.
    const rows = [row("buy", 105, { index: 1 }), row("bridge", 103, { index: 2 })];
    expect(settledSafe(rows)).toEqual({ kind: "amount", usd: 103 });
  });

  // POO-1131: a `buy` carrying native gas ([R1]'s gas-first purchase) is spent on the transaction,
  // not held, exactly like `swap-gas` / `bridge-gas`. Its step type nominally "holds" a delivered
  // balance, so the exclusion rides on the delivered asset (`deliversGas`), not the type name.
  it("[F5-R5] a buy that delivers native gas is never counted as safe-at-rest", () => {
    const rows = [
      row("buy", 12, { index: 1, deliversGas: true }),
      row("swap-token", 100, { index: 2 }),
    ];
    expect(settledSafe(rows)).toEqual({ kind: "amount", usd: 100 });
  });

  it("[F5-R5] a buy that delivers spendable USDC IS counted at rest", () => {
    expect(settledSafe([row("buy", 80, { index: 1 })])).toEqual({ kind: "amount", usd: 80 });
  });

  // The float-add [R9] the micro-dollar accumulation protects: two settled sources whose cents do not
  // sum cleanly in IEEE-754 must still read as their exact total.
  it("[F5-R9] sums disjoint sources in cents, never as drifting floats", () => {
    const rows = [row("swap-token", 0.1, { index: 1 }), row("swap-token", 0.2, { index: 2 })];
    expect(settledSafe(rows)).toEqual({ kind: "amount", usd: 0.3 });
  });
});

/**
 * POO-1507 [R29] — `Step {index} of {total}` and the steps that "will not start", extracted so the
 * stop-confirmation quotes exactly the numbers {@link ExecutionCarousel} is already showing rather
 * than a second count that can drift from it.
 */
describe("currentStepPosition", () => {
  it("no funding steps at all → null", () => {
    expect(currentStepPosition([])).toBeNull();
    // Only the op anchor: it is a label for the operation, never a step the rail runs.
    expect(currentStepPosition([row("op", 200, { index: 1 })])).toBeNull();
  });

  it("the running step is the position, 1-based, op row excluded from the count", () => {
    const rows = [
      row("op", 200, { index: 0 }),
      row("swap-token", 100, { index: 1, status: "done" }),
      row("bridge", 100, { index: 2, status: "active" }),
      row("swap-token", 5, { index: 3, status: "idle" }),
    ];
    expect(currentStepPosition(rows)).toEqual({ index: 2, total: 3, key: "bridge-2" });
  });

  it("no step is active → the failed step is the position", () => {
    const rows = [
      row("swap-token", 100, { index: 1, status: "done" }),
      row("bridge", 100, { index: 2, status: "error" }),
      row("swap-token", 5, { index: 3, status: "idle" }),
    ];
    expect(currentStepPosition(rows)).toEqual({ index: 2, total: 3, key: "bridge-2" });
  });

  it("nothing has run yet → the first idle step is the position", () => {
    const rows = [
      row("swap-token", 100, { index: 1, status: "idle" }),
      row("bridge", 100, { index: 2, status: "idle" }),
    ];
    expect(currentStepPosition(rows)).toEqual({ index: 1, total: 2, key: "swap-token-1" });
  });

  it("every step is done → the last one is the position", () => {
    const rows = [
      row("swap-token", 100, { index: 1, status: "done" }),
      row("bridge", 100, { index: 2, status: "done" }),
    ];
    expect(currentStepPosition(rows)).toEqual({ index: 2, total: 2, key: "bridge-2" });
  });
});

describe("remainingStepsLabel", () => {
  it("no funding steps at all → null", () => {
    expect(remainingStepsLabel([])).toBeNull();
  });

  it("the running step is the last one → nothing left to name", () => {
    const rows = [
      row("swap-token", 100, { index: 1, status: "done" }),
      row("bridge", 100, { index: 2, status: "active" }),
    ];
    expect(remainingStepsLabel(rows)).toBeNull();
  });

  it("exactly one step remains → a single number, not a range", () => {
    const rows = [
      row("swap-token", 100, { index: 1, status: "active" }),
      row("bridge", 100, { index: 2, status: "idle" }),
    ];
    expect(remainingStepsLabel(rows)).toEqual({ count: 1, label: "2" });
  });

  it("more than one step remains → a range from the first to the last", () => {
    const rows = [
      row("swap-token", 100, { index: 1, status: "active" }),
      row("bridge", 100, { index: 2, status: "idle" }),
      row("swap-token", 5, { index: 3, status: "idle" }),
    ];
    expect(remainingStepsLabel(rows)).toEqual({ count: 2, label: "2-3" });
  });

  it("the op anchor is excluded from both the position and what remains", () => {
    const rows = [
      row("op", 200, { index: 0, status: "active" }),
      row("swap-token", 100, { index: 1, status: "active" }),
      row("bridge", 100, { index: 2, status: "idle" }),
    ];
    expect(remainingStepsLabel(rows)).toEqual({ count: 1, label: "2" });
  });
});
