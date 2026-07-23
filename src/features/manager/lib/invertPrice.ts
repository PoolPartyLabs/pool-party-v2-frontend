/**
 * @id PP-MGR
 * @name invertPrice
 * @implements-rules-version v1
 *
 * Pure price-orientation helpers for the Build step's range editor. A Uniswap v3 pool is canonical in
 * `token1` per `token0` (the same space `rangeMath` and `createPoolTicks` work in), but a manager often
 * prefers to read/set a range in the opposite orientation — e.g. USDC-per-ETH instead of ETH-per-USDC.
 *
 * This module is the ONLY place that conversion happens: the on-chain pool, the draft that flows to the
 * create-pool DTO and `createPoolTicks` all stay canonical; inversion is purely a display/input-edge
 * transform. Inverting a price band is reciprocal + swap (the reciprocal is monotonically decreasing,
 * so the smaller canonical bound becomes the larger displayed one), which makes inversion an involution:
 * applying it twice is the identity (modulo float rounding). When `inverted` is false every function is
 * the identity, so the default path is unchanged.
 */

/** A price band — a low (`min`) and high (`max`) bound in one orientation. */
export interface Bounds {
  min: number;
  max: number;
}

/**
 * Reciprocal of a price. Non-positive inputs (0 or negative — used as "empty"/sentinel bounds) pass
 * through unchanged, so an unset bound never turns into ±Infinity.
 */
export function invert(p: number): number {
  return p > 0 ? 1 / p : p;
}

/**
 * Canonical `[min, max]` → the bounds to DISPLAY for the chosen orientation. When inverted, each bound
 * is reciprocated and the two are swapped so the displayed band still reads `min < max`. Identity when
 * not inverted.
 */
export function toDisplayBounds(canonMin: number, canonMax: number, inverted: boolean): Bounds {
  if (!inverted) return { min: canonMin, max: canonMax };
  return { min: invert(canonMax), max: invert(canonMin) };
}

/**
 * DISPLAYED `[min, max]` (what the manager typed/sees) → the CANONICAL bounds to store and hand to the
 * DTO. The exact inverse of {@link toDisplayBounds}: reciprocate + swap when inverted, identity
 * otherwise. So editing the displayed "min" moves the canonical "max" and vice-versa.
 */
export function toCanonicalBounds(dispMin: number, dispMax: number, inverted: boolean): Bounds {
  if (!inverted) return { min: dispMin, max: dispMax };
  return { min: invert(dispMax), max: invert(dispMin) };
}
