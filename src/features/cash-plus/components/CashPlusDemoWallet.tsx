/** @id PP-CP-CMP-006 @name Cash+ simulated wallet presentation @implements-rules-version v1 */
"use client";
import { Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { TokenLogo } from "@/components/data-display/TokenLogo";
import { Button } from "@/components/ui/Button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/Sheet";
import type { CashPlusController } from "@/lib/cash-plus/types";
import { cashPlusMoney } from "./CashPlusPresentation";

export function CashPlusDemoWallet({ controller }: { controller: CashPlusController }) {
  const t = useTranslations("cashPlus");
  const [open, setOpen] = useState(false);
  if (controller.snapshot?.mode !== "preview") return null;
  return (
    <>
      <button
        type="button"
        aria-label={t("demoUI.wallet")}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-2 text-xs transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Wallet className="size-4 text-primary" aria-hidden="true" />
        <span className="text-muted-foreground">{t("demoUI.wallet")}</span>
        <span className="font-semibold tabular-nums">
          {cashPlusMoney(controller.wallet.balanceAssets, t("unavailable"))}
        </span>
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="gap-6 sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-dvh sm:max-w-md sm:translate-x-0 sm:translate-y-0 sm:rounded-none sm:rounded-l-2xl sm:p-7">
          <div className="space-y-3">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Wallet className="size-6" aria-hidden="true" />
            </div>
            <SheetTitle>{t("demoUI.wallet")}</SheetTitle>
            <SheetDescription>{t("demoUI.hint")}</SheetDescription>
          </div>
          <div className="rounded-xl border border-border bg-background p-5">
            <div className="flex items-center gap-3">
              <TokenLogo symbol="USDC" className="size-9" />
              <span className="font-semibold">USDC</span>
            </div>
            <p className="mt-6 font-semibold text-4xl tabular-nums">
              {cashPlusMoney(controller.wallet.balanceAssets, t("unavailable"))}
            </p>
            <p className="mt-2 text-muted-foreground text-xs">{t("preview")}</p>
          </div>
          <p className="break-all rounded-lg bg-background p-4 font-mono text-muted-foreground text-xs">
            {controller.wallet.address}
          </p>
          <p className="text-muted-foreground text-xs">Pool Party · Privy</p>
          <Button className="mt-auto w-full" onClick={() => setOpen(false)}>
            {t("transaction.done")}
          </Button>
        </SheetContent>
      </Sheet>
    </>
  );
}
