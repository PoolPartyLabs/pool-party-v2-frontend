/**
 * @id PP-DASH-CMP-002
 * @name PortfolioChartCard
 * @implements-rules-version v1
 *
 * The Home hero card: portfolio value, today's earnings, an interactive period selector
 * (1D / 1W / 1M / 6M / All) and the value chart. Client component so the tabs are live.
 *
 * POO-367 R4: each period tab is shown only when its own window is plottable (>=2 points), so a
 * sparse real-mode series (short/empty windows, or the daily-grain 1D period) never renders a dead
 * tab over a blank chart. The active period defaults to the FIRST plottable one (1M when present, a
 * longer window otherwise), so the chart is never a blank box on first paint. When no period plots,
 * the tab group and chart area are hidden entirely (POO-556 R3 honest-empty hero).
 *
 * POO-716 R1: an "(i)" tooltip next to the "Portfolio value" label explains the value is estimated,
 * not real-time (see {@link EstimatedTooltip}).
 */
"use client";

import { Info, TrendingDown, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { MaskableValue } from "@/components/data-display/MaskableValue";
import { PerformanceChart } from "@/components/data-display/PerformanceChart";
import { EyeToggle } from "@/components/ui/EyeToggle";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils/cn";
import { formatSignedUsd, formatUsd } from "@/lib/utils/format";
import type { PortfolioSeries } from "@/mocks/data/portfolioSeries";

/** Selectable periods. */
const PERIODS = ["day", "week", "month", "sixMonth", "all"] as const;
type Period = (typeof PERIODS)[number];

/**
 * POO-716 R2: an "(i)" affordance next to the "Portfolio value" label revealing that the value is
 * estimated, not real-time. Composes the shared Tooltip primitive with the mobile-tap-open pattern
 * (Radix ignores a plain tap, so `open` is controlled and onClick opens it while Radix still drives
 * hover, keyboard focus, and outside-tap close); the copy doubles as the trigger's accessible name.
 */
function EstimatedTooltip({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onClick={() => setOpen(true)}
            className="inline-flex shrink-0 rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info className="size-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-60">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Public props for {@link PortfolioChartCard}. */
export interface PortfolioChartCardProps {
  totalValue: number;
  /**
   * "Earned today" (24h fees) shown in the hero badge. `null` = the C1 `/financials` payload served this
   * field honest-absent, OR financials are unavailable (real mode; PP-CORE-LIB-048); the badge renders
   * the "not available yet" affordance, NEVER a fabricated "+$0.00" ([R5]). In mock mode it is a number.
   */
  earnedToday: number | null;
  /** Labelled value series per period; the selected period is plotted. */
  seriesByPeriod: PortfolioSeries;
}

/** Hero portfolio card with a live period selector. */
export function PortfolioChartCard({
  totalValue,
  earnedToday,
  seriesByPeriod,
}: PortfolioChartCardProps) {
  const t = useTranslations("home");
  // POO-936 [R5]: the "not available yet" affordance for a served-NULL earnedToday (never $0).
  const tCommon = useTranslations("common");
  const labels: Record<Period, string> = {
    day: t("periods.day"),
    week: t("periods.week"),
    month: t("periods.month"),
    sixMonth: t("periods.sixMonth"),
    all: t("periods.all"),
  };
  // POO-367 R4: a period is plottable only when its OWN window holds >=2 points. A tab is shown only
  // for a plottable period, so short/empty windows (sparse real-mode history) and the daily-grain 1D
  // period never appear as a dead tab over a blank chart. Mock mode fills every period, so all five
  // show there; real mode shows only what actually plots (POO-556 R3: none plot → nothing shows).
  const plottablePeriods = PERIODS.filter((period) => (seriesByPeriod[period]?.length ?? 0) >= 2);
  // The conventional default period is 1M (the Figma default). Keep it when it plots; otherwise fall
  // to the first plottable period so the chart never paints a blank box on first paint when 1M is
  // empty but a longer window plots (R4, sparse real series). `null` when nothing plots.
  const defaultPeriod = plottablePeriods.includes("month")
    ? "month"
    : (plottablePeriods[0] ?? null);
  const [active, setActive] = useState<Period | null>(defaultPeriod);
  // Resolve the period to plot: the selected one if still plottable, else the default (guards a series
  // that changed shape after mount so a stale selection never points at an empty window).
  const plotted = active && plottablePeriods.includes(active) ? active : defaultPeriod;
  const series = plotted ? (seriesByPeriod[plotted] ?? []) : [];
  const hasSeries = plottablePeriods.length > 0;

  return (
    <section className="rounded-xl border border-border bg-surface p-5 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-muted-foreground text-sm">{t("portfolioValue")}</p>
            <EstimatedTooltip label={t("estimatedTooltip")} />
            <EyeToggle label={t("hideValues")} />
          </div>
          <p className="mt-1 font-bold text-3xl text-foreground lg:text-4xl">
            <MaskableValue>{formatUsd(totalValue)}</MaskableValue>
          </p>
          {/* POO-936 [R5]: a served-NULL earnedToday (the /financials cutover has not populated this
              field yet) renders the honest "not available yet" affordance — NEVER a fabricated
              "+$0.00" — matching the money tiles. Legacy path (a number) keeps the tone badge below.
              POO-896 R4 (supersedes POO-555 R6 for this badge): `earnedToday` is FEES earned and
              arrives CLAMPED at 0 upstream (homeViewModel), so the destructive/TrendingDown branch
              below is unreachable - kept as dead defense (matching PortfolioView), so an unclamped
              regression still renders sanely. A $0.00 day still must not wear a positive badge. */}
          {earnedToday === null ? (
            <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-surface-raised px-2 py-0.5 font-medium text-muted-foreground text-xs">
              {t("earnedToday", { amount: tCommon("unavailable") })}
            </p>
          ) : (
            <p
              className={cn(
                "mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs",
                earnedToday > 0 && "bg-success/10 text-success",
                earnedToday < 0 && "bg-destructive/10 text-destructive",
                earnedToday === 0 && "bg-surface-raised text-muted-foreground",
              )}
            >
              {earnedToday > 0 ? <TrendingUp className="size-3" aria-hidden="true" /> : null}
              {earnedToday < 0 ? <TrendingDown className="size-3" aria-hidden="true" /> : null}
              {t("earnedToday", { amount: formatSignedUsd(earnedToday) })}
            </p>
          )}
        </div>
        {hasSeries ? (
          <div
            className="flex items-center gap-1 rounded-lg border border-border p-1"
            role="tablist"
            aria-label={t("portfolioValue")}
          >
            {plottablePeriods.map((period) => (
              <button
                key={period}
                type="button"
                role="tab"
                aria-selected={plotted === period}
                onClick={() => setActive(period)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs transition-colors",
                  plotted === period
                    ? "bg-surface-raised font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {labels[period]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {hasSeries ? (
        <div className="mt-4 h-28 lg:h-40">
          <PerformanceChart data={series} ariaLabel={t("portfolioValue")} />
        </div>
      ) : null}
    </section>
  );
}
