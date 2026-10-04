/**
 * @id PP-MGR-LIB-026
 * @name applyBlockConfig and describeRemoval tests
 * @implements-rules-version v1 (POO-2184 rules v1)
 * @analytics-events none, a test of pure functions.
 *
 * What one Apply writes and what one Remove takes (POO-2184; verification finding 11, handoff P3,
 * P7, P8, P10, data shapes, canvas I6 and C13):
 *
 * - [A1] Apply is ONE atomic edit: the block's config (`setBlockConfig`) and, when given, its
 *   chain's share (`setChainShare`); any refusal leaves the plan as it was.
 * - [A2] On a spoke the spoke's share is the sum of its chains (DP3): the spoke is raised before the
 *   chain when it grows, and lowered after the chain when it shrinks.
 * - [A3] Only the first position of a chain has an Allocation, and a share is a whole percent from
 *   0 to 100 (the launch takes whole percents only).
 * - [A4] The card and its Swap · auto follow the extended config through the existing derivations
 *   (`describeBlock`, `needsAutoSwap`), which this slice does not re-derive.
 * - [R1] The remove confirm is computed from the real remove (I6): the share that goes back to Idle
 *   input and every step removed with the block, read off the plan before and after.
 */
import { describe, expect, it } from "vitest";
import { describeBlock } from "../blocks/blockRegistry";
import { makeDescribeContext } from "../blocks/blockTestKit";
import type { AaveBlockConfig, BuildPlan, PoolBlockConfig } from "./buildPlan";
import { isPlanBlocked, type PlanReducerResult } from "./buildPlan";
import { allocatedPct, chainsWithNetwork, findBlock } from "./planDerive";
import { validatePlan } from "./planInvariants";
import {
  applyBlockConfig,
  describeRemoval,
  removeBlock,
  removeBlockReleasingShare,
} from "./planReducers";
import { arrivingTokenKey, needsAutoSwap } from "./planRules";
import {
  hubPoolPlan,
  hubPoolWithFeesPlan,
  hubSupplyPlan,
  makeTestContext,
  spokePoolPlan,
  supplyBorrowPlan,
  TEST_ASSET_KEYS,
  TEST_POOL_IDS,
} from "./planTestKit";

const POOL: PoolBlockConfig = {
  poolId: TEST_POOL_IDS.arbitrum,
  tickLower: -199_370,
  tickUpper: -195_370,
  fullRange: false,
  displayInverted: false,
  slippagePct: 2,
};

const RH_POOL: PoolBlockConfig = { ...POOL, poolId: TEST_POOL_IDS.robinhood };

/** The plan a reducer returned; fails the test on a refusal. */
function planOf(result: PlanReducerResult): BuildPlan {
  if (isPlanBlocked(result)) throw new Error(`refused: ${result.blocked.reason}`);
  return result;
}

/** A chain's share, by id, wherever it hangs. */
function shareOf(plan: BuildPlan, chainId: string): number | undefined {
  return chainsWithNetwork(plan).find(({ chain }) => chain.id === chainId)?.chain.sharePct;
}

/** The first hub chain of a fixture plan. */
function hubChain(plan: BuildPlan): BuildPlan["hub"]["chains"][number] {
  const chain = plan.hub.chains[0];
  if (!chain) throw new Error("fixture: no hub chain");
  return chain;
}

/** The hub pool plan with its pool emptied, as a block arrives from a menu (G6). */
function emptyHubPool(): BuildPlan {
  const plan = hubPoolPlan();
  const chain = plan.hub.chains[0];
  const pool = chain?.steps[1];
  if (!chain || pool?.family !== "position") throw new Error("fixture: no pool");
  chain.steps[1] = { ...pool, config: null };
  chain.sharePct = 0;
  return plan;
}

/** The spoke pool plan with a second pool chain at `pct` on the same spoke. */
function twoSpokeChains(firstPct: number, secondPct: number): BuildPlan {
  const plan = spokePoolPlan();
  const spoke = plan.spokes[0];
  const first = spoke?.chains[0];
  if (!spoke || !first) throw new Error("fixture: no spoke chain");
  first.sharePct = firstPct;
  spoke.chains.push({
    id: "rh-pool-2",
    sharePct: secondPct,
    steps: [
      { id: "rh-pool-2-swap", family: "flow", kind: "swap", auto: true },
      { id: "rh-pool-2-pool", family: "position", kind: "uniswapV4Pool", config: RH_POOL },
    ],
  });
  spoke.sharePct = firstPct + secondPct;
  return plan;
}

