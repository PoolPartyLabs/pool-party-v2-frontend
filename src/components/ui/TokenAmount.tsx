/**
 * @id PP-CORE-CMP-045
 * @name TokenAmount
 * @implements-rules-version v1
 *
 * Renders a magnitude-aware token amount (number-formatting skill §4). For ultra-tiny crypto values it
 * shows DEX-style subscript-zero notation — `0.0` + a styled `<sub>` leading-zero count + significant
 * figures (e.g. `0.0₁₅1234`) — so a nonzero amount never collapses to "0" or shows scientific
 * notation. Presentational and props-based (no i18n: a token amount is a number + symbol). The exact
 * value is exposed via `title`/`aria-label` for hover and copy. Consumes {@link formatTokenAmountParts}.
 *
 * PP-A11Y: the compressed subscript is hard to read aloud, so `aria-label` carries the exact value and
 * the symbol; assistive tech announces the real number instead of the cryptic glyphs.
 */
import { cn } from "@/lib/utils/cn";
import { formatTokenAmountParts } from "@/lib/utils/format";

/** Public props for {@link TokenAmount}. */
export interface TokenAmountProps {
  /** The amount to render (display-only; do amount math in Decimal upstream). */
  value: number;
  /** Token symbol shown after the amount (e.g. `"USDC"`). */
  symbol: string;
  /**
   * Explicit fraction-digit cap. When omitted (default), the amount is magnitude-aware: sub-1 uses
   * significant figures and `< 1e-4` uses subscript-zero. When set, the value renders as plain
   * fixed-decimal at that precision for every magnitude (no subscript) — pass it only when you need an
   * exact fixed-precision figure (e.g. a signed amount), otherwise leave it off to keep subscript-zero.
   */
  maxFractionDigits?: number;
  /** Extra classes on the wrapping span. */
  className?: string;
}

/** Magnitude-aware token amount with subscript-zero for ultra-tiny values. See {@link TokenAmountProps}. */
export function TokenAmount({ value, symbol, maxFractionDigits, className }: TokenAmountProps) {
  const { lead, zeroCount, trail, exact } = formatTokenAmountParts(
    value,
    symbol,
    maxFractionDigits,
  );
  const exactLabel = `${exact} ${symbol}`;

  return (
    <span className={cn("whitespace-nowrap tabular-nums", className)} title={exactLabel}>
      {/* Visual form (subscript-zero); the exact value is the sr-only text below for assistive tech. */}
      <span aria-hidden="true">
        {lead}
        {zeroCount > 0 ? <sub className="text-[0.7em]">{zeroCount}</sub> : null}
        {trail}
        {` ${symbol}`}
      </span>
      <span className="sr-only">{exactLabel}</span>
    </span>
  );
}
