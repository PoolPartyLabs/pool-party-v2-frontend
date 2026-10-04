/**
 * @id PP-MGR-LIB-028
 * @name planReadiness tests
 * @implements-rules-version v1 (POO-2184 rules v1); POO-2204 rules v1
 * @analytics-events none, a test of a pure function; the reasons it returns are asserted, not
 *   emitted.
 *
 * Verification finding 4 (A2): the pure part of S7's Next: Review gate, extended with what the
 * launch needs. S7's checks keep their order (its own tests in `buildScreenModel.test.ts` pin it);
 * PA1's checks run after them, so a plan S7 refused gets the same answer, and only a plan S7 let
 * through can meet a new one:
 *
 * - [RD1] a pool block whose config is picked but not finished (no range, no slippage yet);
 * - [RD2] a chain whose share is not a whole percent above 0 (the launch takes neither);
 * - [RD3] a chain with more than one position, or anything under a Supply;
 * - [RD4] a second Supply of the same reserve on one network;
 * - [RD5] a Swap in a chain with no pool (a Supply of a token other than the one that arrives, or a
 *   manager Swap): the launch runs no swap outside a pool yet;
 * - [RD6] a spoke holding more than the sum of its chains (an empty spoke that kept its share, or
 *   a share that is not whole): the launch would bridge capital nothing deploys, or refuse
 *   (review M1 of PR #51). It runs right after the 0% check, with the other share checks.
 *
 * Each refusal names the block to REVEAL (never to select), or null.
 */
import { describe, expect, it } from "vitest";
import type { BuildPlan, Chain, Step } from "./buildPlan";
import { validatePlan } from "./planInvariants";
import { PLAN_READINESS_REFUSALS, planReadiness } from "./planReadiness";
import {
  hubPoolPlan,
  hubSupplyPlan,
  makeTestContext,
  spokePoolPlan,
  supplyBorrowPlan,
  TEST_ASSET_KEYS,
  TEST_POOL_IDS,
  withCompletePools,
} from "./planTestKit";

function readinessOf(plan: BuildPlan) {
  return planReadiness(plan, validatePlan(plan, makeTestContext()));
}

function hubOf(...chains: Chain[]): BuildPlan {
  return { version: 1, hub: { chains }, spokes: [] };
}

function firstChain(plan: BuildPlan): Chain {
  const chain = plan.hub.chains[0] ?? plan.spokes[0]?.chains[0];
  if (!chain) throw new Error("fixture: no chain");
  return chain;
}

function supplyChain(id: string, pct: number, assetKey: string, before: Step[] = []): Chain {
  return {
    id,
    sharePct: pct,
    steps: [
      ...before,
      { id: `${id}-supply`, family: "position", kind: "aaveSupply", config: { assetKey } },
    ],
  };
}

/** The demo plan: a hub pool at 60 with its full config, and a hub Supply USDC at 40. */
function readyPlan(): BuildPlan {
  return hubOf(firstChain(withCompletePools(hubPoolPlan())), firstChain(hubSupplyPlan()));
}

describe("planReadiness: a ready plan (finding 4)", () => {
  it("calls the demo plan ready: a configured pool and a Supply USDC, each with a share", () => {
    expect(readinessOf(readyPlan())).toEqual({ ready: true });
  });

  it("calls a spoke pool chain ready once its config is complete", () => {
    expect(readinessOf(withCompletePools(spokePoolPlan()))).toEqual({ ready: true });
  });

  it("lists S7's checks first and PA1's after them, in the order they run", () => {
    expect(PLAN_READINESS_REFUSALS).toEqual([
      "review_empty_plan",
      "review_invalid_block",
      "review_coming_soon_block",
      "review_empty_block",
      "review_over_share",
      "review_incomplete_block",
      "review_zero_share",
      "review_unused_spoke_share",
      "review_stacked_positions",
      "review_duplicate_reserve",
      "review_unsupported_swap",
    ]);
  });
});

