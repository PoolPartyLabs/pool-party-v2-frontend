/**
 * @id PP-MGR-MCK-005
 * @name buildPanelFixtures tests
 * @implements-rules-version v1 (POO-2185 rules v1)
 * @analytics-events none (data hooks): a data fixture.
 *
 * The fixtures stand in for the v2 catalog in mock mode, so they are held to the catalog's own
 * contract and to the arithmetic that makes the numbers one price: the wire schemas, the real v4
 * PoolId of each pool key, the ascending currency order, `tokens` and `pairSymbols` in KEY order (the
 * launch composition reads `tokens[i]` as currency i), `sqrtPriceX96` and the tick against the served
 * price (decimals applied), and the slugs the mandate's mock Pools step uses for the same pools: every
 * pool a mock mandate can hold must answer, or `Use` could never enable in mock mode (P13).
 */
import { encodeAbiParameters, keccak256 } from "viem";
import { describe, expect, it } from "vitest";
import { isPricedSymbol } from "@/features/manager/fund/mandateDraft";
import { catalogPoolSchema, catalogReserveSchema } from "@/lib/api/v2/schemas";
import {
  findPanelPoolFixture,
  PANEL_MOCK_FAILURE_RATE,
  PANEL_MOCK_LATENCY_MS,
  PANEL_POOL_FIXTURES,
  PANEL_RESERVE_FIXTURES,
  panelPoolAtPrice,
  panelPoolFixtures,
  panelReserveFixtures,
} from "./buildPanelFixtures";
import { fundPoolFixtures } from "./fundPools";

/** Token1 per token0 in human units, from the sqrt price and the two decimals, in floats. */
function humanPriceFromSqrt(sqrtPriceX96: string, decimals0: number, decimals1: number): number {
  const sqrt = Number(sqrtPriceX96);
  return ((sqrt * sqrt) / 2 ** 192) * 10 ** (decimals0 - decimals1);
}

/** The standard Uniswap v4 spacing of each fee tier the mock universe uses. */
const SPACING_OF_FEE: Record<number, number> = { 100: 1, 500: 10, 3000: 60, 10000: 200 };

/**
 * keccak256(abi.encode(poolKey)) of each GENERATED pool, computed offline with viem, apart from the
 * fixture code path: a golden value, so a change to how a key is composed or ordered shows up here.
 */
const GOLDEN_POOL_IDS: Record<string, string> = {
  "arb-v4-weth-usdc-1": "0xbc6e72d269fd1da54d27096339ef254d46b081214c77f7a571bc4dd0f416c581",
  "arb-v4-usdc-usdt-1": "0x20354cf3a44f2980f9fd205b7ed4418fee7ebf82a925c7d3c5d1565eb9831484",
  "arb-v4-wbtc-usdc-30": "0x70bf44c3a9b6b047bf60e5a05968225dbf3d6a5b9e8a95a73727e48921e889c1",
  "arb-v4-wbtc-weth-5": "0x46ffdbb4fee668ed8cc89d7207f4fda471f2f869b010479eac8534c54ec282fd",
  "arb-v4-arb-usdc-30": "0xb2aec80e582cec4ffceacfcd01eef7dc31d4d0f3d8241843ffafbc4623d2d517",
  "arb-v4-usdc-link-30": "0x69dc51302b48199311568c0e7ab6e0a2a961b1ba52d9bd006003d59efd123b75",
  "arb-v4-usdc-dai-1": "0x11a15ef8f07ae3fa4d725eef7a0cbf90643f6d08af7ed5e1c86725fedfe6bb89",
  "rbh-v4-weth-usdg-30": "0x77c25b9386d47de62e0155c393696e9f43f7e6d036c6ca52f66735ccbb8808a7",
  "rbh-v4-usdg-nvda-30": "0x3bb34a44f1b2b5f32c034c38a53065a521a47b199700fa9bd19d60985ff24bf1",
};

const ALL = panelPoolFixtures().map(({ mockId, pool }) => [mockId, pool] as const);

