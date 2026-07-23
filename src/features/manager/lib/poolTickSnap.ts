/**
 * @id PP-MGR (POO-408)
 * @name poolTickSnap
 * @implements-rules-version v3 (POO-877 + POO-881 + POO-900 rules v1)
 *
 * POO-877 (rules v1): stepPriceForPool resolves the starting tick by rounding (POO-877 tick fix), so
 * the shared ± steppers never lock on a fixed point on tickSpacing-1 pools. POO-881 (rules v1, R5/R6):
 * clampRangeBound pins an edited canonical bound off the opposite one, so a blur snap-back or a ± step
 * can never invert / over-narrow the range (input-level enforcement on top of the POO-860 CTA gate).
 * POO-900 (rules v1, R3/R4): the pin sits at EXACTLY MIN_RANGE_SPACINGS and both the pin anchor and
 * the width measure resolve ticks by ROUNDING (priceToNearestUsableTick), so the clamp's pin target
 * and its acceptance threshold agree - the 3-tick sawtooth at the boundary is gone. The mint paths
 * (createPoolTicks, useMoveRange) RECOVER their ticks with the same round resolver, so a gate-accepted
 * range always mints at the gated width; the POO-319 floor stays where typed prices are SNAPPED
 * (snapPriceForPool / snapPriceToUsableTick), not where ticks are measured or recovered.
 *
 * One decision shared by every manager range input (BuildStep, MoveRangeModal): snap a canonical
 * price (token1 per token0) onto the pool's usable-tick grid, and step it by one usable tick. When
 * the pool's token decimals are known (real mode), snap to the EXACT on-chain tick price via
 * `snapPriceToUsableTick`/`stepPriceByTick` — so the value the manager sees equals the tick that
 * mints/rebalances [R2]. When decimals are unknown (mock catalog), fall back to the current-price-
 * anchored grid (`snapToTickGrid`/`stepOnTickGrid`), which is still spacing-valid. The
 * `currentPrice > Number.MIN_VALUE` guards below leave a price-less input untouched — a defensive
 * no-op that also serves MoveRangeModal (live positions). POO-497 retired the manager create-new-pool
 * (no-price) case: the builder picker now offers only pools with a defined market price.
 */
import {
  MIN_RANGE_SPACINGS,
  priceToNearestUsableTick,
  snapPriceToUsableTick,
  stepPriceByTick,
  tickSpacing,
  tickToPrice,
} from "@/lib/manager/tickPrice";
import { snapToTickGrid, stepOnTickGrid } from "./rangeMath";

/** The pool fields the tick grid needs. Decimals are present in real mode, absent on mock data. */
export interface PoolTickGrid {
  /** Current pool price, token1 per token0 (the create-pool sentinel is `Number.MIN_VALUE`). */
  currentPrice: number;
  /** Fee tier in basis points (drives the tick spacing). */
  feeBps: number;
  /** token0 decimals — enables the exact on-chain snap when set. */
  decimals0?: number;
  /** token1 decimals — enables the exact on-chain snap when set. */
  decimals1?: number;
}

/** Whether the exact (decimals-based, absolute-grid) snap is available. */
function hasDecimals(
  grid: PoolTickGrid,
): grid is PoolTickGrid & { decimals0: number; decimals1: number } {
  return grid.decimals0 != null && grid.decimals1 != null;
}

/**
 * Snap a canonical price onto the pool's usable-tick grid. Exact (on-chain tick) when decimals are
 * known; relative grid otherwise; unchanged when neither decimals nor a real market price exist.
 * A non-positive price is returned unchanged.
 */
export function snapPriceForPool(price: number, grid: PoolTickGrid): number {
  if (!(price > 0)) return price;
  if (hasDecimals(grid)) {
    return snapPriceToUsableTick(price, grid.decimals0, grid.decimals1, grid.feeBps);
  }
  if (grid.currentPrice > Number.MIN_VALUE) {
    return snapToTickGrid(price, grid.currentPrice, grid.feeBps);
  }
  return price;
}

