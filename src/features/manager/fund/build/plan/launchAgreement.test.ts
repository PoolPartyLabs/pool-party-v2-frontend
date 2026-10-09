/**
 * @id PP-MGR-LIB-028
 * @name launch agreement tests
 * @implements-rules-version v1 (POO-2184 rules v1); POO-2204 rules v1
 * @analytics-events none, a contract test of pure functions.
 *
 * The canvas and the launch read one plan (POO-2184; verification findings 1, 2 and 4). The launch
 * adapter (`launch/index.ts` `getLaunchSteps`, PP-MGR-LIB-045 over PP-MGR-LIB-037) stays the
 * authority; these tests hold the canvas to it, through the REAL functions on both sides:
 *
 * - [AG1] CONTRACT: a plan configured only through `applyBlockConfig`, with a hub Uniswap v4 pool
 *   (ranges from the pool panel's own maths, `presetRange` of PP-MGR-LIB-029, Full included) and
 *   an Aave USDC Supply, each with a share above 0, is accepted, carries the bare PoolId and the
 *   loss bound the launch signs (slippage 0.1, 2 and 5% are 10, 200 and 500 bps), and passes the
 *   launch's own tick alignment check on the catalog spacing. Apply refuses a range off the grid
 *   and stores the PoolId in the casing the launch compares.
 * - [AG2] AGREEMENT: every plan `planReadiness` calls ready is accepted by `getLaunchSteps`,
 *   spoke shapes included (a spoke above its chains, an emptied spoke, a released one).
 * - [AG3] Each refusal PA1 adds stands for a plan `getLaunchSteps` rejects, where the launch has an
 *   equivalent; those without one are stated as such.
 */
import { describe, expect, it } from "vitest";
import type { FundLaunchDraft } from "../../launch/contracts";
import type * as LaunchIndex from "../../launch/index";
import { assertLaunchPlan, getLaunchSteps as fromJourney } from "../../launch/journey";
import { deriveLaunchSteps, validateTickAlignment } from "../../launch/plan";
import type { MandateDraft } from "../../mandateDraft";
import { type PoolRange, presetRange, type RangePreset } from "../panel/poolRangeMath";
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
import {
  addChain,
  addSpoke,
  applyBlockConfig,
  insertAt,
  removeBlock,
  removeBlockReleasingShare,
} from "./planReducers";
import {
  completePoolConfig,
  makeTestContext,
  makeTestDraft,
  TEST_ASSET_KEYS,
  TEST_POOL_IDS,
  VALID_TEST_PLANS,
  withCompletePools,
} from "./planTestKit";
import {
  makeRealModeDraft,
  REAL_POOL_ID,
  REAL_POOL_TICK_SPACING,
  realCatalogPool,
} from "./realPoolTestKit";

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
  assertLaunchPlan(plan);
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

/**
 * The real pool as the pool panel reads it live (PB, `poolRangeMath.ts`, PP-MGR-LIB-029): WETH (18
 * decimals) over USDC (6), the catalog's spacing of 10, the catalog's current tick.
 */
const LIVE_POOL = {
  decimals0: 18,
  decimals1: 6,
  tickSpacing: REAL_POOL_TICK_SPACING,
  currentTick: realCatalogPool().currentTick,
};

/** A preset chip's range from the panel's own maths, as the panel writes it on Apply. */
function panelRange(preset: RangePreset, displayInverted = false): PoolRange {
  const range = presetRange(LIVE_POOL, preset, displayInverted);
  if (!range) throw new Error(`fixture: no ${preset} range`);
  return range;
}

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

const POOL_CASES: Array<[string, Omit<PoolBlockConfig, "poolId">, number]> = [
  ["the ±10% preset, slippage 2%", { ...panelRange(10), slippagePct: 2 }, 200],
  ["the ±5% preset read inverted, slippage 0.1%", { ...panelRange(5, true), slippagePct: 0.1 }, 10],
  ["the ±20% preset, slippage 5%", { ...panelRange(20), slippagePct: 5 }, 500],
  [
    "Full on the finite aligned extremes, slippage 0.5%",
    { ...panelRange("full"), slippagePct: 0.5 },
    50,
  ],
];

