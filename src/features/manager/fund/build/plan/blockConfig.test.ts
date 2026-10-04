/**
 * @id PP-MGR-LIB-026
 * @name blockConfig tests
 * @implements-rules-version v1 (POO-2184 rules v1)
 * @analytics-events none, a test of pure functions.
 *
 * The block configuration contract of the panels (POO-2184, confirmed by the launch owner on
 * 2026-10-04; verification findings 1 and 2):
 *
 * - [K1] a pool config EXTENDS `{ poolId }` with integer canonical ticks, `fullRange`,
 *   `displayInverted` and `slippagePct` (0.1 to 5); an Aave config extends `{ assetKey }` with an
 *   optional `slippagePct`. `poolId` xor `assetKey`, never both.
 * - [K2] a malformed config (a wrong type or a value out of range) makes the stored plan unreadable,
 *   as today; a valid but INCOMPLETE one (`{ poolId }` with no range yet) still reads.
 * - [K3] `config.poolId` is the BARE v4 PoolId: every reader matches `pool.poolId ?? pool.id` inside
 *   the block's network, so a real-mode row (`42161:<poolId>`, from `mapV2Pool`) is found by its
 *   bare PoolId and never by its row id, and a mock row (no PoolId) by its id.
 * - [K4] a write the reader would refuse is refused by the reducer too.
 */
import { describe, expect, it } from "vitest";
import { describeBlock } from "../blocks/blockRegistry";
import { makeDescribeContext, TEST_CATALOG } from "../blocks/blockTestKit";
import { fullPoolRange } from "../panel/poolRangeMath";
import {
  BLOCK_SLIPPAGE_MAX_PCT,
  BLOCK_SLIPPAGE_MIN_PCT,
  findMandatePool,
  fullRangeTicks,
  isConfigFor,
  isPoolConfigComplete,
} from "./blockConfig";
import { type BuildPlan, isPlanBlocked, type PoolBlockConfig } from "./buildPlan";
import { validatePlan } from "./planInvariants";
import { setBlockConfig } from "./planReducers";
import { normalizePlan } from "./planStorage";
import { hubPoolPlan, makeTestContext, makeTestDraft, TEST_POOL_IDS } from "./planTestKit";
import { makeRealModeDraft, REAL_POOL_ID, realPoolRow } from "./realPoolTestKit";

/** What Apply writes for a pool: every field the launch reads. */
const COMPLETE: PoolBlockConfig = {
  poolId: TEST_POOL_IDS.arbitrum,
  tickLower: -199_370,
  tickUpper: -195_370,
  fullRange: false,
  displayInverted: false,
  slippagePct: 2,
};

/** The hub pool plan with its pool configured as given. */
function hubPoolWith(config: PoolBlockConfig | null): BuildPlan {
  const plan = hubPoolPlan();
  const chain = plan.hub.chains[0];
  const pool = chain?.steps[1];
  if (!chain || pool?.family !== "position") throw new Error("fixture: no pool");
  chain.steps[1] = { ...pool, kind: "uniswapV4Pool", config };
  return plan;
}

