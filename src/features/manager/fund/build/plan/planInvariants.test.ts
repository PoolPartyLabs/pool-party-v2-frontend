/**
 * @id PP-MGR-LIB-021
 * @name planInvariants tests
 * @implements-rules-version v1 (POO-2151 rules v1)
 * @analytics-events none, a pure domain module.
 *
 * Covers INV1 to INV6 through `validatePlan`: every valid plan of the test kit returns no
 * violation, and one mutated plan per violation code returns exactly that code (coordinator
 * default D6: the canvas never deletes silently, it lists what broke). Also the D1 reading of INV5:
 * any plan that satisfies it is valid, beyond what the port menus offer.
 *
 * The Aave v3 Borrow status is SET here instead of read from the table (coordinator default D29).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MandateDraft } from "../../mandateDraft";
import type { BlockKindStatus, BuildPlan, Chain, PlanContext, Step } from "./buildPlan";
import { type PlanViolationCode, validatePlan } from "./planInvariants";
import {
  emptyPlan,
  emptySpokePlan,
  hubPoolPlan,
  hubSupplyPlan,
  makeTestContext,
  makeTestDraft,
  spokePoolPlan,
  supplyBorrowPlan,
  TEST_ASSET_KEYS,
  TEST_POOL_IDS,
  VALID_TEST_PLANS,
} from "./planTestKit";

const kinds = vi.hoisted(() => ({ aaveBorrow: "enabled" as BlockKindStatus }));
vi.mock("./buildPlan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./buildPlan")>();
  return {
    ...actual,
    BLOCK_KIND_STATUS: {
      ...actual.BLOCK_KIND_STATUS,
      get aaveBorrow() {
        return kinds.aaveBorrow;
      },
    },
  };
});

let ctx: PlanContext;

beforeEach(() => {
  kinds.aaveBorrow = "enabled";
  ctx = makeTestContext();
});

function codes(plan: BuildPlan, context: Pick<PlanContext, "draft" | "catalog"> = ctx) {
  return validatePlan(plan, context).map((violation) => violation.code);
}

/** A one-chain hub plan from raw steps. */
function hubOf(steps: Step[], sharePct = 10): BuildPlan {
  return { ...emptyPlan(), hub: { chains: [{ id: "c", sharePct, steps }] } };
}

const autoSwap = (id: string): Step => ({ id, family: "flow", kind: "swap", auto: true });
const swap = (id: string): Step => ({ id, family: "flow", kind: "swap", auto: false });
const fees = (id: string): Step => ({ id, family: "flow", kind: "collectFees", auto: false });
const pool = (id: string): Step => ({
  id,
  family: "position",
  kind: "uniswapV4Pool",
  config: { poolId: TEST_POOL_IDS.arbitrum },
});
const supply = (id: string, assetKey: string = TEST_ASSET_KEYS.usdcArbitrum): Step => ({
  id,
  family: "position",
  kind: "aaveSupply",
  config: { assetKey },
});
const borrow = (id: string): Step => ({
  id,
  family: "position",
  kind: "aaveBorrow",
  config: { assetKey: TEST_ASSET_KEYS.usdcArbitrum },
});

describe("validatePlan on the valid plans of the test kit", () => {
  for (const [name, build] of Object.entries(VALID_TEST_PLANS)) {
    it(`finds nothing wrong with ${name}`, () => {
      // @rule INV1
      expect(validatePlan(build(), ctx)).toEqual([]);
    });
  }

  it("never changes the plan it reads", () => {
    // @rule INV1
    const plan = { ...hubPoolPlan(), spokes: spokePoolPlan().spokes };
    const snapshot = JSON.stringify(plan);
    validatePlan(plan, ctx);
    expect(JSON.stringify(plan)).toBe(snapshot);
  });
});

