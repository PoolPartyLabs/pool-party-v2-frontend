/**
 * @id PP-MGR (POO-306)
 * @name Full-range ticks
 * @implements-rules-version v1
 *
 * Uniswap v3 full-range tick bounds for create-pool: the widest usable ticks aligned to the fee
 * tier's tick spacing. The shared tick primitives (spacing, bounds, nearestUsableTick) live in
 * `tickPrice` (POO-282); this module just applies them to the MIN/MAX bounds. `tickSpacing` is
 * re-exported so existing importers keep working.
 *
 * POO-518 R1 adds `fullRangePrices`: the human price bounds those ticks execute at (tickToPrice,
 * respecting token decimals), so a full-range move reports the bounds it actually applied instead
 * of echoing the position's previous band.
 */
import { MAX_TICK, MIN_TICK, nearestUsableTick, tickSpacing, tickToPrice } from "./tickPrice";

export { tickSpacing };

/** The full-range tick bounds for a fee tier. */
export function fullRangeTicks(feeBps: number): { tickLower: number; tickUpper: number } {
  const spacing = tickSpacing(feeBps);
  return {
    tickLower: nearestUsableTick(MIN_TICK, spacing),
    tickUpper: nearestUsableTick(MAX_TICK, spacing),
  };
}

/**
 * The prices (token1 per 1 token0) at the full-range tick bounds, respecting the tokens' decimals
 * (POO-518 R1). These are the bounds a full-range move/mint actually executes at, so a full move
 * reports them rather than echoing the previous band. A same-decimals pair reads the raw
 * `1.0001^tick` bounds; a decimals gap shifts them by `10^(decimals0 - decimals1)` (tickToPrice).
 */
export function fullRangePrices(
  feeBps: number,
  decimals0: number,
  decimals1: number,
): { minPrice: number; maxPrice: number } {
  const { tickLower, tickUpper } = fullRangeTicks(feeBps);
  return {
    minPrice: tickToPrice(tickLower, decimals0, decimals1),
    maxPrice: tickToPrice(tickUpper, decimals0, decimals1),
  };
}
