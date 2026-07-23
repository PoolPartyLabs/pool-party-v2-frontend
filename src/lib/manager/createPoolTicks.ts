/**
 * @id PP-MGR (POO-306, POO-860, POO-900)
 * @name createPoolTicks
 * @implements-rules-version v3 (POO-900 rules v1)
 *
 * Resolve the create-pool tick bounds from the manager's range selection: full-range (the widest
 * usable ticks) when `full`, otherwise the entered min/max price snapped to the fee tier's tick
 * spacing. Previously `useCreatePool` always used full-range and ignored the BuildStep range; this
 * makes a concentrated (ranged) position honor the selection, mirroring the v1 interface's
 * `isFullRange` toggle. Pure (no React/RPC) so the tick math is unit-tested independently.
 *
 * POO-860 R3: a non-full range must span at least {@link MIN_RANGE_SPACINGS} usable-tick spacings;
 * anything narrower (or that collapses to one tick after snapping) resolves to null. The Build-step
 * UI guard enforces the same minimum before Review so the manager never reaches the silent gate.
 *
 * POO-900 R3 (gate/mint width contract): the bound ticks are RECOVERED by rounding
 * (priceToNearestUsableTick, the POO-877/POO-900 resolver the UI gate measures with), not by the
 * POO-319 floor. The prices arriving here are the BuildStep's canonical bounds - already floor-
 * SNAPPED to exact tick prices at input time (snapPriceForPool), then display-rounded by the
 * tick-aware roundPrice - so rounding recovers exactly the ticks the UI gated on, while flooring
 * read a display-rounded bound one tick low on spacing-1 pools (raw tick of 1.0002 is ~1.9999) and
 * rejected a UI-valid exactly-2-spacing range. The POO-319 floor stays at the typed-price snap.
 */
import { fullRangeTicks } from "./fullRangeTicks";
import { MIN_RANGE_SPACINGS, priceToNearestUsableTick, tickSpacing } from "./tickPrice";

/** The manager's price-range selection (full-range, or a min/max in token1-per-token0). */
export interface RangeSelection {
  full: boolean;
  /** Lower price bound (token1 per token0). Ignored when `full`. */
  minPrice: number | null;
  /** Upper price bound (token1 per token0). Ignored when `full`. */
  maxPrice: number | null;
}

/** Spacing-aligned tick bounds for a create-pool position. */
export interface PoolTicks {
  tickLower: number;
  tickUpper: number;
}

/**
 * Compute the tick bounds for create-pool.
 *
 * @returns The spacing-aligned `{ tickLower, tickUpper }`, or `null` when a non-full range is
 *   incomplete or degenerate (min/max missing, non-positive, inverted, or narrower than
 *   {@link MIN_RANGE_SPACINGS} usable-tick spacings after snapping) — the caller gates Launch on a
 *   non-null result.
 */
export function createPoolTicks(
  range: RangeSelection,
  decimals0: number,
  decimals1: number,
  feeBps: number,
): PoolTicks | null {
  if (range.full) return fullRangeTicks(feeBps);

  const { minPrice, maxPrice } = range;
  if (minPrice == null || maxPrice == null) return null;
  if (!(minPrice > 0) || !(maxPrice > minPrice)) return null;

  // Price increases with tick (token1 per token0), so minPrice → lower tick, maxPrice → upper tick.
  // POO-900 R3: ROUND recovery - these bounds are display-round-tripped exact tick prices (the
  // typed-price floor already ran in the range editor), so this resolves the same ticks the UI
  // gate (isRangeWideEnough) accepted.
  const tickLower = priceToNearestUsableTick(minPrice, decimals0, decimals1, feeBps);
  const tickUpper = priceToNearestUsableTick(maxPrice, decimals0, decimals1, feeBps);
  // POO-860 R3: require at least MIN_RANGE_SPACINGS usable-tick spacings between the bounds. A
  // narrower range (or one that collapses to a single tick after snapping) is rejected rather than
  // minting a degenerate position; the Build-step UI guard enforces the same threshold up front.
  if (tickUpper - tickLower < MIN_RANGE_SPACINGS * tickSpacing(feeBps)) return null;
  return { tickLower, tickUpper };
}
