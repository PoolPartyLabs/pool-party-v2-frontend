/**
 * @id PP-CORE (POO-366)
 * @name manageSeries — tests
 * @implements-rules-version v2
 *
 * v2 (POO-558): the ChartPoint-level, calendar-window primitives that make the manage-detail pill
 * period-aware (R3) and disable a tab whose window is unplottable (R4), reusing the POO-557 date
 * pattern. Date-less (mock) series keep every tab live and a whole-series change.
 */

import { describe, expect, it } from "vitest";
import type { ChartPoint } from "@/components/data-display/PerformanceChart";
import {
  buildManagePerformance,
  changePctOfPoints,
  changePctOverDays,
  managePeriodEnabled,
  PERIOD_WINDOW_DAYS,
  sliceByDays,
} from "./manageSeries";

/** A dated ChartPoint series of `n` daily points ending 2026-06-30, value = base + i. */
function datedPoints(n: number, base = 100): ChartPoint[] {
  const start = Date.parse("2026-06-30") - (n - 1) * 86_400_000;
  return Array.from({ length: n }, (_, i) => ({
    value: base + i,
    label: `d${i}`,
    date: new Date(start + i * 86_400_000).toISOString(),
  }));
}

/** A date-less (mock) ChartPoint series of `n` points, value = base + i. */
function datelessPoints(n: number, base = 100): ChartPoint[] {
  return Array.from({ length: n }, (_, i) => ({ value: base + i, label: `d${i}` }));
}

/** A daily series of `n` points ending 2026-06-30, value = base + i (oldest → newest). */
function dailySeries(n: number, base = 100): { date: string; value_usd: number }[] {
  const start = Date.parse("2026-06-30") - (n - 1) * 86_400_000;
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    value_usd: base + i,
  }));
}

describe("sliceByDays", () => {
  it("narrows to the trailing window (shorter windows keep fewer, recent points)", () => {
    const series = dailySeries(100);
    const week = sliceByDays(series, 7);
    const month = sliceByDays(series, 30);
    expect(week.length).toBeGreaterThanOrEqual(2);
    expect(week.length).toBeLessThan(month.length);
    expect(month.length).toBeLessThan(series.length);
    // The window ends at the latest point.
    expect(week.at(-1)).toEqual(series.at(-1));
  });

  it("falls back to the full series when the window would hold <2 points", () => {
    // Two points 6 months apart: a 7-day window catches only the latest → fall back to both.
    const sparse = [
      { date: "2026-01-01", value_usd: 100 },
      { date: "2026-06-30", value_usd: 200 },
    ];
    expect(sliceByDays(sparse, 7)).toHaveLength(2);
  });

  it("returns the full series for an infinite (all) window", () => {
    const series = dailySeries(12);
    expect(sliceByDays(series, Number.POSITIVE_INFINITY)).toHaveLength(12);
  });
});

describe("changePctOverDays", () => {
  it("computes first→last percent change over the window", () => {
    // 31 daily points 100..130; the 30d window spans the whole range → (130-100)/100*100 = 30%.
    expect(changePctOverDays(dailySeries(31, 100), 30)).toBeCloseTo(30, 6);
  });

  it("returns 0 when the baseline is 0 or there are too few points", () => {
    expect(changePctOverDays([{ date: "2026-06-01", value_usd: 0 }], 30)).toBe(0);
    expect(changePctOverDays([], 30)).toBe(0);
  });
});

describe("buildManagePerformance", () => {
  it("produces all four periods, each >=2 points, widening 7d → all", () => {
    const perf = buildManagePerformance(dailySeries(120), "en-US");
    expect(perf["7d"].length).toBeGreaterThanOrEqual(2);
    expect(perf["7d"].length).toBeLessThan(perf["30d"].length);
    expect(perf["30d"].length).toBeLessThan(perf["90d"].length);
    expect(perf["90d"].length).toBeLessThan(perf.all.length);
    expect(perf.all).toHaveLength(120);
    // labels + display are populated (ChartPoint shape).
    expect(perf["7d"][0]).toHaveProperty("label");
    expect(perf["7d"][0]).toHaveProperty("display");
  });
});

