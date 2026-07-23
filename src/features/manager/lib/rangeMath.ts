/**
 * @id PP-MGR (POO-278)
 * @name rangeMath
 * @implements-rules-version v1
 *
 * Pure helpers for the Build step's range UI: the estimated value split between the two tokens for a
 * chosen Uniswap v3 range, and snapping/stepping a price onto the pool's usable-tick grid. Everything
 * is in price space (token1 per token0), so no token decimals are needed — the wizard's pool object
 * carries the current price + fee tier but not decimals (those are read on-chain later, in Review).
 * The tick grid is anchored at the current price, so the shown bounds step by exactly one usable
 * tick; the absolute on-chain tick alignment is finalized in createPoolTicks at Review.
 */
import { tickSpacing } from "@/lib/manager/tickPrice";

/** Estimated value split (%) between token0 and token1 for a v3 position. */
export interface TokenSplit {
  /** Percent of position value held as token0 (0–100). */
  pct0: number;
  /** Percent of position value held as token1 (0–100). */
  pct1: number;
}

/**
 * The value split between the two tokens for a position with range [min, max] at the current price,
 * from the Uniswap v3 amount formulas (sqrt-price). Price at/below the range → all token0; at/above →
 * all token1; in range → the sqrt-price interpolation. Full range ≈ 50/50. Degenerate inputs (missing
 * / non-positive / inverted bounds) fall back to 50/50.
 */
export function tokenSplit(
  currentPrice: number,
  minPrice: number | null,
  maxPrice: number | null,
  full = false,
): TokenSplit {
  if (full) return { pct0: 50, pct1: 50 };
  if (
    !(currentPrice > 0) ||
    minPrice === null ||
    maxPrice === null ||
    !(minPrice > 0) ||
    !(maxPrice > minPrice)
  ) {
    return { pct0: 50, pct1: 50 };
  }
  const sc = Math.sqrt(currentPrice);
  const sa = Math.sqrt(minPrice);
  const sb = Math.sqrt(maxPrice);
  if (sc <= sa) return { pct0: 100, pct1: 0 }; // price at/below range → all token0
  if (sc >= sb) return { pct0: 0, pct1: 100 }; // price at/above range → all token1
  // token0's value expressed in token1 units = amount0 × price; token1's value = amount1 (the shared
  // liquidity L cancels in the ratio).
  const value0 = ((sb - sc) * sc) / sb;
  const value1 = sc - sa;
  const total = value0 + value1;
  if (!(total > 0)) return { pct0: 50, pct1: 50 };
  const pct1 = (value1 / total) * 100;
  return { pct0: 100 - pct1, pct1 };
}

/** The price ratio between two adjacent usable ticks for a fee tier (1.0001^spacing). */
function gridFactor(feeBps: number): number {
  return 1.0001 ** tickSpacing(feeBps);
}

/**
 * Snap a price onto the usable-tick grid anchored at the current price. Returns the price unchanged
 * when either input is non-positive.
 */
export function snapToTickGrid(price: number, currentPrice: number, feeBps: number): number {
  if (!(price > 0) || !(currentPrice > 0)) return price;
  const f = gridFactor(feeBps);
  const k = Math.round(Math.log(price / currentPrice) / Math.log(f));
  return currentPrice * f ** k;
}

/**
 * Step a price by `dir` usable ticks along the current-price-anchored grid. Snaps first, so a typed
 * off-grid price lands on the grid before stepping.
 */
export function stepOnTickGrid(
  price: number,
  currentPrice: number,
  feeBps: number,
  dir: 1 | -1,
): number {
  if (!(currentPrice > 0)) return price;
  const f = gridFactor(feeBps);
  const base = price > 0 ? price : currentPrice;
  const k = Math.round(Math.log(base / currentPrice) / Math.log(f)) + dir;
  return currentPrice * f ** k;
}