describe("one mutated plan per violation code", () => {
  const cases: Array<{
    code: PlanViolationCode;
    invariant: number;
    plan: () => BuildPlan;
    draft?: () => MandateDraft;
  }> = [
    {
      code: "network_not_in_mandate",
      invariant: 1,
      plan: emptySpokePlan,
      draft: () => ({ ...makeTestDraft(), networks: ["arbitrum"] }),
    },
    {
      code: "duplicate_network",
      invariant: 1,
      plan: () => ({
        ...emptyPlan(),
        spokes: [...emptySpokePlan().spokes, ...emptySpokePlan().spokes],
      }),
    },
    {
      code: "kind_not_in_mandate",
      invariant: 2,
      plan: hubSupplyPlan,
      draft: () => ({ ...makeTestDraft(), protocols: ["uniswap-v3-swap", "across", "uniswap-v4"] }),
    },
    {
      code: "kind_not_on_network",
      invariant: 2,
      plan: () => ({
        ...emptyPlan(),
        spokes: [
          {
            network: "robinhood",
            sharePct: 40,
            chains: [
              {
                id: "rh",
                sharePct: 40,
                steps: [supply("rh-supply", TEST_ASSET_KEYS.usdgRobinhood)],
              },
            ],
          },
        ],
      }),
    },
    {
      code: "kind_coming_soon",
      invariant: 2,
      plan: () =>
        hubOf([
          autoSwap("a"),
          { id: "v3", family: "position", kind: "uniswapV3Pool", config: null },
        ]),
    },
    {
      code: "config_not_in_mandate",
      invariant: 2,
      // The pool left the mandate after the plan was drawn (open point 6, D6).
      plan: hubPoolPlan,
      draft: () => ({ ...makeTestDraft(), pools: [] }),
    },
    {
      code: "share_exceeds_parent",
      invariant: 3,
      plan: () => {
        const plan = { ...hubPoolPlan(), spokes: spokePoolPlan().spokes };
        const chain = plan.hub.chains[0] as Chain;
        chain.sharePct = 70;
        return plan;
      },
    },
    {
      code: "negative_share",
      invariant: 3,
      plan: () => {
        const plan = hubPoolPlan();
        (plan.hub.chains[0] as Chain).sharePct = -5;
        return plan;
      },
    },
    { code: "chain_without_position", invariant: 4, plan: () => hubOf([]) },
    { code: "sequence", invariant: 5, plan: () => hubOf([supply("s"), fees("f")]) },
    { code: "orphan_auto", invariant: 6, plan: () => hubOf([autoSwap("a"), supply("s")]) },
    { code: "missing_auto", invariant: 6, plan: () => hubOf([pool("p")]) },
  ];

  for (const { code, invariant, plan, draft } of cases) {
    it(`reports ${code}`, () => {
      // @rule INV1 to INV6
      const context = draft ? { ...ctx, draft: draft() } : ctx;
      const violations = validatePlan(plan(), context);
      expect(violations.map((v) => v.code)).toEqual([code]);
      expect(violations[0]?.invariant).toBe(invariant);
    });
  }

  it("names the block a pool that left the mandate belongs to", () => {
    // @rule INV2
    const draft = { ...makeTestDraft(), pools: [] };
    expect(validatePlan(hubPoolPlan(), { ...ctx, draft })).toEqual([
      { invariant: 2, code: "config_not_in_mandate", targetId: "hub-pool-pool" },
    ]);
  });

  it("reports a Borrow as coming soon when the table lists it so, and accepts it when enabled", () => {
    // @rule INV2
    kinds.aaveBorrow = "comingSoon";
    expect(codes(supplyBorrowPlan())).toEqual(["kind_coming_soon"]);
    kinds.aaveBorrow = "enabled";
    expect(codes(supplyBorrowPlan())).toEqual([]);
  });
});

describe("INV3 inside a spoke", () => {
  it("reports a spoke whose chains add up to more than the spoke", () => {
    // @rule INV3
    const plan = spokePoolPlan();
    const spoke = plan.spokes[0];
    if (spoke) spoke.sharePct = 30;
    expect(validatePlan(plan, ctx)).toEqual([
      { invariant: 3, code: "share_exceeds_parent", targetId: "robinhood" },
    ]);
  });

  it("reports a negative spoke share once, as negative_share on that spoke", () => {
    // @rule INV3
    const plan = emptySpokePlan();
    const spoke = plan.spokes[0];
    if (spoke) spoke.sharePct = -5;
    expect(validatePlan(plan, ctx)).toEqual([
      { invariant: 3, code: "negative_share", targetId: "robinhood" },
    ]);
  });
});

