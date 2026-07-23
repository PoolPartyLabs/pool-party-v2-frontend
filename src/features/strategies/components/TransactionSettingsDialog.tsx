/**
 * @id PP-STR-MOD-007
 * @name TransactionSettingsDialog
 * @implements-rules-version v3 · v1 (POO-842 rules v1)
 *
 * The shared ⚙ transaction-settings sheet for the strategy flows (invest / collect / withdraw):
 * max slippage (0.5% / 1% / 2% presets + custom, POO-463 R1), transaction deadline (minutes), and "Receive as"
 * (USDC by default plus any manager-defined strategy tokens). Every section is optional and only
 * renders when the caller wires it. Per-flow matrix:
 * invest zap-in = slippage + deadline (no receive-as) · withdraw zap-out = all three ·
 * collect = all three (slippage + deadline + receive-as), POO-384 R6 — this restores the
 * slippage + deadline that POO-280 R5d had removed (collect was receive-as-only); receiving the
 * proceeds as anything but the pool's payout asset involves a swap. Stacks over the flow dialog
 * that opens it. Replaces the slippage-only dialog. (POO-96 R8 / 98 R3 / 100 R5)
 *
 * POO-403 R6: the custom slippage field is a sanitised text input (0-100, one decimal, no "000"
 * artifact) backed by `sanitizeSlippageInput`; a value above 5% / 20% surfaces a High / Very high
 * slippage warning (`slippageSeverity`). R7: the "Receive as" hint copy was reworded.
 *
 * POO-547: the custom field is now UNIFORM across every consumer — 0.1% to 100% with decimals, no
 * per-flow cap (the old manager / create-pool 5% ceilings are gone; `slippageMax` defaults to 100 and
 * no caller overrides it). R4: on blur a positive value under the 0.1% floor snaps up to 0.1%
 * (`floorSlippage`), while an in-progress "0." stays typeable (the floor is NOT applied per keystroke,
 * and an empty field is left empty so the host's default seed applies).
 *
 * POO-513 R1: the custom text is DERIVED from the `slippage` prop; when the host changes it from
 * outside (every flow modal resets its slippage on close while this component stays mounted), the
 * stale custom text re-seeds, so the gear can never display a custom value different from the
 * effective slippage. R4: no build consumes the deadline yet, so the field renders disabled with a
 * "Coming soon" badge and a neutral hint (`onDeadlineChange` still gates the section and stays in
 * the contract for the wiring, see the PP-INTEGRATION-POINT below).
 *
 * POO-525 R2 (v3): a caller that passes `receiveAs` + `receiveOptions` WITHOUT `onReceiveAsChange`
 * gets a FIXED Receive-as section — a non-interactive display of the payout asset(s) with a
 * "fixed for this transaction" hint — so a flow with no payout choice (e.g. the managed collect
 * without per-token fee data) still states what the user receives instead of hiding the section.
 */
"use client";

import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { cn } from "@/lib/utils/cn";
import {
  floorSlippage,
  SLIPPAGE_MAX,
  SLIPPAGE_MIN,
  SLIPPAGE_PRESETS,
  sanitizeSlippageInput,
  slippageSeverity,
} from "../lib/slippage";

/** Public props for {@link TransactionSettingsDialog}. */
export interface TransactionSettingsDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void;
  /** Current slippage tolerance, in percent. Omit to hide the section (no swap in the flow). */
  slippage?: number;
  /** Called with the next slippage tolerance, in percent. */
  onSlippageChange?: (value: number) => void;
  /**
   * Upper bound for the custom slippage input, in percent. Defaults to `SLIPPAGE_MAX` (100). POO-547:
   * every flow shares this default now (no per-flow cap), so no caller overrides it; the prop stays
   * for the rare future flow that needs a tighter ceiling.
   */
  slippageMax?: number;
  /** Current transaction deadline, in minutes. Omit to hide the section. */
  deadlineMins?: number;
  /**
   * Called with the next transaction deadline, in minutes. POO-513 R4: currently never fires (the
   * field renders disabled as "Coming soon"); it still gates the section and stays in the contract
   * for the real-deadline wiring.
   */
  onDeadlineChange?: (value: number) => void;
  /** Currently selected receive asset (a symbol from {@link receiveOptions}). Omit to hide the section. */
  receiveAs?: string;
  /**
   * Called with the next receive asset. Omit (while passing {@link receiveAs} + options) to render
   * the section as a FIXED, non-interactive display of the payout asset (POO-525 R2).
   */
  onReceiveAsChange?: (value: string) => void;
  /** Assets the user can receive (manager-defined); the first is the default, typically USDC. */
  receiveOptions?: string[];
}

