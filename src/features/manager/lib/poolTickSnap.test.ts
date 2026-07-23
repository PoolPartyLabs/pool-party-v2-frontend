/**
 * @id PP-MGR (POO-408)
 * @name poolTickSnap tests
 * @implements-rules-version v3 (POO-877 + POO-881 + POO-900 rules v1)
 *
 * The shared snap picks the exact on-chain tick when decimals are known, the relative grid when only
 * a market price is known, and leaves the price untouched when neither is available (POO-354). POO-877:
 * the shared step never locks on a tickSpacing-1 pool. POO-881: clampRangeBound keeps the range at
 * least the 2-tick minimum on blur / step. POO-900: the clamp pins at EXACTLY the 2-spacing minimum,
 * anchored on the round-resolved opposite tick, and the width measure rounds too, so the pin target and
 * the acceptance threshold agree (the 3-tick sawtooth loop is gone).
 */
import { describe, expect, it } from "vitest";
import { createPoolTicks } from "@/lib/manager/createPoolTicks";
import {
  priceToClosestUsableTick,
  priceToNearestUsableTick,
  tickToPrice,
} from "@/lib/manager/tickPrice";
import {
  clampRangeBound,
  isRangeWideEnough,
  isSingleSidedNearPrice,
  rangeSpacingsForPool,
  snapPriceForPool,
  stepPriceForPool,
} from "./poolTickSnap";
import { roundPrice } from "./priceFormat";

describe("snapPriceForPool", () => {
  it("snaps to the EXACT on-chain tick price when decimals are known", () => {
    const grid = { currentPrice: 3000, feeBps: 30, decimals0: 18, decimals1: 6 };
    const snapped = snapPriceForPool(3123.45, grid);
    const tick = priceToClosestUsableTick(3123.45, 18, 6, 30);
    expect(snapped).toBeCloseTo(tickToPrice(tick, 18, 6), 6);
  });

  it("falls back to the relative grid when decimals are absent but a market price exists", () => {
    const grid = { currentPrice: 3000, feeBps: 30 };
    const snapped = snapPriceForPool(3123.45, grid);
    // Spacing-aligned relative to the current price: log_f(snapped/current) is an integer.
    const f = 1.0001 ** 60;
    const k = Math.log(snapped / 3000) / Math.log(f);
    expect(k).toBeCloseTo(Math.round(k), 6);
  });

  it("leaves the price untouched when there is neither decimals nor a market price (POO-354)", () => {
    const grid = { currentPrice: Number.MIN_VALUE, feeBps: 30 };
    expect(snapPriceForPool(3123.45, grid)).toBe(3123.45);
  });

  it("returns a non-positive price unchanged", () => {
    expect(
      snapPriceForPool(0, { currentPrice: 3000, feeBps: 30, decimals0: 18, decimals1: 6 }),
    ).toBe(0);
  });
});

describe("stepPriceForPool", () => {
  it("steps by one usable tick exactly when decimals are known", () => {
    const grid = { currentPrice: 3000, feeBps: 30, decimals0: 18, decimals1: 6 };
    const base = snapPriceForPool(3000, grid);
    const up = stepPriceForPool(base, grid, 1);
    const down = stepPriceForPool(base, grid, -1);
    expect(up).toBeGreaterThan(base);
    expect(down).toBeLessThan(base);
    // One tick up then one tick down returns to the same usable tick.
    expect(stepPriceForPool(up, grid, -1)).toBeCloseTo(base, 6);
  });

  it("steps along the relative grid when decimals are absent", () => {
    const grid = { currentPrice: 3000, feeBps: 30 };
    const up = stepPriceForPool(3000, grid, 1);
    expect(up).toBeGreaterThan(3000);
  });

  // @rule POO-877 R4 — the shared grid entry (used by BOTH BuildStep and MoveRangeModal) does not lock
  // on a spacing-1 pool: a display-rounded bound steps to the strictly adjacent usable tick each way.
  it("[POO-877 R4] does not lock on a spacing-1 pool through the shared grid", () => {
    const grid = { currentPrice: 1, feeBps: 1, decimals0: 6, decimals1: 6 };
    const display = Number(tickToPrice(5, 6, 6).toFixed(4)); // 1.0005, rendered as the editor does
    const up = stepPriceForPool(display, grid, 1);
    const down = stepPriceForPool(display, grid, -1);
    expect(up).toBeCloseTo(tickToPrice(6, 6, 6), 9);
    expect(down).toBeCloseTo(tickToPrice(4, 6, 6), 9);
    expect(Number(up.toFixed(4))).toBeGreaterThan(display);
    expect(Number(down.toFixed(4))).toBeLessThan(display);
  });
});