describe("applyBlockConfig: one Apply, one atomic edit (A1, A3)", () => {
  it("[A1] writes the config and the chain's share together", () => {
    // @rule A1
    const next = planOf(
      applyBlockConfig(emptyHubPool(), makeTestContext(), "hub-pool-pool", POOL, 40),
    );
    expect(findBlock(next, "hub-pool-pool")?.block).toMatchObject({ config: POOL });
    expect(shareOf(next, "hub-pool")).toBe(40);
    expect(validatePlan(next, makeTestContext())).toEqual([]);
  });

  it("[A1] leaves every share alone when no share is given", () => {
    // @rule A1
    const plan = hubPoolPlan();
    const next = planOf(applyBlockConfig(plan, makeTestContext(), "hub-pool-pool", POOL));
    expect(shareOf(next, "hub-pool")).toBe(60);
    expect(allocatedPct(next)).toBe(allocatedPct(plan));
  });

  it("[A1] P7: Use writes the defaults with a 0% share, and the block stays configured", () => {
    // @rule A1
    const next = planOf(
      applyBlockConfig(emptyHubPool(), makeTestContext(), "hub-pool-pool", POOL, 0),
    );
    expect(findBlock(next, "hub-pool-pool")?.block).toMatchObject({ config: POOL });
    expect(shareOf(next, "hub-pool")).toBe(0);
  });

  it("[A1] refuses the whole Apply when the share is refused, and the input is untouched", () => {
    // @rule A1
    const plan = hubPoolPlan();
    plan.hub.chains.push(hubChain(hubSupplyPlan()));
    const before = JSON.stringify(plan);
    // The pool's 60 and the Supply's 40 already make 100: 65 on the pool would make 105.
    const ok = applyBlockConfig(plan, makeTestContext(), "hub-pool-pool", POOL, 60);
    expect(isPlanBlocked(ok)).toBe(false);
    expect(applyBlockConfig(plan, makeTestContext(), "hub-pool-pool", POOL, 65)).toEqual({
      blocked: { reason: "share_exceeds_parent", targetId: "hub-pool" },
    });
    expect(JSON.stringify(plan)).toBe(before);
  });

  it("[A1] refuses the whole Apply when the config is refused, before any share moves", () => {
    // @rule A1
    const result = applyBlockConfig(
      hubPoolPlan(),
      makeTestContext(),
      "hub-pool-pool",
      { ...POOL, poolId: "not-a-mandate-pool" },
      10,
    );
    expect(result).toEqual({ blocked: { reason: "not_in_mandate", targetId: "hub-pool-pool" } });
  });

  it("[A3] takes a whole share from 0 to 100 only", () => {
    // @rule A3
    for (const pct of [12.5, -5, Number.NaN]) {
      expect(
        applyBlockConfig(emptyHubPool(), makeTestContext(), "hub-pool-pool", POOL, pct),
      ).toEqual({ blocked: { reason: "unknown_target", targetId: "hub-pool-pool" } });
    }
    expect(applyBlockConfig(emptyHubPool(), makeTestContext(), "hub-pool-pool", POOL, 105)).toEqual(
      { blocked: { reason: "share_exceeds_parent", targetId: "hub-pool" } },
    );
  });

  it("[A3] gives a share only to the first position of a chain", () => {
    // @rule A3
    const borrow: AaveBlockConfig = { assetKey: TEST_ASSET_KEYS.usdcArbitrum };
    expect(
      applyBlockConfig(supplyBorrowPlan(), makeTestContext(), "hub-aave-borrow", borrow, 20),
    ).toEqual({ blocked: { reason: "unknown_target", targetId: "hub-aave-borrow" } });
    const kept = planOf(
      applyBlockConfig(supplyBorrowPlan(), makeTestContext(), "hub-aave-borrow", borrow),
    );
    expect(shareOf(kept, "hub-aave")).toBe(50);
  });

  it("[A1] refuses a flow block and an unknown id", () => {
    // @rule A1
    expect(applyBlockConfig(hubPoolPlan(), makeTestContext(), "hub-pool-swap", POOL, 10)).toEqual({
      blocked: { reason: "unknown_target", targetId: "hub-pool-swap" },
    });
    expect(applyBlockConfig(hubPoolPlan(), makeTestContext(), "gone", POOL, 10)).toEqual({
      blocked: { reason: "unknown_target", targetId: "gone" },
    });
  });
});