/** Transaction-settings dialog: slippage + deadline + receive-as. */
export function TransactionSettingsDialog({
  open,
  onOpenChange,
  slippage,
  onSlippageChange,
  slippageMax = SLIPPAGE_MAX,
  deadlineMins,
  onDeadlineChange,
  receiveAs,
  onReceiveAsChange,
  receiveOptions,
}: TransactionSettingsDialogProps) {
  const t = useTranslations("strategies");
  // The "Coming soon" badge label is the shared profile key (same one BuildStep/ReviewStep reuse).
  const tProfile = useTranslations("profile");
  // The custom field is text-backed so it accepts a clean 0-`slippageMax` value (one decimal) and
  // never shows the "000" artifact a controlled number input produced (POO-403 R6). Seeded from a
  // custom (non-preset) starting slippage; preset clicks clear it.
  const seedCustomText = (value: number | undefined) =>
    value != null && !SLIPPAGE_PRESETS.some((preset) => preset === value) ? String(value) : "";
  const [customText, setCustomText] = useState(() => seedCustomText(slippage));
  // POO-513 R1: the custom text is derived from the `slippage` prop. The component stays mounted
  // across the host modal's close (it sits next to the flow dialog), so when the host resets its
  // slippage the seed-once state above would keep displaying the stale custom value while the tx
  // builds with the default (the reported 1.7-shown / 2-built desync). Re-seed on any external
  // prop change; in-dialog typing (where the parsed text already equals the prop) stays untouched
  // so in-progress entries like "1." survive.
  const [syncedSlippage, setSyncedSlippage] = useState(slippage);
  if (slippage !== syncedSlippage) {
    setSyncedSlippage(slippage);
    const parsed = Number.parseFloat(customText);
    if (!(Number.isFinite(parsed) && parsed === slippage)) setCustomText(seedCustomText(slippage));
  }
  const customActive = customText !== "";
  const severity = slippageSeverity(slippage ?? 0);

  function selectPreset(preset: number) {
    setCustomText("");
    onSlippageChange?.(preset);
  }

  function handleCustomSlippage(text: string) {
    const cleaned = sanitizeSlippageInput(text, slippageMax);
    setCustomText(cleaned);
    const next = Number.parseFloat(cleaned);
    if (Number.isFinite(next)) onSlippageChange?.(next);
  }

  // POO-547 R4: apply the 0.1% floor on commit (blur), not per keystroke — so an in-progress "0."
  // stays typeable while focused. An empty field is left empty (the host's default seed applies);
  // a positive value under the floor snaps up to 0.1% in both the field and the committed value.
  function handleCustomSlippageBlur() {
    const parsed = Number.parseFloat(customText);
    if (!Number.isFinite(parsed)) return;
    const floored = floorSlippage(parsed, SLIPPAGE_MIN);
    if (floored === parsed) return;
    setCustomText(String(floored));
    onSlippageChange?.(floored);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("invest.settings.title")}</DialogTitle>
        </DialogHeader>

        {/* Max slippage — only where a swap occurs: invest zap-in / withdraw zap-out / collect with
            a non-USDC payout (POO-280 R5d, re-added to collect by POO-384 R6). */}
        {slippage != null && onSlippageChange ? (
          <div className="flex flex-col gap-2">
            <p className="font-medium text-foreground text-sm">
              {t("invest.settings.slippageLabel")}
            </p>
            {/* POO-842 R3: below sm the 3 presets share the first row and the custom field takes
                its own full-width row — the shared 4-column cell left ~48px of input at 375px,
                where the pt-BR "Personalizado" placeholder was unreadable and a typed value
                collided with the % suffix. sm+ keeps the single 4-column row. */}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {SLIPPAGE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => selectPreset(preset)}
                  className={cn(
                    "rounded-lg border px-2 py-2 font-medium text-sm transition-colors",
                    !customActive && slippage === preset
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-foreground hover:bg-surface-raised",
                  )}
                >
                  {preset}%
                </button>
              ))}
              <div
                className={cn(
                  "col-span-3 flex items-center rounded-lg border px-2 sm:col-span-1",
                  customActive ? "border-primary" : "border-border",
                )}
              >
                <input
                  type="text"
                  inputMode="decimal"
                  value={customText}
                  onChange={(event) => handleCustomSlippage(event.target.value)}
                  onBlur={handleCustomSlippageBlur}
                  placeholder={t("invest.settings.custom")}
                  aria-label={t("invest.settings.custom")}
                  // POO-848 R3: 16px below sm (iOS zooms on focused inputs under 16px).
                  className="w-full min-w-0 bg-transparent text-right text-base text-foreground outline-none placeholder:text-muted-foreground/70 sm:text-sm"
                />
                <span className="pl-0.5 text-muted-foreground text-sm">%</span>
              </div>
            </div>

            {/* POO-403 R6: warn on a High (> 5%) / Very high (> 20%) slippage setting. */}
            {severity !== "none" ? (
              <div className="flex items-start gap-1.5">
                <TriangleAlert
                  className={cn(
                    "mt-0.5 size-3.5 shrink-0",
                    severity === "veryHigh" ? "text-destructive" : "text-warning",
                  )}
                  aria-hidden="true"
                />
                <div className="flex flex-col">
                  <span
                    className={cn(
                      "font-medium text-xs",
                      severity === "veryHigh" ? "text-destructive" : "text-warning",
                    )}
                  >
                    {severity === "veryHigh"
                      ? t("invest.settings.slippageVeryHigh")
                      : t("invest.settings.slippageHigh")}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t("invest.settings.slippageWarningBody")}
                  </span>
                </div>
              </div>
            ) : null}

            <p className="text-muted-foreground text-xs">{t("invest.settings.slippageHint")}</p>
          </div>
        ) : null}

        {/* Transaction deadline, paired with slippage (swap flows: invest / withdraw / collect).
            POO-513 R4: display-only for now (NO build consumes the deadline yet), so the field is
            disabled with a "Coming soon" badge and a neutral hint (the old copy promised a
            cancellation that never happened). PP-INTEGRATION-POINT: when the backend build-tx
            consumes a deadline, re-enable the input (restore onChange -> onDeadlineChange, 1-180
            min) and swap the hint back to the cancellation copy. */}
        {deadlineMins != null && onDeadlineChange ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <p className="font-medium text-foreground text-sm">
                {t("invest.settings.deadlineLabel")}
              </p>
              <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground text-xs">
                {tProfile("security.comingSoon")}
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 opacity-60">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={180}
                step={1}
                value={deadlineMins}
                disabled
                aria-label={t("invest.settings.deadlineLabel")}
                // POO-848 R3: 16px below sm, matching the slippage input (disabled today, but the
                // coming-soon unlock must not reintroduce the focus zoom).
                className="w-full min-w-0 bg-transparent text-base text-foreground outline-none [appearance:textfield] sm:text-sm [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="shrink-0 text-muted-foreground text-sm">
                {t("invest.settings.deadlineUnit")}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">{t("invest.settings.deadlineHint")}</p>
          </div>
        ) : null}

        {/* Receive as (collect-style flows only — hidden when the caller doesn't wire it). POO-525
            R2: with no onReceiveAsChange the section is a fixed, non-interactive display (the flow
            has no payout choice), so the gear still states what the user receives. */}
        {receiveAs != null && receiveOptions ? (
          <div className="flex flex-col gap-2">
            <p className="font-medium text-foreground text-sm">
              {t("invest.settings.receiveAsLabel")}
            </p>
            <div className="flex flex-wrap gap-2">
              {onReceiveAsChange ? (
                receiveOptions.map((token) => (
                  <button
                    key={token}
                    type="button"
                    onClick={() => onReceiveAsChange(token)}
                    className={cn(
                      "rounded-lg border px-3 py-2 font-medium text-sm transition-colors",
                      receiveAs === token
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-foreground hover:bg-surface-raised",
                    )}
                  >
                    {token}
                  </button>
                ))
              ) : (
                <span className="rounded-lg border border-border bg-surface-raised px-3 py-2 font-medium text-muted-foreground text-sm">
                  {receiveAs}
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-xs">
              {onReceiveAsChange
                ? t("invest.settings.receiveAsHint")
                : t("invest.settings.receiveAsFixedHint")}
            </p>
          </div>
        ) : null}

        <Button className="w-full" size="lg" onClick={() => onOpenChange(false)}>
          {t("invest.settings.done")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
