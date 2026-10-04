/**
 * @id PP-MGR-MCK-005
 * @name buildPanelFixtures tests
 * @implements-rules-version v1 (POO-2185 rules v1)
 * @analytics-events none (data hooks): a data fixture.
 *
 * The fixtures stand in for the v2 catalog in mock mode, so they are held to the catalog's own
 * contract and to the arithmetic that makes the numbers one price: the wire schemas, the real v4
 * PoolId of each pool key, the ascending currency order, `sqrtPriceX96` and the tick against the
 * served price (decimals applied), and the slugs the mandate's mock Pools step uses for the same
 * pools (so a pool picked there resolves here).
 */
import { encodeAbiParameters, keccak256 } from "viem";
import { describe, expect, it } from "vitest";
import { catalogPoolSchema, catalogReserveSchema } from "@/lib/api/v2/schemas";
import {
  findPanelPoolFixture,
  PANEL_MOCK_FAILURE_RATE,
  PANEL_MOCK_LATENCY_MS,
  PANEL_POOL_FIXTURES,
  PANEL_RESERVE_FIXTURES,
  panelReserveFixtures,
} from "./buildPanelFixtures";
import { fundPoolFixtures } from "./fundPools";

/** Token1 per token0 in human units, from the sqrt price and the two decimals, in floats. */
function humanPriceFromSqrt(sqrtPriceX96: string, decimals0: number, decimals1: number): number {
  const sqrt = Number(sqrtPriceX96);
  return ((sqrt * sqrt) / 2 ** 192) * 10 ** (decimals0 - decimals1);
}

describe("[MCK-005] pool fixtures", () => {
  it("serves the three pools the panels need: two on Arbitrum (0.05% and 0.3%), one on Robinhood", () => {
    expect(PANEL_POOL_FIXTURES.map(({ pool }) => [pool.chainId, pool.poolKey.fee])).toEqual([
      ["42161", 500],
      ["42161", 3000],
      ["4663", 500],
    ]);
    expect(PANEL_POOL_FIXTURES.map(({ pool }) => pool.poolKey.tickSpacing)).toEqual([10, 60, 10]);
  });

  it.each(
    PANEL_POOL_FIXTURES.map(({ mockId, pool }) => [mockId, pool] as const),
  )("%s parses as a catalog pool", (_id, pool) => {
    expect(catalogPoolSchema.safeParse(pool).success).toBe(true);
  });

  it.each(
    PANEL_POOL_FIXTURES.map(({ mockId, pool }) => [mockId, pool] as const),
  )("%s has the real v4 PoolId of its pool key and no hooks", (_id, pool) => {
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
    PANEL_POOL_FIXTURES.map(({ mockId, pool }) => [mockId, pool] as const),
  )("%s orders its currencies by ascending address and carries both tokens", (_id, pool) => {
    const { currency0, currency1 } = pool.poolKey;
    expect(currency0 < currency1).toBe(true);
    const held = pool.tokens.map((token) => token.address).sort();
    expect(held).toEqual([currency0, currency1].sort());
    expect(pool.tokens.every((token) => token.chainId === pool.chainId)).toBe(true);
  });

  it.each(
    PANEL_POOL_FIXTURES.map(({ mockId, pool }) => [mockId, pool] as const),
  )("%s has one price: the served strings, the sqrt price and the tick agree", (_id, pool) => {
    const byAddress = (address: string) => {
      const token = pool.tokens.find((entry) => entry.address === address);
      if (!token) throw new Error(`missing ${address}`);
      return token;
    };
    const d0 = byAddress(pool.poolKey.currency0).decimals;
    const d1 = byAddress(pool.poolKey.currency1).decimals;
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

  it("quotes ETH at about 3,050 USD on the Arbitrum 0.05% pool, with spacing 10", () => {
    const pool = findPanelPoolFixture(42161, "arb-v4-weth-usdc-5");
    expect(pool).not.toBeNull();
    expect(Number(pool?.currentPrice.token1PerToken0)).toBeGreaterThan(3000);
    expect(Number(pool?.currentPrice.token1PerToken0)).toBeLessThan(3100);
    expect(pool?.poolKey.tickSpacing).toBe(10);
    expect(pool?.pairSymbols).toEqual(["WETH", "USDC"]);
  });

  it("writes the Robinhood pair USDG first while the pool key puts WETH first", () => {
    const pool = findPanelPoolFixture(4663, "rbh-v4-weth-usdg-5");
    expect(pool?.pairSymbols).toEqual(["USDG", "WETH"]);
    expect(pool?.tokens.map((token) => token.symbol)).toEqual(["USDG", "WETH"]);
    const symbolOf = (address: string | undefined) =>
      pool?.tokens.find((token) => token.address === address)?.symbol;
    expect(symbolOf(pool?.poolKey.currency0)).toBe("WETH");
    expect(symbolOf(pool?.poolKey.currency1)).toBe("USDG");
  });

  it("serves TVL and APR as null with a reason, never a number", () => {
    for (const { pool } of PANEL_POOL_FIXTURES) {
      expect(pool.tvlUsd).toBeNull();
      expect(pool.feesApr).toBeNull();
      expect(pool.tvlUnavailableReason).toBeTruthy();
      expect(pool.feesAprUnavailableReason).toBeTruthy();
    }
  });

  it("keeps the liquidity of every pool active and the scale plausible", () => {
    for (const { pool } of PANEL_POOL_FIXTURES) {
      expect(BigInt(pool.liquidity) > 0n).toBe(true);
      expect(pool.eligible).toBe(true);
    }
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
  });

  it("answers null on the wrong network and for an id it does not know", () => {
    expect(findPanelPoolFixture(4663, poolId)).toBeNull();
    expect(findPanelPoolFixture(42161, "rbh-v4-weth-usdg-5")).toBeNull();
    expect(findPanelPoolFixture(42161, "arb-v4-usdc-usdt-1")).toBeNull();
    expect(findPanelPoolFixture(42161, `0x${"ab".repeat(32)}`)).toBeNull();
  });

  it("hands out a copy: writing through it never changes the fixture", () => {
    const first = findPanelPoolFixture(42161, poolId);
    if (!first) throw new Error("fixture missing");
    first.currentTick = 0;
    first.poolKey.fee = 1;
    const second = findPanelPoolFixture(42161, poolId);
    expect(second?.currentTick).toBe(-196090);
    expect(second?.poolKey.fee).toBe(500);
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

describe("[MCK-005] reserve fixtures", () => {
  it.each(
    PANEL_RESERVE_FIXTURES.map((reserve) => [reserve.token.symbol, reserve] as const),
  )("%s parses as a catalog reserve", (_symbol, reserve) => {
    expect(catalogReserveSchema.safeParse(reserve).success).toBe(true);
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
