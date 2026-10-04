/**
 * @id PP-MGR-LIB-028
 * @name launch agreement tests
 * @implements-rules-version v1 (POO-2184 rules v1)
 * @analytics-events none, a contract test of pure functions.
 *
 * The canvas and the launch read one plan (POO-2184; verification findings 1, 2 and 4). The launch
 * adapter (`launch/index.ts` `getLaunchSteps`, PP-MGR-LIB-045 over PP-MGR-LIB-037) stays the
 * authority; these tests hold the canvas to it, through the REAL functions on both sides:
 *
 * - [AG1] CONTRACT: a plan configured only through `applyBlockConfig`, with a hub Uniswap v4 pool
 *   (explicit aligned ticks, and a Full variant on the finite aligned extremes) and an Aave USDC
 *   Supply, each with a share above 0, is accepted, carries the bare PoolId and the loss bound the
 *   launch signs, and passes the launch's own tick alignment check on the catalog spacing.
 * - [AG2] AGREEMENT: every plan `planReadiness` calls ready is accepted by `getLaunchSteps`.
 * - [AG3] Each refusal PA1 adds stands for a plan `getLaunchSteps` rejects, where the launch has an
 *   equivalent; the one without (the same reserve twice) is stated as such.
 */
import { describe, expect, it } from "vitest";
import type { FundLaunchDraft } from "../../launch/contracts";
import type * as LaunchIndex from "../../launch/index";
import { getLaunchSteps as fromJourney } from "../../launch/journey";
import { deriveLaunchSteps, validateTickAlignment } from "../../launch/plan";
import type { MandateDraft } from "../../mandateDraft";
import { fullRangeTicks } from "./blockConfig";
import {
  type BuildPlan,
  type Chain,
  createEmptyPlan,
  isPlanBlocked,
  type PlanReducerResult,
  type PoolBlockConfig,
  type Step,
} from "./buildPlan";
import { chainsWithNetwork } from "./planDerive";
import { validatePlan } from "./planInvariants";
import { type PlanReadinessRefusal, planReadiness } from "./planReadiness";
import { addChain, addSpoke, applyBlockConfig, insertAt } from "./planReducers";
import {
  makeTestContext,
  makeTestDraft,
  TEST_ASSET_KEYS,
  TEST_POOL_IDS,
  VALID_TEST_PLANS,
  withCompletePools,
} from "./planTestKit";
import { makeRealModeDraft, REAL_POOL_ID, REAL_POOL_TICK_SPACING } from "./realPoolTestKit";

/**
 * `launch/index.ts` re-exports `getLaunchSteps` from `journey.ts` unchanged. It is imported from
 * there at run time, because loading the index would mount the Journey screen's React, router and
 * wallet modules in a pure test; the type below fails to compile if the two ever part.
 */
const getLaunchSteps: typeof LaunchIndex.getLaunchSteps = fromJourney;

/** A Review the launch accepts: the plan is the only thing under test. */
const REVIEW: FundLaunchDraft["review"] = {
  name: "Income fund demo",
  description: "",
  imageUrl: "",
  performanceFeeBps: 2000,
  managementFeeBps: 0,
  payoutFeeBps: 200,
  minimum: "100",
  seed: "100",
};

/** The minimal launch draft around a plan: the mandate draft, the plan and a Review. */
function launchDraft(plan: BuildPlan, draft: MandateDraft = makeTestDraft()): FundLaunchDraft {
  return { ...draft, plan, review: REVIEW };
}

function planOf(result: PlanReducerResult): BuildPlan {
  if (isPlanBlocked(result)) throw new Error(`refused: ${result.blocked.reason}`);
  return result;
}

/** The first block of a kind in the plan, in reading order. */
function blockIdOf(plan: BuildPlan, kind: string): string {
  const step = chainsWithNetwork(plan)
    .flatMap(({ chain }) => chain.steps)
    .find((candidate) => candidate.kind === kind);
  if (!step) throw new Error(`fixture: no ${kind}`);
  return step.id;
}