describe("[MCK-005] hand-written pool fixtures", () => {
  it("serves the three pools the panels need: two on Arbitrum (0.05% and 0.3%), one on Robinhood", () => {
    expect(PANEL_POOL_FIXTURES.map(({ pool }) => [pool.chainId, pool.poolKey.fee])).toEqual([
      ["42161", 500],
      ["42161", 3000],
      ["4663", 500],
    ]);
    expect(PANEL_POOL_FIXTURES.map(({ pool }) => pool.poolKey.tickSpacing)).toEqual([10, 60, 10]);
  });

  it("quotes ETH at about 3,050 USD on the Arbitrum 0.05% pool, with spacing 10", () => {
    const pool = findPanelPoolFixture(42161, "arb-v4-weth-usdc-5");
    expect(pool).not.toBeNull();
    expect(Number(pool?.currentPrice.token1PerToken0)).toBeGreaterThan(3000);
    expect(Number(pool?.currentPrice.token1PerToken0)).toBeLessThan(3100);
    expect(pool?.poolKey.tickSpacing).toBe(10);
    expect(pool?.pairSymbols).toEqual(["WETH", "USDC"]);
  });

  it("lists the Robinhood pair in the pool key's order, WETH then USDG, as the launch composition reads it", () => {
    const pool = findPanelPoolFixture(4663, "rbh-v4-weth-usdg-5");
    expect(pool?.pairSymbols).toEqual(["WETH", "USDG"]);
    expect(pool?.tokens.map((token) => token.symbol)).toEqual(["WETH", "USDG"]);
    expect(pool?.tokens.map((token) => token.address)).toEqual([
      pool?.poolKey.currency0,
      pool?.poolKey.currency1,
    ]);
  });
});

describe("[MCK-005] every pool fixture, hand-written or generated", () => {
  it.each(ALL)("%s parses as a catalog pool", (_id, pool) => {
    expect(catalogPoolSchema.safeParse(pool).success).toBe(true);
  });

  it.each(ALL)("%s has the real v4 PoolId of its pool key and no hooks", (_id, pool) => {
    const key = pool.poolKey;
    const id = keccak256(
      encodeAbiParameters(
        [
          { type: "address" },
          { type: "address" },
          { type: "uint24" },
          { type: "int24" },
          { type: "address" },
        ],
        [
          key.currency0 as `0x${string}`,
          key.currency1 as `0x${string}`,
          key.fee,
          key.tickSpacing,
          key.hooks as `0x${string}`,
        ],
      ),
    );
    expect(pool.poolId).toBe(id);
    expect(key.hooks).toBe(`0x${"0".repeat(40)}`);
    expect(pool.hooked).toBe(false);
  });

  it.each(
    ALL,
  )("%s orders its currencies by ascending address, and `tokens` and `pairSymbols` the same way", (_id, pool) => {
    const { currency0, currency1 } = pool.poolKey;
    expect(currency0 < currency1).toBe(true);
    expect(pool.tokens.map((token) => token.address)).toEqual([currency0, currency1]);
    expect(pool.pairSymbols).toEqual(pool.tokens.map((token) => token.symbol));
    expect(pool.tokens.every((token) => token.chainId === pool.chainId)).toBe(true);
  });

  it.each(
    ALL,
  )("%s has one price: the served strings, the sqrt price and the tick agree", (_id, pool) => {
    const [token0, token1] = pool.tokens;
    if (!token0 || !token1) throw new Error("tokens");
    const d0 = token0.decimals;
    const d1 = token1.decimals;
    const price = Number(pool.currentPrice.token1PerToken0);
    const fromSqrt = humanPriceFromSqrt(pool.sqrtPriceX96, d0, d1);
    expect(Math.abs(fromSqrt - price) / price).toBeLessThan(1e-9);
    expect(Math.abs(1 / Number(pool.currentPrice.token0PerToken1) - price) / price).toBeLessThan(
      1e-9,
    );
    // 1.0001^tick <= raw price < 1.0001^(tick + 1), raw being token1 / token0 in wei units.
    const raw = price * 10 ** (d1 - d0);
    expect(1.0001 ** pool.currentTick).toBeLessThanOrEqual(raw * (1 + 1e-12));
    expect(1.0001 ** (pool.currentTick + 1)).toBeGreaterThan(raw * (1 - 1e-12));
  });

  it.each(ALL)("%s serves TVL and APR as null with a reason, never a number", (_id, pool) => {
    expect(pool.tvlUsd).toBeNull();
    expect(pool.feesApr).toBeNull();
    expect(pool.tvlUnavailableReason).toBeTruthy();
    expect(pool.feesAprUnavailableReason).toBeTruthy();
  });

  it.each(ALL)("%s has active liquidity at a plausible scale", (_id, pool) => {
    const liquidity = BigInt(pool.liquidity);
    expect(liquidity > BigInt(0)).toBe(true);
    expect(Number(liquidity)).toBeGreaterThan(1e12);
    expect(Number(liquidity)).toBeLessThan(1e19);
  });

  it.each(ALL)("%s names its tokens the way the Mandate step's price rule does", (_id, pool) => {
    for (const token of pool.tokens) {
      expect(token.hubPriced).toBe(isPricedSymbol(token.symbol));
      // Stables are fixed 1:1 with their own address as source; the rest carry a feed.
      if (token.priceProvenance === "fixed-1:1") {
        expect(token.priceSource).toBe(token.address);
        expect(token.priceUsd).toBe("1");
      }
    }
    expect(pool.eligible).toBe(pool.tokens.every((token) => token.hubPriced));
  });

  it("has an unpriced token only where the Mandate step refuses one", () => {
    const unpriced = panelPoolFixtures()
      .filter(({ pool }) => !pool.eligible)
      .map(({ mockId }) => mockId);
    expect(unpriced).toEqual(["rbh-v4-usdg-nvda-30"]);
  });
});

