/**
 * @id PP-CORE-CMP-039 (POO-1509, POO-1526)
 * @name GasAmountSelector
 * @implements-rules-version v4 (POO-1526 rules v1) · v3 (POO-1509 rules v1) · v2
 *
 * The Custom-plus-presets gas-amount control, rendered only by {@link GasTopUpBody}
 * (PP-CORE-CMP-070) since POO-1509 [R35] made `Not enough gas` the one place a gas amount is picked.
 * Presets are an allowlist; a Custom amount is bound to the source's floor and ceiling. Controlled:
 * the parent owns the {@link GasChoice}; the raw Custom text is local so typing stays smooth.
 * Validation + parsing live in the pure {@link validateGas} / {@link selectCustom} helpers.
 *
 * ## v3: one `source`, because three independent props could disagree
 *
 * `presets`, `minUsd` and `maxUsd` used to arrive separately while {@link validateGas} was called
 * with no source at all, so it validated against the CARD floor whatever the labels said. On the
 * on-chain path that shipped a contradiction: a $7 custom amount was refused, under an error message
 * that read `Minimum $5.00`. All three now derive from `source`, which is the same input
 * {@link gasPresets} / {@link gasMinUsd} / {@link gasMaxUsd} already keyed off, so the bound that
 * rejects an amount is by construction the bound the user was shown.
 *
 * PP-A11Y: the three options are `aria-pressed` toggle buttons; the Custom input is labelled and its
 * below-min/over-max error is wired via `aria-describedby` + `role="alert"` (text, never color alone).
 *
 * ## Provisioning v3 mobile [M5.2], POO-1526
 *
 * `min-h-11` lives on the shared {@link pillClass} helper, not on one pill: the three presets and
 * Custom sit in the same row, and growing one without the others would misalign it against them.
 */
"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import type { GasChoice } from "@/lib/provisioning";
import { cn } from "@/lib/utils/cn";
import { formatUsd } from "@/lib/utils/format";
import {
  type GasFundingSource,
  gasMaxUsd,
  gasMinUsd,
  gasPresets,
  selectCustom,
  selectPreset,
  validateGas,
} from "./gasSelection";

/** Public props for {@link GasAmountSelector}. */
export interface GasAmountSelectorProps {
  /** The current choice (or `null` before anything is picked). */
  value: GasChoice | null;
  /** Called with the next choice on every preset tap / custom keystroke. */
  onChange: (value: GasChoice) => void;
  /** Spendable USDC (USD) — drives the over-balance (on-ramp) signal in {@link validateGas}. */
  balanceUsd: number;
  /**
   * Where the gas is paid from, which decides the presets, the floor, the ceiling AND the validation
   * ([R35]). Defaults to `"card"`, the pre-POO-1084 behaviour ($10/$25, floor $10).
   */
  source?: GasFundingSource;
  className?: string;
}

/**
 * Option pill styling (selected = gold).
 *
 * [M5.2] `min-h-11` applies to the shared helper so all pills in the row (presets + Custom) grow
 * together — fixing one and leaving its siblings at the old `py-2.5` height would misalign the row.
 */
function pillClass(active: boolean): string {
  return cn(
    "min-h-11 rounded-xl border px-3 py-2.5 text-center font-semibold text-sm transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "border-primary bg-primary/10 text-primary"
      : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
  );
}

/** Preset-plus-Custom gas selector, bounded by the funding source ([R35]). */
export function GasAmountSelector({
  value,
  onChange,
  balanceUsd,
  source = "card",
  className,
}: GasAmountSelectorProps) {
  const t = useTranslations("strategies");
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [customText, setCustomText] = useState("");

  // [R35] All four from one input, so the bound that REJECTS an amount is the bound the error text
  // names. They were three props and a defaulted validation call, and they disagreed.
  const presets = gasPresets(source);
  const minUsd = gasMinUsd(source);
  const maxUsd = gasMaxUsd(source);
  const isCustom = value !== null && value.presetUsd === null;
  const validity = validateGas(value, balanceUsd, source);
  const showError =
    isCustom && !validity.ok && (validity.reason === "belowMin" || validity.reason === "overMax");

  // Focus the Custom input when the user enters Custom mode (controlled focus, not autoFocus-on-mount).
  useEffect(() => {
    if (isCustom) inputRef.current?.focus();
  }, [isCustom]);

  function pickPreset(usd: number) {
    setCustomText("");
    onChange(selectPreset(usd as 5 | 10 | 25));
  }

  function onCustomInput(next: string) {
    const cleaned = next.replace(/[^0-9.]/g, "");
    setCustomText(cleaned);
    onChange(selectCustom(cleaned));
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of related toggle buttons (a segmented control) is the correct ARIA pattern; no native element fits. */}
      <div
        role="group"
        aria-label={t("provisioning.gas.selectorLabel")}
        className="grid grid-cols-3 gap-2"
      >
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={value?.presetUsd === preset}
            onClick={() => pickPreset(preset)}
            className={pillClass(value?.presetUsd === preset)}
          >
            {formatUsd(preset)}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={isCustom}
          onClick={() => onChange(selectCustom(customText))}
          className={pillClass(isCustom)}
        >
          {t("provisioning.gas.custom")}
        </button>
      </div>

      {isCustom ? (
        <div className="flex flex-col gap-1">
          <div
            className={cn(
              "flex items-center gap-1 rounded-xl border bg-surface-raised px-3 py-2.5",
              showError ? "border-destructive" : "border-border focus-within:border-primary",
            )}
          >
            <span className="font-semibold text-muted-foreground">$</span>
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              aria-label={t("provisioning.gas.customAria")}
              aria-invalid={showError || undefined}
              aria-describedby={showError ? errorId : undefined}
              value={customText}
              onChange={(event) => onCustomInput(event.target.value)}
              placeholder={t("provisioning.gas.customPlaceholder")}
              className="w-full bg-transparent font-semibold text-foreground outline-none placeholder:text-muted-foreground/60"
            />
          </div>
          {showError ? (
            <p id={errorId} role="alert" className="text-destructive text-xs">
              {validity.reason === "belowMin"
                ? t("provisioning.gas.error.belowMin", { amount: formatUsd(minUsd) })
                : t("provisioning.gas.error.overMax", { amount: formatUsd(maxUsd) })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
