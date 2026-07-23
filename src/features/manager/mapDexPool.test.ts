/**
 * @id PP-MGR (POO-305)
 * @name mapDexPool tests
 * @implements-rules-version v1
 *
 * Fee tier → bps, current price, APR estimate, addresses.
 */
import { describe, expect, it } from "vitest";
import type { DexPool } from "@/lib/manager/dexPoolsSchema";
import { uniswapPoolSchema } from "@/lib/schemas";
import { mapDexPool } from "./mapDexPool";

const pool: DexPool = {
  address: "0xdexpool",
  feeTier: 500,
  tvlInUsd: "1000000",
  baseTokenPriceQuoteToken: "1737.58",
  volumeUsd: { h24: "60000000" },
  currency0: { address: "0xeth", symbol: "ETH" },
  currency1: { address: "0xusdc", symbol: "USDC" },
};

describe("mapDexPool", () => {
  it("maps fee tier, pair, price and addresses", () => {
    const m = mapDexPool(pool, "arbitrum");
    expect(m).toMatchObject({
      id: "0xdexpool",
      network: "arbitrum",
      networkName: "Arbitrum",
      token0: "ETH",
      token1: "USDC",
      feeBps: 5, // 500 / 100
      tvlUsd: 1_000_000,
      currentPrice: 1737.58,
      token0Address: "0xeth",
      token1Address: "0xusdc",
    });
    expect(m.aprPct).toBeGreaterThan(0);
  });

  it("maps the standard fee tiers to bps", () => {
    expect(mapDexPool({ ...pool, feeTier: 3000 }, "base").feeBps).toBe(30);
    expect(mapDexPool({ ...pool, feeTier: 10000 }, "base").feeBps).toBe(100);
    expect(mapDexPool({ ...pool, feeTier: 100 }, "base").feeBps).toBe(1);
  });

  it("maps base/quote USD prices onto token0/token1 by isBaseToken", () => {
    const priced: DexPool = {
      ...pool,
      baseTokenPriceUsd: "1737.58",
      quoteTokenPriceUsd: "1.0001",
      currency0: { ...pool.currency0, isBaseToken: true }, // token0 = base (ETH)
      currency1: { ...pool.currency1, isBaseToken: false }, // token1 = quote (USDC)
    };
    const m = mapDexPool(priced, "arbitrum");
    expect(m.token0PriceUsd).toBeCloseTo(1737.58, 2);
    expect(m.token1PriceUsd).toBeCloseTo(1.0001, 4);

    // Reversed roles: token0 is the quote, token1 the base.
    const reversed = mapDexPool(
      {
        ...priced,
        currency0: { ...pool.currency0, isBaseToken: false },
        currency1: { ...pool.currency1, isBaseToken: true },
      },
      "arbitrum",
    );
    expect(reversed.token0PriceUsd).toBeCloseTo(1.0001, 4);
    expect(reversed.token1PriceUsd).toBeCloseTo(1737.58, 2);
  });

  it("leaves USD prices undefined when the API omits them", () => {
    const m = mapDexPool(pool, "arbitrum");
    expect(m.token0PriceUsd).toBeUndefined();
    expect(m.token1PriceUsd).toBeUndefined();
  });

  it("produces a schema-valid UniswapPool", () => {
    expect(uniswapPoolSchema.safeParse(mapDexPool(pool, "arbitrum")).success).toBe(true);
  });

  // POO-589 R1: the pool-pair label shows the wrapped-ether as "ETH" (address-keyed), so a WETH pool
  // on Base/Polygon reads "ETH/USDC" — parity with the token picker. The on-chain address is untouched.
  it("labels the wrapped-ether pair token as ETH (POO-589)", () => {
    const wethPool: DexPool = {
      ...pool,
      currency0: { address: "0x4200000000000000000000000000000000000006", symbol: "WETH" },
      currency1: { address: "0xusdc", symbol: "USDC" },
    };
    const m = mapDexPool(wethPool, "base");
    expect(m.token0).toBe("ETH");
    expect(m.token1).toBe("USDC");
    expect(m.token0Address).toBe("0x4200000000000000000000000000000000000006");
  });
});
