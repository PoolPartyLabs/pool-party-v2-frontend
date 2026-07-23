/**
 * @id PP-DEP-CMP-002
 * @name AmountField
 * @implements-rules-version v1
 *
 * Prominent USD amount entry shared by the invest and withdraw flows: a large editable figure plus
 * "discreet" (ghost) increment chips that ADD to the current amount, and a Max chip that sets the
 * full available value. String-controlled (the parent owns the raw text) so typing stays smooth.
 *
 * PP-INTEGRATION-POINT: on mobile the design calls for the custom on-screen Amount Keypad
 * (PP-DEP-CMP-001, owned by the Deposit area). This uses a numeric input (inputMode="decimal", so
 * phones still raise a number pad) until that shared keypad lands.
 */
"use client";

import { formatUsd } from "@/lib/utils/format";
import { sanitizeNumericInput } from "@/lib/utils/numericInput";

/**
 * Round to `fractionDigits` and drop trailing zeros, as a raw input string (e.g. `100`, `12.5`).
 * Increment chips use cents (2dp). The Max chip uses the field's `maxFractionDigits`: cents for a
 * fiat figure, but full token decimals (6 for USDC) when the field's max is a raw wallet balance, so
 * "Max" fills the exact spendable amount instead of truncating it to cents (POO-303).
 */
export function amountToText(value: number, fractionDigits = 2): string {
  return String(Number(value.toFixed(fractionDigits)));
}

/** Public props for {@link AmountField}. */
export interface AmountFieldProps {
  /** Raw text value (owned by the parent). */
  value: string;
  /** Called with the sanitized next text. */
  onValueChange: (next: string) => void;
  /** Additive increment chips, in USD (e.g. `[50, 100, 250]`). */
  increments: number[];
  /** Value the Max chip sets. */
  maxValue: number;
  /** Label for the Max chip. */
  maxLabel: string;
  /** Accessible label for the input. */
  ariaLabel: string;
  /**
   * Decimal places the Max chip preserves. Defaults to 2 (cents) for fiat fields; the invest flow
   * passes 6 (USDC decimals) so Max fills the exact spendable wallet balance, not a 2dp truncation
   * (POO-303). Increment chips are unaffected (always cents).
   */
  maxFractionDigits?: number;
}

/** Large USD amount input + increment/Max chips. */
export function AmountField({
  value,
  onValueChange,
  increments,
  maxValue,
  maxLabel,
  ariaLabel,
  maxFractionDigits = 2,
}: AmountFieldProps) {
  const current = Number.parseFloat(value) || 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-center gap-1 text-foreground">
        <span className="font-bold text-3xl">$</span>
        <input
          type="text"
          inputMode="decimal"
          aria-label={ariaLabel}
          value={value}
          onChange={(event) => onValueChange(sanitizeNumericInput(event.target.value))}
          placeholder="0"
          className="w-40 bg-transparent text-center font-bold text-4xl text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
        />
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {increments.map((inc) => (
          <button
            key={inc}
            type="button"
            onClick={() => onValueChange(amountToText(current + inc))}
            className="rounded-full border border-border px-3 py-1.5 font-medium text-muted-foreground text-sm transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            +{formatUsd(inc)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onValueChange(amountToText(maxValue, maxFractionDigits))}
          className="rounded-full border border-border px-3 py-1.5 font-medium text-muted-foreground text-sm transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {maxLabel}
        </button>
      </div>
    </div>
  );
}
