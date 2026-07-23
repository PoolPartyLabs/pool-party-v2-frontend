/**
 * @id PP-CORE-LIB-013
 * @name format utils
 * @implements-rules-version v1
 *
 * Display formatters for money, percentages and token amounts. The app displays values in USD
 * regardless of locale (product decision), so currency formatting is pinned to `en-US`. Per the
 * transaction-display rule, token amounts are shown alongside their USD value by the caller.
 *
 * Token-amount formatting is magnitude-aware by default (POO-229, number-formatting skill §4): >=1
 * trims to a few decimals, sub-1 uses significant figures, and ultra-tiny crypto values (< 1e-4)
 * compress into subscript-zero (DEX-style) notation instead of vanishing to "0" or showing scientific
 * notation. Passing an explicit `maxFractionDigits` overrides that: the value is rendered as plain
 * fixed-decimal at exactly that precision for every magnitude (trailing zeros trimmed), which keeps the
 * displayed figure identical to a signed/confirmed amount (POO-303). Formatting runs through Decimal so
 * a tiny float never drifts or rounds a nonzero amount to 0.
 */
import Decimal from "decimal.js";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const count = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

/** `4532.5` → `"$4,532.50"`. */
export function formatUsd(value: number): string {
  return usd.format(value);
}

/**
 * Money at full token precision, trailing zeros trimmed: `38.005424` → `"$38.005424"`, `50` → `"$50"`.
 * Unlike {@link formatUsd} (always 2dp), this preserves the exact spendable figure so the displayed
 * balance matches what "Max" fills and what the Permit2 signature authorizes. Used where the USD value
 * is really a raw token balance (USDC has 6 decimals), not a rounded fiat amount (POO-303).
 */
export function formatUsdPrecise(value: number, maxFractionDigits = 6): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

/** Compact money for large figures: `1250000` → `"$1.25M"`, `880000` → `"$880K"`. */
export function formatUsdCompact(value: number): string {
  return usdCompact.format(value);
}

/** The magnitude at/above which a KPI tile switches to compact so a 7-figure value fits (POO-843 R4). */
const TILE_COMPACT_THRESHOLD = 1_000_000;

/**
 * USD for a KPI/metric tile: the EXACT figure below $1M, compact (K/M/B/T) at/above it (POO-843 R4).
 * A 7-figure value like `"$1,234,567.89"` overflows a half-width tile at 375px; compacting past the
 * number-formatting-skill threshold (§3, ≥ 1,000,000) keeps it inside while every sub-$1M tile renders
 * its exact figure unchanged. Deciding on magnitude keeps negatives (a rare negative KPI) consistent.
 */
export function formatUsdTile(value: number): string {
  return Math.abs(value) >= TILE_COMPACT_THRESHOLD ? formatUsdCompact(value) : formatUsd(value);
}

/**
 * Investor-facing pool TVL: the underlying Uniswap pool's `reserve_in_usd` as compact USD, or a dash
 * when it is missing or zero (POO-390 R5). The dash is deliberate: the value must never silently fall
 * back to `$0` or to the PP-managed position value, which would misrepresent the pool's liquidity.
 */
export function formatPoolTvl(value: number | undefined): string {
  return value ? formatUsdCompact(value) : "-";
}

/**
 * Whole-number count (investors, tokens, Quacks, tries), `en-US`, with thousands separators:
 * `15021` → `"15,021"`. Pinned to `en-US` like money (product decision; number-formatting skill §3)
 * so a count reads the same in every locale. Pass the result into a plain `{x}` message placeholder —
 * never ICU `{x, number}`, which re-localizes the separators per UI locale.
 */
export function formatCount(value: number): string {
  return count.format(value);
}