/** A value as storage hands it back: through JSON. */
function stored<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("isConfigFor: the shape and ranges of a stored config (K1, K2)", () => {
  it("[K1] accepts an empty block, a picked pool and a complete pool config", () => {
    // @rule K1
    expect(isConfigFor("uniswapV4Pool", null)).toBe(true);
    expect(isConfigFor("uniswapV4Pool", { poolId: "p" })).toBe(true);
    expect(isConfigFor("uniswapV4Pool", COMPLETE)).toBe(true);
    expect(isConfigFor("uniswapV3Pool", COMPLETE)).toBe(true);
  });

  it("[K1] accepts an Aave asset, with or without the slippage of its swap", () => {
    // @rule K1
    expect(isConfigFor("aaveSupply", { assetKey: "arbitrum:0xabc" })).toBe(true);
    expect(isConfigFor("aaveSupply", { assetKey: "arbitrum:0xabc", slippagePct: 2 })).toBe(true);
    expect(isConfigFor("aaveBorrow", { assetKey: "arbitrum:0xabc" })).toBe(true);
  });

  it("[K1] keeps the poolId xor assetKey rule, and refuses a config on a kind that takes none", () => {
    // @rule K1
    expect(isConfigFor("uniswapV4Pool", { poolId: "p", assetKey: "a" })).toBe(false);
    expect(isConfigFor("aaveSupply", { poolId: "p", assetKey: "a" })).toBe(false);
    expect(isConfigFor("uniswapV4Pool", { assetKey: "a" })).toBe(false);
    expect(isConfigFor("aaveSupply", { poolId: "p" })).toBe(false);
    expect(isConfigFor("pendle", { poolId: "p" })).toBe(false);
    expect(isConfigFor("uniswapV4Pool", "p")).toBe(false);
    expect(isConfigFor("uniswapV4Pool", [])).toBe(false);
  });

  it("[K2] refuses ticks that are not integers on the Uniswap tick range, or not in order", () => {
    // @rule K2
    const bad: Array<Partial<PoolBlockConfig> | Record<string, unknown>> = [
      { tickLower: 1.5 },
      { tickUpper: "10" },
      { tickLower: -887_273 },
      { tickUpper: 887_273 },
      { tickLower: Number.NaN },
      { tickLower: 100, tickUpper: 100 },
      { tickLower: 200, tickUpper: 100 },
      { tickLower: null },
    ];
    for (const edit of bad) {
      expect(isConfigFor("uniswapV4Pool", { ...COMPLETE, ...edit })).toBe(false);
    }
    expect(isConfigFor("uniswapV4Pool", { ...COMPLETE, ...fullRangeTicks(1) })).toBe(true);
  });

  it("[K2] refuses flags that are not booleans", () => {
    // @rule K2
    expect(isConfigFor("uniswapV4Pool", { ...COMPLETE, fullRange: "yes" })).toBe(false);
    expect(isConfigFor("uniswapV4Pool", { ...COMPLETE, displayInverted: 1 })).toBe(false);
  });

  it("[K2] takes a slippage from 0.1 to 5 only, on a pool and on an Aave block", () => {
    // @rule K2
    expect(BLOCK_SLIPPAGE_MIN_PCT).toBe(0.1);
    expect(BLOCK_SLIPPAGE_MAX_PCT).toBe(5);
    for (const slippagePct of [0.1, 0.5, 2, 5]) {
      expect(isConfigFor("uniswapV4Pool", { ...COMPLETE, slippagePct })).toBe(true);
      expect(isConfigFor("aaveSupply", { assetKey: "a", slippagePct })).toBe(true);
    }
    for (const slippagePct of [0, 0.09, 5.01, 20, -1, Number.POSITIVE_INFINITY, "2"]) {
      expect(isConfigFor("uniswapV4Pool", { ...COMPLETE, slippagePct })).toBe(false);
      expect(isConfigFor("aaveSupply", { assetKey: "a", slippagePct })).toBe(false);
    }
  });

  it("[K1] keeps fields it does not know, as S1 did for the panel batch", () => {
    // @rule K1
    expect(isConfigFor("uniswapV4Pool", { ...COMPLETE, note: "kept" })).toBe(true);
  });
});

describe("isPoolConfigComplete: what readiness asks of a pool (K2)", () => {
  it("[K2] is true only when every launch field is there", () => {
    // @rule K2
    expect(isPoolConfigComplete(COMPLETE)).toBe(true);
    expect(isPoolConfigComplete(null)).toBe(false);
    expect(isPoolConfigComplete({ poolId: "p" })).toBe(false);
    for (const field of [
      "tickLower",
      "tickUpper",
      "fullRange",
      "displayInverted",
      "slippagePct",
    ] as const) {
      const { [field]: _dropped, ...rest } = COMPLETE;
      expect(isPoolConfigComplete(rest as PoolBlockConfig)).toBe(false);
    }
    expect(isPoolConfigComplete({ ...COMPLETE, slippagePct: 7 })).toBe(false);
  });
});

describe("fullRangeTicks: Full is the finite extremes on the pool's own spacing (K1)", () => {
  it("[K1] gives the widest aligned ticks for any positive spacing", () => {
    // @rule K1
    expect(fullRangeTicks(1)).toEqual({ tickLower: -887_272, tickUpper: 887_272 });
    expect(fullRangeTicks(10)).toEqual({ tickLower: -887_270, tickUpper: 887_270 });
    expect(fullRangeTicks(60)).toEqual({ tickLower: -887_220, tickUpper: 887_220 });
    expect(fullRangeTicks(50)).toEqual({ tickLower: -887_250, tickUpper: 887_250 });
    expect(fullRangeTicks(200)).toEqual({ tickLower: -887_200, tickUpper: 887_200 });
  });

  it("[K1] agrees with the pool panel's Full range on the same grid (PP-MGR-LIB-029)", () => {
    // @rule K1
    for (const tickSpacing of [1, 10, 50, 60, 200]) {
      const full = fullPoolRange({ decimals0: 18, decimals1: 6, tickSpacing });
      expect(fullRangeTicks(tickSpacing)).toEqual({
        tickLower: full.tickLower,
        tickUpper: full.tickUpper,
      });
    }
  });

  it("[K1] answers null for a spacing that is not a positive integer", () => {
    // @rule K1
    expect(fullRangeTicks(0)).toBeNull();
    expect(fullRangeTicks(-10)).toBeNull();
    expect(fullRangeTicks(1.5)).toBeNull();
  });
});

