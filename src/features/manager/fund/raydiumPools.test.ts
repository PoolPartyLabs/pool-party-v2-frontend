/**
 * @id PP-MGR-CMP-107
 * @name raydiumPools tests
 * @implements-rules-version v1 (POO-2343)
 * @analytics-events none, pure logic
 *
 * Rules R2, R3 and the shape check of R5. No network.
 */
import { describe, expect, it } from "vitest";
import {
  type DexScreenerPair,
  mapRaydiumPair,
  parseDexScreenerPairs,
  raydiumPoolsFromPairs,
  selectRaydiumClmmPairs,
} from "./raydiumPools";
import { poolFeeLabel, poolMeta } from "./steps/mandateStepView";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

function pair(over: Partial<DexScreenerPair> & { pairAddress: string }): DexScreenerPair {
  return {
    dexId: "raydium",
    labels: ["CLMM"],
    baseToken: { address: SOL, symbol: "SOL", name: "Wrapped SOL" },
    quoteToken: { address: USDC, symbol: "USDC", name: "USD Coin" },
    liquidity: { usd: 1000 },
    ...over,
  };
}

describe("selectRaydiumClmmPairs", () => {
  // @rule R2
  it("keeps only raydium pairs with the CLMM label", () => {
    const result = selectRaydiumClmmPairs([
      pair({ pairAddress: "a" }),
      pair({ pairAddress: "b", dexId: "orca" }),
      pair({ pairAddress: "c", labels: ["CPMM"] }),
      pair({ pairAddress: "d", labels: undefined }),
    ]);
    expect(result.map((p) => p.pairAddress)).toEqual(["a"]);
  });

  // @rule R2
  it("keeps only pairs with both tokens when a second token is given", () => {
    const both = pair({ pairAddress: "both" });
    const other = pair({
      pairAddress: "other",
      quoteToken: { address: BONK, symbol: "BONK" },
    });
    expect(selectRaydiumClmmPairs([both, other], USDC).map((p) => p.pairAddress)).toEqual(["both"]);
    expect(selectRaydiumClmmPairs([both, other]).map((p) => p.pairAddress)).toEqual([
      "both",
      "other",
    ]);
  });

  // @rule R2
  it("removes duplicate pair addresses and keeps the row with the highest liquidity", () => {
    const lowFirst = selectRaydiumClmmPairs([
      pair({ pairAddress: "a", liquidity: { usd: 5 } }),
      pair({ pairAddress: "a", liquidity: { usd: 9 } }),
    ]);
    expect(lowFirst).toHaveLength(1);
    expect(lowFirst[0]?.liquidity?.usd).toBe(9);

    const highFirst = selectRaydiumClmmPairs([
      pair({ pairAddress: "a", liquidity: { usd: 9 } }),
      pair({ pairAddress: "a", liquidity: { usd: 5 } }),
    ]);
    expect(highFirst).toHaveLength(1);
    expect(highFirst[0]?.liquidity?.usd).toBe(9);

    // A row with a liquidity value beats a row with none, whichever comes first.
    const noneFirst = selectRaydiumClmmPairs([
      pair({ pairAddress: "a", liquidity: undefined }),
      pair({ pairAddress: "a", liquidity: { usd: 1 } }),
    ]);
    expect(noneFirst).toHaveLength(1);
    expect(noneFirst[0]?.liquidity?.usd).toBe(1);
  });

  // @rule R2
  it("sorts by liquidity in USD from high to low, with no value last", () => {
    const result = selectRaydiumClmmPairs([
      pair({ pairAddress: "low", liquidity: { usd: 10 } }),
      pair({ pairAddress: "none", liquidity: undefined }),
      pair({ pairAddress: "high", liquidity: { usd: 500 } }),
    ]);
    expect(result.map((p) => p.pairAddress)).toEqual(["high", "low", "none"]);
  });
});

