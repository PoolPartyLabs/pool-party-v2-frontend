/**
 * @id PP-MGR (POO-306)
 * @name Full-range ticks tests
 * @implements-rules-version v1
 *
 * Tick spacing per fee tier; full-range bounds aligned + within [MIN_TICK, MAX_TICK]. POO-518 R1:
 * `fullRangePrices` derives the human price bounds from those ticks, respecting token decimals.
 */
import { describe, expect, it } from "vitest";
import { fullRangePrices, fullRangeTicks, tickSpacing } from "./fullRangeTicks";
import { tickToPrice } from "./tickPrice";

describe("tickSpacing", () => {
  it("maps the standard fee tiers", () => {
    expect(tickSpacing(1)).toBe(1);
    expect(tickSpacing(5)).toBe(10);
    expect(tickSpacing(30)).toBe(60);
    expect(tickSpacing(100)).toBe(200);
  });
});

describe("fullRangeTicks", () => {
  it("returns spacing-aligned bounds inside the tick range (0.30% pool)", () => {
    const { tickLower, tickUpper } = fullRangeTicks(30);
    expect(tickLower).toBe(-887220);
    expect(tickUpper).toBe(887220);
    expect(tickLower % 60 === 0).toBe(true);
    expect(tickUpper % 60 === 0).toBe(true);
    expect(tickLower).toBeGreaterThanOrEqual(-887272);
    expect(tickUpper).toBeLessThanOrEqual(887272);
  });

  it("aligns to the 0.05% spacing", () => {
    const { tickLower, tickUpper } = fullRangeTicks(5);
    expect(tickLower % 10 === 0).toBe(true);
    expect(tickUpper % 10 === 0).toBe(true);
    expect(tickLower).toBeGreaterThanOrEqual(-887272);
    expect(tickUpper).toBeLessThanOrEqual(887272);
  });
});

// POO-518 R1: the price bounds a full-range move reports are DERIVED from the full-range ticks via
// the shared tickToPrice math (never echoed from the previous band), respecting token decimals.
describe("fullRangePrices", () => {
  it("derives the bounds from the full-range ticks (ETH 18d / USDC 6d, 0.30% pool)", () => {
    const { tickLower, tickUpper } = fullRangeTicks(30);
    const prices = fullRangePrices(30, 18, 6);
    expect(prices.minPrice).toBe(tickToPrice(tickLower, 18, 6));
    expect(prices.maxPrice).toBe(tickToPrice(tickUpper, 18, 6));
    expect(prices.minPrice).toBeGreaterThan(0);
    expect(prices.minPrice).toBeLessThan(prices.maxPrice);
    expect(Number.isFinite(prices.maxPrice)).toBe(true);
  });

  it("respects decimals0/1 in both orientations (6/18 and 18/6)", () => {
    const { tickLower, tickUpper } = fullRangeTicks(5);
    // USDC(6d)/DAI(18d)-style pool.
    expect(fullRangePrices(5, 6, 18)).toEqual({
      minPrice: tickToPrice(tickLower, 6, 18),
      maxPrice: tickToPrice(tickUpper, 6, 18),
    });
    // ETH(18d)/USDC(6d)-style pool.
    expect(fullRangePrices(5, 18, 6)).toEqual({
      minPrice: tickToPrice(tickLower, 18, 6),
      maxPrice: tickToPrice(tickUpper, 18, 6),
    });
    // The decimals gap shifts the human bounds by 10^(decimals0 - decimals1) vs a same-decimals
    // pair (raw 1.0001^tick): 18/6 reads 10^12 higher, 6/18 reads 10^12 lower.
    const same = fullRangePrices(5, 18, 18);
    expect(fullRangePrices(5, 18, 6).maxPrice / same.maxPrice).toBeCloseTo(1e12, -6);
    expect(fullRangePrices(5, 6, 18).maxPrice / same.maxPrice).toBeCloseTo(1e-12, 14);
    // Ordering survives the extreme magnitudes on both sides.
    expect(fullRangePrices(5, 6, 18).minPrice).toBeLessThan(fullRangePrices(5, 6, 18).maxPrice);
  });
});