/** Money with an explicit leading sign for deltas: `612.5` → `"+$612.50"`, `-120` → `"-$120.00"`. */
export function formatSignedUsd(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${usd.format(Math.abs(value))}`;
}

/**
 * Signed money for a half-width KPI tile (POO-843 R4, review B2): the exact signed figure below $1M,
 * compacted WITH its sign at/above (`+$1.23M`) so a 7-figure yield/delta never overflows the tile.
 * The signed sibling of {@link formatUsdTile}; a no-op below the threshold so small deltas keep their
 * exact value.
 */
export function formatSignedUsdTile(value: number): string {
  if (Math.abs(value) < TILE_COMPACT_THRESHOLD) return formatSignedUsd(value);
  return `${value > 0 ? "+" : "-"}${formatUsdCompact(Math.abs(value))}`;
}

/** Percentage from an already-percent value: `7.4` → `"7.4%"`. */
export function formatPercent(value: number, fractionDigits = 1): string {
  return `${value.toFixed(fractionDigits)}%`;
}

/** Transaction hash shortened for receipts: `0x7a3f…9c2e` (first 6 + last 4 characters). */
export function formatTxHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

/** A raw address/hash: 0x followed by at least 40 hex chars (an address is 40; a position id 64). */
const ADDRESS_LIKE = /^0x[0-9a-fA-F]{40,}$/;

/**
 * A human identity label for receipt/plan rows (POO-841 R2): the value as-is, except a raw
 * address/hash id (0x + >= 40 hex) is shortened via {@link formatTxHash} (`0x357d…d64c`) so a
 * missing strategy name never renders a 66-char id that overflows the row. The belt behind the
 * primary fix (thread the real name); protects every current and future receipt caller.
 */
export function formatIdentityLabel(value: string): string {
  return ADDRESS_LIKE.test(value) ? formatTxHash(value) : value;
}

/** Structured pieces of a magnitude-aware token amount, for the `<TokenAmount>` render helper. */
export interface TokenAmountParts {
  /** Leading sign: `"-"` for negatives, otherwise `""`. */
  sign: string;
  /** Text before any subscript: the full number normally, or `"0.0"` in the subscript-zero case. */
  lead: string;
  /** Compressed leading-zero count for subscript-zero notation; `0` when it does not apply. */
  zeroCount: number;
  /** Significant digits shown after the subscript; `""` when not in subscript-zero notation. */
  trail: string;
  /** Plain-text rendering using Unicode subscripts (e.g. `"0.0₁₅1234"`, `"12.85"`). */
  text: string;
  /** Exact decimal value, no scientific notation, for copy / hover (e.g. `"0.0000000000000001234"`). */
  exact: string;
  /** Token symbol (e.g. `"USDC"`). */
  symbol: string;
}

/** Trim trailing fractional zeros (and a bare trailing dot) from a plain decimal string. */
function trimTrailingZeros(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/0+$/, "").replace(/\.$/, "");
}

/** Insert en-US thousands separators into an integer-part string. */
function groupThousands(integerPart: string): string {
  return integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Map a non-negative integer to its Unicode subscript digits (e.g. `15` → `"₁₅"`). */
function toSubscript(count: number): string {
  return String(count)
    .split("")
    .map((digit) => String.fromCharCode(0x2080 + Number(digit)))
    .join("");
}

const TINY_THRESHOLD_LEADING_ZEROS = 4;
const SIGNIFICANT_FIGURES = 4;
/** Decimals kept for `|x| >= 1` in the smart default (when no explicit precision is given). */
const SMART_INTEGER_MAX_FRACTION_DIGITS = 4;

/**
 * Magnitude-aware token-amount parts (number-formatting skill §4). Used by {@link formatTokenAmount}
 * (plain string) and the `<TokenAmount>` component (styled `<sub>`).
 *
 * `maxFractionDigits` has two contracts:
 * - **Explicit** (a number): plain fixed-decimal via Decimal with UP TO that many fraction digits,
 *   trailing zeros trimmed, for **every** magnitude — sub-1 and `< 1e-4` included. This bypasses the
 *   significant-figures AND subscript-zero smart defaults so the rendered value equals the exact figure
 *   the caller asked to display (e.g. the Permit2-signed hero in InvestModal, POO-303:
 *   `0.123456 @6 → "0.123456"`). Grouping is still applied to the integer part when `|x| >= 1`.
 * - **Omitted** (`undefined`): the smart magnitude-aware default —
 *   - `|x| >= 1` → up to ~4 decimals, trailing zeros trimmed, en-US grouping.
 *   - `1 > |x| >= 1e-4` → ~4 significant figures, plain decimal.
 *   - `0 < |x| < 1e-4` → subscript-zero: `0.0` + subscript(leadingZeros) + ~4 significant figures.
 *
 * `0` stays `0`. Never scientific, never a nonzero value rounded to `0`.
 */
export function formatTokenAmountParts(
  value: number,
  symbol: string,
  maxFractionDigits?: number,
): TokenAmountParts {
  const decimal = new Decimal(value);
  const sign = decimal.isNegative() && !decimal.isZero() ? "-" : "";
  const exact = decimal.toFixed();
  const absolute = decimal.abs();

  const plain = (lead: string): TokenAmountParts => ({
    sign,
    lead: `${sign}${lead}`,
    zeroCount: 0,
    trail: "",
    text: `${sign}${lead}`,
    exact,
    symbol,
  });

  if (absolute.isZero()) return plain("0");

  // Explicit precision wins for every magnitude: plain fixed-decimal (Decimal rounding, no float
  // toFixed), trailing zeros trimmed, integer part grouped. Bypasses sig-fig + subscript-zero.
  if (maxFractionDigits !== undefined) {
    const rounded = trimTrailingZeros(absolute.toDecimalPlaces(maxFractionDigits).toFixed());
    const [integerPart = "", fractionPart] = rounded.split(".");
    const grouped = groupThousands(integerPart) + (fractionPart ? `.${fractionPart}` : "");
    return plain(grouped);
  }

  if (absolute.greaterThanOrEqualTo(1)) {
    const rounded = trimTrailingZeros(
      absolute.toDecimalPlaces(SMART_INTEGER_MAX_FRACTION_DIGITS).toFixed(),
    );
    const [integerPart = "", fractionPart] = rounded.split(".");
    const grouped = groupThousands(integerPart) + (fractionPart ? `.${fractionPart}` : "");
    return plain(grouped);
  }

  // Sub-1: significant figures, then decide plain vs subscript-zero by the run of leading zeros.
  const significant = trimTrailingZeros(
    absolute.toSignificantDigits(SIGNIFICANT_FIGURES).toFixed(),
  );
  const fraction = significant.split(".")[1] ?? "";
  let leadingZeros = 0;
  while (fraction[leadingZeros] === "0") leadingZeros += 1;

  if (leadingZeros < TINY_THRESHOLD_LEADING_ZEROS) return plain(significant);

  const trail = fraction.slice(leadingZeros);
  return {
    sign,
    lead: `${sign}0.0`,
    zeroCount: leadingZeros,
    trail,
    text: `${sign}0.0${toSubscript(leadingZeros)}${trail}`,
    exact,
    symbol,
  };
}

/**
 * Token amount + symbol (POO-229). With no `maxFractionDigits` it is magnitude-aware:
 * `12.85, "USDC"` → `"12.85 USDC"`, `1.234e-16, "TKN"` → `"0.0₁₅1234 TKN"` (subscript-zero). With an
 * explicit `maxFractionDigits` it renders plain fixed-decimal at that precision for every magnitude,
 * trailing zeros trimmed — so `0.123456, "USDC", 6` → `"0.123456 USDC"` (the exact Permit2-signed hero,
 * POO-303), never a 4-sig-fig or subscript truncation. Negative inputs keep their sign; a nonzero amount
 * never renders as `"0"` or in scientific notation. For styled subscripts + an exact-value hover use the
 * `<TokenAmount>` component, which consumes {@link formatTokenAmountParts}.
 */
export function formatTokenAmount(
  value: number,
  symbol: string,
  maxFractionDigits?: number,
): string {
  const { text } = formatTokenAmountParts(value, symbol, maxFractionDigits);
  return `${text} ${symbol}`;
}