describe("[MCK-005] generated pools cover the mandate's mock Pools step", () => {
  const hookless = fundPoolFixtures().uniswapV4.filter((row) => !row.hasHook);

  it("covers all 12 hookless Uniswap v4 pools of the mock universe", () => {
    expect(hookless).toHaveLength(12);
    expect(
      panelPoolFixtures()
        .map(({ mockId }) => mockId)
        .sort(),
    ).toEqual(hookless.map((row) => row.id).sort());
  });

  it.each(
    hookless.map((row) => [row.id, row] as const),
  )("%s resolves with the same pair, fee, network and currency order as its mandate row", (id, row) => {
    const chainId = row.network === "arbitrum" ? 42161 : 4663;
    const pool = findPanelPoolFixture(chainId, id);
    expect(pool, id).not.toBeNull();
    expect(pool?.poolKey.currency0).toBe(row.token0.address.toLowerCase());
    expect(pool?.poolKey.currency1).toBe(row.token1.address.toLowerCase());
    expect(pool?.poolKey.fee).toBe(row.feeTier);
    expect(pool?.poolKey.tickSpacing).toBe(SPACING_OF_FEE[row.feeTier]);
    expect(pool?.chainId).toBe(chainId === 42161 ? "42161" : "4663");
  });

  it.each(Object.entries(GOLDEN_POOL_IDS))("%s has the golden PoolId", (id, poolId) => {
    const chainId = id.startsWith("rbh") ? 4663 : 42161;
    expect(findPanelPoolFixture(chainId, id)?.poolId).toBe(poolId);
  });

  it("leaves out the pools with a hook, which no mandate can hold", () => {
    expect(findPanelPoolFixture(42161, "arb-v4-wsteth-weth-1")).toBeNull();
    expect(findPanelPoolFixture(42161, "arb-v4-weth-arb-100")).toBeNull();
  });

  it("builds the same fixtures every time and keeps them in a stable order", () => {
    expect(panelPoolFixtures()).toBe(panelPoolFixtures());
    expect(
      panelPoolFixtures()
        .slice(0, 3)
        .map(({ mockId }) => mockId),
    ).toEqual(["arb-v4-weth-usdc-5", "arb-v4-weth-usdc-30", "rbh-v4-weth-usdg-5"]);
  });

  it("prices a pair from its tokens' reference prices, so related pools agree", () => {
    const price = (chainId: 42161 | 4663, id: string) =>
      Number(findPanelPoolFixture(chainId, id)?.currentPrice.token1PerToken0);
    // WETH / USDC on three fee tiers: within a few hundredths of a percent of each other.
    const five = price(42161, "arb-v4-weth-usdc-5");
    expect(Math.abs(price(42161, "arb-v4-weth-usdc-1") - five) / five).toBeLessThan(0.001);
    // WBTC / WETH is the ratio of the two reference prices (WBTC about 31 ETH).
    const wbtcWeth = price(42161, "arb-v4-wbtc-weth-5");
    const wbtcUsdc = price(42161, "arb-v4-wbtc-usdc-30");
    expect(Math.abs(wbtcWeth * five - wbtcUsdc) / wbtcUsdc).toBeLessThan(0.002);
    // A stable pair sits at parity, and a stable-first pair quotes the small token per stable.
    expect(price(42161, "arb-v4-usdc-usdt-1")).toBeGreaterThan(0.999);
    expect(price(42161, "arb-v4-usdc-usdt-1")).toBeLessThan(1.001);
    expect(price(42161, "arb-v4-usdc-link-30")).toBeLessThan(1);
  });
});

