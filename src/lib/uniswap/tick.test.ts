/**
 * @id PP-CORE-LIB-020 (POO-282)
 * @name uniswapTick tests
 * @implements-rules-version v2 (POO-877 rules v1)
 *
 * tick→price scales by decimals and is monotonic; price→tick is the inverse; usable ticks align to
 * spacing and clamp to [MIN_TICK, MAX_TICK]. POO-877: the stepper resolves the nearest usable tick by
 * rounding, so it never locks on a display-rounded bound (tickSpacing-1 regression).
 */
import { describe, expect, it } from "vitest";
import {
  MAX_TICK,
  MIN_TICK,
  nearestUsableTick,
  priceToClosestUsableTick,
  priceToNearestUsableTick,
  priceToTick,
  snapPriceToUsableTick,
  stepPriceByTick,
  tickSpacing,
  tickToPrice,
} from "./tick";

describe("tickSpacing", () => {
  it("maps each fee tier (bps) to its Uniswap v3 tick spacing", () => {
    expect(tickSpacing(1)).toBe(1);
    expect(tickSpacing(5)).toBe(10);
    expect(tickSpacing(30)).toBe(60);
    expect(tickSpacing(100)).toBe(200);
  });

  it("falls back to the 0.30% spacing (60) for an unknown fee tier", () => {
    expect(tickSpacing(0)).toBe(60);
    expect(tickSpacing(999)).toBe(60);
  });
});

describe("tickToPrice", () => {
  it("is 1 at tick 0 when both tokens share decimals", () => {
    expect(tickToPrice(0, 6, 6)).toBeCloseTo(1, 12);
    expect(tickToPrice(0, 18, 18)).toBeCloseTo(1, 12);
  });

  it("scales by the decimals difference at tick 0", () => {
    // token0 has 12 more decimals than token1 → 1 token0 ≈ 1e12 token1 in human units.
    expect(tickToPrice(0, 18, 6)).toBeCloseTo(1e12, 0);
    expect(tickToPrice(0, 6, 18)).toBeCloseTo(1e-12, 24);
  });

  it("is strictly increasing in tick", () => {
    expect(tickToPrice(60, 6, 6)).toBeGreaterThan(tickToPrice(0, 6, 6));
    expect(tickToPrice(0, 6, 6)).toBeGreaterThan(tickToPrice(-60, 6, 6));
  });
});

describe("priceToTick", () => {
  it("inverts tickToPrice (round-trips to the same tick)", () => {
    for (const tick of [-200_000, -60_000, -60, 0, 60, 60_000, 200_000]) {
      const price = tickToPrice(tick, 18, 6);
      expect(priceToTick(price, 18, 6)).toBeCloseTo(tick, 3);
    }
  });

  it("returns NaN for a non-positive price", () => {
    expect(priceToTick(0, 6, 6)).toBeNaN();
    expect(priceToTick(-1, 6, 6)).toBeNaN();
  });
});

describe("nearestUsableTick", () => {
  it("rounds to the nearest multiple of spacing", () => {
    expect(nearestUsableTick(31, 60)).toBe(60);
    expect(nearestUsableTick(29, 60)).toBe(0);
    expect(nearestUsableTick(-31, 60)).toBe(-60);
  });

  it("stays within [MIN_TICK, MAX_TICK]", () => {
    expect(nearestUsableTick(MIN_TICK - 100, 60)).toBeGreaterThanOrEqual(MIN_TICK);
    expect(nearestUsableTick(MAX_TICK + 100, 60)).toBeLessThanOrEqual(MAX_TICK);
  });
});

describe("priceToClosestUsableTick", () => {
  it("snaps a price to a spacing-aligned tick that re-prices near the input", () => {
    const feeBps = 30; // spacing 60
    const tick = priceToClosestUsableTick(3000, 18, 6, feeBps);
    expect(tick % tickSpacing(feeBps) === 0).toBe(true);
    // The snapped tick prices back close to the requested price (within one spacing step).
    expect(tickToPrice(tick, 18, 6)).toBeCloseTo(3000, -3);
  });

  it("[POO-319] floors the integer tick (matches the SDK) — never above the price's tick", () => {
    // feeBps 1 → spacing 1, so the result IS the floored integer tick. For an off-grid price the
    // floored tick must price at or below the input (round could overshoot to the tick above).
    const feeBps = 1;
    for (const price of [1234.567, 0.0009987, 3210.5]) {
      const tick = priceToClosestUsableTick(price, 18, 6, feeBps);
      expect(tickToPrice(tick, 18, 6)).toBeLessThanOrEqual(price);
      expect(tickToPrice(tick + 1, 18, 6)).toBeGreaterThan(price);
    }
  });
});

describe("snapPriceToUsableTick", () => {
  it("returns the exact price of the nearest usable tick (a grid fixed point)", () => {
    const feeBps = 30; // spacing 60
    const snapped = snapPriceToUsableTick(3000, 18, 6, feeBps);
    const tick = priceToClosestUsableTick(3000, 18, 6, feeBps);
    expect(snapped).toBeCloseTo(tickToPrice(tick, 18, 6), 6);
    // Snapping an already-snapped price is a fixed point (it is on the grid).
    expect(snapPriceToUsableTick(snapped, 18, 6, feeBps)).toBeCloseTo(snapped, 6);
  });

  it("clamps a wildly out-of-bounds price to the MAX usable tick's (finite) price", () => {
    const feeBps = 30;
    const snapped = snapPriceToUsableTick(1e60, 18, 6, feeBps);
    expect(Number.isFinite(snapped)).toBe(true);
    const maxUsable = nearestUsableTick(MAX_TICK, tickSpacing(feeBps));
    expect(snapped).toBeCloseTo(tickToPrice(maxUsable, 18, 6), 0);
  });

  it("returns a non-positive price unchanged (caller decides on empty/invalid input)", () => {
    expect(snapPriceToUsableTick(0, 18, 6, 30)).toBe(0);
    expect(snapPriceToUsableTick(-5, 18, 6, 30)).toBe(-5);
  });
});