/**
 * Step a canonical price by exactly one usable tick (`dir`), snapping onto the grid first. Exact when
 * decimals are known; relative grid otherwise; unchanged when neither is available.
 */
export function stepPriceForPool(price: number, grid: PoolTickGrid, dir: 1 | -1): number {
  if (hasDecimals(grid)) {
    return stepPriceByTick(price, grid.decimals0, grid.decimals1, grid.feeBps, dir);
  }
  if (grid.currentPrice > Number.MIN_VALUE) {
    return stepOnTickGrid(price, grid.currentPrice, grid.feeBps, dir);
  }
  return price;
}

/**
 * The number of usable-tick spacings between two canonical bounds on the pool's grid (POO-860). Exact
 * (on-chain ticks) when decimals are known, else measured on the current-price-anchored relative grid.
 * Negative when the bounds are inverted, 0 when they collapse to the same tick. Returns null when a
 * bound is non-positive/NaN, or when the grid can resolve neither ticks nor a relative step (no
 * decimals AND no market price — a price-less pool, already filtered from the picker).
 *
 * POO-900 R3: both bounds resolve to their NEAREST usable tick (round, the POO-877 stepper resolver) -
 * a display-rounded exact-tick price sits < 0.5 tick from its true tick, so the measure recovers it
 * losslessly, where the POO-319 floor dropped a whole tick on spacing-1 pools and made the width read
 * one short. The floor stays at the typed-price SNAP (snapPriceForPool), which is where POO-319's SDK
 * parity matters. The mint paths (createPoolTicks, useMoveRange's build) recover their ticks with the
 * SAME round resolver, so a range this gate accepts resolves to exactly the gated ticks at mint
 * (gate/mint width contract - a UI-valid exactly-2-spacing range can never mint one spacing short).
 */
export function rangeSpacingsForPool(
  minPrice: number,
  maxPrice: number,
  grid: PoolTickGrid,
): number | null {
  if (!(minPrice > 0) || !(maxPrice > 0)) return null;
  const spacing = tickSpacing(grid.feeBps);
  if (hasDecimals(grid)) {
    const lo = priceToNearestUsableTick(minPrice, grid.decimals0, grid.decimals1, grid.feeBps);
    const hi = priceToNearestUsableTick(maxPrice, grid.decimals0, grid.decimals1, grid.feeBps);
    return (hi - lo) / spacing;
  }
  if (grid.currentPrice > Number.MIN_VALUE) {
    const f = 1.0001 ** spacing;
    const kLo = Math.round(Math.log(minPrice / grid.currentPrice) / Math.log(f));
    const kHi = Math.round(Math.log(maxPrice / grid.currentPrice) / Math.log(f));
    return kHi - kLo;
  }
  return null;
}

/**
 * Whether a min/max range spans at least {@link MIN_RANGE_SPACINGS} usable-tick spacings on the pool's
 * grid (POO-860 R1/R2). False for an equal, inverted, too-tight, incomplete, or unresolvable range —
 * the Build/Move-Range UI gate the Apply/Next controls (and show the inline error) on this, matching
 * the create-pool tick backstop (`createPoolTicks`).
 */
export function isRangeWideEnough(minPrice: number, maxPrice: number, grid: PoolTickGrid): boolean {
  const spacings = rangeSpacingsForPool(minPrice, maxPrice, grid);
  return spacings !== null && spacings >= MIN_RANGE_SPACINGS;
}