describe("normalizePlan reads the extended config (K2)", () => {
  it("[K2] reads a complete pool config and a picked-only pool back deep-equal", () => {
    // @rule K2
    for (const config of [COMPLETE, { poolId: TEST_POOL_IDS.arbitrum }]) {
      const plan = hubPoolWith(config);
      expect(normalizePlan(stored(plan))).toEqual(plan);
    }
  });

  it("[K2] refuses a plan holding a malformed config, so the draft is marked unreadable", () => {
    // @rule K2
    expect(normalizePlan(stored(hubPoolWith({ ...COMPLETE, slippagePct: 9 })))).toBeNull();
    expect(normalizePlan(stored(hubPoolWith({ ...COMPLETE, tickLower: 0.5 })))).toBeNull();
  });
});

describe("findMandatePool: the bare PoolId inside the block's network (K3)", () => {
  it("[K3] finds a real-mode row by its bare PoolId, never by its row id", () => {
    // @rule K3
    const row = realPoolRow();
    expect(row.id).toBe(`42161:${REAL_POOL_ID}`);
    expect(row.poolId).toBe(REAL_POOL_ID);
    expect(findMandatePool([row], "arbitrum", REAL_POOL_ID)).toBe(row);
    expect(findMandatePool([row], "arbitrum", REAL_POOL_ID.toUpperCase().replace("0X", "0x"))).toBe(
      row,
    );
    expect(findMandatePool([row], "arbitrum", row.id)).toBeUndefined();
    expect(findMandatePool([row], "robinhood", REAL_POOL_ID)).toBeUndefined();
  });

  it("[K3] finds a mock row, which has no PoolId, by its id", () => {
    // @rule K3
    const pools = makeTestDraft().pools;
    const mock = pools.find((pool) => pool.id === TEST_POOL_IDS.arbitrum);
    expect(mock?.poolId).toBeUndefined();
    expect(findMandatePool(pools, "arbitrum", TEST_POOL_IDS.arbitrum)).toBe(mock);
    expect(findMandatePool(pools, "robinhood", TEST_POOL_IDS.arbitrum)).toBeUndefined();
  });
});

describe("the three readers follow the bare PoolId (K3, K4)", () => {
  const draft = makeRealModeDraft();
  const ctx = makeTestContext(draft);

  it("[K3] validatePlan holds a real-mode pool configured with its bare PoolId", () => {
    // @rule K3
    const bare = hubPoolWith({ ...COMPLETE, poolId: REAL_POOL_ID });
    expect(validatePlan(bare, { draft, catalog: TEST_CATALOG })).toEqual([]);
    const rowId = hubPoolWith({ ...COMPLETE, poolId: `42161:${REAL_POOL_ID}` });
    expect(validatePlan(rowId, { draft, catalog: TEST_CATALOG })).toEqual([
      { invariant: 2, code: "config_not_in_mandate", targetId: "hub-pool-pool" },
    ]);
  });

  it("[K3] setBlockConfig takes the bare PoolId of a real-mode row and refuses its row id", () => {
    // @rule K3
    const plan = hubPoolWith(null);
    const ok = setBlockConfig(plan, ctx, "hub-pool-pool", { ...COMPLETE, poolId: REAL_POOL_ID });
    expect(isPlanBlocked(ok)).toBe(false);
    expect(setBlockConfig(plan, ctx, "hub-pool-pool", { poolId: `42161:${REAL_POOL_ID}` })).toEqual(
      { blocked: { reason: "not_in_mandate", targetId: "hub-pool-pool" } },
    );
  });

  it("[K3] setBlockConfig still takes a mock row by its id", () => {
    // @rule K3
    const result = setBlockConfig(hubPoolWith(null), makeTestContext(), "hub-pool-pool", COMPLETE);
    expect(isPlanBlocked(result)).toBe(false);
  });

  it("[K4] setBlockConfig refuses a config the stored plan could not read back", () => {
    // @rule K4
    const plan = hubPoolWith(null);
    for (const config of [
      { ...COMPLETE, slippagePct: 7 },
      { ...COMPLETE, tickLower: 10, tickUpper: -10 },
      { ...COMPLETE, fullRange: "no" } as unknown as PoolBlockConfig,
    ]) {
      expect(setBlockConfig(plan, makeTestContext(), "hub-pool-pool", config)).toEqual({
        blocked: { reason: "unknown_target", targetId: "hub-pool-pool" },
      });
    }
  });

  it("[K3] describeBlock titles a real-mode pool found by its bare PoolId", () => {
    // @rule K3
    const plan = hubPoolWith({ ...COMPLETE, poolId: REAL_POOL_ID });
    const content = describeBlock("hub-pool-pool", makeDescribeContext(plan, draft));
    expect(content.title).toBe("WETH / USDC");
    expect(content.caption).toBe("Uniswap v4 · 0.05%");
    expect(content.state).toBe("default");
  });
});
