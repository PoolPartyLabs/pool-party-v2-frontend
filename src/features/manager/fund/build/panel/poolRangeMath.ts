/**
 * @id PP-MGR-LIB-029
 * @name poolRangeMath
 * @implements-rules-version v1 (POO-2180 rules v1)
 * @analytics-events none (pure maths, no user surface)
 *
 * The price range maths of the Uniswap pool panel in the fund builder (handoff "Build configuration
 * panels" v1.2: "Uniswap pool block", "Configured" item 3 (Price range), P4, and the rows "Range
 * bounds" and "Split" of "What the deployed alpha and the v2 API change"). Slice PB of POO-2171.
 *
 * Everything runs on the POOL'S OWN GRID: its token decimals and its tick spacing, any positive
 * integer, as a Uniswap v4 pool key carries it. The result is what a pool block stores: canonical
 * `tickLower` and `tickUpper` (token1 per token0, aligned) plus `fullRange` and `displayInverted`,
 * the flat fields the launch adapter reads.
 *
 * - [R1] Presets ±5%, ±10% and ±20% are taken around the current price in the DISPLAYED
 *   orientation, as V1 does (±10% inverted is not the same tick pair as ±10% canonical), then
 *   snapped to usable ticks. Full is the finite aligned extremes, MIN_TICK and MAX_TICK aligned
 *   inward, flagged `fullRange`. The current price is read from the pool's price, else its tick.
 * - [R2] A stepper moves exactly one usable tick, in the displayed orientation.
 * - [R3] A typed bound is decimal-sanitised per keystroke and snaps to a usable tick on blur; an
 *   empty, zero or unreadable field leaves the range as it was (it snaps back).
 * - [R4] Max stays at least MIN_RANGE_SPACINGS (2) spacings above Min and inside the grid.
 *   {@link rangeSteppers} says which stepper would break that, so the UI disables it, and every
 *   function returns a valid range (P4). A preset that snaps narrower than the minimum on a very
 *   coarse grid becomes the minimum range around the current price.
 * - [R5] The status (in range, below, above; bounds inclusive) is computed canonically by
 *   `getRangeStatus` and REPORTED in the displayed orientation: canonical "below" reads "above"
 *   when the quote is inverted (finding 24).
 * - [R6] The split is the estimated value split at the current price from `tokenSplit`, as whole
 *   percentages that sum to 100: one side is 100% outside the range and exactly on a bound (where
 *   the status still reads in range), and Full is 50 / 50.
 * - [R7] The marker sits at (current - min) / (max - min) on the displayed scale, clamped to
 *   [0, 1], or 0.5 for Full. The unclamped ratio is returned beside it, because the handoff lets
 *   the marker leave the range segment and stop at the end of the track.
 * - [R8] Inverting the quote flips only `displayInverted`; display values come through
 *   `invertPrice.ts` (`toDisplayBounds`, `toCanonicalBounds`, `invert`).
 * - [R9] Reused unchanged: `invertPrice.ts`, `rangeMath.ts` `tokenSplit`, `rangeStatus.ts`
 *   `getRangeStatus`, `presets.ts` `RANGE_PRESETS`, and from `tick.ts` only the primitives that
 *   take a spacing or no fee (`nearestUsableTick`, `tickToPrice`, `priceToTick`, `MIN_TICK`,
 *   `MAX_TICK`, `MIN_RANGE_SPACINGS`).
 * - [R10] Never used: `poolTickSnap.ts`, `tickSpacing(feeBps)` and the fee-keyed helpers of
 *   `tick.ts`. They know only the four Uniswap v3 tiers and answer 60 for any other fee, so a
 *   0.25% pool of spacing 50 would snap on 60 (finding 12). The typed-price snap below is V1's
 *   formula (floor the tick, then the nearest usable tick, POO-319) on the pool's own spacing,
 *   and the tests hold it to V1's results on the four v3 tiers.
 * - [R11] Numbers only. Formatting belongs to the UI: `fmtPrice` is en-US only (finding 27).
 *
 * A grid whose spacing is not a positive integer, or is too wide to hold a minimum range, throws
 * a RangeError: the catalog schema rules it out, and a silent fallback is what finding 12 is about.
 */