describe("[AG1] the contract: a plan written by Apply is a plan the launch runs", () => {
  it("[AG3] a local Solana descriptor never becomes an EVM launch position (POO-2301)", () => {
    // @rule AG3: structural fixture validation does not grant local execution capability.
    const plan: BuildPlan = {
      ...createEmptyPlan(),
      hub: {
        chains: [
          {
            id: "local-chain",
            sharePct: 100,
            steps: [
              {
                id: "local-position",
                family: "position",
                kind: "solanaOrcaPool",
                config: { catalogId: "local-orca", pair: "SOL / USDC" },
              },
            ],
          },
        ],
      },
    };
    expect(launchOf(plan)).toEqual({ error: "UNSUPPORTED_POSITION" });
  });

  for (const [name, pool, bps] of POOL_CASES) {
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
      expect(open?.config?.poolId).toMatch(/^0x[0-9a-fA-F]{64}$/);
      expect(() => validateTickAlignment(open?.config ?? {}, REAL_POOL_TICK_SPACING)).not.toThrow();
    });
  }

  it("[AG1] Full is the widest pair of ticks on the pool's own spacing, on both sides", () => {
    // @rule AG1
    expect(panelRange("full")).toMatchObject({ tickLower: -887_270, tickUpper: 887_270 });
    expect(fullRangeTicks(REAL_POOL_TICK_SPACING)).toEqual({
      tickLower: -887_270,
      tickUpper: 887_270,
    });
  });

  it("[AG1] the PoolId the launch reads is the catalog's bytes32", () => {
    // @rule AG1
    expect(REAL_POOL_ID).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it("[AG1] Apply refuses a range off the pool's grid, and Full off its extremes", () => {
    // @rule AG1
    const { plan, draft } = demoPlan({ ...panelRange(10), slippagePct: 2 });
    const ctx = makeTestContext(draft);
    const poolId = blockIdOf(plan, "uniswapV4Pool");
    const ten = panelRange(10);
    for (const config of [
      { ...ten, tickLower: ten.tickLower + 1 },
      { ...ten, fullRange: true },
    ]) {
      expect(
        applyBlockConfig(plan, ctx, poolId, { poolId: REAL_POOL_ID, ...config, slippagePct: 2 }),
      ).toEqual({ blocked: { reason: "unknown_target", targetId: poolId } });
    }
  });

  it("[AG1] Apply stores the PoolId the launch compares strictly, whatever casing it got", () => {
    // @rule AG1
    const { plan, draft } = demoPlan({ ...panelRange(10), slippagePct: 2 });
    const poolId = blockIdOf(plan, "uniswapV4Pool");
    const upper = `0x${REAL_POOL_ID.slice(2).toUpperCase()}`;
    const next = planOf(
      applyBlockConfig(plan, makeTestContext(draft), poolId, {
        poolId: upper,
        ...panelRange(10),
        slippagePct: 2,
      }),
    );
    const steps = deriveLaunchSteps(launchDraft(next, draft).plan, {}, true, false);
    expect(steps.find((step) => step.id === `${poolId}:open`)?.config?.poolId).toBe(REAL_POOL_ID);
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

const COMPLETE: PoolBlockConfig = completePoolConfig(TEST_POOL_IDS.arbitrum);
const AUTO_SWAP: Step = { id: "x-swap", family: "flow", kind: "swap", auto: true };
const MANUAL_SWAP: Step = { id: "m-swap", family: "flow", kind: "swap", auto: false };

/** `spokePlan(chainPct)` with the spoke's own share set apart from its chain (review M1). */
function spokeHolding(spokePct: number, chainPct = 40): BuildPlan {
  const plan = spokePlan(chainPct);
  return { ...plan, spokes: plan.spokes.map((spoke) => ({ ...spoke, sharePct: spokePct })) };
}

/** A hub pool at 50 beside a spoke pool at 40, then the spoke pool removed the way given. */
function afterSpokeRemove(release: boolean): BuildPlan {
  const ctx = makeTestContext();
  const spoke = spokePlan(40);
  const plan = { ...spoke, hub: { chains: [pool("p", 50, COMPLETE)] } };
  const id = blockIdOf(spoke, "uniswapV4Pool");
  return planOf(release ? removeBlockReleasingShare(plan, ctx, id) : removeBlock(plan, ctx, id));
}

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
  "spoke 40.5 over a chain of 40": () => spokeHolding(40.5),
  "spoke 45 over a chain of 40": () => spokeHolding(45),
  "spoke left at 40 by the old remove": () => afterSpokeRemove(false),
  "spoke released to 0 by the panel's remove": () => afterSpokeRemove(true),
  "pool without the two display flags": () =>
    hubOf(
      pool("p", 60, {
        poolId: TEST_POOL_IDS.arbitrum,
        tickLower: COMPLETE.tickLower,
        tickUpper: COMPLETE.tickUpper,
        slippagePct: 2,
      }),
    ),
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
        "pool at 0",
        "pool with Collect fees",
        "spoke pool 40",
        "spoke pool 40 + hub pool 60",
        "spoke released to 0 by the panel's remove",
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
    ["review_zero_share", "spoke pool at 0", "INVALID_ALLOCATION"],
    ["review_stacked_positions", "supplyBorrowPlan", "BUILD_EXECUTION_GAP"],
    ["review_stacked_positions", "supply then manager swap", "BUILD_EXECUTION_GAP"],
    ["review_unsupported_swap", "supply WETH", "BUILD_EXECUTION_GAP"],
    ["review_unsupported_swap", "manager swap then supply", "BUILD_EXECUTION_GAP"],
    ["review_unused_spoke_share", "spoke 40.5 over a chain of 40", "INVALID_ALLOCATION"],
    ["review_duplicate_reserve", "same reserve twice", "DUPLICATE_AAVE_RESERVE"],
    // No equivalent either: the launch bridges a spoke's whole share and deploys only its chains,
    // so the rest would sit on the spoke. The canvas refuses it (review M1 of PR #51).
    ["review_unused_spoke_share", "spoke 45 over a chain of 40", null],
    ["review_unused_spoke_share", "spoke left at 40 by the old remove", null],
    // Stricter on purpose: Apply always writes both flags, so a pool without them was not written
    // by a panel; the launch reads neither flag (review L1 of PR #51).
    ["review_incomplete_block", "pool without the two display flags", null],
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
