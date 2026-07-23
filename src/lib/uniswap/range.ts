/**
 * @id PP-CORE-LIB-020 (POO-282)
 * @name uniswapRange
 * @implements-rules-version v1
 *
 * Position tick bounds → human price range (token1 per token0), plus tick-space membership. Used by
 * the detailed position / move-range / create-pool views to render a real range from the API's
 * `tickLower` / `tickUpper` / `tickCurrent` + token decimals.
 *
 * Note on `inRange`: this is the TICK-space primitive (is `tick` between the bounds). The PRICE-space
 * range STATUS used by the range UI ("in" / "below" / "above") is `getRangeStatus` in
 * `lib/utils/rangeStatus.ts` (POO-236); the two are complementary, not duplicates — keep
 * price-space status there and tick-space membership here.
 */
import { tickToPrice } from "./tick";

/** A position's range as human prices (token1 per token0). */
export interface PriceRangeFromTicks {
  /** Price at the lower tick. */
  minPrice: number;
  /** Price at the upper tick. */
  maxPrice: number;
  /** Price at the pool's current tick. */
  currentPrice: number;
}

/**
 * The human price range for a position's tick bounds + the pool's current tick. Price increases with
 * tick (token1 per token0), so `tickLower → minPrice`, `tickUpper → maxPrice`. The caller is
 * responsible for guarding incomplete input (missing ticks / decimals) before calling.
 */
export function priceRangeFromTicks(
  tickLower: number,
  tickUpper: number,
  tickCurrent: number,
  decimals0: number,
  decimals1: number,
): PriceRangeFromTicks {
  return {
    minPrice: tickToPrice(tickLower, decimals0, decimals1),
    maxPrice: tickToPrice(tickUpper, decimals0, decimals1),
    currentPrice: tickToPrice(tickCurrent, decimals0, decimals1),
  };
}

/**
 * Whether `tick` lies within `[tickLower, tickUpper]`. Bounds are inclusive, matching Uniswap v3
 * in-range semantics (a position is active while `tickLower <= tickCurrent <= tickUpper`).
 */
export function inRange(tick: number, tickLower: number, tickUpper: number): boolean {
  return tick >= tickLower && tick <= tickUpper;
}