/** What `getLaunchSteps` says: the step ids, or the error code it throws. */
function launchOf(plan: BuildPlan, draft?: MandateDraft): string[] | { error: string } {
  try {
    return getLaunchSteps(launchDraft(plan, draft)).map((step) => step.id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function readinessOf(plan: BuildPlan, draft: MandateDraft = makeTestDraft()) {
  const ctx = makeTestContext(draft);
  return planReadiness(plan, validatePlan(plan, ctx));
}

/** An aligned canonical range on the real pool's spacing of 10, around tick -197375. */
const RANGE = { tickLower: -199_370, tickUpper: -195_370 };

/**
 * [AG1] The demo plan, configured only through `applyBlockConfig`: the blocks come from the Add
 * protocol menu (`addChain`, empty, share 0, as G6 says), and Apply writes every config and share.
 */
function demoPlan(pool: Omit<PoolBlockConfig, "poolId">): { plan: BuildPlan; draft: MandateDraft } {
  const draft = makeRealModeDraft();
  const ctx = makeTestContext(draft);
  let plan = planOf(addChain(createEmptyPlan(), ctx, "arbitrum", "uniswapV4Pool"));
  plan = planOf(addChain(plan, ctx, "arbitrum", "aaveSupply"));
  plan = planOf(
    applyBlockConfig(
      plan,
      ctx,
      blockIdOf(plan, "uniswapV4Pool"),
      { poolId: REAL_POOL_ID, ...pool },
      60,
    ),
  );
  plan = planOf(
    applyBlockConfig(
      plan,
      ctx,
      blockIdOf(plan, "aaveSupply"),
      { assetKey: TEST_ASSET_KEYS.usdcArbitrum },
      40,
    ),
  );
  return { plan, draft };
}

const EXPLICIT = { ...RANGE, fullRange: false, displayInverted: false, slippagePct: 2 };

const FULL = {
  ...(fullRangeTicks(REAL_POOL_TICK_SPACING) ?? RANGE),
  fullRange: true,
  displayInverted: true,
  slippagePct: 0.5,
};

describe("[AG1] the contract: a plan written by Apply is a plan the launch runs", () => {
  for (const [name, pool, bps] of [
    ["explicit aligned ticks", EXPLICIT, 200],
    ["Full range on the finite aligned extremes", FULL, 50],
  ] as const) {
    it(`[AG1] accepts a hub v4 pool (${name}) and a Supply USDC`, () => {
      // @rule AG1
      const { plan, draft } = demoPlan(pool);
      expect(readinessOf(plan, draft)).toEqual({ ready: true });

      const poolId = blockIdOf(plan, "uniswapV4Pool");
      const supplyId = blockIdOf(plan, "aaveSupply");
      expect(launchOf(plan, draft)).toEqual(
        expect.arrayContaining([`${poolId}:swap`, `${poolId}:open`, `${supplyId}:open`]),
      );

      // What the launch reads off the pool block: the bare PoolId, canonical ticks, the loss bound.
      const steps = deriveLaunchSteps(launchDraft(plan, draft).plan, {}, true, false);
      const open = steps.find((step) => step.id === `${poolId}:open`);
      expect(open?.sharePct).toBe(60);
      expect(open?.config).toMatchObject({
        poolId: REAL_POOL_ID,
        tickLower: pool.tickLower,
        tickUpper: pool.tickUpper,
        maxLossBps: bps,
      });
      expect(() => validateTickAlignment(open?.config ?? {}, REAL_POOL_TICK_SPACING)).not.toThrow();
    });
  }

  it("[AG1] Full range is the widest pair of ticks on the pool's own spacing", () => {
    // @rule AG1
    expect(FULL).toMatchObject({ tickLower: -887_270, tickUpper: 887_270 });
  });
});

// ---------------------------------------------------------------------------
// A corpus of plans: every test kit plan, completed and not, plus the shapes the panels can reach
// ---------------------------------------------------------------------------

function hubOf(...chains: Chain[]): BuildPlan {
  return { ...createEmptyPlan(), hub: { chains } };
}

function supply(
  id: string,
  pct: number,
  assetKey: string,
  before: Step[] = [],
  after: Step[] = [],
) {
  return {
    id,
    sharePct: pct,
    steps: [
      ...before,
      { id: `${id}-supply`, family: "position", kind: "aaveSupply", config: { assetKey } },
      ...after,
    ],
  } as Chain;
}

function pool(id: string, pct: number, config: PoolBlockConfig | null): Chain {
  return {
    id,
    sharePct: pct,
    steps: [
      { id: `${id}-swap`, family: "flow", kind: "swap", auto: true },
      { id: `${id}-pool`, family: "position", kind: "uniswapV4Pool", config },
    ],
  };
}

const COMPLETE: PoolBlockConfig = { poolId: TEST_POOL_IDS.arbitrum, ...EXPLICIT };
const AUTO_SWAP: Step = { id: "x-swap", family: "flow", kind: "swap", auto: true };
const MANUAL_SWAP: Step = { id: "m-swap", family: "flow", kind: "swap", auto: false };

/** A spoke pool chain built through the reducers, at `pct` of the strategy. */
function spokePlan(pct: number): BuildPlan {
  const ctx = makeTestContext();
  let plan = planOf(addSpoke(createEmptyPlan(), ctx, "robinhood"));
  plan = planOf(addChain(plan, ctx, "robinhood", "uniswapV4Pool"));
  const id = blockIdOf(plan, "uniswapV4Pool");
  return planOf(
    applyBlockConfig(plan, ctx, id, { ...COMPLETE, poolId: TEST_POOL_IDS.robinhood }, pct),
  );
}

/** A hub pool with Collect fees inserted at its port, through the reducers. */
function poolWithFees(): BuildPlan {
  const ctx = makeTestContext();
  const plan = hubOf(pool("p", 50, COMPLETE));
  return planOf(
    insertAt(
      plan,
      ctx,
      { side: "after", blockId: "p-pool" },
      { family: "flow", kind: "collectFees" },
    ),
  );
}

const CORPUS: Record<string, () => BuildPlan> = {
  ...Object.fromEntries(
    Object.entries(VALID_TEST_PLANS).flatMap(([name, build]) => [
      [name, build],
      [`${name} (complete)`, () => withCompletePools(build())],
    ]),
  ),
  "pool 60 + supply 40": () =>
    hubOf(pool("p", 60, COMPLETE), supply("s", 40, TEST_ASSET_KEYS.usdcArbitrum)),
  "pool 100": () => hubOf(pool("p", 100, COMPLETE)),
  "pool 35 (not a multiple of 5)": () => hubOf(pool("p", 35, COMPLETE)),
  "pool with Collect fees": poolWithFees,
  "two pools": () => hubOf(pool("p", 30, COMPLETE), pool("q", 30, COMPLETE)),
  "pool at 0": () => hubOf(pool("p", 0, COMPLETE), supply("s", 40, TEST_ASSET_KEYS.usdcArbitrum)),
  "pool with no slippage": () =>
    hubOf(pool("p", 60, { ...COMPLETE, slippagePct: undefined as unknown as number })),
  "supply WETH": () => hubOf(supply("w", 40, TEST_ASSET_KEYS.wethArbitrum, [AUTO_SWAP])),
  "supply then manager swap": () =>
    hubOf(supply("s", 40, TEST_ASSET_KEYS.usdcArbitrum, [], [MANUAL_SWAP])),
  "manager swap then supply": () =>
    hubOf(supply("s", 40, TEST_ASSET_KEYS.usdcArbitrum, [MANUAL_SWAP])),
  "same reserve twice": () =>
    hubOf(
      supply("a", 30, TEST_ASSET_KEYS.usdcArbitrum),
      supply("b", 20, TEST_ASSET_KEYS.usdcArbitrum),
    ),
  "spoke pool 40": () => spokePlan(40),
  "spoke pool 40 + hub pool 60": () => {
    const plan = spokePlan(40);
    return { ...plan, hub: { chains: [pool("p", 60, COMPLETE)] } };
  },
  "spoke pool at 0": () => spokePlan(0),
};

describe("[AG2] agreement: every plan readiness calls ready, the launch accepts", () => {
  const ready = Object.entries(CORPUS).filter(([, build]) => readinessOf(build()).ready);

  it("[AG2] has ready plans to check (the property is not vacuous)", () => {
    // @rule AG2
    expect(ready.map(([name]) => name).sort()).toEqual(
      [
        "hubPoolPlan (complete)",
        "hubPoolWithFeesPlan (complete)",
        "hubSupplyPlan",
        "hubSupplyPlan (complete)",
        "pool 100",
        "pool 35 (not a multiple of 5)",
        "pool 60 + supply 40",
        "pool with Collect fees",
        "spoke pool 40",
        "spoke pool 40 + hub pool 60",
        "spokePoolPlan (complete)",
        "two pools",
      ].sort(),
    );
  });

  for (const [name, build] of Object.entries(CORPUS)) {
    it(`[AG2] ${name}: ready implies accepted`, () => {
      // @rule AG2
      const plan = build();
      if (!readinessOf(plan).ready) return;
      expect(launchOf(plan)).not.toHaveProperty("error");
    });
  }
});

describe("[AG3] each new refusal stands for a plan the launch rejects", () => {
  const cases: Array<[PlanReadinessRefusal, string, string | null]> = [
    ["review_incomplete_block", "hubPoolPlan", "BUILD_EXECUTION_GAP"],
    ["review_incomplete_block", "pool with no slippage", "INVALID_SLIPPAGE"],
    ["review_zero_share", "pool at 0", "INVALID_ALLOCATION"],
    ["review_zero_share", "spoke pool at 0", "INVALID_ALLOCATION"],
    ["review_stacked_positions", "supplyBorrowPlan", "BUILD_EXECUTION_GAP"],
    ["review_stacked_positions", "supply then manager swap", "BUILD_EXECUTION_GAP"],
    ["review_unsupported_swap", "supply WETH", "BUILD_EXECUTION_GAP"],
    ["review_unsupported_swap", "manager swap then supply", "BUILD_EXECUTION_GAP"],
    // No equivalent in the launch adapter: it opens the same reserve twice without a word. The
    // canvas is stricter on purpose (one Aave open per reserve), and this pins that it is the one.
    ["review_duplicate_reserve", "same reserve twice", null],
  ];

  for (const [refusal, name, code] of cases) {
    it(`[AG3] ${refusal}: ${name} ${code ? `is ${code}` : "has no launch equivalent"}`, () => {
      // @rule AG3
      const build = CORPUS[name];
      if (!build) throw new Error(`fixture: no plan ${name}`);
      const plan = build();
      expect(readinessOf(plan)).toMatchObject({ ready: false, refusal });
      if (code === null) expect(launchOf(plan)).not.toHaveProperty("error");
      else expect(launchOf(plan)).toEqual({ error: code });
    });
  }
});