describe("planReadiness: what the launch needs before Review (RD1 to RD5)", () => {
  it("[RD1] refuses a pool picked but not finished, and reveals it", () => {
    // @rule RD1
    expect(readinessOf(hubPoolPlan())).toEqual({
      ready: false,
      refusal: "review_incomplete_block",
      target: { kind: "block", blockId: "hub-pool-pool" },
    });
  });

  it("[R4] accepts a deferred pool beside an executable position", () => {
    // @rule RD2
    const plan = readyPlan();
    firstChain(plan).sharePct = 0;
    expect(readinessOf(plan)).toEqual({ ready: true });
  });

  it("[RD2] refuses a share that is not a whole percent", () => {
    // @rule RD2
    const plan = readyPlan();
    firstChain(plan).sharePct = 12.5;
    expect(readinessOf(plan)).toMatchObject({ refusal: "review_zero_share" });
  });

  it("[RD6] refuses a spoke holding more than its chains, and reveals the network", () => {
    // @rule RD6
    for (const spokePct of [45, 40.5]) {
      const plan = withCompletePools(spokePoolPlan());
      const spoke = plan.spokes[0];
      if (!spoke) throw new Error("fixture: no spoke");
      spoke.sharePct = spokePct;
      expect(readinessOf(plan)).toEqual({
        ready: false,
        refusal: "review_unused_spoke_share",
        target: { kind: "network", network: "robinhood" },
      });
    }
  });

  it("[RD6] refuses a spoke whose last chain went and whose share stayed", () => {
    // @rule RD6
    const plan: BuildPlan = {
      ...readyPlan(),
      spokes: [{ network: "robinhood", sharePct: 0, chains: [] }],
    };
    expect(readinessOf(plan)).toEqual({ ready: true });
    const hub = firstChain(plan);
    hub.sharePct = 30;
    const stranded: BuildPlan = {
      ...plan,
      spokes: [{ network: "robinhood", sharePct: 30, chains: [] }],
    };
    expect(readinessOf(stranded)).toMatchObject({
      refusal: "review_unused_spoke_share",
      target: { kind: "network", network: "robinhood" },
    });
  });

  it("[RD3] refuses a Borrow under a Supply, and reveals the Borrow", () => {
    // @rule RD3
    expect(readinessOf(supplyBorrowPlan())).toEqual({
      ready: false,
      refusal: "review_stacked_positions",
      target: { kind: "block", blockId: "hub-aave-borrow" },
    });
  });

  it("[RD3] refuses a manager Swap under a Supply", () => {
    // @rule RD3
    const chain = supplyChain("c", 40, TEST_ASSET_KEYS.usdcArbitrum);
    chain.steps.push({ id: "c-swap", family: "flow", kind: "swap", auto: false });
    expect(readinessOf(hubOf(chain))).toEqual({
      ready: false,
      refusal: "review_stacked_positions",
      target: { kind: "block", blockId: "c-swap" },
    });
  });

  it("[RD4] refuses a second Supply of the same reserve on one network, and reveals it", () => {
    // @rule RD4
    const plan = hubOf(
      supplyChain("a", 30, TEST_ASSET_KEYS.usdcArbitrum),
      supplyChain(
        "b",
        20,
        TEST_ASSET_KEYS.usdcArbitrum.toUpperCase().replace("ARBITRUM", "arbitrum"),
      ),
    );
    expect(readinessOf(plan)).toEqual({
      ready: false,
      refusal: "review_duplicate_reserve",
      target: { kind: "block", blockId: "b-supply" },
    });
  });

  it("[RD5] refuses a Supply of a token other than the one that arrives, and reveals the Supply", () => {
    // @rule RD5
    const swap: Step = { id: "w-swap", family: "flow", kind: "swap", auto: true };
    const plan = hubOf(supplyChain("w", 40, TEST_ASSET_KEYS.wethArbitrum, [swap]));
    expect(readinessOf(plan)).toEqual({
      ready: false,
      refusal: "review_unsupported_swap",
      target: { kind: "block", blockId: "w-supply" },
    });
  });

  it("[RD5] refuses a manager Swap above a Supply, and reveals the Swap", () => {
    // @rule RD5
    const swap: Step = { id: "m-swap", family: "flow", kind: "swap", auto: false };
    const plan = hubOf(supplyChain("m", 40, TEST_ASSET_KEYS.usdcArbitrum, [swap]));
    expect(readinessOf(plan)).toEqual({
      ready: false,
      refusal: "review_unsupported_swap",
      target: { kind: "block", blockId: "m-swap" },
    });
  });

  it("[RD5] keeps the Swap · auto of a pool: that swap is the pool's own", () => {
    // @rule RD5
    expect(readinessOf(readyPlan())).toEqual({ ready: true });
  });
});

describe("planReadiness: order (finding 4, A2)", () => {
  it("answers S7's over share before any of PA1's checks", () => {
    const plan = hubOf(
      { ...firstChain(hubPoolPlan()), sharePct: 70 },
      supplyChain("s", 40, TEST_ASSET_KEYS.usdcArbitrum),
    );
    expect(readinessOf(plan)).toEqual({
      ready: false,
      refusal: "review_over_share",
      target: null,
    });
  });

  it("answers an unfinished pool before a 0% share, and a 0% share before a stacked chain", () => {
    const incomplete = hubOf(
      { ...firstChain(hubPoolPlan()), sharePct: 0 },
      supplyChain("s", 0, TEST_ASSET_KEYS.usdcArbitrum),
    );
    expect(readinessOf(incomplete)).toMatchObject({ refusal: "review_zero_share" });
    const zero = hubOf(
      firstChain(supplyBorrowPlan()),
      supplyChain("s", 0, TEST_ASSET_KEYS.usdcArbitrum),
    );
    expect(readinessOf(zero)).toMatchObject({ refusal: "review_zero_share" });
  });

  it("names the first offender in reading order: hub first, then the spokes", () => {
    const spoke = spokePoolPlan();
    const plan: BuildPlan = {
      ...spoke,
      hub: { chains: [{ ...firstChain(hubPoolPlan()), sharePct: 10 }] },
    };
    expect(readinessOf(plan)).toMatchObject({
      refusal: "review_incomplete_block",
      target: { kind: "block", blockId: "hub-pool-pool" },
    });
  });
});

describe("deferred pool Review (POO-2204)", () => {
  // @rule R2, R4
  it("keeps a selected range-less pool at zero beside an executable Supply", () => {
    const plan = readyPlan();
    const pool = plan.hub.chains[0];
    if (!pool) throw new Error("fixture");
    pool.sharePct = 0;
    const position = pool.steps.find((step) => step.family === "position");
    if (position?.family !== "position") throw new Error("fixture");
    position.config = { poolId: TEST_POOL_IDS.arbitrum };
    expect(readinessOf(plan)).toEqual({ ready: true });
  });
});

describe("deferred pool authorization (POO-2204)", () => {
  // @rule R2
  it("still rejects an unauthorized pool at zero", () => {
    const plan = readyPlan();
    const chain = firstChain(plan);
    chain.sharePct = 0;
    const block = chain.steps.find((step) => step.family === "position");
    if (block?.family !== "position") throw new Error("fixture");
    block.config = { poolId: "unauthorized" };
    expect(readinessOf(plan)).toMatchObject({ ready: false, refusal: "review_invalid_block" });
  });
});
