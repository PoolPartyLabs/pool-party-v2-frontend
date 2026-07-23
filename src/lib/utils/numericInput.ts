/**
 * @id PP-CORE-LIB-019 (POO-229)
 * @name numericInput
 * @implements-rules-version v1
 *
 * The single numeric-input helper for the app. Every amount / fee / range field routes its raw input
 * through here instead of re-implementing per-component sanitizing (number-formatting skill §5):
 * whitelist digits + a single decimal separator, bound the fractional digits, accept the locale
 * separator (normalize to "." internally), and validate + clamp at the boundary with Zod / Decimal.
 *
 * The field's *string* state and the parsed *Decimal* are deliberately different things: callers keep
 * the raw string for the input and parse to a Decimal only for logic (skill §5, §1 — never JS float).
 */
import Decimal from "decimal.js";
import { z } from "zod";

/** Options shared by the sanitize / parse helpers. */
export interface NumericInputOptions {
  /** Max digits after the separator. Omit for unbounded; 0 makes the field integer-only. */
  maxDecimals?: number;
  /** Permit a single leading "-" (amounts/fees/ranges are non-negative, so default off). */
  allowNegative?: boolean;
  /** The user's decimal separator (e.g. "," in pt-BR). Normalized to "." internally. Default ".". */
  decimalSeparator?: string;
}

/** Escape a single character for use inside a RegExp. */
function escapeForRegExp(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sanitize a raw typed string into a valid numeric-input string suitable for the controlled value:
 * keep only digits and one decimal point, bound the fraction, normalize the locale separator. Returns
 * a *string* (it may end in a trailing "." mid-typing); parse with {@link parseNumericInput} for math.
 */
export function sanitizeNumericInput(raw: string, options: NumericInputOptions = {}): string {
  const { maxDecimals, allowNegative = false, decimalSeparator = "." } = options;

  const negative = allowNegative && raw.trimStart().startsWith("-");

  let s = raw;
  if (decimalSeparator !== ".") {
    // The locale separator becomes the canonical ".", and a literal "." is grouping noise to drop.
    s = s.replace(/\./g, "");
    s = s.replace(new RegExp(escapeForRegExp(decimalSeparator), "g"), ".");
  }
  // Whitelist: digits and the canonical separator only (everything else, incl. grouping, is stripped).
  s = s.replace(/[^0-9.]/g, "");

  // Collapse to a single separator (keep the first).
  const dot = s.indexOf(".");
  if (dot !== -1) {
    s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "");
  }

  // Bound the fractional digits.
  if (maxDecimals !== undefined && dot !== -1) {
    s = maxDecimals === 0 ? s.slice(0, dot) : s.slice(0, dot + 1 + maxDecimals);
  }

  return negative ? `-${s}` : s;
}

/**
 * Apply a single keypad key ("0"–"9", ".", "backspace") to the current amount string, bounding the
 * fraction to `maxDecimals` (default 2 — cents). Shared by every custom-keypad amount field so the
 * keypad path and the typed-input path enforce the same rules.
 */
export function applyKeypadKey(
  prev: string,
  key: string,
  options: NumericInputOptions = {},
): string {
  const { maxDecimals = 2 } = options;

  if (key === "backspace") return prev.slice(0, -1);
  if (key === ".") {
    if (prev.includes(".")) return prev;
    return prev === "" ? "0." : `${prev}.`;
  }

  const next = prev === "0" ? key : prev + key;
  const dot = next.indexOf(".");
  if (dot !== -1 && next.length - dot - 1 > maxDecimals) return prev;
  return next;
}

/**
 * Parse a numeric-input string to a {@link Decimal} (locale separator normalized first), or `null`
 * when empty / non-numeric / separator-only. Never returns `NaN` and never goes through a JS float.
 */
export function parseNumericInput(raw: string, options: NumericInputOptions = {}): Decimal | null {
  const { decimalSeparator = "." } = options;
  let s = raw.trim();
  if (decimalSeparator !== ".") {
    s = s.replace(/\./g, "").replace(new RegExp(escapeForRegExp(decimalSeparator), "g"), ".");
  }
  s = s.replace(/[^0-9.-]/g, "");
  if (s === "" || s === "." || s === "-") return null;
  try {
    const value = new Decimal(s);
    return value.isFinite() ? value : null;
  } catch {
    return null;
  }
}

/** Inclusive range for {@link clampToRange} / {@link numericAmountSchema}. */
export interface NumericRange {
  /** Lower bound (inclusive). Omit for unbounded below. */
  min?: number;
  /** Upper bound (inclusive). Omit for unbounded above. */
  max?: number;
}

/** Clamp a Decimal into `[min, max]` (either bound optional). */
export function clampToRange(value: Decimal, range: NumericRange): Decimal {
  let clamped = value;
  if (range.min !== undefined && clamped.lessThan(range.min)) clamped = new Decimal(range.min);
  if (range.max !== undefined && clamped.greaterThan(range.max)) clamped = new Decimal(range.max);
  return clamped;
}

/**
 * Boundary schema for an amount/fee crossing into a service or action: coerce to a number, reject
 * `NaN`/`Infinity` (`.finite()`), and bound the range. Client Zod is UX, not a trust boundary — the
 * API edge re-validates (skill §6).
 *
 * Note: `z.coerce.number()` coerces an empty / whitespace string to `0` by design — the lower bound
 * (`range.min`, typically the field's minimum > 0) is what rejects an empty or zero amount, and every
 * consumer additionally gates the CTA on `>= min` / `> 0` downstream. Do not treat empty as a separate
 * "invalid" state here.
 *
 * PP-SECURITY: a value off a numeric input is attacker-controlled until parsed here.
 */
export function numericAmountSchema(range: NumericRange = {}) {
  let schema = z.coerce.number().finite();
  if (range.min !== undefined) schema = schema.min(range.min);
  if (range.max !== undefined) schema = schema.max(range.max);
  return schema;
}
