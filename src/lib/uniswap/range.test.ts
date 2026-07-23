/**
 * @id PP-CORE-LIB-020 (POO-282)
 * @name uniswapRange tests
 * @implements-rules-version v1
 *
 * Position tick bounds → human price range (token1 per token0) and tick-space membership. The
 * acceptance cross-check: a known tick range → price range → in/out of range.
 */
import { describe, expect, it } from "vitest";
import { inRange, priceRangeFromTicks } from "./range";
import { tickToPrice } from "./tick";

describe("priceRangeFromTicks", () => {
  // @rule R-RANGE tickLower→minPrice, tickUpper→maxPrice, tickCurrent→currentPrice (price ↑ with tick)
  it("maps each tick to its price (token1 per token0), ascending with tick", () => {
    const r = priceRangeFromTicks(-201000, -191000, -196260, 18, 6);
    expect(r.minPrice).toBeCloseTo(tickToPrice(-201000, 18, 6), 6);
    expect(r.maxPrice).toBeCloseTo(tickToPrice(-191000, 18, 6), 6);
    expect(r.currentPrice).toBeCloseTo(tickToPrice(-196260, 18, 6), 6);
    expect(r.minPrice).toBeLessThan(r.currentPrice);
    expect(r.currentPrice).toBeLessThan(r.maxPrice);
  });

  // @rule R-RANGE cross-check: an in-range WETH/USDC position prices the range around ~3000
  it("prices a known WETH/USDC position around the expected magnitude", () => {
    const r = priceRangeFromTicks(-201000, -191000, -196260, 18, 6);
    expect(r.currentPrice).toBeGreaterThan(2000);
    expect(r.currentPrice).toBeLessThan(4000);
    expect(r.minPrice).toBeGreaterThan(1500);
    expect(r.maxPrice).toBeLessThan(5500);
  });
});

describe("inRange", () => {
  // @rule R-INRANGE tick within [lower, upper] is in range; bounds inclusive (v3 in-range semantics)
  it("is true strictly inside and on either boundary", () => {
    expect(inRange(-196260, -201000, -191000)).toBe(true);
    expect(inRange(-201000, -201000, -191000)).toBe(true); // lower boundary
    expect(inRange(-191000, -201000, -191000)).toBe(true); // upper boundary
  });

  // @rule R-INRANGE a tick below the lower bound or above the upper bound is out of range
  it("is false below the lower bound and above the upper bound", () => {
    expect(inRange(-202000, -201000, -191000)).toBe(false); // below
    expect(inRange(-190000, -201000, -191000)).toBe(false); // above
  });

  // @rule R-INRANGE cross-check: range → in/out agrees with the price-range ordering
  it("agrees with the derived price range (current price inside ⇒ in range)", () => {
    const lower = -201000;
    const upper = -191000;
    const current = -196260;
    const r = priceRangeFromTicks(lower, upper, current, 18, 6);
    const priceInside = r.currentPrice > r.minPrice && r.currentPrice < r.maxPrice;
    expect(inRange(current, lower, upper)).toBe(priceInside);
  });
});
