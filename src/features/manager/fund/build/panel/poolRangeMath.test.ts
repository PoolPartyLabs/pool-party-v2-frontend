/**
 * @id PP-MGR-LIB-029
 * @name poolRangeMath tests
 * @implements-rules-version v1 (POO-2180 rules v1)
 * @analytics-events none (pure maths, no user surface)
 *
 * Covers R1 to R11 of POO-2180 on the pool's own grid. The V1 helpers (`poolTickSnap.ts` and the
 * fee-keyed half of `tick.ts`) appear here ONLY as oracles: on the four Uniswap v3 tiers the new
 * module must land on exactly the ticks V1 lands on, and on a spacing V1 cannot express (50, a
 * 0.25% pool) it must stay on its own grid where V1 falls back to 60. Then inversion symmetry, the
 * clamp at the ends of the grid, Full, the on-bound behaviour, the status flip under inversion
 * (finding 24), the handoff's worked split numbers and a seeded random walk that never leaves a
 * valid range (P4).
 */
import { describe, expect, it } from "vitest";
import { fullRangeTicks } from "@/lib/manager/fullRangeTicks";
import {
  MAX_TICK,
  MIN_RANGE_SPACINGS,
  MIN_TICK,
  priceToNearestUsableTick,
  priceToTick,
  tickSpacing,
  tickToPrice,
} from "@/lib/uniswap/tick";
import { invert, toCanonicalBounds, toDisplayBounds } from "../../../lib/invertPrice";
import { clampRangeBound, snapPriceForPool, stepPriceForPool } from "../../../lib/poolTickSnap";
import { RANGE_PRESETS } from "../../../lib/presets";
import { roundPrice } from "../../../lib/priceFormat";
import {
  commitBoundInput,
  currentPoolPrice,
  DEFAULT_RANGE_PRESET,
  type DisplayBound,
  displayBounds,
  fullPoolRange,
  invertRange,
  type LivePoolGrid,
  type PoolGrid,
  type PoolRange,
  presetRange,
  type RangeMarker,
  rangeMarker,
  rangeSplit,
  rangeStatus,
  rangeSteppers,
  sanitizeBoundInput,
  stepBound,
  usableTickBounds,
} from "./poolRangeMath";

/** The grid of the handoff's pool: WETH / USDC 0.05% on Arbitrum, WETH is token0. */
const WETH_USDC_GRID: PoolGrid = { decimals0: 18, decimals1: 6, tickSpacing: 10 };

/** The handoff's pool at its worked price, 3,050 USDC per WETH. */
const WETH_USDC: LivePoolGrid = { ...WETH_USDC_GRID, currentPrice: 3050 };

/** The four Uniswap v3 tiers V1 knows, in pool-key fee units and in V1's basis points. */
const V3_TIERS = [
  { fee: 100, feeBps: 1, spacing: 1 },
  { fee: 500, feeBps: 5, spacing: 10 },
  { fee: 3000, feeBps: 30, spacing: 60 },
  { fee: 10000, feeBps: 100, spacing: 200 },
] as const;

/** Three markets with different decimals and price scales, for the agreement with V1. */
const MARKETS = [
  { name: "WETH/USDC", decimals0: 18, decimals1: 6, price: 3050 },
  { name: "USDC/USDT", decimals0: 6, decimals1: 6, price: 1.0003 },
  { name: "WBTC/WETH", decimals0: 8, decimals1: 18, price: 28.42 },
] as const;

const BOUNDS: DisplayBound[] = ["min", "max"];
const DIRS = [1, -1] as const;

function isAligned(tick: number, spacing: number): boolean {
  return Number.isInteger(tick / spacing);
}

/** A range must hold whatever the manager did (P4). */
function expectValid(range: PoolRange, grid: PoolGrid): void {
  const { minTick, maxTick } = usableTickBounds(grid.tickSpacing);
  expect(Number.isInteger(range.tickLower)).toBe(true);
  expect(Number.isInteger(range.tickUpper)).toBe(true);
  expect(isAligned(range.tickLower, grid.tickSpacing)).toBe(true);
  expect(isAligned(range.tickUpper, grid.tickSpacing)).toBe(true);
  expect(range.tickLower).toBeGreaterThanOrEqual(minTick);
  expect(range.tickUpper).toBeLessThanOrEqual(maxTick);
  expect(range.tickUpper - range.tickLower).toBeGreaterThanOrEqual(
    MIN_RANGE_SPACINGS * grid.tickSpacing,
  );
  if (range.fullRange) {
    expect(range.tickLower).toBe(minTick);
    expect(range.tickUpper).toBe(maxTick);
  }
}

/** A range from two ticks, never full, for the cases a preset cannot reach. */
function ticks(tickLower: number, tickUpper: number, displayInverted = false): PoolRange {
  return { tickLower, tickUpper, fullRange: false, displayInverted };
}

/** A price as the manager would type it: plain decimals, no exponent. */
function typed(value: number): string {
  return value.toFixed(12);
}

/** V1's grid for a tier: the fee-keyed record `poolTickSnap.ts` takes. */
function v1Grid(feeBps: number, market: (typeof MARKETS)[number]) {
  return {
    currentPrice: market.price,
    feeBps,
    decimals0: market.decimals0,
    decimals1: market.decimals1,
  };
}

/** V1's tick for a price it produced (round recovery, exact on its own tick prices). */
function v1Tick(price: number, feeBps: number, market: (typeof MARKETS)[number]): number {
  return priceToNearestUsableTick(price, market.decimals0, market.decimals1, feeBps);
}

/** V1's preset (BuildStep `presetBounds`): ±pct around the DISPLAYED price, snapped canonically. */
function v1Preset(
  pct: number,
  inverted: boolean,
  feeBps: number,
  market: (typeof MARKETS)[number],
): [number, number] {
  const grid = v1Grid(feeBps, market);
  const shown = inverted ? invert(market.price) : market.price;
  const canon = toCanonicalBounds(shown * (1 - pct / 100), shown * (1 + pct / 100), inverted);
  return [
    v1Tick(snapPriceForPool(canon.min, grid), feeBps, market),
    v1Tick(snapPriceForPool(canon.max, grid), feeBps, market),
  ];
}

