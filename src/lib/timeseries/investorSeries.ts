/**
 * @id PP-CORE (POO-367)
 * @name investorSeries
 * @implements-rules-version v1
 *
 * Builds the Home hero's per-period {@link PortfolioSeries} from the real per-investor daily value
 * series (`investor_portfolio.series`, POO-368). Each selectable period is a date-window over the
 * series' ISO dates (POO-557 precedent), mapped to labelled `ChartPoint`s via {@link mapTimeseries}.
 *
 * [R4] Unlike the manager `sliceByDays` (which widens a too-small window to keep the manage chart
 * schema-valid), a period whose TRUE calendar window holds <2 points is left EMPTY here, never
 * silently widened. An empty period is "not plottable": `PortfolioChartCard` shows a tab only for a
 * period whose own window plots (>=2 points), so an empty period's tab is not shown and the active
 * period defaults to the first plottable one. The daily grain cannot honestly plot the hourly 1D
 * period, so `day` is always empty in real mode until an hourly series lands (B2); [R3] an empty /
 * single-point source yields every period empty → the honest-empty hero (tabs + chart both hidden;
 * PerformanceChart draws nothing below 2 points).
 *
 * POO-716 (rules v1): the stored daily series is snapshot-only (refreshed a few times a day), so its
 * last point lags the live portfolio total shown as the hero's big number. When the caller passes the
 * current value, a synthetic "now" tip (value == that total, timestamped at page load) is APPENDED as
 * the last point of every non-empty period, so the chart ends exactly at the big number. Display-only:
 * the stored series is never mutated, and the tip is added ONLY to a period that already plots (>=2
 * real points) — an empty/insufficient period stays honest-empty, never fabricated from a lone point.
 */
import type { ChartPoint } from "@/components/data-display/PerformanceChart";
import type { ChartPeriod, PortfolioSeries } from "@/mocks/data/portfolioSeries";
import { mapTimeseries } from "./mapTimeseries";
import type { TimeseriesPoint } from "./timeseriesSchema";

const DAY_MS = 86_400_000;

/**
 * The trailing-`days` calendar window over a daily series, measured from its latest point. Returns
 * the true window (no fallback-to-full): `Infinity` days = the whole series. Callers treat a window
 * with <2 points as unplottable (R4).
 */
function trailingWindow(points: TimeseriesPoint[], days: number): TimeseriesPoint[] {
  if (!Number.isFinite(days)) return points;
  const last = points.at(-1);
  if (!last) return points;
  const cutoff = Date.parse(last.date) - days * DAY_MS;
  return points.filter((point) => Date.parse(point.date) >= cutoff);
}

/** Calendar length of each selectable period. `day` (1D, hourly) has no daily-grain window (R4). */
const PERIOD_DAYS: Record<Exclude<ChartPeriod, "day">, number> = {
  week: 7,
  month: 30,
  sixMonth: 182,
  all: Number.POSITIVE_INFINITY,
};

/**
 * A windowed period is only plottable with >=2 points; otherwise it renders (and is treated as) empty.
 * When a `nowTip` is given (POO-716), it is appended to an already-plottable window so the period ends
 * at the live current value; an unplottable (<2-point) window stays empty — the tip never rescues it.
 */
function windowedPoints(
  points: TimeseriesPoint[],
  days: number,
  locale: string,
  nowTip?: ChartPoint,
): ChartPoint[] {
  const window = trailingWindow(points, days);
  if (window.length < 2) return [];
  const mapped = mapTimeseries(window, locale);
  return nowTip ? [...mapped, nowTip] : mapped;
}

/**
 * Build the Home hero's per-period series from the real daily investor value series. `day` is always
 * empty (no hourly grain, R4); every other period is a date-window, empty when it holds <2 points.
 *
 * POO-716: pass `currentValue` (the hero's live portfolio total) to append a synthetic "now" tip so
 * every plottable period ends at that value. `now` is injectable for deterministic tests (mirrors
 * {@link buildPortfolioSeries}). Omit `currentValue` (e.g. the Portfolio hero callers) for the plain,
 * un-appended windows. The tip reuses {@link mapTimeseries} so its label/display/date match every
 * other point.
 */
export function buildInvestorPortfolioSeries(
  points: TimeseriesPoint[],
  locale: string,
  currentValue?: number,
  now: number = Date.now(),
): PortfolioSeries {
  const nowTip =
    currentValue !== undefined && Number.isFinite(currentValue)
      ? mapTimeseries([{ date: new Date(now).toISOString(), value_usd: currentValue }], locale)[0]
      : undefined;
  return {
    day: [],
    week: windowedPoints(points, PERIOD_DAYS.week, locale, nowTip),
    month: windowedPoints(points, PERIOD_DAYS.month, locale, nowTip),
    sixMonth: windowedPoints(points, PERIOD_DAYS.sixMonth, locale, nowTip),
    all: windowedPoints(points, PERIOD_DAYS.all, locale, nowTip),
  };
}
