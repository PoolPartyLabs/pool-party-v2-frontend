/**
 * @id PP-MGR-LIB-006 (POO-559)
 * @name buildSpark
 * @implements-rules-version v1
 *
 * Pure builder for a manager-console card sparkline from a pool's real value series (POO-559): window
 * the daily `{ date, value_usd }` points to the trailing <=30d, downsample to ~8 (endpoints preserved
 * so the direction tint is exact), and report whether the result is a MEASURED trend (>=2 points) or a
 * placeholder that the card must not present as one. Reuses {@link sliceByDaysStrict} for the window.
 */
import type { TimeseriesPoint } from "@/lib/timeseries/timeseriesSchema";

const DAY_MS = 86_400_000;

/** The card spark shape: a small point budget matching the mock, ~8. */
const SPARK_WINDOW_DAYS = 30;
const SPARK_TARGET_POINTS = 8;

/** A card sparkline derived from a real series. */
export interface SparkResult {
  /** Values oldest -> newest. Meaningful only when {@link SparkResult.measured} is true. */
  points: number[];
  /** Whether `points` is a real measured trend (>=2 windowed points), not a placeholder. */
  measured: boolean;
}

/**
 * Points within the last `days` of the series' latest date. Unlike `sliceByDays` in manageSeries (which
 * falls back to the FULL series when the window is thin, because the manage-detail chart schema needs
 * >=2 points per period), this is STRICT: a thin window stays thin so the caller can honour R2 and hide
 * the spark rather than silently widen it to an out-of-window trend.
 */
function sliceByDaysStrict(points: TimeseriesPoint[], days: number): TimeseriesPoint[] {
  const last = points.at(-1);
  if (!last) return [];
  const cutoff = Date.parse(last.date) - days * DAY_MS;
  return points.filter((point) => Date.parse(point.date) >= cutoff);
}

/**
 * Downsample `values` to at most `target` points, always keeping the first and last (so the endpoints,
 * and therefore the first-vs-last direction tint, are exact) and sampling the interior at even index
 * steps. A series already at or below `target` is returned unchanged.
 */
export function downsampleSpark(values: number[], target = SPARK_TARGET_POINTS): number[] {
  if (values.length <= target || target < 2) return values;
  const out: number[] = [];
  const step = (values.length - 1) / (target - 1);
  for (let i = 0; i < target; i++) {
    const index = i === target - 1 ? values.length - 1 : Math.round(i * step);
    const value = values[index];
    if (value !== undefined) out.push(value);
  }
  return out;
}

/**
 * Build a card sparkline from a pool's value series: window to the trailing 30d, downsample to ~8. A
 * window with fewer than two points yields `measured: false` (R2), so the card hides the spark instead
 * of asserting a trend from a single point or an out-of-window value.
 */
export function sparkFromSeries(series: TimeseriesPoint[]): SparkResult {
  const windowed = sliceByDaysStrict(series, SPARK_WINDOW_DAYS);
  if (windowed.length < 2) return { points: [], measured: false };
  const points = downsampleSpark(
    windowed.map((point) => point.value_usd),
    SPARK_TARGET_POINTS,
  );
  return { points, measured: true };
}
