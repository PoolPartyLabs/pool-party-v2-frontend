/**
 * Mock portfolio value series for the Home hero chart, one per selectable period. The label
 * granularity follows the period — hourly for `day`, daily/weekly/monthly otherwise — so the chart
 * tooltip can show "that day/hour" for the selected period. Deterministic given `now`, so the server
 * render and the client hydration agree.
 *
 * PP-INTEGRATION-POINT: replace with the performance time-series endpoint.
 */
import type { ChartPoint } from "@/components/data-display/PerformanceChart";
import { formatUsd } from "@/lib/utils/format";

/** The selectable chart periods (must match the tabs in PortfolioChartCard). */
export type ChartPeriod = "day" | "week" | "month" | "sixMonth" | "all";

/** A labelled series for every period. */
export type PortfolioSeries = Record<ChartPeriod, ChartPoint[]>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Sample count, spacing and label format for each period. */
const SPECS: Record<
  ChartPeriod,
  { count: number; stepMs: number; format: Intl.DateTimeFormatOptions }
> = {
  day: { count: 24, stepMs: HOUR, format: { hour: "2-digit", minute: "2-digit" } },
  week: { count: 7, stepMs: DAY, format: { weekday: "short", day: "numeric" } },
  month: { count: 30, stepMs: DAY, format: { month: "short", day: "numeric" } },
  sixMonth: { count: 26, stepMs: 7 * DAY, format: { month: "short", day: "numeric" } },
  all: { count: 12, stepMs: 30 * DAY, format: { month: "short", year: "2-digit" } },
};

/** Deterministic rising series of `count` values ending exactly at `end` (mock; no randomness). */
function trend(count: number, end: number): number[] {
  const start = end * 0.82;
  return Array.from({ length: count }, (_, index) => {
    if (index === count - 1) return end;
    const progress = index / (count - 1);
    const linear = start + (end - start) * progress;
    // Damped, index-seeded wiggle so each period looks alive yet is stable across renders.
    const wiggle = Math.sin(index * 1.3) * (end - start) * 0.18 * (1 - progress);
    return Math.round((linear + wiggle) * 100) / 100;
  });
}

/**
 * An honest-empty series: every selectable period maps to an empty point list. Real mode uses this
 * so the hero chart renders nothing (PerformanceChart draws nothing below 2 points) rather than a
 * fabricated curve, until the per-investor portfolio timeseries lands (POO-556 R1 / POO-368).
 */
export function emptyPortfolioSeries(): PortfolioSeries {
  return { day: [], week: [], month: [], sixMonth: [], all: [] };
}

/**
 * Build the per-period value series ending at `currentValue`, with labels localized to `locale`.
 *
 * @param locale BCP-47 locale (e.g. `"pt-BR"`) used to format the x-axis labels.
 * @param currentValue The latest portfolio value; every period ends here.
 * @param now Reference time in ms; defaults to the current time. Pass a fixed value in tests.
 */
export function buildPortfolioSeries(
  locale: string,
  currentValue: number,
  now: number = Date.now(),
): PortfolioSeries {
  const out = {} as PortfolioSeries;
  for (const [period, spec] of Object.entries(SPECS) as [
    ChartPeriod,
    (typeof SPECS)[ChartPeriod],
  ][]) {
    const formatter = new Intl.DateTimeFormat(locale, spec.format);
    out[period] = trend(spec.count, currentValue).map((value, index) => ({
      value,
      label: formatter.format(now - (spec.count - 1 - index) * spec.stepMs),
      display: formatUsd(value),
    }));
  }
  return out;
}

/**
 * Label an existing numeric series with daily dates ending at `now` — for charts that show a single
 * series (no period selector), e.g. the strategy detail and portfolio hero.
 */
export function toDailyChartPoints(
  values: number[],
  locale: string,
  now: number = Date.now(),
): ChartPoint[] {
  const formatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  return values.map((value, index) => ({
    value,
    label: formatter.format(now - (values.length - 1 - index) * DAY),
    display: formatUsd(value),
  }));
}