describe("mapRaydiumPair", () => {
  // @rule R3
  it("maps a pair to a solana raydium pool with an empty fee and APR", () => {
    expect(mapRaydiumPair(pair({ pairAddress: "PairAddr1", liquidity: { usd: 1234.5 } }))).toEqual({
      id: "solana:PairAddr1",
      address: "PairAddr1",
      network: "solana",
      protocol: "raydium",
      token0: { address: SOL, symbol: "SOL", name: "Wrapped SOL", logoUrl: null },
      token1: { address: USDC, symbol: "USDC", name: "USD Coin", logoUrl: null },
      feeBps: null,
      feeTier: null,
      tvlUsd: 1234.5,
      aprPct: null,
      volume24hUsd: null,
      tierSharePct: null,
      hasHook: false,
    });
  });

  // @rule R3
  it("keeps tvl null when DEX Screener sends no liquidity, and does not change the case of a mint", () => {
    const mapped = mapRaydiumPair(pair({ pairAddress: "MixedCase", liquidity: undefined }));
    expect(mapped.tvlUsd).toBeNull();
    expect(mapped.address).toBe("MixedCase");
    expect(mapped.token0.address).toBe(SOL);
  });

  // @rule R3
  it("maps the 24 h volume from DEX Screener and keeps it null when missing", () => {
    const withVolume = mapRaydiumPair(pair({ pairAddress: "v", volume: { h24: 987.6 } }));
    expect(withVolume.volume24hUsd).toBe(987.6);
    expect(
      mapRaydiumPair(pair({ pairAddress: "n", volume: { h24: null } })).volume24hUsd,
    ).toBeNull();
    expect(mapRaydiumPair(pair({ pairAddress: "m" })).volume24hUsd).toBeNull();
    const parsed = parseDexScreenerPairs([{ ...pair({ pairAddress: "p" }), volume: { h24: 5 } }]);
    expect(parsed?.[0] && mapRaydiumPair(parsed[0]).volume24hUsd).toBe(5);
  });

  // @rule R3
  it("returns the mapped pools in the sorted order", () => {
    const pools = raydiumPoolsFromPairs([
      pair({ pairAddress: "low", liquidity: { usd: 1 } }),
      pair({ pairAddress: "high", liquidity: { usd: 2 } }),
    ]);
    expect(pools.map((p) => p.address)).toEqual(["high", "low"]);
  });
});

describe("parseDexScreenerPairs", () => {
  // @rule R5
  it("returns the pairs for a valid body", () => {
    expect(parseDexScreenerPairs([pair({ pairAddress: "a" })])).toHaveLength(1);
    expect(parseDexScreenerPairs([])).toEqual([]);
  });

  // @rule R5
  it("returns null for a body that is not an array", () => {
    expect(parseDexScreenerPairs({ pairs: [] })).toBeNull();
    expect(parseDexScreenerPairs(null)).toBeNull();
    expect(parseDexScreenerPairs("pairs")).toBeNull();
  });

  // @rule R5
  it("skips a pair that fails the schema and keeps the good pairs", () => {
    const good = pair({ pairAddress: "good" });
    const parsed = parseDexScreenerPairs([
      { dexId: "raydium" },
      { ...pair({ pairAddress: "badLiquidity" }), liquidity: { usd: "high" } },
      { dexId: "orca", pairAddress: "otherDex" },
      good,
    ]);
    expect(parsed?.map((p) => p.pairAddress)).toEqual(["good"]);
    expect(raydiumPoolsFromPairs(parsed ?? []).map((p) => p.address)).toEqual(["good"]);
  });
});

describe("null fee label", () => {
  // @rule R3
  it("shows no fee label for a null fee, as for a null APR", () => {
    expect(poolFeeLabel(null)).toBeNull();
    expect(poolFeeLabel(30)).toBe("0.30%");
    const raydium = mapRaydiumPair(pair({ pairAddress: "a" }));
    expect(poolMeta(raydium).map((part) => part.part)).toEqual(["protocol", "network"]);
    expect(poolMeta({ ...raydium, feeBps: 5 }).map((part) => part.part)).toEqual([
      "protocol",
      "network",
      "feeTier",
    ]);
  });
});