import {
  MAX_TICK,
  MIN_RANGE_SPACINGS,
  MIN_TICK,
  nearestUsableTick,
  priceToTick,
  tickToPrice,
} from "@/lib/uniswap/tick";
import { sanitizeNumericInput } from "@/lib/utils/numericInput";
import { getRangeStatus, type RangeStatus } from "@/lib/utils/rangeStatus";
import { type Bounds, invert, toCanonicalBounds, toDisplayBounds } from "../../../lib/invertPrice";
import type { RANGE_PRESETS } from "../../../lib/presets";
import { tokenSplit } from "../../../lib/rangeMath";

/** A Uniswap pool's tick grid, from the pool itself (its key and its tokens), never a fee tier. */
export interface PoolGrid {
  /** Decimals of token0, the base of the canonical price. */
  decimals0: number;
  /** Decimals of token1, the quote of the canonical price. */
  decimals1: number;
  /** The pool's tick spacing: any positive integer (a Uniswap v4 pool key sets its own). */
  tickSpacing: number;
}

/** A pool grid with where the price is now (the panel's live read). Either value may be missing. */
export interface LivePoolGrid extends PoolGrid {
  /** The current canonical price, token1 per token0. Preferred when known: it is exact. */
  currentPrice?: number | null;
  /** The current tick. The price is derived from it when `currentPrice` is missing. */
  currentTick?: number | null;
}

/** What a pool block stores for its price range: canonical ticks plus two flags. */
export interface PoolRange {
  /** Lower canonical tick (token1 per token0), aligned to the pool's spacing. */
  tickLower: number;
  /** Upper canonical tick, aligned, at least MIN_RANGE_SPACINGS spacings above the lower one. */
  tickUpper: number;
  /** The Full preset: the ticks are the finite aligned extremes of the grid. */
  fullRange: boolean;
  /** The manager reads the quote inverted (token0 per token1). Display only. */
  displayInverted: boolean;
}

/** A preset chip: ±5%, ±10%, ±20% or Full. */
export type RangePreset = (typeof RANGE_PRESETS)[number] | "full";

/** The preset of a pool block after Use and after a pool change: ±10% (handoff, Price range). */
export const DEFAULT_RANGE_PRESET = 10 satisfies RangePreset;

/** A bound as the manager sees it: the Min or the Max field, in the displayed orientation. */
export type DisplayBound = "min" | "max";

/** A stepper press: plus raises the displayed value, minus lowers it. */
export type StepDirection = 1 | -1;

/** Which of the four steppers can move. False means the UI disables it (R4). */
export interface RangeSteppers {
  minDown: boolean;
  minUp: boolean;
  maxDown: boolean;
  maxUp: boolean;
}

/** The estimated value split of the position at the current price, in whole percent (R6). */
export interface RangeSplit {
  /** Share of token0. */
  pct0: number;
  /** Share of token1. `pct0 + pct1` is 100. */
  pct1: number;
  /** Share of the displayed base token (token0, or token1 when inverted): the bar's left side. */
  basePct: number;
  /** Share of the displayed quote token: the bar's right side. `basePct + quotePct` is 100. */
  quotePct: number;
}

/** Where the current price marker sits along the displayed range (R7). */
export interface RangeMarker {
  /** (current - min) / (max - min), clamped to [0, 1]; 0.5 for Full. */
  position: number;
  /** The same ratio before the clamp: under 0 below the range, over 1 above it. */
  ratio: number;
}

interface Grid {
  minTick: number;
  maxTick: number;
  spacing: number;
  width: number;
}

/** -0 reads as 0, so a stored tick compares equal to itself after a JSON round trip. */
function plain(tick: number): number {
  return tick === 0 ? 0 : tick;
}

