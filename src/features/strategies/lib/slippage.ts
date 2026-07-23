/**
 * @id PP-STR-LIB-003 (POO-403)
 * @name slippage
 * @implements-rules-version v3
 *
 * Pure helpers for the custom slippage input in the shared TransactionSettingsDialog (POO-403 R6).
 * `sanitizeSlippageInput` keeps the field to a clean 0-`max` number with at most one decimal place
 * (fixing the "000 %" artifact a controlled number input produced); POO-513 R3: a comma decimal
 * separator (pt-BR and most EU keyboard layouts) reads as the decimal point instead of being
 * dropped, so "1,7" no longer collapses to 17. `slippageSeverity` classifies a
 * tolerance so the dialog can warn on a High (> 5%) or Very high (> 20%) setting.
 * POO-463 R1/R2: the preset list and the per-surface defaults live here too, so the dialog and its
 * six consumer modals share one source of truth (investor flows open at 2%; the manager-only
 * Move Range / Close flows SEED 5%).
 * POO-525 R1: the create-pool (Launch strategy) flow gets its own 2% default, shared by the Review
 * gear seed, useCreatePool's client default and createPoolAction's server fallback.
 *
 * POO-547: the custom slippage field is now UNIFORM across every consumer — 0.1% to 100% with
 * decimals, no per-flow cap. The old manager `SLIPPAGE_CAP=5` / create-pool `CREATE_POOL_SLIPPAGE_MAX=5`
 * ceilings are gone; every flow falls back to the shared `SLIPPAGE_MAX=100`, and the per-surface 5% / 2%
 * constants below are DEFAULT SEEDS only (never caps). `SLIPPAGE_MIN` / `floorSlippage` add the 0.1%
 * floor, applied on commit (the dialog's onBlur), not inside `sanitizeSlippageInput` (which stays a
 * pure display clamp so an in-progress "0." remains typeable).
 */

/** Preset slippage tolerances offered by the settings dialog, in percent (POO-463 R1). */
export const SLIPPAGE_PRESETS = [0.5, 1, 2] as const;
/** Default slippage tolerance for the investor flows (invest / compound / collect / withdraw). */
export const DEFAULT_SLIPPAGE_PCT = 2;
/**
 * Default SEED for the manager-only flows (Move Range / Close / managed Collect), in percent. Since
 * POO-547 this is a seed only, NOT a cap: the custom input accepts the full 0.1-100% range like every
 * other flow. Sits on the high-slippage boundary (== HIGH_SLIPPAGE_PCT) by design: severity is
 * strictly greater-than, so 5 still classifies as "none" (no warning at the default seed).
 */
export const MANAGER_DEFAULT_SLIPPAGE_PCT = 5;
/**
 * Default SEED for the create-pool (Launch strategy) flow, in percent (POO-525 R1): one source of
 * truth for the Review gear seed, useCreatePool's client default and createPoolAction's server
 * fallback. Since POO-547 this is a seed only, NOT a cap (a launch seeds a fresh position, so the
 * tighter investor-style 2% is the default, but the manager can raise it up to 100%).
 */
export const CREATE_POOL_DEFAULT_SLIPPAGE_PCT = 2;
/** The default upper bound for a slippage tolerance, in percent (POO-547: shared by every flow). */
export const SLIPPAGE_MAX = 100;
/**
 * The lower bound for a committed slippage tolerance, in percent (POO-547 R4). A positive value under
 * this floor normalizes up to it on commit (see {@link floorSlippage}); an empty field falls back to
 * the surface default seed instead.
 */
export const SLIPPAGE_MIN = 0.1;
/** Above this percentage the dialog shows a "High slippage" warning. */
export const HIGH_SLIPPAGE_PCT = 5;
/** Above this percentage the warning escalates to "Very high slippage". */
export const VERY_HIGH_SLIPPAGE_PCT = 20;

/**
 * Clean a raw slippage keystroke into a display string: digits only, a single decimal point with at
 * most one fractional digit, no leading-zero noise ("000" -> "0"), clamped to `[0, max]`. Returns
 * "" for an empty/invalid entry and preserves an in-progress decimal like "10.". A comma reads as
 * a decimal point (POO-513 R3), so comma-layout keyboards can enter decimals too.
 */
export function sanitizeSlippageInput(text: string, max: number = SLIPPAGE_MAX): string {
  // A comma is a decimal separator on pt-BR/EU layouts; normalise it before stripping (POO-513 R3).
  // Keep only digits and dots (drops sign, letters, separators).
  let s = text.replace(/,/g, ".").replace(/[^\d.]/g, "");
  // Collapse to a single decimal point (keep the first).
  const dot = s.indexOf(".");
  if (dot !== -1) {
    s = `${s.slice(0, dot + 1)}${s.slice(dot + 1).replace(/\./g, "")}`;
    // At most one fractional digit.
    s = s.slice(0, dot + 2);
  }
  // Strip leading zeros ("007" -> "7", "000" -> "0"), but keep a leading "0." intact.
  s = s.replace(/^0+(?=\d)/, "");
  // Clamp the numeric value to the allowed maximum.
  if (s !== "" && s !== ".") {
    const n = Number.parseFloat(s);
    if (Number.isFinite(n) && n > max) s = String(max);
  }
  return s;
}

/** A slippage tolerance's risk band. */
export type SlippageSeverity = "none" | "high" | "veryHigh";

/** Classify a slippage tolerance (percent) into a warning band (POO-403 R6). */
export function slippageSeverity(value: number): SlippageSeverity {
  if (!Number.isFinite(value)) return "none";
  if (value > VERY_HIGH_SLIPPAGE_PCT) return "veryHigh";
  if (value > HIGH_SLIPPAGE_PCT) return "high";
  return "none";
}

/**
 * Apply the slippage floor on commit (POO-547 R4): a finite, positive value below `min` (the 0.1%
 * floor) normalizes up to `min`; every other input passes through untouched. Zero, negatives and
 * non-finite values are left as-is on purpose — an empty/no-op custom field must fall back to the
 * surface's default seed, not to the floor, so the caller only commits this on blur (never per
 * keystroke, so an in-progress "0." stays typeable).
 */
export function floorSlippage(value: number, min: number = SLIPPAGE_MIN): number {
  if (Number.isFinite(value) && value > 0 && value < min) return min;
  return value;
}