/**
 * Clamp a canonical bound so the [min, max] range keeps at least {@link MIN_RANGE_SPACINGS} usable-tick
 * width against the fixed `opposite` bound (POO-881 R5/R6, POO-900 R4). `which` names the bound being
 * edited. Returns `candidate` unchanged when it already clears the minimum width
 * ({@link isRangeWideEnough}) or when `opposite` is not a usable positive price (nothing to clamp
 * against). Otherwise pins the edited bound EXACTLY {@link MIN_RANGE_SPACINGS} spacings off the
 * opposite one (min below, max above) - the boundary value itself, the minimum the width check accepts.
 *
 * The pin is anchored on the opposite bound's tick as the width check resolves it - ROUND
 * (`priceToNearestUsableTick`, POO-877/POO-900 R3) in real mode, the relative-grid round in mock mode
 * (matching {@link rangeSpacingsForPool}) - so pin target and acceptance threshold agree. POO-881
 * pinned one spacing PAST the minimum because the then-floor-based measure could re-read an exact-2
 * pin at width 1 after the display round-trip; that mismatch (accept at 2, pin at 3) made the
 * narrowing stepper sawtooth across 3 ticks at the boundary (POO-900). With the round resolver the
 * exact-tick pin re-measures at exactly 2 after display rounding (roundPrice is tick-aware, POO-900
 * R8), so the pin is stable/idempotent. Both grid modes; canonical space, so orientation is handled
 * by the caller.
 */
export function clampRangeBound(
  candidate: number,
  opposite: number,
  which: "min" | "max",
  grid: PoolTickGrid,
): number {
  if (!(candidate > 0) || !(opposite > 0)) return candidate;
  const lo = which === "min" ? candidate : opposite;
  const hi = which === "min" ? opposite : candidate;
  if (isRangeWideEnough(lo, hi, grid)) return candidate;
  const delta = which === "min" ? -MIN_RANGE_SPACINGS : MIN_RANGE_SPACINGS;
  const spacing = tickSpacing(grid.feeBps);
  if (hasDecimals(grid)) {
    const oppTick = priceToNearestUsableTick(opposite, grid.decimals0, grid.decimals1, grid.feeBps);
    return tickToPrice(oppTick + delta * spacing, grid.decimals0, grid.decimals1);
  }
  if (grid.currentPrice > Number.MIN_VALUE) {
    const f = 1.0001 ** spacing;
    const k = Math.round(Math.log(opposite / grid.currentPrice) / Math.log(f)) + delta;
    return grid.currentPrice * f ** k;
  }
  return candidate;
}

/**
 * Default buffer (usable ticks) below which a single-sided range is flagged as close to the current
 * price (POO-861 R4). Tunable — within this many ticks a small price move can pull the current price
 * into the range and require BOTH seed tokens (turning a mono-asset create into a two-token one).
 */
export const MONO_ASSET_WARN_TICKS = 3;

/**
 * Whether the chosen range is single-sided (the current price sits OUTSIDE [min, max], so only one
 * token seeds it) AND its nearest boundary is within `bufferTicks` usable ticks of the current price
 * (POO-861 R4). In that band a small price move crosses into the range and the create then needs both
 * tokens — so the builder surfaces a non-blocking warning. False for a full/two-sided/degenerate range
 * or a comfortably-buffered single-sided one. `currentPrice` is the LIVE price (POO-861 R2), not the
 * possibly-stale grid anchor.
 */
export function isSingleSidedNearPrice(
  currentPrice: number,
  minPrice: number | null,
  maxPrice: number | null,
  full: boolean,
  grid: PoolTickGrid,
  bufferTicks: number = MONO_ASSET_WARN_TICKS,
): boolean {
  if (full || minPrice == null || maxPrice == null) return false;
  if (!(currentPrice > 0) || !(minPrice > 0) || !(maxPrice > minPrice)) return false;
  // In range → two-sided seed, nothing to warn about.
  if (currentPrice >= minPrice && currentPrice <= maxPrice) return false;
  // Single-sided: measure the gap (usable ticks) from the current price to the NEAR boundary.
  const [lo, hi] = currentPrice < minPrice ? [currentPrice, minPrice] : [maxPrice, currentPrice];
  const gap = rangeSpacingsForPool(lo, hi, grid);
  return gap !== null && gap <= bufferTicks;
}