function makeRange(
  tickLower: number,
  tickUpper: number,
  fullRange: boolean,
  displayInverted: boolean,
): PoolRange {
  return { tickLower: plain(tickLower), tickUpper: plain(tickUpper), fullRange, displayInverted };
}

function gridOf(grid: PoolGrid): Grid {
  const { minTick, maxTick } = usableTickBounds(grid.tickSpacing);
  return {
    minTick,
    maxTick,
    spacing: grid.tickSpacing,
    width: MIN_RANGE_SPACINGS * grid.tickSpacing,
  };
}

/** V1's snap for a free-form price (POO-319: floor the tick, then the nearest usable tick). */
function snapPrice(price: number, grid: PoolGrid): number {
  const tick = Math.floor(priceToTick(price, grid.decimals0, grid.decimals1));
  return nearestUsableTick(tick, grid.tickSpacing);
}

/**
 * The canonical tick a displayed bound moves, and which way it moves for a displayed direction.
 * Inverted, the displayed Min is the reciprocal of the canonical upper price, and raising a
 * reciprocal lowers the price, so both the side and the direction flip.
 */
function canonicalEdit(
  bound: DisplayBound,
  dir: StepDirection,
  inverted: boolean,
): { side: "lower" | "upper"; dir: StepDirection } {
  if (!inverted) return { side: bound === "min" ? "lower" : "upper", dir };
  return { side: bound === "min" ? "upper" : "lower", dir: dir === 1 ? -1 : 1 };
}

function canonicalPrices(range: PoolRange, grid: PoolGrid): Bounds {
  return {
    min: tickToPrice(range.tickLower, grid.decimals0, grid.decimals1),
    max: tickToPrice(range.tickUpper, grid.decimals0, grid.decimals1),
  };
}

function shares(pct1: number, inverted: boolean): RangeSplit {
  const pct0 = 100 - pct1;
  return inverted
    ? { pct0, pct1, basePct: pct1, quotePct: pct0 }
    : { pct0, pct1, basePct: pct0, quotePct: pct1 };
}

/**
 * The finite ends of the grid for a tick spacing: MIN_TICK and MAX_TICK aligned inward (R1).
 *
 * @throws RangeError when the spacing is not a positive integer, or is so wide that the grid
 *   cannot hold a range of MIN_RANGE_SPACINGS spacings.
 */
export function usableTickBounds(tickSpacing: number): { minTick: number; maxTick: number } {
  if (!Number.isInteger(tickSpacing) || tickSpacing < 1) {
    throw new RangeError(`A pool's tick spacing is a positive integer, not ${tickSpacing}.`);
  }
  const minTick = nearestUsableTick(MIN_TICK, tickSpacing);
  const maxTick = nearestUsableTick(MAX_TICK, tickSpacing);
  if (maxTick - minTick < MIN_RANGE_SPACINGS * tickSpacing) {
    throw new RangeError(`A tick spacing of ${tickSpacing} leaves no valid range on the grid.`);
  }
  return { minTick, maxTick };
}

/**
 * The current canonical price (token1 per token0): the pool's price when it is a positive number,
 * else the price of its current tick, else null while neither is known.
 */
export function currentPoolPrice(pool: LivePoolGrid): number | null {
  const { currentPrice, currentTick } = pool;
  if (currentPrice != null && Number.isFinite(currentPrice) && currentPrice > 0) {
    return currentPrice;
  }
  if (currentTick != null && Number.isFinite(currentTick)) {
    const price = tickToPrice(currentTick, pool.decimals0, pool.decimals1);
    if (Number.isFinite(price) && price > 0) return price;
  }
  return null;
}

/** The Full range: the finite aligned extremes of the pool's grid, flagged `fullRange` (R1). */
export function fullPoolRange(grid: PoolGrid, displayInverted = false): PoolRange {
  const { minTick, maxTick } = gridOf(grid);
  return makeRange(minTick, maxTick, true, displayInverted);
}

