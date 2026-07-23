/**
 * @id PP-CORE (POO-367)
 * @name investorSeries — tests
 * @implements-rules-version v1
 */
import { describe, expect, it } from "vitest";
import { formatUsd } from "@/lib/utils/format";
import { buildInvestorPortfolioSeries } from "./investorSeries";
import type { TimeseriesPoint } from "./timeseriesSchema";

/** A daily series of `n` points ending 2026-06-30, value = base + i (oldest → newest). */
function dailySeries(n: number, base = 100): TimeseriesPoint[] {
  const start = Date.parse("2026-06-30T00:00:00.000Z") - (n - 1) * 86_400_000;
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString(),
    value_usd: base + i,
  }));
}

describe("buildInvestorPortfolioSeries", () => {
  // [R4] The daily series can't honestly plot the hourly 1D period → `day` is always empty in real mode.
  it("[R4] leaves the day (1D) period empty (no sub-daily grain)", () => {
    const series = buildInvestorPortfolioSeries(dailySeries(120), "en-US");
    expect(series.day).toEqual([]);
  });

  // [R4] The other periods are date-windowed from the ISO dates, widening 1W → All.
  it("[R4] date-windows week/month/sixMonth/all, widening toward All", () => {
    const series = buildInvestorPortfolioSeries(dailySeries(400), "en-US");
    expect(series.week.length).toBeGreaterThanOrEqual(2);
    expect(series.week.length).toBeLessThan(series.month.length);
    expect(series.month.length).toBeLessThan(series.sixMonth.length);
    expect(series.sixMonth.length).toBeLessThan(series.all.length);
    expect(series.all).toHaveLength(400);
    // Each windowed period ends at the latest point (ChartPoint carries `value`, not `value_usd`).
    expect(series.week.at(-1)?.value).toBe(series.all.at(-1)?.value);
  });

  // [R4] A tab whose true window holds <2 points is NOT silently widened — it is left empty (omitted).
  it("[R4] leaves a period empty when its true window holds <2 points (never widened)", () => {
    // Only 3 daily points: the 6-month and All windows hold all 3; the 1W window holds all 3 too
    // (they're within 7 days), but a genuinely out-of-window period stays empty. Use a sparse pair.
    const sparse: TimeseriesPoint[] = [
      { date: "2026-01-01T00:00:00.000Z", value_usd: 100 },
      { date: "2026-06-30T00:00:00.000Z", value_usd: 200 },
    ];
    const series = buildInvestorPortfolioSeries(sparse, "en-US");
    // The 1W window catches only the latest point (<2) → empty, NOT widened to both.
    expect(series.week).toEqual([]);
    // The 1M window also catches only the latest (Jan 1 is >30 days before Jun 30) → empty.
    expect(series.month).toEqual([]);
    // The 6M window spans both → 2 points.
    expect(series.sixMonth).toHaveLength(2);
    // All is the full series.
    expect(series.all).toHaveLength(2);
  });

  // [R3] An empty (or <2-point) source series yields every period empty → the honest-empty hero.
  it("[R3] yields every period empty for an empty source series", () => {
    const series = buildInvestorPortfolioSeries([], "en-US");
    expect(series).toEqual({ day: [], week: [], month: [], sixMonth: [], all: [] });
  });

  it("[R3] yields every period empty for a single-point source series (chart needs >=2)", () => {
    const series = buildInvestorPortfolioSeries(dailySeries(1), "en-US");
    expect(series.all).toEqual([]);
    expect(series.week).toEqual([]);
  });

  it("populates ChartPoint label/display/date on windowed points", () => {
    const series = buildInvestorPortfolioSeries(dailySeries(30), "en-US");
    expect(series.all[0]).toHaveProperty("label");
    expect(series.all[0]).toHaveProperty("display");
    expect(series.all[0]).toHaveProperty("date");
  });

  // POO-716: append the live current value as a synthetic "now" tip so the chart's last point equals
  // the big number. Display-only: only already-plottable (>=2-point) periods get it; `day` and empty
  // periods stay honest-empty (a lone synthetic point must never fabricate a plottable chart).
  const NOW = Date.parse("2026-07-09T12:00:00.000Z");

  it("[POO-716] appends the current value as the last point of every non-empty period", () => {
    const series = buildInvestorPortfolioSeries(dailySeries(400), "en-US", 1234.5, NOW);
    for (const period of ["week", "month", "sixMonth", "all"] as const) {
      expect(series[period].at(-1)?.value).toBe(1234.5);
    }
  });

  it("[POO-716] does not fabricate a tip for empty/insufficient periods (they stay empty)", () => {
    const sparse: TimeseriesPoint[] = [
      { date: "2026-01-01T00:00:00.000Z", value_usd: 100 },
      { date: "2026-06-30T00:00:00.000Z", value_usd: 200 },
    ];
    const series = buildInvestorPortfolioSeries(sparse, "en-US", 999, NOW);
    // 1W / 1M hold <2 real points → still empty; the tip must not conjure a chart from nothing.
    expect(series.week).toEqual([]);
    expect(series.month).toEqual([]);
    // 6M / All hold 2 real points → 2 real points followed by the synthetic tip.
    expect(series.sixMonth).toHaveLength(3);
    expect(series.sixMonth.at(-1)?.value).toBe(999);
    expect(series.all).toHaveLength(3);
    expect(series.all.at(-1)?.value).toBe(999);
  });

  it("[POO-716] keeps the day (1D) period empty even with a current value", () => {
    const series = buildInvestorPortfolioSeries(dailySeries(120), "en-US", 999, NOW);
    expect(series.day).toEqual([]);
  });

  it("[POO-716] appends without mutating: real points precede the tip, which carries display + date", () => {
    const series = buildInvestorPortfolioSeries(dailySeries(30), "en-US", 999, NOW);
    // 30 windowed real points + 1 synthetic tip (append, no mutation).
    expect(series.all).toHaveLength(31);
    // The last REAL value (base 100 + 29 = 129) is preserved as the second-to-last point.
    expect(series.all.at(-2)?.value).toBe(129);
    // The synthetic tip is the current value, formatted, timestamped at `now`.
    const tip = series.all.at(-1);
    expect(tip?.value).toBe(999);
    expect(tip?.display).toBe(formatUsd(999));
    expect(tip?.date).toBe(new Date(NOW).toISOString());
  });

  it("[POO-716] omitting currentValue leaves windows un-appended (Portfolio callers unchanged)", () => {
    const series = buildInvestorPortfolioSeries(dailySeries(30), "en-US");
    // No synthetic tip: exactly the 30 windowed real points, ending at the last real value.
    expect(series.all).toHaveLength(30);
    expect(series.all.at(-1)?.value).toBe(129);
  });
});
