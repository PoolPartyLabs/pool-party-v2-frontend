/**
 * @id PP-CP-CMP-003
 * @name CashPlusSimulation
 * @i18n-namespace cashPlus
 * @implements-rules-version v1
 * Isolated annual comparison. Assumptions never enter wallet state or observed results.
 */
"use client";
import { Calculator, ChevronDown, SlidersHorizontal } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { canonicalCashPlusAmount } from "@/lib/cash-plus/amounts";
import {
  type CashPlusComparisonInput,
  calculateCashPlusComparison,
  DEFAULT_COMPARISON,
} from "@/lib/cash-plus/comparison";
import { cn } from "@/lib/utils/cn";
import { formatUsd, formatUsdCompact } from "@/lib/utils/format";

export interface CashPlusSimulationProps {
  /** Additional section styling. */
  className?: string;
}

export function CashPlusSimulation({ className }: CashPlusSimulationProps) {
  const t = useTranslations("cashPlus");
  const locale = useLocale();
  const id = useId();
  const [assumptions, setAssumptions] = useState<CashPlusComparisonInput>({
    ...DEFAULT_COMPARISON,
  });
  const result = useMemo(() => {
    try {
      const canonical = Object.fromEntries(
        Object.entries(assumptions).map(([key, value]) => [
          key,
          canonicalCashPlusAmount(value, locale),
        ]),
      ) as CashPlusComparisonInput;
      return calculateCashPlusComparison(canonical);
    } catch {
      return null;
    }
  }, [assumptions, locale]);
  const fields: Array<{ key: keyof CashPlusComparisonInput; label: string }> = [
    { key: "nav", label: t("simulation.nav") },
    { key: "lendingAllocation", label: t("simulation.allocation") },
    { key: "lendingRate", label: t("simulation.lendingRate") },
    { key: "grossMarginBps", label: t("simulation.margin") },
    { key: "variableCostBps", label: t("simulation.variable") },
    { key: "fixedCosts", label: t("simulation.fixed") },
    { key: "performanceFee", label: t("simulation.fee") },
    { key: "benchmarkRate", label: t("simulation.benchmarkRate") },
  ];
  const benchmark = Number(result?.benchmarkResult ?? 0);
  const cashPlus = Number(result?.investorResult ?? 0);
  const maximum = Math.max(benchmark, cashPlus, 1);
  const delta = Number(result?.excessPercentagePoints ?? 0);
  return (
    <details className={cn("group rounded-xl border border-border bg-surface", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-6 [&::-webkit-details-marker]:hidden">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background">
          <Calculator className="size-5 text-primary" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block font-semibold text-sm sm:text-base">{t("simulation.title")}</span>
          <span className="mt-1 block text-muted-foreground text-xs">{t("simulation.label")}</span>
        </span>
        <ChevronDown
          className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="border-border border-t p-5 sm:p-6">
        <div className="mb-6 flex flex-col gap-2">
          <span className="w-fit rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 font-medium text-primary text-[10px] uppercase tracking-wider">
            {t("simulation.label")}
          </span>
          <p className="max-w-2xl text-muted-foreground text-xs leading-relaxed">
            {t("simulation.description")}
          </p>
        </div>
        <div className="grid gap-6 xl:grid-cols-2 xl:gap-10">
          <div aria-live="polite" className="space-y-5">
            {result ? (
              <>
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium text-sm">{t("simulation.cashPlus")}</p>
                    <p className="font-semibold text-primary text-xl tabular-nums">
                      {Number(result.investorRate).toFixed(2)}%
                    </p>
                  </div>
                  <p className="mt-3 font-semibold text-3xl tabular-nums">{formatUsd(cashPlus)}</p>
                  <p className="mt-1 text-muted-foreground text-xs">
                    {t("simulation.annualResult")}
                  </p>
                  <div className="mt-4 h-1.5 rounded-full bg-background">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
                      style={{ width: `${Math.max(0, (cashPlus / maximum) * 100)}%` }}
                    />
                  </div>
                </div>
                <div className="px-1">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{t("simulation.benchmark")}</span>
                    <span className="font-medium tabular-nums">
                      {Number(result.benchmarkRate).toFixed(2)}%
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="font-semibold text-xl tabular-nums">
                      {formatUsd(benchmark)}
                    </span>
                    <span className="text-muted-foreground text-[10px]">
                      {t("simulation.annualResult")}
                    </span>
                  </div>
                  <div className="mt-3 h-1.5 rounded-full bg-background">
                    <div
                      className="h-full rounded-full bg-muted-foreground/50 transition-[width] duration-200 motion-reduce:transition-none"
                      style={{ width: `${Math.max(0, (benchmark / maximum) * 100)}%` }}
                    />
                  </div>
                </div>
                {result.additionalReturnPercent !== null &&
                Number(result.additionalReturnPercent) > 0 ? (
                  <p className="text-success text-xs">
                    {t("simulation.extra", {
                      value: Number(result.additionalReturnPercent).toFixed(0),
                    })}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2 border-border border-t pt-4 text-xs">
                  <span className="text-muted-foreground">{t("simulation.difference")}</span>
                  <span
                    className={cn(
                      "font-medium tabular-nums",
                      delta > 0 ? "text-success" : "text-foreground",
                    )}
                  >
                    {t("simulation.points", {
                      value: `${delta > 0 ? "+" : ""}${delta.toFixed(2)}`,
                    })}
                  </span>
                </div>
              </>
            ) : (
              <p role="alert" className="rounded-lg bg-warning/10 p-4 text-warning text-sm">
                {t("simulation.invalid")}
              </p>
            )}
          </div>
          <div>
            <label htmlFor={`${id}-volume`} className="block font-medium text-sm">
              {t("simulation.volume")}
            </label>
            <p className="mt-3 font-semibold text-3xl tabular-nums">
              {formatUsdCompact(Number(assumptions.annualVolume))}
            </p>
            <input
              id={`${id}-volume`}
              type="range"
              min="0"
              max="100000000"
              step="1000000"
              value={assumptions.annualVolume}
              onChange={(event) =>
                setAssumptions((old) => ({ ...old, annualVolume: event.target.value }))
              }
              className="my-4 h-2 w-full cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex justify-between text-muted-foreground text-[10px]">
              <span>{formatUsdCompact(0)}</span>
              <span>{formatUsdCompact(100000000)}</span>
            </div>
            <details className="group/assumptions mt-6 border-border border-t pt-4">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded text-muted-foreground text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                {t("simulation.assumptions")}
                <ChevronDown
                  className="ml-auto size-3.5 transition-transform group-open/assumptions:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {fields.map(({ key, label }) => (
                  <div key={key}>
                    <label
                      htmlFor={`${id}-${key}`}
                      className="mb-1.5 block text-muted-foreground text-[10px] leading-relaxed"
                    >
                      {label}
                    </label>
                    <input
                      id={`${id}-${key}`}
                      type="text"
                      inputMode="decimal"
                      maxLength={100}
                      value={assumptions[key]}
                      onChange={(event) =>
                        setAssumptions((old) => ({ ...old, [key]: event.target.value }))
                      }
                      className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                ))}
              </div>
            </details>
          </div>
        </div>
        <p className="mt-6 border-border border-t pt-4 text-muted-foreground text-[10px] leading-relaxed">
          {t("simulation.disclaimer")}
        </p>
      </div>
    </details>
  );
}
