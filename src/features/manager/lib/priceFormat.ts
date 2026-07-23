/**
 * @id PP-MGR (POO-278)
 * @name priceFormat
 * @implements-rules-version v2 (POO-900 rules v1)
 *
 * Magnitude-aware price formatting for the Build/Review range editor. Extracted from BuildStep so the
 * Build step and the Review summary render a price (and its inverted-orientation counterpart) with the
 * exact same decimal count, keeping the two steps visually consistent. Pure (no React), so it is
 * unit-tested independently. POO-900 R8: roundPrice is additionally tick-aware - the range editors
 * hold their state as display STRINGS, so the string must resolve one usable tick (a ~1.0001x move)
 * unambiguously or two adjacent ticks alias to the same value and the boundary state loops.
 */

/**
 * Decimal places to render a price at, by magnitude. High-value pairs need only 2 (a one
 * tick-spacing nudge is cents); sub-dollar pairs (e.g. ETH/cbBTC ≈ 0.0269) need more, or a single
 * nudge (≈ price × 1e-4 … 2e-2) rounds straight back to the same string and the ± stepper looks
 * dead. Keeps ~5 significant figures past the leading zeros; capped at 12 to stay inside float
 * precision. (POO-278 stepper fix.)
 */
export function priceDecimals(ref: number): number {
  const abs = Math.abs(ref);
  if (abs >= 100) return 2;
  if (abs >= 1) return 4;
  if (abs <= 0) return 6;
  return Math.min(12, Math.ceil(-Math.log10(abs)) + 5);
}

/** A price formatted with locale grouping at the magnitude-appropriate precision. */
export function fmtPrice(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: priceDecimals(n) });
}

/**
 * Decimal places that resolve ONE usable tick at `n`'s own magnitude (POO-900 R8). A tick is a
 * ~1.0001x relative move (spacing 1, the tightest grid), i.e. ~|n|·1e-4 absolute, so distinguishing
 * adjacent ticks needs 10^-d <= |n|·1e-4 → d = 4 − log10(|n|), plus one guard digit for the marginal
 * zone where the tick step and the rounding quantum coincide (float slop aliased adjacent ticks
 * there). Capped at 12 like {@link priceDecimals} to stay inside float precision.
 */
function tickDecimals(n: number): number {
  const abs = Math.abs(n);
  if (!(abs > 0)) return 0;
  return Math.min(12, Math.ceil(4 - Math.log10(abs)) + 1);
}

/**
 * A price rounded for the range editors, returned as a bare (un-grouped) numeric string: `ref`'s
 * magnitude precision, raised to `n`'s tick precision when that needs more digits (POO-900 R8 - one
 * tick step always changes the string, and the string round-recovers its tick).
 */
export function roundPrice(n: number, ref: number): string {
  const decimals = Math.max(priceDecimals(ref), tickDecimals(n));
  return String(Number(n.toFixed(decimals)));
}