/** V1's stepper (BuildStep `nudge`): step the canonical bound, then pin it off the other one. */
function v1Nudge(
  range: PoolRange,
  bound: DisplayBound,
  dir: 1 | -1,
  feeBps: number,
  market: (typeof MARKETS)[number],
): [number, number] {
  const grid = v1Grid(feeBps, market);
  const lo = tickToPrice(range.tickLower, market.decimals0, market.decimals1);
  const hi = tickToPrice(range.tickUpper, market.decimals0, market.decimals1);
  const inverted = range.displayInverted;
  const which: "min" | "max" = inverted ? (bound === "min" ? "max" : "min") : bound;
  const canonDir = (inverted ? -dir : dir) as 1 | -1;
  const stepped = stepPriceForPool(which === "min" ? lo : hi, grid, canonDir);
  const next = clampRangeBound(stepped, which === "min" ? hi : lo, which, grid);
  return which === "min"
    ? [v1Tick(next, feeBps, market), range.tickUpper]
    : [range.tickLower, v1Tick(next, feeBps, market)];
}

/** V1's blur (BuildStep `snapBound`): snap the typed canonical bound, then pin it. */
function v1Typed(
  range: PoolRange,
  bound: DisplayBound,
  text: string,
  feeBps: number,
  market: (typeof MARKETS)[number],
): [number, number] {
  const grid = v1Grid(feeBps, market);
  const lo = tickToPrice(range.tickLower, market.decimals0, market.decimals1);
  const hi = tickToPrice(range.tickUpper, market.decimals0, market.decimals1);
  const inverted = range.displayInverted;
  const shown = toDisplayBounds(lo, hi, inverted);
  const edited = { ...shown, [bound]: Number.parseFloat(text) };
  const canon = toCanonicalBounds(edited.min, edited.max, inverted);
  const which: "min" | "max" = inverted ? (bound === "min" ? "max" : "min") : bound;
  const snapped = snapPriceForPool(which === "min" ? canon.min : canon.max, grid);
  const next = clampRangeBound(snapped, which === "min" ? hi : lo, which, grid);
  return which === "min"
    ? [v1Tick(next, feeBps, market), range.tickUpper]
    : [range.tickLower, v1Tick(next, feeBps, market)];
}