describe("[MCK-005] findPanelPoolFixture", () => {
  const poolId = "0xfc7b3ad139daaf1e9c3637ed921c154d1b04286f8a82b805a6c352da57028653";

  it("finds a pool by its PoolId, in any letter case", () => {
    expect(findPanelPoolFixture(42161, poolId)?.poolKey.fee).toBe(500);
    expect(findPanelPoolFixture(42161, poolId.toUpperCase().replace("0X", "0x"))?.poolKey.fee).toBe(
      500,
    );
  });

  it("finds a pool by the slug the mandate's mock Pools step gives it", () => {
    expect(findPanelPoolFixture(42161, "arb-v4-weth-usdc-30")?.poolKey.tickSpacing).toBe(60);
    expect(findPanelPoolFixture(4663, "rbh-v4-weth-usdg-5")?.chainId).toBe("4663");
    expect(findPanelPoolFixture(42161, "arb-v4-usdc-usdt-1")?.poolKey.fee).toBe(100);
  });

  it("answers null on the wrong network and for an id it does not know", () => {
    expect(findPanelPoolFixture(4663, poolId)).toBeNull();
    expect(findPanelPoolFixture(42161, "rbh-v4-weth-usdg-5")).toBeNull();
    expect(findPanelPoolFixture(42161, "arb-v4-doge-usdc-30")).toBeNull();
    expect(findPanelPoolFixture(42161, `0x${"ab".repeat(32)}`)).toBeNull();
  });

  it("hands out a copy: writing through it never changes the fixture", () => {
    for (const id of [poolId, "arb-v4-wbtc-usdc-30"]) {
      const first = findPanelPoolFixture(42161, id);
      if (!first) throw new Error("fixture missing");
      const tick = first.currentTick;
      const fee = first.poolKey.fee;
      first.currentTick = 0;
      first.poolKey.fee = 1;
      const second = findPanelPoolFixture(42161, id);
      expect(second?.currentTick).toBe(tick);
      expect(second?.poolKey.fee).toBe(fee);
    }
  });

  it("uses the same slugs, networks, fees and currency order as the mandate's mock Pools step", () => {
    const mandateRows = fundPoolFixtures().uniswapV4;
    for (const { mockId, pool } of PANEL_POOL_FIXTURES) {
      const row = mandateRows.find((entry) => entry.id === mockId);
      expect(row, mockId).toBeDefined();
      expect(row?.feeTier).toBe(pool.poolKey.fee);
      expect(row?.network).toBe(pool.chainId === "42161" ? "arbitrum" : "robinhood");
      expect(row?.token0.address.toLowerCase()).toBe(pool.poolKey.currency0);
      expect(row?.token1.address.toLowerCase()).toBe(pool.poolKey.currency1);
    }
  });
});