// @rule R3: the pill computes the change over the SELECTED period's calendar window (not a fixed 30d).
describe("changePctOfPoints", () => {
  it("computes first→last percent change over a dated calendar window", () => {
    // 31 dated daily points 100..130. The window is strict `< N days` from the last point (POO-557
    // precedent): the 30d window holds the last 30 points (101..130) → (130-101)/101.
    expect(changePctOfPoints(datedPoints(31, 100), 30)).toBeCloseTo(((130 - 101) / 101) * 100, 6);
    // The 7d window holds only the last 7 points (124..130) → (130-124)/124.
    const week = datedPoints(31, 100);
    expect(changePctOfPoints(week, 7)).toBeCloseTo(((130 - 124) / 124) * 100, 6);
  });

  it("returns different values per period (a fixed-30d pill would not, POO-555)", () => {
    const series = datedPoints(91, 100); // 100..190, all up
    const d7 = changePctOfPoints(series, 7);
    const d30 = changePctOfPoints(series, 30);
    const d90 = changePctOfPoints(series, 90);
    expect(d7).not.toBeCloseTo(d30 ?? 0, 3);
    expect(d30).not.toBeCloseTo(d90 ?? 0, 3);
  });

  it("returns undefined when the window holds <2 points (no coerced 0, R2/R4)", () => {
    // Two points a year apart: the 7d window catches only the latest → undefined, not a widened 0.
    const sparse: ChartPoint[] = [
      { value: 100, label: "a", date: "2025-06-30T00:00:00.000Z" },
      { value: 200, label: "b", date: "2026-06-30T00:00:00.000Z" },
    ];
    expect(changePctOfPoints(sparse, 7)).toBeUndefined();
    expect(changePctOfPoints([], 30)).toBeUndefined();
  });

  it("uses the whole date-less (mock) series regardless of the window (R4 mock parity)", () => {
    // Mock points carry no date → the change is the whole-series first→last, per period.
    const mock = datelessPoints(5, 100); // 100..104
    expect(changePctOfPoints(mock, 7)).toBeCloseTo(4, 6);
    expect(changePctOfPoints(mock, 90)).toBeCloseTo(4, 6);
  });
});

// @rule R4: a period tab whose calendar window holds <2 points is disabled, not silently widened.
describe("managePeriodEnabled", () => {
  it("disables a tab whose window is shorter than 2 points on a dated series", () => {
    // 5 dated daily points → 7d holds all 5 (enabled), 30d/90d add nothing (disabled), all enabled.
    const series = datedPoints(5);
    expect(managePeriodEnabled(series, "7d")).toBe(true);
    expect(managePeriodEnabled(series, "30d")).toBe(false);
    expect(managePeriodEnabled(series, "90d")).toBe(false);
    expect(managePeriodEnabled(series, "all")).toBe(true);
  });

  it("enables a tab whose window holds >=2 points and adds depth over the smaller tab", () => {
    const series = datedPoints(120);
    expect(managePeriodEnabled(series, "7d")).toBe(true);
    expect(managePeriodEnabled(series, "30d")).toBe(true);
    expect(managePeriodEnabled(series, "90d")).toBe(true);
    expect(managePeriodEnabled(series, "all")).toBe(true);
  });

  it("keeps every tab enabled on a date-less (mock) series (R4 mock parity)", () => {
    const mock = datelessPoints(3);
    expect(managePeriodEnabled(mock, "7d")).toBe(true);
    expect(managePeriodEnabled(mock, "30d")).toBe(true);
    expect(managePeriodEnabled(mock, "90d")).toBe(true);
    expect(managePeriodEnabled(mock, "all")).toBe(true);
  });

  it("exposes the calendar-day window per period (7/30/90/all)", () => {
    expect(PERIOD_WINDOW_DAYS["7d"]).toBe(7);
    expect(PERIOD_WINDOW_DAYS["30d"]).toBe(30);
    expect(PERIOD_WINDOW_DAYS["90d"]).toBe(90);
    expect(PERIOD_WINDOW_DAYS.all).toBe(Number.POSITIVE_INFINITY);
  });
});
