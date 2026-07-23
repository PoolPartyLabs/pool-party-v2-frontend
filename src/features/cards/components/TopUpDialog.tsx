/**
 * @id PP-CARD-CMP-004
 * @name Top Up Dialog
 * @implements-rules-version v1
 *
 * The rechargeable-balance Top up flow as a modal: enter an amount (custom keypad on mobile, typed
 * input on desktop, quick-add chips on both) and confirm. Funds come from the wallet. Mirrors the
 * Deposit amount-entry pattern. The parent owns the service call (cardsService.topUp) via onConfirm.
 */
"use client";

import { Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { AmountKeypad } from "@/features/deposit/components/AmountKeypad";
import { formatUsd } from "@/lib/utils/format";
import { applyKeypadKey, sanitizeNumericInput } from "@/lib/utils/numericInput";

/** Round to cents, drop trailing zeros, as a raw string. */
function toText(value: number): string {
  return String(Number(value.toFixed(2)));
}

/** Quick-add increments (USD). */
const INCREMENTS = [50, 100, 250] as const;

/** Public props for {@link TopUpDialog}. */
export interface TopUpDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void;
  /** Called with the chosen amount (USD) when the user confirms. */
  onConfirm: (amountUsd: number) => void;
}

/** The Top up modal. */
export function TopUpDialog({ open, onOpenChange, onConfirm }: TopUpDialogProps) {
  const t = useTranslations("cards");
  const [amountText, setAmountText] = useState("50");
  const amount = Number.parseFloat(amountText) || 0;

  function applyKey(key: string) {
    setAmountText((prev) => applyKeypadKey(prev, key, { maxDecimals: 2 }));
  }

  function confirm() {
    if (amount <= 0) return;
    onConfirm(amount);
    setAmountText("50");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("topUp.title")}</DialogTitle>
          <DialogDescription>{t("topUp.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-2 pt-1">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-muted-foreground text-xs">
            <Wallet className="size-3.5" aria-hidden="true" />
            {t("topUp.source.wallet")}
          </span>
          {/* Mobile: static display driven by the keypad. */}
          <p className="flex items-center font-bold text-4xl text-foreground lg:hidden">
            <span>$</span>
            <span>{amountText || "0"}</span>
          </p>
          {/* Desktop: typed input. */}
          <div className="hidden items-center font-bold text-4xl text-foreground lg:flex">
            <span>$</span>
            <input
              type="text"
              inputMode="decimal"
              aria-label={t("topUp.title")}
              value={amountText}
              onChange={(event) =>
                setAmountText(sanitizeNumericInput(event.target.value, { maxDecimals: 2 }))
              }
              className="w-40 bg-transparent text-center outline-none placeholder:text-muted-foreground"
              placeholder="0"
            />
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {INCREMENTS.map((inc) => (
            <button
              key={inc}
              type="button"
              onClick={() => setAmountText(toText(amount + inc))}
              className="rounded-full border border-border px-3 py-1.5 font-medium text-muted-foreground text-sm transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              +{formatUsd(inc)}
            </button>
          ))}
        </div>

        <AmountKeypad className="lg:hidden" onKey={applyKey} />

        <DialogFooter>
          <Button className="w-full" size="lg" disabled={amount <= 0} onClick={confirm}>
            {t("topUp.cta")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
