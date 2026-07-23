import { describe, expect, it } from "vitest";
import { buildPortfolioSeries, emptyPortfolioSeries, toDailyChartPoints } from "./portfolioSeries";

/** Fixed reference time so the labels/series are deterministic. */
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

describe("buildPortfolioSeries", () => {
  it("returns a labelled series for every period, each ending at the current value", () => {
    const series = buildPortfolioSeries("en-US", 5000, NOW);
    expect(Object.keys(series)).toEqual(["day", "week", "month", "sixMonth", "all"]);
    expect(series.day).toHaveLength(24);
    expect(series.week).toHaveLength(7);
    expect(series.month).toHaveLength(30);

    for (const points of Object.values(series)) {
      expect(points[points.length - 1]?.value).toBe(5000);
      expect(points.every((point) => point.label.length > 0)).toBe(true);
      expect(points.every((point) => typeof point.display === "string")).toBe(true);
    }
  });

  it("is deterministic for a fixed reference time", () => {
    expect(buildPortfolioSeries("en-US", 1234, NOW)).toEqual(
      buildPortfolioSeries("en-US", 1234, NOW),
    );
  });

  it("labels the `day` period by time (hourly) and `all` by month", () => {
    const series = buildPortfolioSeries("en-US", 1000, NOW);
    expect(series.day.at(-1)?.label).toContain(":"); // e.g. "12:00 PM"
    expect(series.all.at(-1)?.label).not.toContain(":"); // e.g. "Jan 26"
  });
});

describe("emptyPortfolioSeries (POO-556 R1)", () => {
  it("returns the same period keys as buildPortfolioSeries, each an empty (<2-point) series", () => {
    const series = emptyPortfolioSeries();
    // Same shape as the mock builder, so PortfolioChartCard's period selector still resolves a key.
    expect(Object.keys(series)).toEqual(Object.keys(buildPortfolioSeries("en-US", 1, NOW)));
    for (const points of Object.values(series)) {
      // < 2 points → PerformanceChart renders nothing (honest-empty, no fabricated curve).
      expect(points).toEqual([]);
    }
  });
});

describe("toDailyChartPoints", () => {
  it("labels each value with a date and pre-formats the display string", () => {
    const points = toDailyChartPoints([10, 20, 30], "en-US", NOW);
    expect(points).toHaveLength(3);
    expect(points[2]?.value).toBe(30);
    expect(points.every((point) => point.label.length > 0 && point.display?.includes("$"))).toBe(
      true,
    );
  });
});
