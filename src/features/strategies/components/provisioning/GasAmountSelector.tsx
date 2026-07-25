/**
 * @id PP-CORE-CMP-039
 * @name GasAmountSelector
 * @implements-rules-version v2
 *
 * The $10 / $25 / Custom gas-amount control for the buy-gas modal (PP-CORE-MOD-010) — also reused
 * inline by the provisioning wizard's gas top-up step (POO-409). Presets are an allowlist; a Custom
 * amount is bound to [$10, $200] (the Paybis floor → max). Controlled: the parent owns the
 * {@link GasChoice}; the raw Custom text is local so typing stays smooth. Validation + parsing live in
 * the pure {@link validateGas} / {@link selectCustom} helpers.
 *
 * PP-A11Y: the three options are `aria-pressed` toggle buttons; the Custom input is labelled and its
 * below-min/over-max error is wired via `aria-describedby` + `role="alert"` (text, never color alone).
 */
"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import type { GasChoice } from "@/lib/provisioning";
import { GAS_CUSTOM_MAX_USD, GAS_CUSTOM_MIN_USD, GAS_PRESETS_USD } from "@/lib/provisioning";
import { cn } from "@/lib/utils/cn";
import { formatUsd } from "@/lib/utils/format";
import { selectCustom, selectPreset, validateGas } from "./gasSelection";

/** Public props for {@link GasAmountSelector}. */
export interface GasAmountSelectorProps {
  /** The current choice (or `null` before anything is picked). */
  value: GasChoice | null;
  /** Called with the next choice on every preset tap / custom keystroke. */
  onChange: (value: GasChoice) => void;
  /** Spendable USDC (USD) — drives the over-balance (on-ramp) signal in {@link validateGas}. */
  balanceUsd: number;
  /** Preset shortcuts; defaults to `GAS_PRESETS_USD` ($10/$25). */
  presets?: readonly number[];
  /** Custom lower bound (USD); defaults to `GAS_CUSTOM_MIN_USD` ($10). */
  minUsd?: number;
  /** Custom upper bound (USD); defaults to `GAS_CUSTOM_MAX_USD` ($200). */
  maxUsd?: number;
  className?: string;
}

/** Option pill styling (selected = gold). */
function pillClass(active: boolean): string {
  return cn(
    "rounded-xl border px-3 py-2.5 text-center font-semibold text-sm transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "border-primary bg-primary/10 text-primary"
      : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
  );
}

/** $10 / $25 / Custom gas selector. */
export function GasAmountSelector({
  value,
  onChange,
  balanceUsd,
  presets = GAS_PRESETS_USD,
  minUsd = GAS_CUSTOM_MIN_USD,
  maxUsd = GAS_CUSTOM_MAX_USD,
  className,
}: GasAmountSelectorProps) {
  const t = useTranslations("strategies");
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [customText, setCustomText] = useState("");

  const isCustom = value !== null && value.presetUsd === null;
  const validity = validateGas(value, balanceUsd);
  const showError =
    isCustom && !validity.ok && (validity.reason === "belowMin" || validity.reason === "overMax");

  // Focus the Custom input when the user enters Custom mode (controlled focus, not autoFocus-on-mount).
  useEffect(() => {
    if (isCustom) inputRef.current?.focus();
  }, [isCustom]);

  function pickPreset(usd: number) {
    setCustomText("");
    onChange(selectPreset(usd as 10 | 25));
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