describe("clampRangeBound (POO-881 R5/R6 + POO-900 R4)", () => {
  // Decimals known → exact on-chain ticks; feeBps 5 → spacing 10, MIN_RANGE_SPACINGS = 2.
  const grid = { currentPrice: 1, feeBps: 5, decimals0: 6, decimals1: 6 };
  const p = (tick: number) => tickToPrice(tick, 6, 6);

  it("leaves a valid, wide-enough bound unchanged", () => {
    // Editing min to tick 0 against max at tick 40 (4 spacings) → already valid.
    expect(clampRangeBound(p(0), p(40), "min", grid)).toBeCloseTo(p(0), 9);
    // Editing max to tick 40 against min at tick 0 → already valid.
    expect(clampRangeBound(p(40), p(0), "max", grid)).toBeCloseTo(p(40), 9);
  });

  // @rule POO-900 R4 - the pin is oppositeTick ∓ MIN_RANGE_SPACINGS·spacing (EXACTLY 2, the 3-spacing
  // CLAMP_PIN_SPACINGS band is gone), so the clamp emits the boundary value the acceptance threshold
  // agrees with: the pin target equals the minimum the width check passes.
  it("[POO-900 R4] pins an inverted min back at exactly 2 spacings below max", () => {
    // min pushed to tick 60 while max sits at tick 20 (inverted) → pinned at tick 0 (20 − 2·10).
    const clamped = clampRangeBound(p(60), p(20), "min", grid);
    expect(clamped).toBeLessThan(p(20));
    expect(priceToNearestUsableTick(clamped, 6, 6, 5)).toBe(0);
    expect(rangeSpacingsForPool(clamped, p(20), grid)).toBe(2);
    expect(isRangeWideEnough(clamped, p(20), grid)).toBe(true);
  });

  it("[POO-900 R4] pins an inverted max back at exactly 2 spacings above min", () => {
    // max pushed to tick 0 while min sits at tick 40 (inverted) → pinned at tick 60 (40 + 2·10).
    const clamped = clampRangeBound(p(0), p(40), "max", grid);
    expect(clamped).toBeGreaterThan(p(40));
    expect(priceToNearestUsableTick(clamped, 6, 6, 5)).toBe(60);
    expect(rangeSpacingsForPool(p(40), clamped, grid)).toBe(2);
    expect(isRangeWideEnough(p(40), clamped, grid)).toBe(true);
  });

  it("pins a too-narrow (1-spacing) bound out at exactly the minimum width", () => {
    // min at tick 10 against max at tick 20 is only 1 spacing → widen to tick 0, exactly 2 spacings.
    const clampedMin = clampRangeBound(p(10), p(20), "min", grid);
    expect(rangeSpacingsForPool(clampedMin, p(20), grid)).toBe(2);
    expect(isRangeWideEnough(clampedMin, p(20), grid)).toBe(true);
    // max at tick 10 against min at tick 0 is 1 spacing → widen to tick 20, exactly 2 spacings.
    const clampedMax = clampRangeBound(p(10), p(0), "max", grid);
    expect(rangeSpacingsForPool(p(0), clampedMax, grid)).toBe(2);
    expect(isRangeWideEnough(p(0), clampedMax, grid)).toBe(true);
  });

  it("clamps on the relative grid too (mock mode)", () => {
    const relGrid = { currentPrice: 3000, feeBps: 30 }; // spacing 60
    const f = 1.0001 ** 60;
    // min pushed above max (inverted) → pinned exactly 2 spacings below max on the relative grid.
    const clamped = clampRangeBound(3000 * f * f, 3000, "min", relGrid);
    expect(clamped).toBeCloseTo(3000 / (f * f), 4);
    expect(rangeSpacingsForPool(clamped, 3000, relGrid)).toBe(2);
    expect(isRangeWideEnough(clamped, 3000, relGrid)).toBe(true);
  });

  // @rule POO-900 R3/R4 - the clamp anchors on the opposite bound's ROUND-resolved tick (the same
  // resolver the width measure uses, POO-877), and pins at EXACTLY the 2-spacing minimum. Rounding is
  // what makes exact-2 safe on spacing-1 pools: a display-rounded exact-tick price sits < 0.5 tick from
  // its true tick, so the round resolver recovers it, where the POO-319 floor (kept for typed prices at
  // the SNAP, not the width measure) dropped a whole tick and could re-measure an exact-2 pin at width 1
  // (the reason POO-881 pinned at 3 and the boundary sawtoothed between 3 ticks).
  it("[POO-900 R4] the pin re-measures at EXACTLY 2 spacings, off-grid and across a spacing-1 sweep", () => {
    const grid1 = { currentPrice: 1, feeBps: 1, decimals0: 6, decimals1: 6 };
    const clampedMin = clampRangeBound(9999, 1.0002, "min", grid1);
    expect(clampedMin).toBeLessThan(1.0002);
    expect(rangeSpacingsForPool(clampedMin, 1.0002, grid1)).toBe(2);
    const clampedMax = clampRangeBound(0.0001, 0.9998, "max", grid1);
    expect(clampedMax).toBeGreaterThan(0.9998);
    expect(rangeSpacingsForPool(0.9998, clampedMax, grid1)).toBe(2);
    // Exhaustive sweep on the fragile spacing-1 grid: every inverted min AND max pins to EXACTLY the
    // 2-spacing minimum, in both directions, even after the pinned value round-trips the display
    // string (roundPrice) the way the range editors re-parse it - the loop-freedom invariant.
    for (let t = -50; t <= 50; t++) {
      const oppP = tickToPrice(t, 6, 6);
      const pinnedMin = clampRangeBound(oppP * 2, oppP, "min", grid1);
      expect(rangeSpacingsForPool(pinnedMin, oppP, grid1)).toBe(2);
      expect(rangeSpacingsForPool(Number(roundPrice(pinnedMin, 1)), oppP, grid1)).toBe(2);
      const pinnedMax = clampRangeBound(oppP / 2, oppP, "max", grid1);
      expect(rangeSpacingsForPool(oppP, pinnedMax, grid1)).toBe(2);
      expect(rangeSpacingsForPool(oppP, Number(roundPrice(pinnedMax, 1)), grid1)).toBe(2);
    }
  });

  it("returns the candidate unchanged when the opposite bound is not a usable price", () => {
    expect(clampRangeBound(p(10), Number.NaN, "min", grid)).toBeCloseTo(p(10), 9);
    expect(clampRangeBound(p(10), 0, "min", grid)).toBeCloseTo(p(10), 9);
  });
});

