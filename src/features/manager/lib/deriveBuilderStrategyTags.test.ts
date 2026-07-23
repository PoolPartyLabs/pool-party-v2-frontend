/**
 * @id PP-MGR-LIB-016
 * @name deriveBuilderStrategyTags tests
 * @implements-rules-version v1
 *
 * The builder adapter (POO-830 R3/R4/R5): maps the Build step's pool pair + current price + range
 * selection into the {@link deriveStrategyTags} input, deriving the mint composition from `tokenSplit`
 * (two-sided → both legs > 0; single-sided → the 100% token gets the only nonzero leg). One assertion
 * per row of the determinism table, built from concrete symbol pairs whose classes resolve via R1.
 * Orientation is NEVER hand-rolled: the split is computed from the canonical bounds by `tokenSplit`.
 */
import { describe, expect, it } from "vitest";
import { deriveBuilderStrategyTags } from "./deriveBuilderStrategyTags";

/** A canonical two-sided range that covers the current price (in range → both legs held). */
const twoSided = { full: false, minPrice: 2500, maxPrice: 3500 };
/** Symbol-only descriptors → the R1 symbol fallback (no chainId/address). */
function sym(symbol: string) {
  return { symbol };
}

describe("deriveBuilderStrategyTags — determinism table", () => {
  // @rule R3 — two-sided (range covers current price) → income; assets from the pair (one-stable).
  it("two-sided ETH/USDC covering current → income, [ethereum]", () => {
    expect(
      deriveBuilderStrategyTags({
        token0: sym("ETH"),
        token1: sym("USDC"),
        currentPrice: 3000,
        range: twoSided,
      }),
    ).toEqual({ objectiveTags: ["income"], assetTags: ["ethereum"], unverified: false });
  });

  // @rule R4 — single-sided dollar → crypto: USDC (token1) is the only leg because the range sits
  // ENTIRELY BELOW current (price above range → all token1 held) → gradualBuy, target crypto.
  it("single-sided dollar→crypto (USDC deposited, range below) → gradualBuy, [ethereum]", () => {
    expect(
      deriveBuilderStrategyTags({
        token0: sym("ETH"),
        token1: sym("USDC"),
        currentPrice: 3000,
        range: { full: false, minPrice: 2000, maxPrice: 2500 },
      }),
    ).toEqual({ objectiveTags: ["gradualBuy"], assetTags: ["ethereum"], unverified: false });
  });

  // @rule R4 — single-sided crypto → dollar: ETH (token0) is the only leg because the range sits
  // ENTIRELY ABOVE current (price below range → all token0 held) → gradualSell, source crypto.
  it("single-sided crypto→dollar (ETH deposited, range above) → gradualSell, [ethereum]", () => {
    expect(
      deriveBuilderStrategyTags({
        token0: sym("ETH"),
        token1: sym("USDC"),
        currentPrice: 3000,
        range: { full: false, minPrice: 3500, maxPrice: 4000 },
      }),
    ).toEqual({ objectiveTags: ["gradualSell"], assetTags: ["ethereum"], unverified: false });
  });

  // @rule R4 — single-sided crypto → crypto rotation (ETH deposited, range above) → both directions,
  // both classes.
  it("single-sided crypto→crypto (ETH→WBTC) → [gradualBuy, gradualSell], [ethereum, bitcoin]", () => {
    expect(
      deriveBuilderStrategyTags({
        token0: sym("WETH"),
        token1: sym("WBTC"),
        currentPrice: 0.05,
        range: { full: false, minPrice: 0.06, maxPrice: 0.07 },
      }),
    ).toEqual({
      objectiveTags: ["gradualBuy", "gradualSell"],
      assetTags: ["ethereum", "bitcoin"],
      unverified: false,
    });
  });

  // @rule R4 — single-sided dollar → dollar (USDC deposited, range above) → income, stablecoins.
  it("single-sided dollar→dollar (USDC→USDT) → income, [stablecoins]", () => {
    expect(
      deriveBuilderStrategyTags({
        token0: sym("USDC"),
        token1: sym("USDT"),
        currentPrice: 1,
        range: { full: false, minPrice: 1.01, maxPrice: 1.02 },
      }),
    ).toEqual({ objectiveTags: ["income"], assetTags: ["stablecoins"], unverified: false });
  });

  // @rule R2 — a token absent from the registry classifies by SHAPE (two-sided → income) and folds to
  // altcoins + raises the unverified flag.
  it("two-sided with an unverified token → income, [ethereum, altcoins] + unverified", () => {
    expect(
      deriveBuilderStrategyTags({
        token0: sym("WETH"),
        token1: sym("MYSTERYCOIN"),
        currentPrice: 3000,
        range: twoSided,
      }),
    ).toEqual({ objectiveTags: ["income"], assetTags: ["ethereum", "altcoins"], unverified: true });
  });
});

describe("deriveBuilderStrategyTags — edge cases", () => {
  // @rule R3 — a FULL range is two-sided (≈50/50) → income (never a single-sided direction).
  it("full range → income (two-sided)", () => {
    expect(
      deriveBuilderStrategyTags({
        token0: sym("ETH"),
        token1: sym("USDC"),
        currentPrice: 3000,
        range: { full: true, minPrice: null, maxPrice: null },
      }),
    ).toEqual({ objectiveTags: ["income"], assetTags: ["ethereum"], unverified: false });
  });

  // @rule R3 — a degenerate/incomplete range (tokenSplit falls back to 50/50) is two-sided → income,
  // never a spurious single-sided direction.
  it("incomplete range (null bounds) falls back to two-sided income", () => {
    expect(
      deriveBuilderStrategyTags({
        token0: sym("ETH"),
        token1: sym("USDC"),
        currentPrice: 3000,
        range: { full: false, minPrice: null, maxPrice: null },
      }),
    ).toEqual({ objectiveTags: ["income"], assetTags: ["ethereum"], unverified: false });
  });
});
