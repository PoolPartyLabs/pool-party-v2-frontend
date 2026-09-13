/**
 * @id PP-CP-SCR-001
 * @name CashPlusView
 * @i18n-namespace cashPlus
 * @implements-rules-version v1
 * Pure investor page composition driven by an explicit controller.
 */
"use client";
import { CircleAlert, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import type { CashPlusController } from "@/lib/cash-plus/types";
import { INVESTOR_HIDE_VALUES_KEY, PersistedMaskProvider } from "@/lib/hooks/maskValue";
import {
  CashPlusChart,
  CashPlusFlow,
  CashPlusHero,
  CashPlusPositionCard,
  CashPlusReturnSources,
  CashPlusSkeleton,
} from "./CashPlusDashboard";
import {
  CashPlusActivity,
  CashPlusComposition,
  CashPlusDemoPanel,
  CashPlusDetails,
} from "./CashPlusDetails";
import { CashPlusInvestPanel } from "./CashPlusInvestPanel";
import { CashPlusSimulation } from "./CashPlusSimulation";
import { CashPlusTransactionSheet } from "./CashPlusTransactionSheet";

export interface CashPlusViewProps {
  /** Live controller or clearly labeled preview fixture. */
  controller: CashPlusController;
}

export function CashPlusView({ controller }: CashPlusViewProps) {
  const t = useTranslations("cashPlus");
  const { snapshot, status, transaction } = controller;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setDismissed(transaction.phase === "idle");
  }, [transaction.phase]);
  function changeSheet(open: boolean) {
    if (!open) {
      setDismissed(true);
      // Submitted operation identity stays intact until its receipt is resolved.
      if (!["pending", "approval", "signature", "preflight"].includes(transaction.phase))
        controller.resetTransaction();
    } else setDismissed(false);
  }
  if (!snapshot && status === "loading") return <CashPlusSkeleton />;
  if (!snapshot)
    return (
      <div className="space-y-6">
        <CashPlusHero controller={controller} />
        <ErrorState
          title={t("errorTitle")}
          description={t("errorBody")}
          onRetry={() => {
            void controller.refresh();
          }}
          retryLabel={t("refresh")}
        />
      </div>
    );

  return (
    <PersistedMaskProvider persistKey={INVESTOR_HIDE_VALUES_KEY}>
      <div className="flex min-w-0 flex-col gap-6 pb-6">
        <CashPlusHero controller={controller} />
        {snapshot.mode !== "live" ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-3 text-muted-foreground text-xs leading-relaxed">
            {snapshot.mode === "preview" ? t("previewNotice") : t("forkNotice")}
          </p>
        ) : null}
        {status === "stale" || status === "error" ? (
          <div
            role="status"
            className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-warning text-xs leading-relaxed"
          >
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
            {t("stale")}
          </div>
        ) : null}
        {transaction.phase === "pending" && dismissed ? (
          <div
            role="status"
            className="flex items-center justify-between gap-4 rounded-lg border border-primary/20 bg-primary/5 p-4"
          >
            <span className="inline-flex items-center gap-2 text-sm">
              <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
              {t("transaction.pending")}
            </span>
            <Button size="sm" variant="secondary" onClick={() => setDismissed(false)}>
              {t("activity.receipt")}
            </Button>
          </div>
        ) : null}
        <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-6">
            <CashPlusPositionCard snapshot={snapshot} className="order-1" />
            <CashPlusChart snapshot={snapshot} className="order-3" />
            <CashPlusReturnSources snapshot={snapshot} className="order-4" />
            <CashPlusFlow snapshot={snapshot} className="order-5" />
            <CashPlusActivity
              snapshot={snapshot}
              className="order-6"
              onLoadEarlier={controller.loadEarlierHistory}
            />
          </div>
          <aside className="order-2 min-w-0 space-y-5 lg:sticky lg:top-6">
            <CashPlusInvestPanel
              key={`${controller.wallet.address ?? "disconnected"}-${controller.wallet.correctChain}`}
              controller={controller}
            />
            <div className="hidden lg:block">
              <CashPlusComposition snapshot={snapshot} />
            </div>
            <div className="hidden lg:block">
              <CashPlusDetails snapshot={snapshot} />
            </div>
          </aside>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:hidden">
          <CashPlusComposition snapshot={snapshot} />
          <CashPlusDetails snapshot={snapshot} />
        </div>
        <CashPlusSimulation />
        <CashPlusDemoPanel snapshot={snapshot} />
        <CashPlusTransactionSheet
          controller={controller}
          open={transaction.phase !== "idle" && !dismissed}
          onOpenChange={changeSheet}
        />
      </div>
    </PersistedMaskProvider>
  );
}
