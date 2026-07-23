/**
 * @id PP-CORE (POO-366)
 * @name manageSeries
 * @implements-rules-version v2
 *
 * Period helpers over a daily value series: window it to a trailing N days, the percent change across
 * a window, and the per-period AUM object the manage-detail performance chart needs. Pure; operate on
 * the analytics `{ date, value_usd }` points and reuse {@link mapTimeseries} for labels.
 *
 * v2 (POO-558): ChartPoint-level, calendar-window primitives that make the manage-detail pill
 * period-aware ({@link changePctOfPoints}, R3) and disable a tab whose window is unplottable
 * ({@link managePeriodEnabled}, R4), reusing the POO-557 date pattern. A dated (real) series windows
 * by real calendar time counted back from its LAST point (so a lagging indexer still windows
 * sensibly); a date-less (mock) series has no window, so it reads the whole series with every tab
 * live and its change is the whole-series first→last (R4 mock parity).
 */
import type { ChartPoint } from "@/components/data-display/PerformanceChart";
import type { ManagePeriod } from "@/lib/schemas";
import { mapTimeseries } from "./mapTimeseries";
import type { TimeseriesPoint } from "./timeseriesSchema";

const DAY_MS = 86_400_000;

/** Calendar-day window per selectable manage-detail period (week · month · quarter · all), POO-558. */
export const PERIOD_WINDOW_DAYS: Record<ManagePeriod, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: Number.POSITIVE_INFINITY,
};

/**
 * The points within the last `days` of the series' latest date. Falls back to the full series when the
 * window would hold fewer than two points, because the manage-detail schema requires ≥ 2 per period.
 */
export function sliceByDays(points: TimeseriesPoint[], days: number): TimeseriesPoint[] {
  if (!Number.isFinite(days)) return points;
  const last = points.at(-1);
  if (!last) return points;
  const cutoff = Date.parse(last.date) - days * DAY_MS;
  const windowed = points.filter((point) => Date.parse(point.date) >= cutoff);
  return windowed.length >= 2 ? windowed : points;
}

/**
 * Percent change of value across the last `days` (first-in-window → latest). Returns 0 when there are
 * fewer than two points or the baseline is 0 (avoids divide-by-zero / Infinity).
 */
export function changePctOverDays(points: TimeseriesPoint[], days: number): number {
  const window = sliceByDays(points, days);
  const first = window[0];
  const last = window.at(-1);
  if (!first || !last || first.value_usd === 0) return 0;
  return ((last.value_usd - first.value_usd) / first.value_usd) * 100;
}

/** Every point's date as epoch ms, or `null` when the series is date-less (mock) or empty. */
function chartDates(points: readonly ChartPoint[]): number[] | null {
  if (points.length === 0) return null;
  const parsed = points.map((point) => (point.date ? Date.parse(point.date) : Number.NaN));
  return parsed.every(Number.isFinite) ? parsed : null;
}

/**
 * The ChartPoints inside `period`'s calendar window, anchored at the LAST point's date. A date-less
 * (mock) series has no window → the whole series (R4 mock parity). "all" is the whole series.
 */
function windowByPeriod(points: ChartPoint[], period: ManagePeriod): ChartPoint[] {
  const windowDays = PERIOD_WINDOW_DAYS[period];
  if (!Number.isFinite(windowDays)) return points;
  const dates = chartDates(points);
  if (!dates) return points;
  const anchor = dates[dates.length - 1] ?? 0;
  return points.filter((_, index) => anchor - (dates[index] ?? 0) < windowDays * DAY_MS);
}

/**
 * [R3] The manage-detail pill's signed % for the selected `period`: first→last change across that
 * period's calendar window (a date-less mock series uses the whole series). Returns `undefined` when
 * the window holds <2 points or the baseline is 0 — the pill then renders nothing (no coerced 0),
 * paired with the tab being disabled ({@link managePeriodEnabled}).
 */
export function changePctOfPoints(points: ChartPoint[], days: number): number | undefined {
  // Map the day count back to a period key so the mock (date-less) path reads the whole series.
  const period = (Object.keys(PERIOD_WINDOW_DAYS) as ManagePeriod[]).find(
    (key) => PERIOD_WINDOW_DAYS[key] === days,
  );
  const window = period ? windowByPeriod(points, period) : points;
  const first = window[0];
  const last = window.at(-1);
  if (!first || !last || window.length < 2 || first.value === 0) return undefined;
  return ((last.value - first.value) / first.value) * 100;
}

/**
 * [R4] Whether a period tab is selectable: "all" always is; a dated series disables a tab whose
 * window holds <2 points (nothing to plot — must NOT silently widen to full history) or adds no
 * points over the next-smaller tab (it would render identical, faking depth the history lacks). A
 * date-less (mock) series keeps every tab live (R4 mock parity).
 */
export function managePeriodEnabled(points: ChartPoint[], period: ManagePeriod): boolean {
  if (period === "all") return true;
  const dates = chartDates(points);
  if (!dates) return true;
  const count = windowByPeriod(points, period).length;
  if (count < 2) return false;
  if (period === "7d") return true;
  const smaller: ManagePeriod = period === "90d" ? "30d" : "7d";
  return count > windowByPeriod(points, smaller).length;
}

/** The manage-detail per-period AUM series (each ≥ 2 points), built from one daily series. */
export function buildManagePerformance(
  points: TimeseriesPoint[],
  locale: string,
): { "7d": ChartPoint[]; "30d": ChartPoint[]; "90d": ChartPoint[]; all: ChartPoint[] } {
  return {
    "7d": mapTimeseries(sliceByDays(points, 7), locale),
    "30d": mapTimeseries(sliceByDays(points, 30), locale),
    "90d": mapTimeseries(sliceByDays(points, 90), locale),
    all: mapTimeseries(points, locale),
  };
}