/** A deterministic random source (mulberry32), so the random walk replays the same way. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("usableTickBounds", () => {
  it("aligns MIN_TICK and MAX_TICK inward to any positive spacing", () => {
    // @rule R1
    for (const spacing of [1, 10, 50, 60, 200, 2000, 32767]) {
      const { minTick, maxTick } = usableTickBounds(spacing);
      expect(minTick, `spacing ${spacing}`).toBe(Math.ceil(MIN_TICK / spacing) * spacing);
      expect(maxTick, `spacing ${spacing}`).toBe(Math.floor(MAX_TICK / spacing) * spacing);
    }
    expect(usableTickBounds(50)).toEqual({ minTick: -887250, maxTick: 887250 });
  });

  it("refuses a spacing that is not a positive integer: the grid comes from the pool key", () => {
    // @rule R10
    for (const spacing of [0, -10, 2.5, Number.NaN, 2_000_000]) {
      expect(() => usableTickBounds(spacing), `spacing ${spacing}`).toThrow(RangeError);
    }
  });
});

describe("currentPoolPrice", () => {
  it("reads the canonical price, else derives it from the current tick", () => {
    // @rule R1 (the input is the current price and/or the current tick)
    expect(currentPoolPrice(WETH_USDC)).toBe(3050);
    const tickOnly: LivePoolGrid = {
      decimals0: 18,
      decimals1: 6,
      tickSpacing: 10,
      currentTick: -196091,
    };
    expect(currentPoolPrice(tickOnly)).toBe(tickToPrice(-196091, 18, 6));
    // The price wins when both are known: it is exact, the tick is floored.
    expect(currentPoolPrice({ ...WETH_USDC, currentTick: 0 })).toBe(3050);
  });

  it("is null while neither is known, or the price is not a positive number", () => {
    // @rule R1
    const grid: PoolGrid = { decimals0: 18, decimals1: 6, tickSpacing: 10 };
    expect(currentPoolPrice(grid)).toBeNull();
    expect(currentPoolPrice({ ...grid, currentPrice: null, currentTick: null })).toBeNull();
    expect(currentPoolPrice({ ...grid, currentPrice: 0 })).toBeNull();
    expect(currentPoolPrice({ ...grid, currentPrice: Number.NaN })).toBeNull();
  });
});

describe("presets", () => {
  it("offers ±5%, ±10% and ±20% beside Full, with ±10% as the default", () => {
    // @rule R1
    expect(RANGE_PRESETS).toEqual([5, 10, 20]);
    expect(DEFAULT_RANGE_PRESET).toBe(10);
  });

  it("takes ±pct around the current price and snaps it to usable ticks of the pool", () => {
    // @rule R1
    for (const pct of RANGE_PRESETS) {
      const range = presetRange(WETH_USDC, pct) as PoolRange;
      expectValid(range, WETH_USDC);
      expect(range.fullRange).toBe(false);
      expect(range.displayInverted).toBe(false);
      const shown = displayBounds(range, WETH_USDC);
      const oneSpacing = 1.0001 ** WETH_USDC.tickSpacing;
      expect(shown.min / (3050 * (1 - pct / 100))).toBeGreaterThan(1 / oneSpacing);
      expect(shown.min / (3050 * (1 - pct / 100))).toBeLessThan(oneSpacing);
      expect(shown.max / (3050 * (1 + pct / 100))).toBeGreaterThan(1 / oneSpacing);
      expect(shown.max / (3050 * (1 + pct / 100))).toBeLessThan(oneSpacing);
    }
  });

  it("takes the percentage in the displayed orientation: ±10% inverted is another tick pair", () => {
    // @rule R1
    const canonical = presetRange(WETH_USDC, 10, false) as PoolRange;
    const inverted = presetRange(WETH_USDC, 10, true) as PoolRange;
    expect(inverted.displayInverted).toBe(true);
    expect([inverted.tickLower, inverted.tickUpper]).not.toEqual([
      canonical.tickLower,
      canonical.tickUpper,
    ]);
    // Inverted, the band is ±10% around 1 / 3050 as the manager reads it.
    const shown = displayBounds(inverted, WETH_USDC);
    expect(shown.min).toBeCloseTo((1 / 3050) * 0.9, 6);
    expect(shown.max).toBeCloseTo((1 / 3050) * 1.1, 6);
  });

  it("works from the current tick alone", () => {
    // @rule R1
    const tick = -196091;
    const fromTick = presetRange(
      { decimals0: 18, decimals1: 6, tickSpacing: 10, currentTick: tick },
      10,
    );
    const fromPrice = presetRange({ ...WETH_USDC, currentPrice: tickToPrice(tick, 18, 6) }, 10);
    expect(fromTick).toEqual(fromPrice);
  });

  it("is null until the pool's price is known, except Full, which needs none", () => {
    // @rule R1 (P13: Apply waits for the first live read)
    const grid: PoolGrid = { decimals0: 18, decimals1: 6, tickSpacing: 10 };
    expect(presetRange(grid, 10)).toBeNull();
    expect(presetRange(grid, "full")).toEqual(fullPoolRange(grid));
  });

  it("keeps a grid so coarse the band collapses at two spacings, around the current price", () => {
    // @rule R4 (P4: a preset is never narrower than the minimum), up to v4's maximum spacing
    for (const spacing of [2000, 16383, 32767]) {
      for (const price of [3050, 1e-9, 1e9]) {
        const coarse: LivePoolGrid = { ...WETH_USDC, tickSpacing: spacing, currentPrice: price };
        for (const pct of RANGE_PRESETS) {
          for (const inverted of [false, true]) {
            const range = presetRange(coarse, pct, inverted) as PoolRange;
            const label = `spacing ${spacing} price ${price} ±${pct} inverted ${inverted}`;
            expectValid(range, coarse);
            expect(rangeStatus(range, coarse), label).toBe("in");
          }
        }
      }
    }
    expect(presetRange({ ...WETH_USDC, tickSpacing: 2000 }, 5)).toEqual(ticks(-198000, -194000));
    // At 32767 the minimum range is the two spacings around the usable tick nearest 3,050.
    expect(presetRange({ ...WETH_USDC, tickSpacing: 32767 }, 5)).toEqual(ticks(-229369, -163835));
  });

  it("stays on the grid at its ends", () => {
    // @rule R4
    const grid = { decimals0: 0, decimals1: 0, tickSpacing: 60 };
    const { minTick, maxTick } = usableTickBounds(60);
    const top = presetRange(
      { ...grid, currentPrice: tickToPrice(MAX_TICK, 0, 0) },
      20,
    ) as PoolRange;
    const bottom = presetRange(
      { ...grid, currentPrice: tickToPrice(MIN_TICK, 0, 0) },
      5,
    ) as PoolRange;
    expectValid(top, grid);
    expectValid(bottom, grid);
    expect(top.tickUpper).toBe(maxTick);
    expect(bottom.tickLower).toBe(minTick);
  });
});

describe("agreement with V1 on the four Uniswap v3 tiers", () => {
  it("V1 knows these four tiers and their spacings", () => {
    // @rule R10
    for (const tier of V3_TIERS) expect(tickSpacing(tier.feeBps)).toBe(tier.spacing);
  });

  it("lands every preset, in both orientations, on the ticks V1 lands on", () => {
    // @rule R1, R9
    for (const tier of V3_TIERS) {
      for (const market of MARKETS) {
        const pool: LivePoolGrid = {
          ...market,
          tickSpacing: tier.spacing,
          currentPrice: market.price,
        };
        for (const pct of RANGE_PRESETS) {
          for (const inverted of [false, true]) {
            const range = presetRange(pool, pct, inverted) as PoolRange;
            expect(
              [range.tickLower, range.tickUpper],
              `${market.name} fee ${tier.fee} ±${pct} inverted ${inverted}`,
            ).toEqual(v1Preset(pct, inverted, tier.feeBps, market));
          }
        }
      }
    }
  });

  it("steps exactly where V1 steps, in both orientations", () => {
    // @rule R2, R9
    for (const tier of V3_TIERS) {
      for (const market of MARKETS) {
        const pool: LivePoolGrid = {
          ...market,
          tickSpacing: tier.spacing,
          currentPrice: market.price,
        };
        for (const inverted of [false, true]) {
          const start = presetRange(pool, 10, inverted) as PoolRange;
          for (const bound of BOUNDS) {
            for (const dir of DIRS) {
              const next = stepBound(start, pool, bound, dir);
              expect(
                [next.tickLower, next.tickUpper],
                `${market.name} fee ${tier.fee} ${bound} ${dir} inverted ${inverted}`,
              ).toEqual(v1Nudge(start, bound, dir, tier.feeBps, market));
            }
          }
        }
      }
    }
  });

  it("snaps and pins a typed bound where V1 does, in both orientations", () => {
    // @rule R3, R4, R9
    const multipliers = [0.05, 0.5, 0.93, 0.999, 1.0004, 1.07, 1.5, 3, 40];
    for (const tier of V3_TIERS) {
      for (const market of MARKETS) {
        const pool: LivePoolGrid = {
          ...market,
          tickSpacing: tier.spacing,
          currentPrice: market.price,
        };
        for (const inverted of [false, true]) {
          const start = presetRange(pool, 10, inverted) as PoolRange;
          const shownNow = inverted ? 1 / market.price : market.price;
          for (const bound of BOUNDS) {
            for (const multiplier of multipliers) {
              const text = typed(shownNow * multiplier);
              const next = commitBoundInput(start, pool, bound, text);
              expect(
                [next.tickLower, next.tickUpper],
                `${market.name} fee ${tier.fee} ${bound} ${text} inverted ${inverted}`,
              ).toEqual(v1Typed(start, bound, text, tier.feeBps, market));
            }
          }
        }
      }
    }
  });

  it("pins at exactly two spacings where V1's clamp does", () => {
    // @rule R4, R9
    for (const tier of V3_TIERS) {
      const market = MARKETS[0];
      const pool: LivePoolGrid = {
        ...market,
        tickSpacing: tier.spacing,
        currentPrice: market.price,
      };
      const s = tier.spacing;
      // Three spacings wide: one step in is allowed, the next one is not.
      const start = ticks(-196100 - (-196100 % s) - s, -196100 - (-196100 % s) + 2 * s);
      let range = start;
      for (let i = 0; i < 4; i += 1) {
        const expected = v1Nudge(range, "min", 1, tier.feeBps, market);
        range = stepBound(range, pool, "min", 1);
        expect([range.tickLower, range.tickUpper], `fee ${tier.fee} step ${i}`).toEqual(expected);
      }
      expect(range.tickUpper - range.tickLower).toBe(MIN_RANGE_SPACINGS * s);
    }
  });

  it("gives Full the ticks V1's full range gives", () => {
    // @rule R1, R9
    for (const tier of V3_TIERS) {
      const range = fullPoolRange({ decimals0: 18, decimals1: 6, tickSpacing: tier.spacing });
      expect({ tickLower: range.tickLower, tickUpper: range.tickUpper }).toEqual(
        fullRangeTicks(tier.feeBps),
      );
    }
  });
});

describe("a spacing V1 cannot express (50, a 0.25% pool, fee 2500)", () => {
  const pool: LivePoolGrid = { decimals0: 18, decimals1: 6, tickSpacing: 50, currentPrice: 3050 };

  it("is unknown to V1, which would snap it on 60", () => {
    // @rule R10
    expect(tickSpacing(2500 / 100)).toBe(60);
  });

  it("keeps presets, steps, typed values and Full on multiples of 50", () => {
    // @rule R1, R2, R3, R10
    const ranges: PoolRange[] = [];
    for (const pct of RANGE_PRESETS) {
      for (const inverted of [false, true])
        ranges.push(presetRange(pool, pct, inverted) as PoolRange);
    }
    const start = presetRange(pool, 10) as PoolRange;
    for (const bound of BOUNDS) {
      for (const dir of DIRS) ranges.push(stepBound(start, pool, bound, dir));
      ranges.push(commitBoundInput(start, pool, bound, "3123.45"));
    }
    ranges.push(fullPoolRange(pool));
    for (const range of ranges) expectValid(range, pool);
    expect(
      ranges.some((range) => !isAligned(range.tickLower, 60) || !isAligned(range.tickUpper, 60)),
    ).toBe(true);
  });

  it("differs from what V1 would produce for the same band", () => {
    // @rule R10
    const ours = presetRange(pool, 10) as PoolRange;
    const market = MARKETS[0];
    const v1 = v1Preset(10, false, 25, market);
    expect([ours.tickLower, ours.tickUpper]).toEqual([-197150, -195150]);
    expect(v1).toEqual([-197160, -195120]);
  });

  it("steps by 50", () => {
    // @rule R2
    const start = presetRange(pool, 10) as PoolRange;
    expect(stepBound(start, pool, "min", 1).tickLower - start.tickLower).toBe(50);
    expect(stepBound(start, pool, "max", -1).tickUpper - start.tickUpper).toBe(-50);
  });
});

describe("steppers", () => {
  it("move exactly one usable tick of the pool's own spacing", () => {
    // @rule R2
    for (const spacing of [1, 10, 50, 60, 200]) {
      const pool = { ...WETH_USDC, tickSpacing: spacing };
      const start = presetRange(pool, 10) as PoolRange;
      expect(stepBound(start, pool, "min", 1)).toEqual({
        ...start,
        tickLower: start.tickLower + spacing,
      });
      expect(stepBound(start, pool, "min", -1)).toEqual({
        ...start,
        tickLower: start.tickLower - spacing,
      });
      expect(stepBound(start, pool, "max", 1)).toEqual({
        ...start,
        tickUpper: start.tickUpper + spacing,
      });
      expect(stepBound(start, pool, "max", -1)).toEqual({
        ...start,
        tickUpper: start.tickUpper - spacing,
      });
    }
  });

  it("move in the displayed orientation when the quote is inverted", () => {
    // @rule R2, R8
    const start = presetRange(WETH_USDC, 10, true) as PoolRange;
    const shown = displayBounds(start, WETH_USDC);
    const minUp = stepBound(start, WETH_USDC, "min", 1);
    const maxUp = stepBound(start, WETH_USDC, "max", 1);
    // Raising the displayed Min lowers the canonical upper tick, and the reverse for Max.
    expect(minUp).toEqual({ ...start, tickUpper: start.tickUpper - 10 });
    expect(maxUp).toEqual({ ...start, tickLower: start.tickLower - 10 });
    expect(displayBounds(minUp, WETH_USDC).min).toBeGreaterThan(shown.min);
    expect(displayBounds(maxUp, WETH_USDC).max).toBeGreaterThan(shown.max);
    expect(displayBounds(stepBound(start, WETH_USDC, "min", -1), WETH_USDC).min).toBeLessThan(
      shown.min,
    );
  });

  it("are all available on a comfortable range", () => {
    // @rule R4
    const start = presetRange(WETH_USDC, 10) as PoolRange;
    expect(rangeSteppers(start, WETH_USDC)).toEqual({
      minDown: true,
      minUp: true,
      maxDown: true,
      maxUp: true,
    });
  });
});

describe("clamp (P4)", () => {
  it("keeps Max two spacings above Min and reports the steppers that would break it", () => {
    // @rule R4
    const narrow = ticks(-196100, -196080);
    expect(rangeSteppers(narrow, WETH_USDC)).toEqual({
      minDown: true,
      minUp: false,
      maxDown: false,
      maxUp: true,
    });
    expect(stepBound(narrow, WETH_USDC, "min", 1)).toEqual(narrow);
    expect(stepBound(narrow, WETH_USDC, "max", -1)).toEqual(narrow);
  });

  it("reports the same pair in the displayed orientation when inverted", () => {
    // @rule R4, R8
    const narrow = ticks(-196100, -196080, true);
    // Displayed Min up lowers the canonical upper tick, displayed Max down raises the lower one.
    expect(rangeSteppers(narrow, WETH_USDC)).toEqual({
      minDown: true,
      minUp: false,
      maxDown: false,
      maxUp: true,
    });
  });

  it("stops at the ends of the grid", () => {
    // @rule R4
    const { minTick, maxTick } = usableTickBounds(10);
    const bottom = ticks(minTick, minTick + 40);
    const top = ticks(maxTick - 40, maxTick);
    expect(rangeSteppers(bottom, WETH_USDC).minDown).toBe(false);
    expect(rangeSteppers(top, WETH_USDC).maxUp).toBe(false);
    expect(stepBound(bottom, WETH_USDC, "min", -1)).toEqual(bottom);
    expect(stepBound(top, WETH_USDC, "max", 1)).toEqual(top);
    // Inverted, the bottom of the grid is the top of the displayed scale.
    expect(rangeSteppers({ ...bottom, displayInverted: true }, WETH_USDC).maxUp).toBe(false);
    expect(rangeSteppers({ ...top, displayInverted: true }, WETH_USDC).minDown).toBe(false);
  });

  it("pins a typed bound that would cross the other one exactly two spacings off it", () => {
    // @rule R3, R4
    const start = presetRange(WETH_USDC, 10) as PoolRange;
    const minPast = commitBoundInput(start, WETH_USDC, "min", "9000");
    const maxPast = commitBoundInput(start, WETH_USDC, "max", "100");
    expect(minPast).toEqual({ ...start, tickLower: start.tickUpper - 20 });
    expect(maxPast).toEqual({ ...start, tickUpper: start.tickLower + 20 });
    const equal = commitBoundInput(
      start,
      WETH_USDC,
      "max",
      typed(displayBounds(start, WETH_USDC).min),
    );
    expect(equal.tickUpper - equal.tickLower).toBe(20);
  });

  it("brings a typed value beyond the grid back to its aligned edge", () => {
    // @rule R3, R4
    const { minTick, maxTick } = usableTickBounds(10);
    const start = presetRange(WETH_USDC, 10) as PoolRange;
    const huge = `1${"0".repeat(60)}`;
    const tiny = `0.${"0".repeat(60)}1`;
    expect(commitBoundInput(start, WETH_USDC, "max", huge).tickUpper).toBe(maxTick);
    expect(commitBoundInput(start, WETH_USDC, "min", tiny).tickLower).toBe(minTick);
  });

  it("never leaves a valid range over a long random walk of every operation", () => {
    // @rule R1 to R4 (P4: there is never an invalid result)
    const random = seeded(2180);
    for (const spacing of [1, 10, 50, 60, 200, 2000, 16383, 32767]) {
      const pool: LivePoolGrid = { ...WETH_USDC, tickSpacing: spacing };
      let range = presetRange(pool, DEFAULT_RANGE_PRESET) as PoolRange;
      for (let i = 0; i < 400; i += 1) {
        const roll = random();
        const bound: DisplayBound = random() < 0.5 ? "min" : "max";
        const dir = random() < 0.5 ? 1 : -1;
        if (roll < 0.55) range = stepBound(range, pool, bound, dir);
        else if (roll < 0.8) {
          const shownNow = range.displayInverted ? 1 / 3050 : 3050;
          range = commitBoundInput(range, pool, bound, typed(shownNow * 10 ** (random() * 6 - 3)));
        } else if (roll < 0.9) range = invertRange(range);
        else {
          const presets = [...RANGE_PRESETS, "full"] as const;
          const pick = presets[Math.floor(random() * presets.length)] ?? "full";
          range = presetRange(pool, pick, range.displayInverted) as PoolRange;
        }
        expectValid(range, pool);
      }
    }
  });
});

describe("typed bounds", () => {
  it("sanitise each keystroke to a decimal number, the locale separator reading as the point", () => {
    // @rule R3
    expect(sanitizeBoundInput("3,050.5")).toBe("3050.5");
    expect(sanitizeBoundInput("3.050,5", ",")).toBe("3050.5");
    expect(sanitizeBoundInput("$ 3050abc")).toBe("3050");
    expect(sanitizeBoundInput("0.000298")).toBe("0.000298");
    expect(sanitizeBoundInput("1.2.3")).toBe("1.23");
  });

  it("snap onto a usable tick on blur", () => {
    // @rule R3
    const start = presetRange(WETH_USDC, 10) as PoolRange;
    const next = commitBoundInput(start, WETH_USDC, "min", "2900");
    expectValid(next, WETH_USDC);
    expect(next.tickUpper).toBe(start.tickUpper);
    expect(next.tickLower).toBe(Math.round(Math.floor(priceToTick(2900, 18, 6)) / 10) * 10);
    expect(next.fullRange).toBe(false);
  });

  it("read the typed value in the displayed orientation when inverted", () => {
    // @rule R3, R8
    const start = presetRange(WETH_USDC, 10, true) as PoolRange;
    const next = commitBoundInput(start, WETH_USDC, "min", "0.0003");
    // The displayed Min is the canonical upper bound, at 1 / 0.0003.
    expect(next.tickLower).toBe(start.tickLower);
    expect(next.tickUpper).toBe(Math.round(Math.floor(priceToTick(1 / 0.0003, 18, 6)) / 10) * 10);
    expect(displayBounds(next, WETH_USDC).min).toBeCloseTo(0.0003, 6);
  });

  it("leave the range as it was when the field is empty, zero or not a number", () => {
    // @rule R3 (P4: a typed value snaps back on blur)
    const start = presetRange(WETH_USDC, 10) as PoolRange;
    for (const text of ["", ".", "0", "0.000", "abc"]) {
      expect(commitBoundInput(start, WETH_USDC, "min", text), JSON.stringify(text)).toBe(start);
      expect(commitBoundInput(start, WETH_USDC, "max", text), JSON.stringify(text)).toBe(start);
    }
  });

  it("leave Full for a typed bound, the other end staying at the edge of the grid", () => {
    // @rule R3
    const full = fullPoolRange(WETH_USDC);
    const next = commitBoundInput(full, WETH_USDC, "min", "2600");
    expectValid(next, WETH_USDC);
    expect(next.fullRange).toBe(false);
    expect(next.tickUpper).toBe(full.tickUpper);
  });

  it("can move an untouched bound one tick on a spacing-1 pool when the shown text is unknown", () => {
    // @rule R3 (why the shown text matters: V1's typed-price snap floors, POO-319)
    const pool: LivePoolGrid = { ...WETH_USDC, tickSpacing: 1 };
    const start = presetRange(pool, 5) as PoolRange;
    const shown = roundPrice(displayBounds(start, pool).min, 3050);
    expect([start.tickLower, start.tickUpper]).toEqual([-196605, -195604]);
    expect(shown).toBe("2897.21");
    expect(commitBoundInput(start, pool, "min", shown).tickLower).toBe(-196606);
  });

  it("keeps a bound committed untouched, given the text the field showed", () => {
    // @rule R3 (P5: an untouched field is not a change)
    for (const spacing of [1, 2, 10, 60]) {
      const pool: LivePoolGrid = { ...WETH_USDC, tickSpacing: spacing };
      for (const inverted of [false, true]) {
        const reference = inverted ? 1 / 3050 : 3050;
        for (const pct of RANGE_PRESETS) {
          const start = presetRange(pool, pct, inverted) as PoolRange;
          const shown = displayBounds(start, pool);
          for (const bound of BOUNDS) {
            const text = roundPrice(shown[bound], reference);
            const label = `spacing ${spacing} ±${pct} ${bound} inverted ${inverted}`;
            expect(commitBoundInput(start, pool, bound, text, text), label).toBe(start);
            expect(commitBoundInput(start, pool, bound, ` ${text} `, text), label).toBe(start);
          }
        }
      }
    }
  });

  it("already kept an untouched bound on a spacing of 10 or 60, without the shown text", () => {
    // @rule R3
    for (const spacing of [10, 60]) {
      const pool: LivePoolGrid = { ...WETH_USDC, tickSpacing: spacing };
      for (const inverted of [false, true]) {
        const reference = inverted ? 1 / 3050 : 3050;
        for (const pct of RANGE_PRESETS) {
          const start = presetRange(pool, pct, inverted) as PoolRange;
          const shown = displayBounds(start, pool);
          for (const bound of BOUNDS) {
            const text = roundPrice(shown[bound], reference);
            expect(
              commitBoundInput(start, pool, bound, text),
              `spacing ${spacing} ±${pct} ${bound} inverted ${inverted}`,
            ).toEqual(start);
          }
        }
      }
    }
  });

  it("still snaps a value that differs from the shown text", () => {
    // @rule R3
    const pool: LivePoolGrid = { ...WETH_USDC, tickSpacing: 1 };
    const start = presetRange(pool, 10) as PoolRange;
    const shown = roundPrice(displayBounds(start, pool).min, 3050);
    const typedNow = commitBoundInput(start, pool, "min", "2900", shown);
    expect(typedNow).toEqual(commitBoundInput(start, pool, "min", "2900"));
    expect(typedNow.tickLower).toBe(Math.floor(priceToTick(2900, 18, 6)));
    expect(typedNow.tickUpper).toBe(start.tickUpper);
  });
});

describe("inversion", () => {
  it("keeps the canonical ticks and flips only the display flag", () => {
    // @rule R8
    const start = presetRange(WETH_USDC, 10) as PoolRange;
    expect(invertRange(start)).toEqual({ ...start, displayInverted: true });
    expect(invertRange(invertRange(start))).toEqual(start);
  });

  it("shows the reciprocals, swapped: the handoff's 0.000298 to 0.000364", () => {
    // @rule R8
    const start = presetRange(WETH_USDC, 10) as PoolRange;
    const shown = displayBounds(start, WETH_USDC);
    const flipped = displayBounds(invertRange(start), WETH_USDC);
    expect(flipped.min).toBeCloseTo(1 / shown.max, 12);
    expect(flipped.max).toBeCloseTo(1 / shown.min, 12);
    expect(flipped.min).toBeCloseTo(0.000298, 6);
    expect(flipped.max).toBeCloseTo(0.000364, 6);
  });

  it("swaps the two sides of the split and keeps the canonical shares", () => {
    // @rule R6, R8
    const start = presetRange(WETH_USDC, 10) as PoolRange;
    const split = rangeSplit(start, WETH_USDC);
    const flipped = rangeSplit(invertRange(start), WETH_USDC);
    expect(flipped?.pct0).toBe(split?.pct0);
    expect(flipped?.pct1).toBe(split?.pct1);
    expect(flipped?.basePct).toBe(split?.quotePct);
    expect(flipped?.quotePct).toBe(split?.basePct);
  });

  it("is symmetric for presets: the band read inverted mirrors the band of the mirrored pool", () => {
    // @rule R1, R8 (same decimals, so the mirrored pool's ticks are the negated ones)
    const stable: LivePoolGrid = {
      decimals0: 6,
      decimals1: 6,
      tickSpacing: 10,
      currentPrice: 1.0003,
    };
    const mirrored: LivePoolGrid = { ...stable, currentPrice: 1 / 1.0003 };
    for (const pct of RANGE_PRESETS) {
      const read = presetRange(stable, pct, true) as PoolRange;
      const mirror = presetRange(mirrored, pct, false) as PoolRange;
      // The typed-price snap floors before it rounds (V1, POO-319), so a mirror may sit one
      // spacing away, never more.
      expect(Math.abs(-read.tickUpper - mirror.tickLower), `±${pct}`).toBeLessThanOrEqual(10);
      expect(Math.abs(-read.tickLower - mirror.tickUpper), `±${pct}`).toBeLessThanOrEqual(10);
    }
  });
});

describe("status", () => {
  const range = presetRange(WETH_USDC, 10) as PoolRange;
  const shown = displayBounds(range, WETH_USDC);

  it("reads in range, below or above, bounds inclusive", () => {
    // @rule R5
    expect(rangeStatus(range, WETH_USDC)).toBe("in");
    expect(rangeStatus(range, { ...WETH_USDC, currentPrice: shown.min * 0.99 })).toBe("below");
    expect(rangeStatus(range, { ...WETH_USDC, currentPrice: shown.max * 1.01 })).toBe("above");
    expect(rangeStatus(range, { ...WETH_USDC, currentPrice: shown.min })).toBe("in");
    expect(rangeStatus(range, { ...WETH_USDC, currentPrice: shown.max })).toBe("in");
  });

  it("flips under inversion: canonical below reads above, canonical above reads below", () => {
    // @rule R5 (finding 24)
    const inverted = invertRange(range);
    expect(rangeStatus(inverted, { ...WETH_USDC, currentPrice: shown.min * 0.99 })).toBe("above");
    expect(rangeStatus(inverted, { ...WETH_USDC, currentPrice: shown.max * 1.01 })).toBe("below");
    expect(rangeStatus(inverted, WETH_USDC)).toBe("in");
  });

  it("reads always in range for Full", () => {
    // @rule R5
    expect(rangeStatus(fullPoolRange(WETH_USDC), WETH_USDC)).toBe("in");
    expect(rangeStatus(fullPoolRange(WETH_USDC, true), { ...WETH_USDC, currentPrice: 1e-30 })).toBe(
      "in",
    );
  });

  it("is null while the current price is unknown", () => {
    // @rule R5 (P13)
    expect(rangeStatus(range, WETH_USDC_GRID)).toBeNull();
  });
});

describe("split shares", () => {
  it("match the handoff's worked numbers at 3,050 on its 0.05% pool, within one point", () => {
    // @rule R6
    const cases = [
      { pct: 5, base: 49, quote: 51 },
      { pct: 10, base: 48, quote: 52 },
      { pct: 20, base: 45, quote: 55 },
    ] as const;
    for (const spacing of [1, 10, 50, 60]) {
      const pool = { ...WETH_USDC, tickSpacing: spacing };
      for (const { pct, base, quote } of cases) {
        const split = rangeSplit(presetRange(pool, pct) as PoolRange, pool);
        expect(
          Math.abs((split?.basePct ?? -9) - base),
          `spacing ${spacing} ±${pct}`,
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs((split?.quotePct ?? -9) - quote),
          `spacing ${spacing} ±${pct}`,
        ).toBeLessThanOrEqual(1);
      }
      const custom = commitBoundInput(
        commitBoundInput(presetRange(pool, 10) as PoolRange, pool, "min", "2600"),
        pool,
        "max",
        "3800",
      );
      const split = rangeSplit(custom, pool);
      expect(
        Math.abs((split?.basePct ?? -9) - 58),
        `spacing ${spacing} 2,600 to 3,800`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs((split?.quotePct ?? -9) - 42),
        `spacing ${spacing} 2,600 to 3,800`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it("hit the worked numbers exactly on the handoff's own pool (spacing 10)", () => {
    // @rule R6
    const reads = RANGE_PRESETS.map((pct) =>
      rangeSplit(presetRange(WETH_USDC, pct) as PoolRange, WETH_USDC),
    );
    expect(reads.map((split) => [split?.basePct, split?.quotePct])).toEqual([
      [49, 51],
      [48, 52],
      [45, 55],
    ]);
  });

  it("are whole percentages that sum to 100", () => {
    // @rule R6
    for (const pct of RANGE_PRESETS) {
      for (const inverted of [false, true]) {
        const split = rangeSplit(presetRange(WETH_USDC, pct, inverted) as PoolRange, WETH_USDC);
        for (const share of [split?.pct0, split?.pct1, split?.basePct, split?.quotePct]) {
          expect(Number.isInteger(share)).toBe(true);
        }
        expect((split?.pct0 ?? 0) + (split?.pct1 ?? 0)).toBe(100);
        expect((split?.basePct ?? 0) + (split?.quotePct ?? 0)).toBe(100);
      }
    }
  });

  it("put the whole position in one token outside the range", () => {
    // @rule R6
    const range = presetRange(WETH_USDC, 10) as PoolRange;
    const shown = displayBounds(range, WETH_USDC);
    expect(rangeSplit(range, { ...WETH_USDC, currentPrice: shown.min / 2 })).toEqual({
      pct0: 100,
      pct1: 0,
      basePct: 100,
      quotePct: 0,
    });
    expect(rangeSplit(range, { ...WETH_USDC, currentPrice: shown.max * 2 })).toEqual({
      pct0: 0,
      pct1: 100,
      basePct: 0,
      quotePct: 100,
    });
  });

  it("name the base token below the range and the quote token above it, read either way", () => {
    // @rule R5, R6 (finding 24: the one-token sentence follows the displayed status)
    const USDC_WETH: LivePoolGrid = {
      decimals0: 6,
      decimals1: 18,
      tickSpacing: 10,
      currentPrice: 1 / 3050,
    };
    for (const pool of [WETH_USDC, USDC_WETH]) {
      for (const inverted of [false, true]) {
        const range = presetRange(pool, 10, inverted) as PoolRange;
        const shown = displayBounds(range, pool);
        // A displayed price, as the manager reads it, turned back into the pool's canonical price.
        const at = (displayed: number): LivePoolGrid => ({
          ...pool,
          currentPrice: inverted ? 1 / displayed : displayed,
        });
        const label = `token0 decimals ${pool.decimals0}, inverted ${inverted}`;
        expect(rangeStatus(range, at(shown.min / 2)), label).toBe("below");
        expect(rangeSplit(range, at(shown.min / 2))?.basePct, label).toBe(100);
        expect(rangeStatus(range, at(shown.max * 2)), label).toBe("above");
        expect(rangeSplit(range, at(shown.max * 2))?.quotePct, label).toBe(100);
      }
    }
  });

  it("are 50 / 50 for Full", () => {
    // @rule R6
    for (const inverted of [false, true]) {
      expect(rangeSplit(fullPoolRange(WETH_USDC, inverted), WETH_USDC)).toEqual({
        pct0: 50,
        pct1: 50,
        basePct: 50,
        quotePct: 50,
      });
    }
  });

  it("are null while the current price is unknown", () => {
    // @rule R6 (P13)
    expect(rangeSplit(presetRange(WETH_USDC, 10) as PoolRange, WETH_USDC_GRID)).toBeNull();
  });
});

describe("on a bound", () => {
  const range = presetRange(WETH_USDC, 10) as PoolRange;
  const atLower: LivePoolGrid = { ...WETH_USDC, currentPrice: null, currentTick: range.tickLower };
  const atUpper: LivePoolGrid = { ...WETH_USDC, currentPrice: null, currentTick: range.tickUpper };

  it("reads in range with one side at 100%", () => {
    // @rule R5, R6 (finding 24)
    expect(rangeStatus(range, atLower)).toBe("in");
    expect(rangeSplit(range, atLower)).toEqual({ pct0: 100, pct1: 0, basePct: 100, quotePct: 0 });
    expect(rangeStatus(range, atUpper)).toBe("in");
    expect(rangeSplit(range, atUpper)).toEqual({ pct0: 0, pct1: 100, basePct: 0, quotePct: 100 });
  });

  it("puts the marker at the matching end of the range", () => {
    // @rule R7
    expect(rangeMarker(range, atLower)).toEqual({ position: 0, ratio: 0 });
    expect(rangeMarker(range, atUpper)).toEqual({ position: 1, ratio: 1 });
  });

  it("reads the same from the inverted side, with the ends swapped", () => {
    // @rule R5, R6, R7, R8
    const inverted = invertRange(range);
    expect(rangeStatus(inverted, atLower)).toBe("in");
    expect(rangeSplit(inverted, atLower)).toEqual({
      pct0: 100,
      pct1: 0,
      basePct: 0,
      quotePct: 100,
    });
    expect(rangeMarker(inverted, atLower)).toEqual({ position: 1, ratio: 1 });
    expect(rangeMarker(inverted, atUpper)).toEqual({ position: 0, ratio: 0 });
  });
});

describe("marker", () => {
  const range = presetRange(WETH_USDC, 10) as PoolRange;
  const shown = displayBounds(range, WETH_USDC);

  it("sits at (current - min) / (max - min) on the displayed scale", () => {
    // @rule R7
    const expected = (3050 - shown.min) / (shown.max - shown.min);
    expect(rangeMarker(range, WETH_USDC)?.position).toBeCloseTo(expected, 12);
    const inverted = invertRange(range);
    const flipped = displayBounds(inverted, WETH_USDC);
    const expectedInverted = (1 / 3050 - flipped.min) / (flipped.max - flipped.min);
    expect(rangeMarker(inverted, WETH_USDC)?.position).toBeCloseTo(expectedInverted, 12);
  });

  it("is clamped to [0, 1] outside the range, keeping the unclamped ratio beside it", () => {
    // @rule R7
    const below = rangeMarker(range, { ...WETH_USDC, currentPrice: shown.min * 0.9 });
    const above = rangeMarker(range, { ...WETH_USDC, currentPrice: shown.max * 1.1 });
    expect(below?.position).toBe(0);
    expect(below?.ratio).toBeLessThan(0);
    expect(above?.position).toBe(1);
    expect(above?.ratio).toBeGreaterThan(1);
  });

  it("is centred for Full and null while the price is unknown", () => {
    // @rule R7
    expect(rangeMarker(fullPoolRange(WETH_USDC), WETH_USDC)).toEqual({ position: 0.5, ratio: 0.5 });
    expect(rangeMarker(range, WETH_USDC_GRID)).toBeNull();
  });

  it("reaches the ends of the handoff's track only through ratio", () => {
    // @rule R7 (handoff split bar: a 200 wide track, the range segment from 40 to 160)
    const onTrack = (ratio: number) => Math.min(200, Math.max(0, 40 + 120 * ratio));
    // Strip 07, the ±10% range read inverted: the marker at 94.
    const strip07 = rangeMarker(invertRange(range), WETH_USDC) as RangeMarker;
    expect(Math.round(onTrack(strip07.ratio))).toBe(94);
    // Out of range the marker leaves the segment and stops at the end of the track.
    const below = rangeMarker(range, { ...WETH_USDC, currentPrice: shown.min / 2 }) as RangeMarker;
    const above = rangeMarker(range, { ...WETH_USDC, currentPrice: shown.max * 2 }) as RangeMarker;
    expect(onTrack(below.ratio)).toBe(0);
    expect(onTrack(above.ratio)).toBe(200);
    // `position` stops at the ends of the segment, so it cannot draw that marker.
    expect(40 + 120 * below.position).toBe(40);
    expect(40 + 120 * above.position).toBe(160);
  });
});

describe("Full", () => {
  it("is the finite aligned extremes of the pool's spacing, flagged full", () => {
    // @rule R1
    for (const spacing of [1, 10, 50, 60, 200]) {
      const grid = { decimals0: 18, decimals1: 6, tickSpacing: spacing };
      const range = fullPoolRange(grid);
      expectValid(range, grid);
      expect(range).toEqual({
        tickLower: Math.ceil(MIN_TICK / spacing) * spacing,
        tickUpper: Math.floor(MAX_TICK / spacing) * spacing,
        fullRange: true,
        displayInverted: false,
      });
    }
    expect(fullPoolRange(WETH_USDC, true).displayInverted).toBe(true);
    expect(presetRange(WETH_USDC, "full", true)).toEqual(fullPoolRange(WETH_USDC, true));
  });

  it("shows 0 to infinity in both orientations", () => {
    // @rule R1, R8
    expect(displayBounds(fullPoolRange(WETH_USDC), WETH_USDC)).toEqual({
      min: 0,
      max: Number.POSITIVE_INFINITY,
    });
    expect(displayBounds(fullPoolRange(WETH_USDC, true), WETH_USDC)).toEqual({
      min: 0,
      max: Number.POSITIVE_INFINITY,
    });
  });

  it("disables the four steppers, which then change nothing", () => {
    // @rule R4
    const full = fullPoolRange(WETH_USDC);
    expect(rangeSteppers(full, WETH_USDC)).toEqual({
      minDown: false,
      minUp: false,
      maxDown: false,
      maxUp: false,
    });
    for (const bound of BOUNDS) {
      for (const dir of DIRS) expect(stepBound(full, WETH_USDC, bound, dir)).toEqual(full);
    }
  });

  it("survives inversion as Full", () => {
    // @rule R8
    expect(invertRange(fullPoolRange(WETH_USDC))).toEqual(fullPoolRange(WETH_USDC, true));
  });
});

describe("numbers, not text", () => {
  it("returns plain numbers for every value the panel shows, for the UI to format", () => {
    // @rule R11
    const range = presetRange(WETH_USDC, 10) as PoolRange;
    const values = [
      ...Object.values(displayBounds(range, WETH_USDC)),
      ...Object.values(rangeSplit(range, WETH_USDC) ?? {}),
      ...Object.values(rangeMarker(range, WETH_USDC) ?? {}),
      range.tickLower,
      range.tickUpper,
    ];
    for (const value of values) expect(typeof value).toBe("number");
  });

  it("never stores a negative zero tick", () => {
    // @rule R11 (a tick survives a JSON round trip unchanged)
    // 0.9997 floors to tick -4, which rounds to the usable tick "minus zero" on a spacing of 10.
    const atZero: LivePoolGrid = { decimals0: 6, decimals1: 6, tickSpacing: 10, currentPrice: 1 };
    const range = commitBoundInput(presetRange(atZero, 10) as PoolRange, atZero, "max", "0.9997");
    expect(range.tickUpper).toBe(0);
    expect(Object.is(range.tickUpper, -0)).toBe(false);
    expect(JSON.parse(JSON.stringify(range))).toEqual(range);
  });
});