describe("applyBlockConfig on a spoke: the spoke is the sum of its chains (A2)", () => {
  it("[A2] raises the spoke first when the chain grows", () => {
    // @rule A2
    const next = planOf(
      applyBlockConfig(spokePoolPlan(), makeTestContext(), "rh-pool-pool", RH_POOL, 60),
    );
    expect(shareOf(next, "rh-pool")).toBe(60);
    expect(next.spokes[0]?.sharePct).toBe(60);
  });

  it("[A2] lowers the spoke after the chain when the chain shrinks", () => {
    // @rule A2
    const next = planOf(
      applyBlockConfig(spokePoolPlan(), makeTestContext(), "rh-pool-pool", RH_POOL, 15),
    );
    expect(shareOf(next, "rh-pool")).toBe(15);
    expect(next.spokes[0]?.sharePct).toBe(15);
  });

  it("[A2] keeps the sibling chains in the sum", () => {
    // @rule A2
    const up = planOf(
      applyBlockConfig(twoSpokeChains(30, 10), makeTestContext(), "rh-pool-pool", RH_POOL, 45),
    );
    expect(up.spokes[0]?.sharePct).toBe(55);
    const down = planOf(
      applyBlockConfig(twoSpokeChains(30, 10), makeTestContext(), "rh-pool-pool", RH_POOL, 5),
    );
    expect(down.spokes[0]?.sharePct).toBe(15);
    expect(validatePlan(down, makeTestContext())).toEqual([]);
  });

  it("[A2] heals a spoke that holds more than its chains, on the next Apply", () => {
    // @rule A2
    const plan = spokePoolPlan();
    const spoke = plan.spokes[0];
    if (!spoke) throw new Error("fixture: no spoke");
    spoke.sharePct = 70;
    const next = planOf(applyBlockConfig(plan, makeTestContext(), "rh-pool-pool", RH_POOL, 50));
    expect(next.spokes[0]?.sharePct).toBe(50);
  });

  it("[A2] refuses a spoke that would take the strategy past 100, and changes nothing", () => {
    // @rule A2
    const plan = spokePoolPlan();
    plan.hub.chains.push({ ...hubChain(hubPoolPlan()), sharePct: 50 });
    const before = JSON.stringify(plan);
    expect(applyBlockConfig(plan, makeTestContext(), "rh-pool-pool", RH_POOL, 60)).toEqual({
      blocked: { reason: "share_exceeds_parent", targetId: "robinhood" },
    });
    expect(JSON.stringify(plan)).toBe(before);
  });
});

describe("the card follows the extended config through the existing derivations (A4)", () => {
  it("[A4] a pool card reads its pair and fee once Apply writes the full config", () => {
    // @rule A4
    const next = planOf(
      applyBlockConfig(emptyHubPool(), makeTestContext(), "hub-pool-pool", POOL, 40),
    );
    expect(describeBlock("hub-pool-pool", makeDescribeContext(next))).toMatchObject({
      title: "WETH / USDC",
      caption: "Uniswap v4 · 0.05%",
      state: "default",
    });
    // C13: a pool always keeps its Swap · auto.
    expect(findBlock(next, "hub-pool-swap")?.block).toMatchObject({ kind: "swap", auto: true });
  });

  it("[A4] a Supply's Swap · auto comes with an asset that is not the arriving token, and goes", () => {
    // @rule A4
    const ctx = makeTestContext();
    const weth = planOf(
      applyBlockConfig(
        hubSupplyPlan(),
        ctx,
        "hub-supply-supply",
        { assetKey: TEST_ASSET_KEYS.wethArbitrum, slippagePct: 2 },
        40,
      ),
    );
    const supply = findBlock(weth, "hub-supply-supply");
    expect(supply?.index).toBe(1);
    expect(supply?.chain.steps[0]).toMatchObject({ family: "flow", kind: "swap", auto: true });
    if (supply?.block.family !== "position") throw new Error("fixture: no supply");
    expect(needsAutoSwap(supply.block, arrivingTokenKey(weth, ctx, "hub-supply-supply"))).toBe(
      true,
    );
    expect(describeBlock("hub-supply-supply", makeDescribeContext(weth)).title).toBe("Supply WETH");

    const usdc = planOf(
      applyBlockConfig(weth, ctx, "hub-supply-supply", { assetKey: TEST_ASSET_KEYS.usdcArbitrum }),
    );
    expect(findBlock(usdc, "hub-supply-supply")?.index).toBe(0);
    expect(describeBlock("hub-supply-supply", makeDescribeContext(usdc)).title).toBe("Supply USDC");
  });
});