/**
 * The range of a preset chip (R1). ±pct is taken around the current price as the manager reads
 * it (inverted or not), converted to canonical bounds and snapped to usable ticks. Null until the
 * pool's price is known, except Full, which needs no price.
 */
export function presetRange(
  pool: LivePoolGrid,
  preset: RangePreset,
  displayInverted = false,
): PoolRange | null {
  if (preset === "full") return fullPoolRange(pool, displayInverted);
  const grid = gridOf(pool);
  const current = currentPoolPrice(pool);
  if (current === null) return null;
  const shown = displayInverted ? invert(current) : current;
  const band = toCanonicalBounds(
    shown * (1 - preset / 100),
    shown * (1 + preset / 100),
    displayInverted,
  );
  const lower = snapPrice(band.min, pool);
  const upper = snapPrice(band.max, pool);
  if (upper - lower >= grid.width) return makeRange(lower, upper, false, displayInverted);
  // A grid so coarse that the band snapped narrower than the minimum (R4): the minimum range,
  // centred on the usable tick nearest the current price and kept on the grid.
  const centre = nearestUsableTick(
    priceToTick(current, pool.decimals0, pool.decimals1),
    grid.spacing,
  );
  const below = Math.floor(MIN_RANGE_SPACINGS / 2) * grid.spacing;
  const start = Math.min(Math.max(centre - below, grid.minTick), grid.maxTick - grid.width);
  return makeRange(start, start + grid.width, false, displayInverted);
}

/** The same range read the other way: the ticks stay, only `displayInverted` flips (R8). */
export function invertRange(range: PoolRange): PoolRange {
  return { ...range, displayInverted: !range.displayInverted };
}

/**
 * The Min and Max the fields show, in the displayed orientation (R8): the prices of the canonical
 * ticks, reciprocated and swapped when inverted. Full shows 0 and infinity in both orientations.
 */
export function displayBounds(range: PoolRange, grid: PoolGrid): Bounds {
  if (range.fullRange) return { min: 0, max: Number.POSITIVE_INFINITY };
  const canonical = canonicalPrices(range, grid);
  return toDisplayBounds(canonical.min, canonical.max, range.displayInverted);
}

/** One stepper press, or null when it would leave the grid or break the minimum width (R2, R4). */
function stepped(
  range: PoolRange,
  grid: PoolGrid,
  bound: DisplayBound,
  dir: StepDirection,
): PoolRange | null {
  if (range.fullRange) return null;
  const { minTick, maxTick, spacing, width } = gridOf(grid);
  const edit = canonicalEdit(bound, dir, range.displayInverted);
  const move = edit.dir * spacing;
  const lower = edit.side === "lower" ? range.tickLower + move : range.tickLower;
  const upper = edit.side === "upper" ? range.tickUpper + move : range.tickUpper;
  if (lower < minTick || upper > maxTick || upper - lower < width) return null;
  return makeRange(lower, upper, false, range.displayInverted);
}

/**
 * Press a stepper of the Min or Max field (R2): the displayed value moves by exactly one usable
 * tick. A press the clamp forbids, and any press on Full, returns the range unchanged (R4).
 */
export function stepBound(
  range: PoolRange,
  grid: PoolGrid,
  bound: DisplayBound,
  dir: StepDirection,
): PoolRange {
  return stepped(range, grid, bound, dir) ?? range;
}

/** Which steppers can move (R4). All four are disabled on Full. */
export function rangeSteppers(range: PoolRange, grid: PoolGrid): RangeSteppers {
  return {
    minDown: stepped(range, grid, "min", -1) !== null,
    minUp: stepped(range, grid, "min", 1) !== null,
    maxDown: stepped(range, grid, "max", -1) !== null,
    maxUp: stepped(range, grid, "max", 1) !== null,
  };
}

/**
 * Clean one keystroke of a Min or Max field (R3): digits and one decimal point. The locale's own
 * separator reads as that point and the other one is dropped as grouping, so the text that comes
 * back always uses ".".
 */
