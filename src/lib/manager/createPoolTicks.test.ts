/**
 * @id PP-MGR (POO-306, POO-860, POO-900)
 * @name createPoolTicks tests
 * @implements-rules-version v3 (POO-900 rules v1)
 */
import { describe, expect, it } from "vitest";
import { createPoolTicks } from "./createPoolTicks";
import { fullRangeTicks } from "./fullRangeTicks";
import { tickToPrice } from "./tickPrice";

describe("createPoolTicks", () => {
  it("returns the full-range bounds when `full`, spacing-aligned", () => {
    const ticks = createPoolTicks({ full: true, minPrice: null, maxPrice: null }, 6, 6, 5);
    expect(ticks).toEqual(fullRangeTicks(5));
    expect(ticks && Math.abs(ticks.tickLower % 10)).toBe(0);
    expect(ticks && Math.abs(ticks.tickUpper % 10)).toBe(0);
  });

  it("snaps a min/max range to the fee tier's tick spacing (lower < upper, both aligned)", () => {
    // USDC/USDT, both 6 decimals, price ~1; feeBps 5 → spacing 10.
    const ticks = createPoolTicks({ full: false, minPrice: 0.99, maxPrice: 1.01 }, 6, 6, 5);
    expect(ticks).not.toBeNull();
    if (!ticks) return;
    expect(Math.abs(ticks.tickLower % 10)).toBe(0);
    expect(Math.abs(ticks.tickUpper % 10)).toBe(0);
    expect(ticks.tickLower).toBeLessThan(ticks.tickUpper);
    // price 1 is tick 0, so the symmetric range straddles 0.
    expect(ticks.tickLower).toBeLessThanOrEqual(0);
    expect(ticks.tickUpper).toBeGreaterThanOrEqual(0);
  });

  it("aligns to the wider spacing of a higher fee tier", () => {
    const ticks = createPoolTicks({ full: false, minPrice: 0.5, maxPrice: 2 }, 6, 6, 30);
    expect(ticks).not.toBeNull();
    if (!ticks) return;
    expect(Math.abs(ticks.tickLower % 60)).toBe(0); // feeBps 30 → spacing 60
    expect(Math.abs(ticks.tickUpper % 60)).toBe(0);
  });

  it("returns null when a non-full range is incomplete", () => {
    expect(createPoolTicks({ full: false, minPrice: null, maxPrice: 1.01 }, 6, 6, 5)).toBeNull();
    expect(createPoolTicks({ full: false, minPrice: 0.99, maxPrice: null }, 6, 6, 5)).toBeNull();
  });

  it("returns null for non-positive or inverted bounds", () => {
    expect(createPoolTicks({ full: false, minPrice: 0, maxPrice: 1 }, 6, 6, 5)).toBeNull();
    expect(createPoolTicks({ full: false, minPrice: -1, maxPrice: 1 }, 6, 6, 5)).toBeNull();
    expect(createPoolTicks({ full: false, minPrice: 2, maxPrice: 1 }, 6, 6, 5)).toBeNull();
  });

  it("returns null when a too-tight range collapses to a single tick after snapping", () => {
    // feeBps 100 → spacing 200; 1.0 and 1.0001 both snap to tick 0.
    expect(createPoolTicks({ full: false, minPrice: 1.0, maxPrice: 1.0001 }, 6, 6, 100)).toBeNull();
  });

  it("returns null when the snapped range is only one tick spacing wide (POO-860 R3: needs ≥ 2)", () => {
    // feeBps 5 → spacing 10. Prices exactly at tick 0 and tick 10 → one spacing apart.
    const minPrice = tickToPrice(0, 6, 6);
    const maxPrice = tickToPrice(10, 6, 6);
    expect(createPoolTicks({ full: false, minPrice, maxPrice }, 6, 6, 5)).toBeNull();
  });

  it("returns the bounds when the snapped range is at least two tick spacings wide (POO-860 R3)", () => {
    // feeBps 5 → spacing 10. Prices at tick 0 and tick 20 → two spacings apart.
    const minPrice = tickToPrice(0, 6, 6);
    const maxPrice = tickToPrice(20, 6, 6);
    expect(createPoolTicks({ full: false, minPrice, maxPrice }, 6, 6, 5)).toEqual({
      tickLower: 0,
      tickUpper: 20,
    });
  });

  // @rule POO-900 R3 - the mint resolution recovers bound ticks by ROUNDING (the same resolver the
  // UI gate measures with), so a range the Build/Move-Range UI presents as the valid exactly-2-spacing
  // minimum resolves to exactly those ticks. Flooring here read the display-rounded max one tick low
  // on spacing-1 pools (raw tick of 1.0002 is ~1.9999), returning null for a UI-valid range.
  it("[POO-900 R3] resolves the display-rounded exactly-2-spacing range on a spacing-1 pool", () => {
    // USDC/USDT 0.01% (feeBps 1 → spacing 1): the UI gate accepts min=1 / max=1.0002 as exactly two
    // spacings (ticks 0 and 2); the mint must recover the SAME ticks, not floor 1.0002 down to tick 1.
    expect(createPoolTicks({ full: false, minPrice: 1, maxPrice: 1.0002 }, 6, 6, 1)).toEqual({
      tickLower: 0,
      tickUpper: 2,
    });
  });
});
