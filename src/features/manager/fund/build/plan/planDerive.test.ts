/**
 * @id PP-MGR-LIB-021
 * @name planDerive tests
 * @implements-rules-version v1 (POO-2151 rules v1)
 * @analytics-events none, a pure domain module.
 *
 * Covers C5 (a block's network is where it sits), C10 (income exists iff a Collect fees exists), the
 * allocated share and HU2 (`config` is the single source of "configured").
 */
import { describe, expect, it } from "vitest";
import type { BuildPlan } from "./buildPlan";
import { allocatedPct, blockNetwork, findBlock, hasIncome, isConfigured } from "./planDerive";
import {
  emptyPlan,
  emptySpokePlan,
  hubPoolPlan,
  hubPoolWithFeesPlan,
  hubSupplyPlan,
  spokePoolPlan,
} from "./planTestKit";

/** The hub pool chain beside the Robinhood spoke, one plan. */
function hubAndSpoke(): BuildPlan {
  return { ...hubPoolPlan(), spokes: spokePoolPlan().spokes };
}

describe("findBlock", () => {
  it("finds a block with its chain, its network and its index in the chain", () => {
    // @rule C5
    const plan = hubAndSpoke();
    const found = findBlock(plan, "rh-pool-pool");
    expect(found?.block.id).toBe("rh-pool-pool");
    expect(found?.chain.id).toBe("rh-pool");
    expect(found?.network).toBe("robinhood");
    expect(found?.index).toBe(1);
  });

  it("returns null for an id no step carries", () => {
    // @rule C5
    expect(findBlock(hubAndSpoke(), "nope")).toBeNull();
  });
});

describe("blockNetwork (C5)", () => {
  it("puts a block of a hub chain on Arbitrum", () => {
    // @rule C5
    expect(blockNetwork(hubAndSpoke(), "hub-pool-pool")).toBe("arbitrum");
    expect(blockNetwork(hubAndSpoke(), "hub-pool-swap")).toBe("arbitrum");
  });

  it("puts a block inside a spoke on that spoke's network", () => {
    // @rule C5
    expect(blockNetwork(hubAndSpoke(), "rh-pool-pool")).toBe("robinhood");
  });

  it("knows no network for an unknown block", () => {
    // @rule C5
    expect(blockNetwork(hubAndSpoke(), "nope")).toBeNull();
  });
});

describe("hasIncome (C10)", () => {
  it("is true as soon as one Collect fees exists", () => {
    // @rule C10
    expect(hasIncome(hubPoolWithFeesPlan())).toBe(true);
  });

  it("is false with pools but no Collect fees, and on the empty canvas", () => {
    // @rule C10
    expect(hasIncome(hubPoolPlan())).toBe(false);
    expect(hasIncome(hubSupplyPlan())).toBe(false);
    expect(hasIncome(emptyPlan())).toBe(false);
  });

  it("counts a Collect fees inside a spoke", () => {
    // @rule C10
    const plan = spokePoolPlan();
    const chain = plan.spokes[0]?.chains[0];
    chain?.steps.push({ id: "rh-fees", family: "flow", kind: "collectFees", auto: false });
    expect(hasIncome(plan)).toBe(true);
  });
});

describe("allocatedPct", () => {
  it("adds the hub chains and the spokes, not the chains inside a spoke", () => {
    // @rule C8
    expect(allocatedPct(hubAndSpoke())).toBe(100);
    expect(allocatedPct(hubPoolPlan())).toBe(60);
    expect(allocatedPct(spokePoolPlan())).toBe(40);
  });

  it("is 0 on the empty canvas and with a spoke just added", () => {
    // @rule C8
    expect(allocatedPct(emptyPlan())).toBe(0);
    expect(allocatedPct(emptySpokePlan())).toBe(0);
  });
});

describe("isConfigured (HU2)", () => {
  it("reads configured from config alone", () => {
    // @rule HU2
    expect(
      isConfigured({ id: "a", family: "position", kind: "aaveSupply", config: { assetKey: "k" } }),
    ).toBe(true);
    expect(isConfigured({ id: "b", family: "position", kind: "uniswapV4Pool", config: null })).toBe(
      false,
    );
  });
});