export function sanitizeBoundInput(text: string, decimalSeparator = "."): string {
  return sanitizeNumericInput(text, { decimalSeparator });
}

/**
 * Commit a typed Min or Max when the field loses focus (R3, R4). `text` is the field as
 * {@link sanitizeBoundInput} left it. The value is read in the displayed orientation, snapped to a
 * usable tick and pinned at least MIN_RANGE_SPACINGS spacings off the other bound. An empty, zero
 * or unreadable field returns the range unchanged. From Full, the other bound stays at the edge of
 * the grid and the range is no longer full.
 *
 * Pass `shownText`, the text the field displayed for this bound: when `text` is still that text,
 * the field was not edited and the range comes back unchanged. Without it, re-snapping a shown
 * price can move an untouched bound one tick on a spacing-1 pool, because the typed-price snap
 * floors (V1, POO-319), and the panel would read "Changes not applied" with no edit (P5).
 */
export function commitBoundInput(
  range: PoolRange,
  grid: PoolGrid,
  bound: DisplayBound,
  text: string,
  shownText?: string,
): PoolRange {
  if (shownText !== undefined && text.trim() === shownText.trim()) return range;
  const value = Number.parseFloat(sanitizeNumericInput(text));
  if (!(Number.isFinite(value) && value > 0)) return range;
  const { width } = gridOf(grid);
  const { side } = canonicalEdit(bound, 1, range.displayInverted);
  const tick = snapPrice(range.displayInverted ? invert(value) : value, grid);
  return side === "lower"
    ? makeRange(
        Math.min(tick, range.tickUpper - width),
        range.tickUpper,
        false,
        range.displayInverted,
      )
    : makeRange(
        range.tickLower,
        Math.max(tick, range.tickLower + width),
        false,
        range.displayInverted,
      );
}

/**
 * In range, below or above (R5), bounds inclusive, as the manager reads it: computed canonically
 * by `getRangeStatus`, then below and above swap when the quote is inverted. Full is always in
 * range. Null while the current price is unknown.
 */
export function rangeStatus(range: PoolRange, pool: LivePoolGrid): RangeStatus | null {
  if (range.fullRange) return "in";
  const current = currentPoolPrice(pool);
  if (current === null) return null;
  const canonical = canonicalPrices(range, pool);
  const status = getRangeStatus(current, {
    full: false,
    minPrice: canonical.min,
    maxPrice: canonical.max,
  });
  if (!range.displayInverted || status === null || status === "in") return status;
  return status === "below" ? "above" : "below";
}

/**
 * The estimated value split at the current price (R6), from `tokenSplit`, in whole percent.
 * Outside the range, and exactly on a bound, one side holds 100%; Full is 50 / 50. Null while the
 * current price is unknown (Full needs none).
 */
export function rangeSplit(range: PoolRange, pool: LivePoolGrid): RangeSplit | null {
  // Full reads 50 / 50, as `tokenSplit` reads it, with no price needed.
  if (range.fullRange) return shares(50, range.displayInverted);
  const current = currentPoolPrice(pool);
  if (current === null) return null;
  const canonical = canonicalPrices(range, pool);
  const split = tokenSplit(current, canonical.min, canonical.max);
  return shares(Math.round(split.pct1), range.displayInverted);
}

/**
 * Where the current price marker sits on the displayed range (R7). Null while the current price is
 * unknown; centred for Full.
 */
export function rangeMarker(range: PoolRange, pool: LivePoolGrid): RangeMarker | null {
  if (range.fullRange) return { position: 0.5, ratio: 0.5 };
  const current = currentPoolPrice(pool);
  if (current === null) return null;
  const shown = range.displayInverted ? invert(current) : current;
  const bounds = displayBounds(range, pool);
  const ratio = (shown - bounds.min) / (bounds.max - bounds.min);
  return { position: Math.min(1, Math.max(0, ratio)), ratio };
}