describe("describeRemoval: the remove confirm, read off the real remove (R1)", () => {
  it("[R1] a pool takes its Swap · auto and its Collect fees, and its share goes back", () => {
    // @rule R1
    expect(describeRemoval(hubPoolWithFeesPlan(), makeTestContext(), "hub-pool-pool")).toEqual({
      blockId: "hub-pool-pool",
      empty: false,
      returnedPct: 60,
      chainRemoved: true,
      removedWith: [
        { id: "hub-pool-swap", family: "flow", kind: "swap", auto: true },
        { id: "hub-pool-fees", family: "flow", kind: "collectFees", auto: false },
      ],
    });
  });

  it("[R1] a Supply takes its Swap · auto and the Borrow under it", () => {
    // @rule R1
    const removal = describeRemoval(supplyBorrowPlan(), makeTestContext(), "hub-aave-supply");
    expect(removal?.returnedPct).toBe(50);
    expect(removal?.removedWith.map((step) => step.id)).toEqual([
      "hub-aave-swap",
      "hub-aave-borrow",
    ]);
  });

  it("[R1] a Borrow leaves its Supply and the share where they are", () => {
    // @rule R1
    expect(describeRemoval(supplyBorrowPlan(), makeTestContext(), "hub-aave-borrow")).toEqual({
      blockId: "hub-aave-borrow",
      empty: false,
      returnedPct: 0,
      chainRemoved: false,
      removedWith: [],
    });
  });

  it("[R1] an empty block says so, for the short confirm", () => {
    // @rule R1
    expect(describeRemoval(emptyHubPool(), makeTestContext(), "hub-pool-pool")).toMatchObject({
      empty: true,
      returnedPct: 0,
    });
  });

  it("[R1, A2] a spoke block's share goes back too: the spoke drops to what its chains hold", () => {
    // @rule R1
    // @rule A2
    expect(describeRemoval(spokePoolPlan(), makeTestContext(), "rh-pool-pool")).toMatchObject({
      returnedPct: 40,
      chainRemoved: true,
    });
    const next = planOf(
      removeBlockReleasingShare(spokePoolPlan(), makeTestContext(), "rh-pool-pool"),
    );
    expect(next.spokes[0]).toEqual({ network: "robinhood", sharePct: 0, chains: [] });
    const kept = planOf(
      removeBlockReleasingShare(twoSpokeChains(30, 10), makeTestContext(), "rh-pool-pool"),
    );
    expect(kept.spokes[0]?.sharePct).toBe(10);
  });

  it("[R1] names exactly what the cascade removes, nothing it does not", () => {
    // @rule R1
    for (const [plan, id] of [
      [hubPoolWithFeesPlan(), "hub-pool-pool"],
      [supplyBorrowPlan(), "hub-aave-supply"],
      [supplyBorrowPlan(), "hub-aave-borrow"],
      [hubSupplyPlan(), "hub-supply-supply"],
    ] as const) {
      const after = planOf(removeBlock(plan, makeTestContext(), id));
      const ids = (p: BuildPlan) =>
        chainsWithNetwork(p).flatMap(({ chain }) => chain.steps.map((step) => step.id));
      const gone = ids(plan).filter((step) => step !== id && !ids(after).includes(step));
      expect(describeRemoval(plan, makeTestContext(), id)?.removedWith.map((s) => s.id)).toEqual(
        gone,
      );
    }
  });

  it("[R1] answers null for an app-owned block and an unknown id", () => {
    // @rule R1
    expect(describeRemoval(hubPoolPlan(), makeTestContext(), "hub-pool-swap")).toBeNull();
    expect(describeRemoval(hubPoolPlan(), makeTestContext(), "gone")).toBeNull();
  });
});

describe("automatic Collect fees on pool Apply (POO-2210)", () => {
  // @rule R1, R6
  it("adds fees once on new selection at zero and respects deliberate removal", () => {
    const initial = hubPoolPlan();
    const ctx = makeTestContext();
    const found = chainsWithNetwork(initial)[0]?.chain.steps.find(
      (step) => step.family === "position",
    );
    if (found?.family !== "position" || !found.config) throw new Error("fixture");
    const first = applyBlockConfig(initial, ctx, found.id, null, 0);
    if (isPlanBlocked(first)) throw new Error("fixture");
    const applied = applyBlockConfig(first, ctx, found.id, found.config, 0);
    if (isPlanBlocked(applied)) throw new Error("fixture");
    const fees = applied.hub.chains[0]?.steps.filter((step) => step.kind === "collectFees") ?? [];
    expect(fees).toHaveLength(1);
    const repeated = applyBlockConfig(applied, ctx, found.id, found.config, 0);
    if (isPlanBlocked(repeated)) throw new Error("fixture");
    expect(
      repeated.hub.chains[0]?.steps.filter((step) => step.kind === "collectFees"),
    ).toHaveLength(1);
    const removed = removeBlock(repeated, ctx, fees[0]?.id ?? "");
    if (isPlanBlocked(removed)) throw new Error("fixture");
    const again = applyBlockConfig(removed, ctx, found.id, found.config, 0);
    if (isPlanBlocked(again)) throw new Error("fixture");
    expect(again.hub.chains[0]?.steps.some((step) => step.kind === "collectFees")).toBe(false);
  });
});
