/**
 * @id PP-CP-CMP-001
 * @name CashPlusDashboard
 * @i18n-namespace cashPlus
 * @implements-rules-version v1
 * Observed position, history and return sources using the existing Pool Party visual language.
 */
"use client";
import {
  ArrowLeftRight,
  ArrowUpRight,
  ChartNoAxesCombined,
  Check,
  CircleDollarSign,
  Clock3,
  Eye,
  EyeOff,
  Landmark,
  Layers3,
  RefreshCw,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { formatUnits } from "viem";
import { MaskableValue } from "@/components/data-display/MaskableValue";
import { PerformanceChart } from "@/components/data-display/PerformanceChart";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import type { CashPlusController, CashPlusSnapshot } from "@/lib/cash-plus/types";
import { useMaskValue } from "@/lib/hooks/maskValue";
import { cn } from "@/lib/utils/cn";
import { formatUsdPrecise } from "@/lib/utils/format";
import { CashPlusDemoWallet } from "./CashPlusDemoWallet";
import { cashPlusMoney } from "./CashPlusPresentation";

export interface CashPlusSnapshotProps {
  /** The selected chain snapshot; never silently substituted with preview data. */
  snapshot: CashPlusSnapshot;
  /** Additional section styling. */
  className?: string;
}

export function CashPlusHero({
  controller,
}: {
  /** Current page controller. */ controller: CashPlusController;
}) {
  const t = useTranslations("cashPlus");
  const { snapshot, status } = controller;
  const format = useFormatter();
  return (
    <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3 sm:gap-4">
        <div
          className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 sm:size-14"
          aria-hidden="true"
        >
          <CircleDollarSign className="size-7 text-primary" strokeWidth={1.5} />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-semibold text-3xl tracking-tight">{t("name")}</h1>
            <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] text-muted-foreground sm:text-xs">
              {snapshot?.networkName ?? t("loading")}
            </span>
          </div>
          <p className="mt-2 max-w-xl text-muted-foreground text-sm leading-relaxed">
            {t("description")}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
        <CashPlusDemoWallet controller={controller} />
        {snapshot ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] sm:text-xs",
              snapshot.mode === "live"
                ? "bg-success/10 text-success"
                : "bg-primary/10 text-primary",
            )}
          >
            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
            {snapshot.mode === "preview"
              ? t("preview")
              : snapshot.mode === "fork"
                ? t("fork")
                : t("live")}
          </span>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          disabled={status === "loading"}
          aria-label={t("refresh")}
          onClick={() => {
            void controller.refresh();
          }}
          className="h-7 gap-1.5 px-1 text-muted-foreground"
        >
          <RefreshCw
            className={cn("size-3", status === "loading" && "motion-safe:animate-spin")}
            aria-hidden="true"
          />
          <span className="text-[10px]">
            {snapshot
              ? t("updated", {
                  time: format.dateTime(new Date(snapshot.readAt), {
                    timeZone: "UTC",
                    timeZoneName: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })
              : t("refresh")}
          </span>
        </Button>
      </div>
    </header>
  );
}

