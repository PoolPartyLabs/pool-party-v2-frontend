/**
 * @id PP-MGR-SCR-002
 * @name getRangeStatus
 * @implements-rules-version v1
 *
 * POO-278 [R6] / POO-236: the single shared range-status rule for a Uniswap v3 price range.
 * `inRange = minPrice <= currentPrice <= maxPrice` (bounds inclusive); out of range distinguishes
 * `below` (current < min) from `above` (current > max); a full range is always in range. Reused by
 * the strategy builder (Mandate + Build steps), the manage-detail RangeCard, the live-position
 * surface and the investor in-range badge so every surface agrees.
 */

/** Where the current price sits relative to the chosen range. */
export type RangeStatus = "in" | "below" | "above";

/** A price range: full range, or explicit min/max bounds (token1 per token0). */
export interface PriceRange {
  /** Full-range liquidity — always in range. */
  full: boolean;
  /** Lower bound, or null when unset. */
  minPrice: number | null;
  /** Upper bound, or null when unset. */
  maxPrice: number | null;
}

/**
 * Computes the range status for a current price vs a chosen range.
 * Returns `null` while the range is incomplete, inverted or not finite (nothing to decide yet).
 */
export function getRangeStatus(currentPrice: number, range: PriceRange): RangeStatus | null {
  if (range.full) return "in";
  if (!Number.isFinite(currentPrice)) return null;
  const min = range.minPrice;
  const max = range.maxPrice;
  if (min === null || max === null || !Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (max < min) return null;
  if (currentPrice < min) return "below";
  if (currentPrice > max) return "above";
  return "in";
}