describe("[MCK-005] panelPoolAtPrice", () => {
  const original = () => {
    const pool = findPanelPoolFixture(42161, "arb-v4-weth-usdc-5");
    if (!pool) throw new Error("fixture missing");
    return pool;
  };

  it.each([
    2400, 3050.4127, 3100, 4200.55,
  ])("moves the market to %s with one coherent price: strings, sqrt price and tick", (price) => {
    const moved = panelPoolAtPrice(original(), price);
    expect(catalogPoolSchema.safeParse(moved).success).toBe(true);
    expect(Math.abs(Number(moved.currentPrice.token1PerToken0) - price) / price).toBeLessThan(1e-9);
    expect(Math.abs(humanPriceFromSqrt(moved.sqrtPriceX96, 18, 6) - price) / price).toBeLessThan(
      1e-9,
    );
    expect(Math.abs(1 / Number(moved.currentPrice.token0PerToken1) - price) / price).toBeLessThan(
      1e-9,
    );
    const raw = price * 10 ** (6 - 18);
    expect(1.0001 ** moved.currentTick).toBeLessThanOrEqual(raw * (1 + 1e-12));
    expect(1.0001 ** (moved.currentTick + 1)).toBeGreaterThan(raw * (1 - 1e-12));
  });

  it("keeps everything else of the pool and never writes through the original", () => {
    const before = original();
    const moved = panelPoolAtPrice(before, 3300);
    expect(moved.poolId).toBe(before.poolId);
    expect(moved.poolKey).toEqual(before.poolKey);
    expect(moved.tokens).toEqual(before.tokens);
    expect(moved.liquidity).toBe(before.liquidity);
    expect(original().currentTick).toBe(-196090);
    expect(before.currentPrice.token1PerToken0).toBe("3050.4127");
    moved.poolKey.fee = 1;
    expect(before.poolKey.fee).toBe(500);
  });

  it("moves a pool whose token0 has fewer decimals, as well as one whose token0 has more", () => {
    const stableFirst = findPanelPoolFixture(42161, "arb-v4-usdc-link-30");
    if (!stableFirst) throw new Error("fixture missing");
    const moved = panelPoolAtPrice(stableFirst, 0.08);
    expect(Math.abs(humanPriceFromSqrt(moved.sqrtPriceX96, 6, 18) - 0.08) / 0.08).toBeLessThan(
      1e-9,
    );
  });

  it("refuses a pool whose key names a currency its tokens do not carry", () => {
    const broken = original();
    broken.poolKey.currency1 = `0x${"9".repeat(40)}`;
    expect(() => panelPoolAtPrice(broken, 3000)).toThrow(/currency/i);
  });
});

describe("[MCK-005] reserve fixtures", () => {
  it.each(
    PANEL_RESERVE_FIXTURES.map((reserve) => [reserve.token.symbol, reserve] as const),
  )("%s parses as a catalog reserve", (_symbol, reserve) => {
    expect(catalogReserveSchema.safeParse(reserve).success).toBe(true);
  });

  it.each(
    PANEL_RESERVE_FIXTURES.map((reserve) => [reserve.token.symbol, reserve] as const),
  )("%s keys its reserve the way the launch builds the Aave pool key: the asset address, left-padded", (_symbol, reserve) => {
    expect(reserve.poolKey).toBe(`0x${reserve.token.address.slice(2).padStart(64, "0")}`);
  });

  it("lists the Aave USDC reserve on Arbitrum with a plausible supply APY, usable", () => {
    const usdc = PANEL_RESERVE_FIXTURES.find((reserve) => reserve.token.symbol === "USDC");
    expect(usdc?.chainId).toBe("42161");
    expect(usdc?.token.decimals).toBe(6);
    expect(Number(usdc?.supplyApy)).toBeGreaterThan(2);
    expect(Number(usdc?.supplyApy)).toBeLessThan(10);
    expect(
      usdc?.available && usdc.active && !usdc.frozen && !usdc.paused && !usdc.supplyCapReached,
    ).toBe(true);
  });

  it("lists exactly one unusable reserve, so a disabled row exists to render", () => {
    const unusable = PANEL_RESERVE_FIXTURES.filter(
      (reserve) =>
        !(
          reserve.available &&
          reserve.active &&
          !reserve.frozen &&
          !reserve.paused &&
          !reserve.supplyCapReached
        ),
    );
    expect(unusable).toHaveLength(1);
    expect(unusable[0]?.token.symbol).toBe("WETH");
    expect(unusable[0]?.supplyCapReached).toBe(true);
  });

  it("hands out a copy of the reserves", () => {
    const first = panelReserveFixtures();
    const firstReserve = first[0];
    if (!firstReserve) throw new Error("fixture missing");
    firstReserve.supplyApy = "99";
    expect(panelReserveFixtures()[0]?.supplyApy).toBe("4.12");
    expect(PANEL_RESERVE_FIXTURES[0]?.supplyApy).toBe("4.12");
  });
});

describe("[MCK-005] mock read behaviour", () => {
  it("has a latency band wide enough to see a skeleton and a failure rate in the realistic band", () => {
    const [low, high] = PANEL_MOCK_LATENCY_MS;
    expect(low).toBeGreaterThanOrEqual(50);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(1000);
    expect(PANEL_MOCK_FAILURE_RATE).toBeGreaterThanOrEqual(0.02);
    expect(PANEL_MOCK_FAILURE_RATE).toBeLessThanOrEqual(0.05);
  });
});
