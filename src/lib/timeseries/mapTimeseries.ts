/**
 * @id PP-CORE (POO-366)
 * @name mapTimeseries
 * @implements-rules-version v2
 *
 * Pure mapper: an analytics value-over-time series → the `ChartPoint[]` the PerformanceChart renders.
 * Labels are the point's own ISO date formatted in the active locale (UTC, so a `YYYY-MM-DD` never
 * shifts a day across timezones); `display` is the USD value. Series order is preserved (API returns
 * oldest → newest). v2 (POO-557 R2): the raw ISO `date` rides along on each ChartPoint so period
 * tabs can window the series by real calendar time.
 */
import type { ChartPoint } from "@/components/data-display/PerformanceChart";
import { formatUsd } from "@/lib/utils/format";
import type { TimeseriesPoint } from "./timeseriesSchema";

/** Map `{ date, value_usd }[]` to labelled chart points in `locale`. */
export function mapTimeseries(points: TimeseriesPoint[], locale: string): ChartPoint[] {
  const formatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return points.map((point) => ({
    value: point.value_usd,
    label: formatter.format(new Date(point.date)),
    display: formatUsd(point.value_usd),
    date: point.date,
  }));
}