describe("rangeSpacingsForPool / isRangeWideEnough (POO-860 R1/R2)", () => {
  // Decimals known → exact on-chain ticks; feeBps 5 → spacing 10.
  const realGrid = { currentPrice: 1, feeBps: 5, decimals0: 6, decimals1: 6 };
  const p0 = tickToPrice(0, 6, 6);
  const p10 = tickToPrice(10, 6, 6);
  const p20 = tickToPrice(20, 6, 6);

  it("counts exact usable-tick spacings between the bounds when decimals are known", () => {
    expect(rangeSpacingsForPool(p0, p10, realGrid)).toBe(1);
    expect(rangeSpacingsForPool(p0, p20, realGrid)).toBe(2);
  });

  it("requires at least 2 spacings: rejects equal, inverted, and 1-tick ranges", () => {
    expect(isRangeWideEnough(p0, p0, realGrid)).toBe(false); // equal
    expect(isRangeWideEnough(p20, p0, realGrid)).toBe(false); // inverted (min > max)
    expect(isRangeWideEnough(p0, p10, realGrid)).toBe(false); // one spacing
    expect(isRangeWideEnough(p0, p20, realGrid)).toBe(true); // two spacings
  });

  it("uses the relative grid when decimals are absent (mock mode)", () => {
    const grid = { currentPrice: 3000, feeBps: 30 };
    const f = 1.0001 ** 60; // one usable-tick step for spacing 60
    expect(rangeSpacingsForPool(3000, 3000 * f, grid)).toBe(1);
    expect(isRangeWideEnough(3000, 3000 * f, grid)).toBe(false);
    expect(isRangeWideEnough(3000, 3000 * f * f, grid)).toBe(true);
  });

  it("is null / not-wide for incomplete or price-less input", () => {
    expect(rangeSpacingsForPool(0, 1, realGrid)).toBeNull();
    expect(rangeSpacingsForPool(Number.NaN, 1, realGrid)).toBeNull();
    expect(isRangeWideEnough(0, 1, realGrid)).toBe(false);
    // No decimals AND no market price (sentinel) → unresolvable → not wide (other guards handle it).
    expect(isRangeWideEnough(1, 2, { currentPrice: Number.MIN_VALUE, feeBps: 30 })).toBe(false);
  });

  // @rule POO-883 R9/R10 (measure updated by POO-900 R3) - the width check measures on-grid ticks, not
  // raw prices, so a typed off-grid band that RESOLVES to 2 spacings is accepted. POO-900 switched the
  // width resolver from the POO-319 floor to ROUND (priceToNearestUsableTick, the POO-877 stepper
  // resolver): the floor stays where POO-319 needs it, at the typed-price SNAP (snapPriceForPool /
  // createPoolTicks), while the width measure recovers display-rounded exact-tick bounds losslessly.
  it("[POO-883 R10] measures resolved ticks: an off-grid band resolving to 2 spacings is wide enough", () => {
    // Off-grid prices just above ticks 0 and 20 (spacing 10): both round to their nearest usable
    // ticks 0 and 20 → resolved width is exactly 2 spacings → valid. (The POO-319 floor at the snap
    // maps them to the same ticks: exact-tick prices floor to their own tick.)
    const minOff = tickToPrice(1, 6, 6); // nearest usable tick 0
    const maxOff = tickToPrice(21, 6, 6); // nearest usable tick 20
    expect(priceToClosestUsableTick(minOff, 6, 6, 5)).toBe(0);
    expect(priceToClosestUsableTick(maxOff, 6, 6, 5)).toBe(20);
    expect(rangeSpacingsForPool(minOff, maxOff, realGrid)).toBe(2);
    expect(isRangeWideEnough(minOff, maxOff, realGrid)).toBe(true);
  });

  // @rule POO-900 R3 (gate/mint width contract) - a range the round-measured gate accepts must
  // resolve to the SAME ticks on the mint path (createPoolTicks), never one spacing short. With the
  // gate on round and the mint on the POO-319 floor, ~25% of display-rounded exactly-2 ranges on
  // spacing-1 pools were gate-valid but mint-degenerate (Launch silently disabled / move-range
  // "too narrow" throw after the UI blessed the minimum).
  it("[POO-900 R3] a gate-accepted exactly-2 range mint-resolves to the gated ticks (spacing-1 display round-trip sweep)", () => {
    // USDC/USDT 0.01% (feeBps 1 → spacing 1), bounds as the editor renders them: exact tick prices
    // through the tick-aware roundPrice display round-trip.
    const grid = { currentPrice: 1, feeBps: 1, decimals0: 6, decimals1: 6 };
    for (let t = -2000; t <= 2000; t++) {
      const lo = Number.parseFloat(roundPrice(tickToPrice(t, 6, 6), grid.currentPrice));
      const hi = Number.parseFloat(roundPrice(tickToPrice(t + 2, 6, 6), grid.currentPrice));
      expect(isRangeWideEnough(lo, hi, grid)).toBe(true);
      expect(createPoolTicks({ full: false, minPrice: lo, maxPrice: hi }, 6, 6, 1)).toEqual({
        tickLower: t,
        tickUpper: t + 2,
      });
    }
  });
});

