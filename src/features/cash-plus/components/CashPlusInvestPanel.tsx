/**
 * @id PP-CP-CMP-002
 * @name CashPlusInvestPanel
 * @i18n-namespace cashPlus
 * @implements-rules-version v1
 * Exact amount entry and explicit cash or proportional exit selection.
 */
"use client";
import { ArrowDownToLine, ArrowLeft, ArrowUpRight, ShieldCheck, Wallet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { formatUnits } from "viem";
import { TokenLogo } from "@/components/data-display/TokenLogo";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { canonicalCashPlusAmount, parseCashPlusAmount } from "@/lib/cash-plus/amounts";
import type { CashPlusController } from "@/lib/cash-plus/types";
import { cn } from "@/lib/utils/cn";
import { CashPlusRow, cashPlusMoney } from "./CashPlusPresentation";

export interface CashPlusInvestPanelProps {
  /** The live or explicitly illustrative controller; presentation never submits directly. */
  controller: CashPlusController;
  /** Additional card styling. */
  className?: string;
}

export function CashPlusInvestPanel({ controller, className }: CashPlusInvestPanelProps) {
  // CP-TX05: remount the form when the signing identity or network readiness changes.
  return (
    <CashPlusInvestForm
      key={`${controller.wallet.address ?? "disconnected"}-${controller.wallet.correctChain}`}
      controller={controller}
      className={className}
    />
  );
}

function CashPlusInvestForm({ controller, className }: CashPlusInvestPanelProps) {
  const t = useTranslations("cashPlus");
  const locale = useLocale();
  const id = useId();
  const [amount, setAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [all, setAll] = useState(false);
  const [touched, setTouched] = useState(false);
  const { snapshot, wallet, transaction, status } = controller;
  const busy = ["preflight", "review", "approval", "signature", "pending"].includes(
    transaction.phase,
  );
  const unavailable = t("unavailable");
  const healthy = status === "ready" && snapshot !== null;
  const mayInvest =
    healthy &&
    !snapshot.depositsPaused &&
    snapshot.oracleHealthy &&
    snapshot.capacityAssets !== null &&
    snapshot.capacityAssets > BigInt("0");
  const hasShares = snapshot !== null && snapshot.accountShares > BigInt("0");
  const canReadWallet = wallet.balanceAssets !== null;
  const max =
    wallet.balanceAssets !== null &&
    snapshot?.capacityAssets !== null &&
    snapshot?.capacityAssets !== undefined
      ? wallet.balanceAssets < snapshot.capacityAssets
        ? wallet.balanceAssets
        : snapshot.capacityAssets
      : null;
  const decimalSeparator =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")
      ?.value ?? ".";
  const localAmount = (raw: bigint) => formatUnits(raw, 6).replace(".", decimalSeparator);
  let normalized = "";
  let validation = "";
  try {
    normalized = canonicalCashPlusAmount(amount, locale);
    const raw = parseCashPlusAmount(normalized);
    if (!withdrawing && wallet.balanceAssets !== null && raw > wallet.balanceAssets)
      validation = t("invest.overBalance");
    else if (
      !withdrawing &&
      snapshot?.capacityAssets !== null &&
      snapshot?.capacityAssets !== undefined &&
      raw > snapshot.capacityAssets
    )
      validation = t("invest.overCapacity");
    else if (!withdrawing && snapshot && raw < snapshot.minimumDepositAssets)
      validation = t("invest.belowMinimum");
    else if (
      withdrawing &&
      snapshot?.accountAssets !== null &&
      snapshot?.accountAssets !== undefined &&
      raw > snapshot.accountAssets
    )
      validation = t("invest.overBalance");
  } catch {
    validation = t("invest.invalid");
  }

  useEffect(() => {
    if (transaction.phase === "success") {
      setAmount("");
      setAll(false);
      setTouched(false);
    }
  }, [transaction.phase]);

  function switchMode(next: boolean) {
    setWithdrawing(next);
    setAmount("");
    setAll(false);
    setTouched(false);
  }
  function review() {
    setTouched(true);
    if ((!all && validation) || !healthy || busy || !wallet.connected || !wallet.correctChain)
      return;
    if (!withdrawing && (!mayInvest || !canReadWallet)) return;
    // PP-INTEGRATION-POINT: the controller refreshes, simulates and binds the exact amount to the connected wallet.
    void controller.review(withdrawing ? "redeem" : "deposit", all ? "all" : normalized);
  }

  return (
    <Card className={cn("overflow-hidden rounded-xl", className)}>
      <div className="h-1 bg-primary" aria-hidden="true" />
      <form
        className="flex flex-col gap-5 p-5 xl:p-6"
        onSubmit={(event) => {
          event.preventDefault();
          review();
        }}
        noValidate
      >
        <div>
          {withdrawing ? (
            <button
              type="button"
              onClick={() => switchMode(false)}
              disabled={busy}
              className="mb-3 inline-flex items-center gap-1.5 rounded text-muted-foreground text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              {t("invest.back")}
            </button>
          ) : null}
          <h2 className="font-semibold text-lg">
            {withdrawing ? t("invest.withdrawTitle") : t("invest.title")}
          </h2>
          <p className="mt-1 text-muted-foreground text-sm">
            {withdrawing ? t("position.liquidity") : t("invest.subtitle")}
          </p>
        </div>
        <div>
          <label htmlFor={id} className="mb-2 block font-medium text-xs">
            {withdrawing ? t("invest.withdrawAmount") : t("invest.amount")}
          </label>
          <div
            className={cn(
              "rounded-xl border bg-background p-4 focus-within:ring-2 focus-within:ring-ring",
              touched && validation && !all ? "border-destructive" : "border-border",
            )}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 font-medium text-sm">
                <TokenLogo symbol="USDC" className="size-6" />
                USDC
              </span>
              <button
                type="button"
                disabled={
                  busy ||
                  (withdrawing
                    ? !healthy || !hasShares
                    : max === null || max <= BigInt("0") || !mayInvest)
                }
                onClick={() => {
                  if (withdrawing) {
                    setAll(true);
                    setAmount(
                      snapshot?.accountAssets != null ? localAmount(snapshot.accountAssets) : "",
                    );
                  } else if (max !== null) {
                    setAmount(localAmount(max));
                  }
                  setTouched(false);
                }}
                className="rounded-md bg-primary/10 px-2.5 py-1 font-medium text-primary text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
              >
                {withdrawing ? t("invest.all") : t("invest.max")}
              </button>
            </div>
            <input
              id={id}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              maxLength={120}
              placeholder="0.00"
              value={amount}
              disabled={busy}
              onChange={(event) => {
                setAmount(event.target.value);
                setAll(false);
                setTouched(true);
              }}
              aria-invalid={touched && Boolean(validation) && !all}
              aria-describedby={`${id}-feedback`}
              className="w-full min-w-0 bg-transparent font-semibold text-3xl tabular-nums outline-none placeholder:text-muted-foreground/50"
            />
          </div>
          <div id={`${id}-feedback`} className="mt-2 min-h-4 text-xs" aria-live="polite">
            {touched && validation && !all ? (
              <p className="text-destructive">{validation}</p>
            ) : (
              <CashPlusRow
                label={withdrawing ? t("position.available") : t("invest.wallet")}
                personal
              >
                {cashPlusMoney(
                  withdrawing ? snapshot?.withdrawableAssets : wallet.balanceAssets,
                  unavailable,
                )}
              </CashPlusRow>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {!wallet.connected ? (
            <Button size="lg" className="w-full" onClick={controller.connect}>
              <Wallet className="size-4" aria-hidden="true" />
              {t("invest.connect")}
            </Button>
          ) : !wallet.correctChain ? (
            <Button
              size="lg"
              className="w-full"
              onClick={() => {
                void controller.switchNetwork();
              }}
            >
              {t("invest.switch")}
            </Button>
          ) : (
            <Button
              type="submit"
              size="lg"
              className="w-full text-sm"
              loading={transaction.phase === "preflight"}
              disabled={
                busy ||
                !healthy ||
                (!withdrawing && (!mayInvest || !canReadWallet)) ||
                (withdrawing && !hasShares)
              }
            >
              {withdrawing ? t("invest.withdrawAction") : t("invest.action")}
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Button>
          )}
          {!withdrawing && hasShares ? (
            <Button
              variant="secondary"
              className="w-full"
              disabled={busy}
              onClick={() => switchMode(true)}
            >
              <ArrowDownToLine className="size-4" aria-hidden="true" />
              {t("invest.withdraw")}
            </Button>
          ) : null}
          <p className="text-center text-muted-foreground text-xs">{t("invest.hint")}</p>
        </div>
        {withdrawing && hasShares ? (
          <div className="border-border border-t pt-4">
            {snapshot.withdrawableAssets !== null &&
            snapshot.accountAssets !== null &&
            snapshot.withdrawableAssets < snapshot.accountAssets ? (
              <p className="mb-3 text-warning text-xs">{t("invest.cashLimited")}</p>
            ) : null}
            <button
              type="button"
              disabled={!healthy || busy}
              onClick={() => {
                void controller.review("proportional", "all");
              }}
              className="rounded text-left font-medium text-primary text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {t("invest.proportional")}
            </button>
            <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
              {t("invest.proportionalHelp")}
            </p>
          </div>
        ) : (
          <div className="space-y-3 border-border border-t pt-4">
            <CashPlusRow label={t("invest.capacity")}>
              {cashPlusMoney(snapshot?.capacityAssets, unavailable, false, true)}
            </CashPlusRow>
            <CashPlusRow label={t("invest.minimum")}>
              {cashPlusMoney(snapshot?.minimumDepositAssets, unavailable)}
            </CashPlusRow>
            <div className="flex gap-2 text-muted-foreground text-xs leading-relaxed">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                {snapshot?.depositsPaused
                  ? t("invest.paused")
                  : snapshot?.capacityAssets === BigInt("0")
                    ? t("invest.full")
                    : !canReadWallet && wallet.connected
                      ? t("invest.unreadBalance")
                      : t("position.accounting")}
              </p>
            </div>
          </div>
        )}
      </form>
    </Card>
  );
}