describe("INV1 on the hub", () => {
  it("reports the hub listed as a spoke", () => {
    // @rule INV1
    const plan: BuildPlan = {
      ...emptyPlan(),
      spokes: [{ network: "arbitrum", sharePct: 0, chains: [] }],
    };
    expect(validatePlan(plan, ctx)).toEqual([
      { invariant: 1, code: "network_not_in_mandate", targetId: "arbitrum" },
    ]);
  });
});

describe("INV3 share arithmetic", () => {
  /** Three hub chains, each a Supply of USDC, with these shares. */
  function threeChains(a: number, b: number, c: number): BuildPlan {
    const chain = (id: string, sharePct: number): Chain => ({
      id,
      sharePct,
      steps: [supply(`${id}-s`)],
    });
    return { ...emptyPlan(), hub: { chains: [chain("x", a), chain("y", b), chain("z", c)] } };
  }

  it("accepts shares that add up to 100 in decimal, even when floating point lands above it", () => {
    // @rule INV3
    expect(codes(threeChains(33.3, 33.3, 33.4))).toEqual([]);
    // 0.2 + 83.9 + 15.9 is 100.00000000000001 in floating point.
    expect(codes(threeChains(0.2, 83.9, 15.9))).toEqual([]);
  });

  it("reports a sum that passes 100 by more than the rounding slack", () => {
    // @rule INV3
    expect(codes(threeChains(0.2, 83.9, 15.900001))).toEqual(["share_exceeds_parent"]);
  });
});

describe("INV5 sequences", () => {
  it("reports a Borrow that is not directly under a Supply", () => {
    // @rule INV5
    expect(codes(hubOf([borrow("b")]))).toEqual(["sequence"]);
    expect(codes(hubOf([supply("s"), swap("m"), borrow("b")]))).toEqual(["sequence"]);
  });

  it("reports anything after a pool but its Collect fees", () => {
    // @rule INV5
    expect(codes(hubOf([autoSwap("a"), pool("p"), swap("m")]))).toEqual(["sequence"]);
    expect(codes(hubOf([autoSwap("a"), pool("p"), fees("f"), swap("m")]))).toEqual(["sequence"]);
  });

  it("reports a position after a pool's Collect fees: the pool, or its fees, ends the chain", () => {
    // @rule INV5
    expect(validatePlan(hubOf([autoSwap("a"), pool("p"), fees("f"), supply("s")]), ctx)).toEqual([
      { invariant: 5, code: "sequence", targetId: "s" },
    ]);
  });

  it("reports a second Collect fees after a pool's Collect fees", () => {
    // @rule INV5
    expect(validatePlan(hubOf([autoSwap("a"), pool("p"), fees("f1"), fees("f2")]), ctx)).toEqual([
      { invariant: 5, code: "sequence", targetId: "f2" },
    ]);
  });

  it("reports a manager Swap that is neither before a position nor after an Aave block", () => {
    // @rule INV5
    expect(
      codes(hubOf([swap("m1"), swap("m2"), supply("s", TEST_ASSET_KEYS.wethArbitrum)])),
    ).toEqual(["sequence"]);
  });

  it("accepts every sequence INV5 allows, beyond the port menus (D1)", () => {
    // @rule INV5
    // Canvas A: a Supply, then the Swap · auto, then a pool.
    expect(codes(hubOf([supply("s"), autoSwap("a"), pool("p")]))).toEqual([]);
    // A manager Swap before a pool, with the app's Swap · auto between them.
    expect(codes(hubOf([swap("m"), autoSwap("a"), pool("p")]))).toEqual([]);
    // Supply, Borrow, a Swap after the Borrow, then a pool.
    expect(
      codes(hubOf([supply("s"), borrow("b"), swap("m"), autoSwap("a"), pool("p"), fees("f")])),
    ).toEqual([]);
  });
});
