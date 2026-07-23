/**
 * @id PP-STR-LIB-014
 * @name deriveStrategyTags tests
 * @implements-rules-version v1
 *
 * [R3] Objective from mint composition (two-sided → income; single-sided → R4). [R4] Direction of a
 * single-sided position (source = deposited/nonzero leg, target = the other). The determinism table
 * below has ONE test per row, built from concrete pools whose classes resolve through the R1 registry.
 */
import { describe, expect, it } from "vitest";
import { deriveStrategyTags } from "./deriveStrategyTags";
import { tokenClassBySymbol } from "./tokenClassRegistry";

/** Resolve a concrete pool's two symbols to their token classes (via the R1 registry). */
function pair(symbol0: string, symbol1: string) {
  return { c0: tokenClassBySymbol(symbol0), c1: tokenClassBySymbol(symbol1) };
}

describe("deriveStrategyTags — two-sided (R3 → income + R2 assets)", () => {
  // @rule R3 — two-sided USDC/USDT (both stable) → income, ['stablecoins'].
  it("two-sided both-stable USDC/USDT → income, stablecoins", () => {
    expect(
      deriveStrategyTags({ pair: pair("USDC", "USDT"), mint: { amount0: 1000, amount1: 1000 } }),
    ).toEqual({
      objectiveTags: ["income"],
      assetTags: ["stablecoins"],
      unverified: false,
    });
  });

  // @rule R3 — two-sided USDC/WETH → income, target/other crypto tag (['ethereum']).
  it("two-sided USDC/WETH → income, ethereum", () => {
    expect(
      deriveStrategyTags({ pair: pair("USDC", "WETH"), mint: { amount0: 500, amount1: 0.2 } }),
    ).toEqual({
      objectiveTags: ["income"],
      assetTags: ["ethereum"],
      unverified: false,
    });
  });

  // @rule R3 — two-sided WETH/WBTC (both non-stable) → income, both classes deduped.
  it("two-sided WETH/WBTC → income, [ethereum, bitcoin]", () => {
    expect(
      deriveStrategyTags({ pair: pair("WETH", "WBTC"), mint: { amount0: 1, amount1: 0.05 } }),
    ).toEqual({
      objectiveTags: ["income"],
      assetTags: ["ethereum", "bitcoin"],
      unverified: false,
    });
  });

  // @rule R3 — two-sided PEPE/WETH (meme + eth) → income, both classes.
  it("two-sided PEPE/WETH → income, [meme, ethereum]", () => {
    expect(
      deriveStrategyTags({
        pair: pair("PEPE", "WETH"),
        mint: { amount0: 1_000_000, amount1: 0.3 },
      }),
    ).toEqual({
      objectiveTags: ["income"],
      assetTags: ["meme", "ethereum"],
      unverified: false,
    });
  });
});

describe("deriveStrategyTags — single-sided (R3 → R4 direction)", () => {
  // @rule R4 — single dollar→crypto (deposit USDC, range toward WETH) → gradualBuy, target crypto.
  it("single dollar→crypto USDC→WETH → gradualBuy, [ethereum]", () => {
    expect(
      deriveStrategyTags({ pair: pair("USDC", "WETH"), mint: { amount0: 1000, amount1: 0 } }),
    ).toEqual({
      objectiveTags: ["gradualBuy"],
      assetTags: ["ethereum"],
      unverified: false,
    });
  });

  // @rule R4 — single crypto→dollar (deposit WETH, range toward USDC) → gradualSell, source crypto.
  it("single crypto→dollar WETH→USDC → gradualSell, [ethereum]", () => {
    expect(
      deriveStrategyTags({ pair: pair("WETH", "USDC"), mint: { amount0: 1, amount1: 0 } }),
    ).toEqual({
      objectiveTags: ["gradualSell"],
      assetTags: ["ethereum"],
      unverified: false,
    });
  });

  // @rule R4 — single crypto→crypto rotation (deposit WETH, range toward WBTC) → buy+sell, both.
  it("single crypto→crypto WETH→WBTC → [gradualBuy, gradualSell], [ethereum, bitcoin]", () => {
    expect(
      deriveStrategyTags({ pair: pair("WETH", "WBTC"), mint: { amount0: 1, amount1: 0 } }),
    ).toEqual({
      objectiveTags: ["gradualBuy", "gradualSell"],
      assetTags: ["ethereum", "bitcoin"],
      unverified: false,
    });
  });

  // @rule R4 — single dollar→dollar (deposit USDC, range toward USDT) → income, stablecoins.
  it("single dollar→dollar USDC→USDT → income, [stablecoins]", () => {
    expect(
      deriveStrategyTags({ pair: pair("USDC", "USDT"), mint: { amount0: 1000, amount1: 0 } }),
    ).toEqual({
      objectiveTags: ["income"],
      assetTags: ["stablecoins"],
      unverified: false,
    });
  });
});

describe("deriveStrategyTags — unverified token (R2/R4 flag)", () => {
  // @rule R3 — a pool with an unverified token classifies by SHAPE and raises the flag; the unknown
  // token folds to altcoins.
  it("two-sided WETH/<unknown> → income, [ethereum, altcoins] + unverified flag", () => {
    expect(
      deriveStrategyTags({ pair: pair("WETH", "MYSTERYCOIN"), mint: { amount0: 1, amount1: 5 } }),
    ).toEqual({
      objectiveTags: ["income"],
      assetTags: ["ethereum", "altcoins"],
      unverified: true,
    });
  });
});

describe("deriveStrategyTags — edge cases", () => {
  // @rule R4 — single crypto→crypto of the SAME tag dedupes the assets.
  it("single crypto→crypto of the same tag dedupes (WETH→cbETH)", () => {
    expect(
      deriveStrategyTags({ pair: pair("WETH", "cbETH"), mint: { amount0: 1, amount1: 0 } }),
    ).toEqual({
      objectiveTags: ["gradualBuy", "gradualSell"],
      assetTags: ["ethereum"],
      unverified: false,
    });
  });

  // @rule R3 — the source is whichever leg is nonzero, regardless of index (deposit on token1 side).
  it("single-sided on the token1 leg picks token1 as the source", () => {
    // amount0=0 (WETH side empty), amount1>0 (USDC deposited) → S=USDC (cash), T=WETH → gradualBuy.
    expect(
      deriveStrategyTags({ pair: pair("WETH", "USDC"), mint: { amount0: 0, amount1: 1000 } }),
    ).toEqual({
      objectiveTags: ["gradualBuy"],
      assetTags: ["ethereum"],
      unverified: false,
    });
  });

  // @rule R3 — a degenerate both-zero mint is NOT single-sided; it falls to the two-sided/income path.
  it("both-zero mint routes to the two-sided income path", () => {
    expect(
      deriveStrategyTags({ pair: pair("USDC", "WETH"), mint: { amount0: 0, amount1: 0 } }),
    ).toEqual({
      objectiveTags: ["income"],
      assetTags: ["ethereum"],
      unverified: false,
    });
  });
});
