/**
 * @id PP-CP-MOD-001
 * @name CashPlusTransactionSheet
 * @i18n-namespace cashPlus
 * @implements-rules-version v1
 * Accessible review and receipt presentation driven entirely by the transaction controller.
 */
"use client";
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  ExternalLink,
  Loader2,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { formatUnits } from "viem";
import { TokenLogo } from "@/components/data-display/TokenLogo";
import { Button } from "@/components/ui/Button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/Sheet";
import type { CashPlusController } from "@/lib/cash-plus/types";
import { cn } from "@/lib/utils/cn";
import { CashPlusRow, cashPlusMoney } from "./CashPlusPresentation";

export interface CashPlusTransactionSheetProps {
  /** Controller providing the authoritative transaction phase and decoded receipt. */
  controller: CashPlusController;
  /** Whether the review or current operation is visible. */
  open: boolean;
  /** Dismisses presentation; submitted transactions remain in the controller journal. */
  onOpenChange: (open: boolean) => void;
}

export function CashPlusTransactionSheet({
  controller,
  open,
  onOpenChange,
}: CashPlusTransactionSheetProps) {
  const t = useTranslations("cashPlus");
  const { transaction: tx, snapshot } = controller;
  const heading = useRef<HTMLHeadingElement>(null);
  const openingAction = useRef<HTMLElement | null>(null);
  const pending = tx.phase === "pending";
  const signing = tx.phase === "approval" || tx.phase === "signature";
  const success = tx.phase === "success" && Boolean(tx.receipt);
  const reviewing = tx.phase === "review";
  const failed = tx.phase === "error";
  const proportional = tx.kind === "proportional";
  const title = success
    ? t("transaction.success")
    : failed
      ? t("transaction.error")
      : pending
        ? t("transaction.pending")
        : tx.phase === "approval"
          ? t("transaction.approval")
          : tx.phase === "signature"
            ? t("transaction.signature")
            : tx.phase === "preflight"
              ? t("transaction.preflight")
              : proportional
                ? t("transaction.reviewProportional")
                : tx.kind === "deposit"
                  ? t("transaction.reviewInvest")
                  : t("transaction.reviewWithdraw");
  const description = success
    ? t("transaction.successBody")
    : pending
      ? t("transaction.pendingBody")
      : tx.phase === "approval"
        ? t("transaction.approvalBody")
        : tx.phase === "signature"
          ? t("transaction.signatureBody")
          : t("transaction.reviewBody");
  const amount = success ? tx.receipt?.assets : tx.amountAssets;
  const outputs = success ? tx.receipt?.tokens : tx.outputs;
  const hash = tx.receipt?.hash ?? tx.hash;
  const errorCode = tx.errorCode ?? "UNKNOWN";
  const errorMessage =
    errorCode === "PREVIEW_ONLY"
      ? t("transaction.previewOnly")
      : errorCode === "USER_REJECTED"
        ? t("transaction.rejected")
        : [
              "WALLET_CHANGED",
              "WRONG_NETWORK",
              "WRONG_CHAIN",
              "TX_CANCELLED",
              "POLICY_CHANGED",
              "QUOTE_EXPIRED",
              "MIN_OUTPUT_NOT_MET",
              "TX_REPLACED",
            ].includes(errorCode)
          ? t("transaction.changed")
          : errorCode === "LIQUIDITY_INSUFFICIENT"
            ? t("transaction.liquidity")
            : errorCode === "READ_UNAVAILABLE"
              ? t("transaction.read")
              : errorCode === "INSUFFICIENT_GAS"
                ? t("transaction.gas")
                : ["ORACLE_INVALID", "SEQUENCER_UNAVAILABLE"].includes(errorCode)
                  ? t("transaction.oracle")
                  : errorCode === "TX_REVERTED"
                    ? t("transaction.reverted")
                    : errorCode === "TX_TIMEOUT"
                      ? t("transaction.timeout")
                      : errorCode === "AMOUNT_INVALID"
                        ? t("invest.invalid")
                        : errorCode === "INSUFFICIENT_USDC"
                          ? t("invest.overBalance")
                          : errorCode === "CAPACITY_FULL"
                            ? t("invest.full")
                            : errorCode === "DEPOSIT_PAUSED"
                              ? t("invest.paused")
                              : t("transaction.generic");

  // Each new step is announced and focus leaves the old action button before Enter can be repeated.
  useEffect(() => {
    if (open && tx.phase !== "idle") heading.current?.focus();
  }, [tx.phase, open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          openingAction.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          heading.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (openingAction.current?.isConnected) openingAction.current.focus();
        }}
        showClose={false}
        disableSwipe={signing}
        onInteractOutside={(event) => {
          if (reviewing || signing) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (signing) event.preventDefault();
        }}
        className="gap-6 sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-dvh sm:max-w-md sm:translate-x-0 sm:translate-y-0 sm:rounded-none sm:rounded-l-2xl sm:p-7"
      >
        <div className="flex items-center justify-between gap-4">
          <span className="font-semibold text-sm">{t("name")}</span>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={signing}
            aria-label={t("transaction.close")}
            className="rounded p-2 text-muted-foreground hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="py-2" aria-live="polite">
          <div
            className={cn(
              "mb-5 flex size-14 items-center justify-center rounded-full",
              success
                ? "bg-success/10 text-success"
                : failed
                  ? "bg-warning/10 text-warning"
                  : "bg-primary/10 text-primary",
            )}
          >
            {success ? (
              <Check className="size-6" aria-hidden="true" />
            ) : failed ? (
              <CircleAlert className="size-6" aria-hidden="true" />
            ) : pending || tx.phase === "preflight" ? (
              <Loader2 className="size-6 motion-safe:animate-spin" aria-hidden="true" />
            ) : signing ? (
              <Wallet className="size-6" aria-hidden="true" />
            ) : (
              <ArrowUpRight className="size-6" aria-hidden="true" />
            )}
          </div>
          <SheetTitle ref={heading} tabIndex={-1} className="pr-2 text-2xl outline-none">
            {title}
          </SheetTitle>
          <SheetDescription className="mt-3 text-sm leading-relaxed">
            {failed ? errorMessage : description}
          </SheetDescription>
        </div>
        {snapshot?.mode === "preview" ? (
          <p className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-primary text-xs leading-relaxed">
            {t("transaction.previewOnly")}
          </p>
        ) : null}
        {(reviewing || success) && amount !== undefined && amount !== null ? (
          <div className="rounded-xl border border-border bg-background p-5">
            <p className="text-muted-foreground text-xs">{t("transaction.amount")}</p>
            <div className="mt-3 flex items-center gap-3">
              <TokenLogo symbol="USDC" className="size-8" />
              <p className="min-w-0 break-all font-semibold text-2xl tabular-nums">
                {formatUnits(amount, 6)} <span className="text-muted-foreground text-sm">USDC</span>
              </p>
            </div>
            <p className="mt-2 text-muted-foreground text-sm tabular-nums">
              {cashPlusMoney(amount, t("unavailable"))}
            </p>
          </div>
        ) : null}
        {proportional && (reviewing || success) ? (
          <div>
            <h3 className="mb-3 font-medium text-sm">
              {reviewing ? t("transaction.minimumComponents") : t("transaction.receive")}
            </h3>
            <div className="space-y-3 rounded-xl border border-border bg-background p-4">
              {outputs?.map((token) => (
                <div key={token.address} className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-sm">
                    <TokenLogo symbol={token.symbol} className="size-6" />
                    {token.symbol}
                  </span>
                  <span className="min-w-0 break-all text-right font-medium text-sm tabular-nums">
                    {formatUnits(token.amount, token.decimals)}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 rounded-lg bg-warning/10 p-3 text-warning text-xs leading-relaxed">
              {t("transaction.noCash")}
            </p>
          </div>
        ) : null}
        {reviewing ? (
          <div className="space-y-4 border-border border-y py-5">
            <CashPlusRow label={t("transaction.network")}>
              {snapshot?.networkName ?? t("unavailable")}
            </CashPlusRow>
            {tx.minAssets !== undefined ? (
              <CashPlusRow label={t("transaction.minimum")}>
                {formatUnits(tx.minAssets, 6)} USDC
              </CashPlusRow>
            ) : null}
            {tx.minShares !== undefined ? (
              <CashPlusRow label={t("transaction.minimumShares")}>
                {formatUnits(tx.minShares, 18)}
              </CashPlusRow>
            ) : null}
            <CashPlusRow label={t("transaction.fee")}>{t("transaction.feeValue")}</CashPlusRow>
          </div>
        ) : null}
        {hash ? (
          <div className="space-y-2 rounded-lg bg-background p-4">
            <p className="text-muted-foreground text-xs">{t("transaction.hash")}</p>
            <p className="break-all font-mono text-xs">{hash}</p>
            {snapshot?.explorerUrl ? (
              <a
                href={`${snapshot.explorerUrl}/tx/${hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded text-primary text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("transaction.receipt")}
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            ) : (
              <p className="text-muted-foreground text-xs">{t("activity.localReceipt")}</p>
            )}
          </div>
        ) : null}
        <div className="mt-auto space-y-3 pt-4">
          {reviewing ? (
            <>
              <Button
                size="lg"
                className="w-full"
                onClick={() => {
                  void controller.confirm();
                }}
              >
                {t("transaction.confirm")}
              </Button>
              <p className="flex items-center justify-center gap-1.5 text-muted-foreground text-[10px]">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                {t("invest.hint")}
              </p>
            </>
          ) : !signing && tx.phase !== "preflight" ? (
            <Button
              className="w-full"
              variant={pending ? "secondary" : "primary"}
              onClick={() => onOpenChange(false)}
            >
              {success
                ? t("transaction.done")
                : failed
                  ? t("transaction.back")
                  : t("transaction.close")}
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