describe("stepPriceByTick", () => {
  it("steps to the adjacent usable tick's price", () => {
    const feeBps = 30; // spacing 60
    const base = tickToPrice(60, 18, 6); // a usable tick
    expect(stepPriceByTick(base, 18, 6, feeBps, 1)).toBeCloseTo(tickToPrice(120, 18, 6), 6);
    expect(stepPriceByTick(base, 18, 6, feeBps, -1)).toBeCloseTo(tickToPrice(0, 18, 6), 6);
  });

  it("snaps an off-grid price onto the grid before stepping", () => {
    const feeBps = 30; // spacing 60
    const offGrid = tickToPrice(95, 18, 6); // nearest usable tick is 120
    expect(stepPriceByTick(offGrid, 18, 6, feeBps, 1)).toBeCloseTo(tickToPrice(180, 18, 6), 6);
  });

  it("returns a non-positive price unchanged", () => {
    expect(stepPriceByTick(0, 18, 6, 30, 1)).toBe(0);
  });

  // @rule POO-877 R1/R3 — the stepper resolves the CURRENT usable tick by ROUNDING to the nearest
  // spacing (not the POO-319 floor used for typed prices), so a display-rounded bound recovers the
  // exact tick it represents. Regression from the tickSpacing-1 lock: the range editor renders a
  // usable-tick price rounded DOWN for display; the old floor-then-step reproduced the same tick on
  // `+1` (a fixed point) and skipped a tick on `-1`.
  it("[POO-877 R1/R3] does not lock on a spacing-1 pool: +1 rises one tick, -1 falls one tick", () => {
    const feeBps = 1; // USDC/USDT 0.01% → spacing 1
    const d0 = 6;
    const d1 = 6;
    const tick = 5;
    // The exact usable-tick price, rounded to 4dp the way the editor shows it (rounds BELOW the tick's
    // true price), then re-parsed — the round-trip that used to freeze the stepper.
    const display = Number(tickToPrice(tick, d0, d1).toFixed(4)); // 1.0005, < tickToPrice(5)
    const up = stepPriceByTick(display, d0, d1, feeBps, 1);
    const down = stepPriceByTick(display, d0, d1, feeBps, -1);
    // Exactly one usable-tick spacing in each direction (no fixed point, no skipped tick).
    expect(up).toBeCloseTo(tickToPrice(tick + 1, d0, d1), 9);
    expect(down).toBeCloseTo(tickToPrice(tick - 1, d0, d1), 9);
    // And crucially, re-rendered for display the value actually CHANGES (the visible-lock regression).
    expect(Number(up.toFixed(4))).toBeGreaterThan(display);
    expect(Number(down.toFixed(4))).toBeLessThan(display);
  });

  it("[POO-877 R3] repeated + / - steps keep moving through the display round-trip (spacing-1)", () => {
    const feeBps = 1;
    const d0 = 6;
    const d1 = 6;
    // Walk up five ticks, re-rendering to 4dp between each step exactly as the UI does.
    let display = Number(tickToPrice(0, d0, d1).toFixed(4)); // "1"
    for (let i = 0; i < 5; i++) {
      const next = Number(stepPriceByTick(display, d0, d1, feeBps, 1).toFixed(4));
      expect(next).toBeGreaterThan(display); // never a fixed point
      display = next;
    }
    // …and back down five ticks, strictly decreasing every step.
    for (let i = 0; i < 5; i++) {
      const next = Number(stepPriceByTick(display, d0, d1, feeBps, -1).toFixed(4));
      expect(next).toBeLessThan(display);
      display = next;
    }
  });

  // @rule POO-877 R2 — the TYPED-price snap (priceToClosestUsableTick) still FLOORS. Only the stepper
  // path changed; typing a price keeps POO-319 SDK parity (the tick prices at or below the input).
  it("[POO-877 R2] leaves the typed-price floor snap (priceToClosestUsableTick) untouched", () => {
    const feeBps = 1; // spacing 1 → the floor is visible at the integer tick
    for (const price of [1234.567, 0.0009987]) {
      const tick = priceToClosestUsableTick(price, 18, 6, feeBps);
      expect(tickToPrice(tick, 18, 6)).toBeLessThanOrEqual(price);
      expect(tickToPrice(tick + 1, 18, 6)).toBeGreaterThan(price);
    }
  });
});

describe("priceToNearestUsableTick (POO-877)", () => {
  it("rounds to the nearest usable tick (recovers a display-rounded bound's tick, unlike the floor)", () => {
    const feeBps = 1; // spacing 1
    const display = Number(tickToPrice(5, 6, 6).toFixed(4)); // rounds below tickToPrice(5)
    // The floor snap drops to tick 4; the nearest snap recovers tick 5.
    expect(priceToClosestUsableTick(display, 6, 6, feeBps)).toBe(4);
    expect(priceToNearestUsableTick(display, 6, 6, feeBps)).toBe(5);
  });

  it("aligns to spacing on wider tiers", () => {
    const feeBps = 30; // spacing 60
    expect(priceToNearestUsableTick(tickToPrice(95, 18, 6), 18, 6, feeBps)).toBe(120);
  });
});