export function CashPlusPositionCard({ snapshot, className }: CashPlusSnapshotProps) {
  const t = useTranslations("cashPlus");
  const { masked, toggle } = useMaskValue();
  const invested = snapshot.accountShares > BigInt("0");
  const unavailable = t("unavailable");
  return (
    <Card className={cn("relative overflow-hidden rounded-xl p-5 sm:p-6", className)}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <span className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
          {t("position.title")}
        </span>
        <button
          type="button"
          onClick={toggle}
          aria-label={masked ? t("position.show") : t("position.hide")}
          className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {masked ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
      {invested ? (
        <>
          <div
            className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4"
            aria-live="polite"
          >
            <div className="min-w-0">
              <p className="break-words font-semibold text-3xl tabular-nums tracking-tight sm:text-4xl xl:text-5xl">
                <MaskableValue>
                  {cashPlusMoney(snapshot.accountAssets, unavailable, false, true)}
                </MaskableValue>
              </p>
              <p className="mt-2 text-muted-foreground text-xs">USDC</p>
            </div>
            <div>
              <p className="mb-1 text-muted-foreground text-xs">{t("position.result")}</p>
              <p
                className={cn(
                  "flex items-center gap-1 font-medium text-xl tabular-nums",
                  snapshot.resultAssets !== null && snapshot.resultAssets >= BigInt("0")
                    ? "text-success"
                    : "text-foreground",
                )}
              >
                <MaskableValue>
                  {snapshot.resultAssets !== null && snapshot.resultAssets > BigInt("0") ? (
                    <ArrowUpRight className="size-4" aria-hidden="true" />
                  ) : null}
                  {cashPlusMoney(snapshot.resultAssets, unavailable, true)}
                </MaskableValue>
              </p>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4 border-border border-t pt-5">
            <div>
              <p className="text-muted-foreground text-xs">{t("position.invested")}</p>
              <p className="mt-1 font-medium text-sm tabular-nums">
                <MaskableValue>
                  {cashPlusMoney(snapshot.investedAssets, unavailable, false, true)}
                </MaskableValue>
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">{t("position.available")}</p>
              <p className="mt-1 font-medium text-sm tabular-nums">
                <MaskableValue>
                  {cashPlusMoney(snapshot.withdrawableAssets, unavailable, false, true)}
                </MaskableValue>
              </p>
            </div>
          </div>
        </>
      ) : (
        <div className="py-2 sm:py-4">
          <h2 className="max-w-md font-semibold text-2xl leading-tight sm:text-3xl">
            {t("position.emptyTitle")}
          </h2>
          <p className="mt-3 max-w-xl text-muted-foreground text-sm leading-relaxed">
            {t("position.emptyBody")}
          </p>
          <p className="mt-5 inline-flex items-center gap-2 text-primary text-xs">
            <Check className="size-4" aria-hidden="true" />
            {t("position.emptyHint")}
          </p>
        </div>
      )}
    </Card>
  );
}

export function CashPlusChart({ snapshot, className }: CashPlusSnapshotProps) {
  const t = useTranslations("cashPlus");
  const format = useFormatter();
  const { masked } = useMaskValue();
  const data = snapshot.history
    .map((point) => ({
      value: Number(formatUnits(point.shareValueAssets, 6)),
      display: formatUsdPrecise(Number(formatUnits(point.shareValueAssets, 6))),
      label: format.dateTime(new Date(point.timestamp * 1000), {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
        timeZoneName: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    }))
    .filter((point) => Number.isFinite(point.value));
  return (
    <Card className={cn("rounded-xl p-5 sm:p-6", className)}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium text-sm">{t("chart.title")}</h2>
        <span className="rounded-md bg-surface-raised px-2 py-1 text-muted-foreground text-[10px]">
          {t("chart.period")}
        </span>
      </div>
      {masked ? (
        <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground text-xs">
          <EyeOff className="size-4" aria-hidden="true" />
          {t("chart.masked")}
        </div>
      ) : data.length > 1 ? (
        <>
          <PerformanceChart
            data={data}
            ariaLabel={t(snapshot.mode === "preview" ? "chart.sample" : "chart.label")}
            className="h-40"
          />
          <div className="mt-3 flex justify-between gap-3 text-muted-foreground text-[10px]">
            <span>{data[0]?.label}</span>
            <span>{data.at(-1)?.label}</span>
          </div>
        </>
      ) : (
        <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-border border-dashed bg-background/50 px-5 py-6 text-center">
          <ChartNoAxesCombined
            className="mb-1 size-7 text-muted-foreground"
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <p className="font-medium text-sm">{t("chart.emptyTitle")}</p>
          <p className="max-w-sm text-muted-foreground text-xs leading-relaxed">
            {t("chart.emptyBody")}
          </p>
        </div>
      )}
      {snapshot.mode === "preview" ? (
        <p className="mt-3 text-primary text-[10px]">{t("chart.sample")}</p>
      ) : (
        <p className="mt-3 inline-flex items-center gap-1 text-muted-foreground text-[10px]">
          <Check className="size-3" aria-hidden="true" />
          {t("observed")}
        </p>
      )}
    </Card>
  );
}

export function CashPlusReturnSources({ snapshot, className }: CashPlusSnapshotProps) {
  const t = useTranslations("cashPlus");
  const items = [
    {
      label: t("sources.interest"),
      hint: t(snapshot.mode === "preview" ? "demoUI.interestHint" : "sources.interestHint"),
      value: snapshot.interestAssets,
      icon: Landmark,
    },
    {
      label: t("sources.conversions"),
      hint: t(snapshot.mode === "preview" ? "demoUI.conversionHint" : "sources.conversionHint"),
      value: snapshot.conversionAssets,
      icon: ArrowLeftRight,
    },
    {
      label: t("sources.cash"),
      hint: t("sources.cashHint"),
      value: snapshot.totalAssets,
      icon: Layers3,
    },
  ];
  return (
    <section className={className} aria-label={t("sources.title")}>
      <div className="grid gap-3 sm:grid-cols-3">
        {items.map(({ label, hint, value, icon: Icon }) => (
          <Card key={label} className="flex items-center gap-3 rounded-xl p-4 sm:block sm:p-5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-primary sm:mb-4">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-muted-foreground text-xs">{label}</p>
              <p className="mt-1 font-semibold text-xl tabular-nums">
                {cashPlusMoney(value, t("unavailable"), false, true)}
              </p>
              <p className="mt-1.5 text-muted-foreground text-[10px] leading-relaxed">{hint}</p>
            </div>
          </Card>
        ))}
      </div>
      {!snapshot.attributionComplete ? (
        <p className="mt-3 text-muted-foreground text-xs leading-relaxed">{t("sources.partial")}</p>
      ) : null}
    </section>
  );
}

export function CashPlusFlow({ snapshot, className }: CashPlusSnapshotProps) {
  const t = useTranslations("cashPlus");
  const lending = snapshot.composition.some((asset) => asset.lendingRaw > BigInt("0"));
  const steps = [
    { title: t("flow.interest"), body: t("flow.interestBody"), icon: Landmark },
    { title: t("flow.convert"), body: t("flow.convertBody"), icon: ArrowLeftRight },
    { title: t("flow.earn"), body: t("flow.earnBody"), icon: ChartNoAxesCombined },
  ];
  return (
    <Card className={cn("rounded-xl p-5 sm:p-6", className)}>
      <h2 className="font-semibold text-base">{t("flow.title")}</h2>
      <p className="mt-1 text-muted-foreground text-xs leading-relaxed">{t("flow.subtitle")}</p>
      <ol className="mt-6 grid gap-5 sm:grid-cols-3 sm:gap-6">
        {steps.map(({ title, body, icon: Icon }, index) => (
          <li key={title} className="relative flex gap-3 sm:block">
            <div className="mb-3 flex size-10 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/5 text-primary">
              <Icon className="size-4" aria-hidden="true" />
            </div>
            <div>
              <p className="font-medium text-sm">
                <span className="mr-1.5 text-muted-foreground text-[10px]">0{index + 1}</span>
                {title}
              </p>
              <p className="mt-1.5 text-muted-foreground text-xs leading-relaxed">{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 border-border border-t pt-4 text-[10px]">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          {lending ? (
            <Check className="size-3 text-success" aria-hidden="true" />
          ) : (
            <Clock3 className="size-3" aria-hidden="true" />
          )}
          {lending ? t("flow.active") : t("flow.waiting")}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5",
            snapshot.tradingPaused ? "text-warning" : "text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              snapshot.tradingPaused ? "bg-warning" : "bg-success",
            )}
            aria-hidden="true"
          />
          {snapshot.tradingPaused ? t("flow.paused") : t("flow.enabled")}
        </span>
      </div>
    </Card>
  );
}

export function CashPlusSkeleton() {
  const t = useTranslations("cashPlus");
  return (
    <div role="status" aria-busy="true" aria-label={t("loading")} className="space-y-6">
      <div className="flex gap-4">
        <Skeleton className="size-14 rounded-xl" />
        <div className="space-y-3">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-60 max-w-full" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}