describe("isSingleSidedNearPrice (POO-861 R4)", () => {
  // Decimals known → exact on-chain ticks; feeBps 5 → spacing 10.
  const grid = { currentPrice: 1, feeBps: 5, decimals0: 6, decimals1: 6 };
  const p = (tick: number) => tickToPrice(tick, 6, 6);

  it("does not warn for a two-sided range (current price inside)", () => {
    // Range ticks 0..40, current at tick 20 → in range → two-sided.
    expect(isSingleSidedNearPrice(p(20), p(0), p(40), false, grid)).toBe(false);
  });

  it("does not warn for a full range", () => {
    expect(isSingleSidedNearPrice(p(20), null, null, true, grid)).toBe(false);
  });

  it("warns when a single-sided range (below) is within the buffer of the current price", () => {
    // Current at tick 0, range starts 2 ticks above (ticks 20..60) → gap 2 <= 3 → warn.
    expect(isSingleSidedNearPrice(p(0), p(20), p(60), false, grid)).toBe(true);
  });

  it("warns when a single-sided range (above) is within the buffer of the current price", () => {
    // Current at tick 100, range ends 1 tick below (ticks 40..90) → gap 1 <= 3 → warn.
    expect(isSingleSidedNearPrice(p(100), p(40), p(90), false, grid)).toBe(true);
  });

  it("does not warn when a single-sided range sits comfortably away from the price", () => {
    // Current at tick 0, range starts 10 ticks above (ticks 100..200) → gap 10 > 3 → no warn.
    expect(isSingleSidedNearPrice(p(0), p(100), p(200), false, grid)).toBe(false);
  });

  it("respects a custom buffer", () => {
    // gap 2; buffer 1 → no warn; buffer 3 → warn.
    expect(isSingleSidedNearPrice(p(0), p(20), p(60), false, grid, 1)).toBe(false);
    expect(isSingleSidedNearPrice(p(0), p(20), p(60), false, grid, 3)).toBe(true);
  });

  it("is false for incomplete or degenerate input", () => {
    expect(isSingleSidedNearPrice(p(0), null, p(40), false, grid)).toBe(false);
    expect(isSingleSidedNearPrice(0, p(20), p(60), false, grid)).toBe(false);
    expect(isSingleSidedNearPrice(p(0), p(60), p(20), false, grid)).toBe(false); // inverted
  });
});
