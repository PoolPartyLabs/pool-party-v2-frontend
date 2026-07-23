/**
 * @id PP-CORE (POO-366, POO-782)
 * @name fetchPoolTimeseries
 * @implements-rules-version v1
 *
 * Server-side read of a PP pool's value-over-time (AUM) series from the analytics indexer, for the
 * strategy-detail and manager-strategy performance charts. Wallet-independent, so it is cacheable and
 * fetched in the server component. Returns [] on empty/missing/error so the chart falls back to its
 * derived series rather than breaking the page.
 *
 * [R2] The degrade-to-[] on error is observed (structured server log) so an analytics OUTAGE is
 * distinguishable from a clean 200-with-empty-series (a young/uncovered pool). [R3] the clean empty
 * case is not logged.
 *
 * POO-782 R1: callers that only need a short trailing window (the manager-console row sparks, which
 * downsample to the trailing 30d) pass `{ period: "1M" }` so the endpoint pulls just the last month
 * instead of the full history series. The period is appended to the URL, which DELIBERATELY SPLITS the
 * Next data-cache key from the full-history detail-chart read (same pool id, no period). We accept that
 * split: the spark reads are tiny and 300s-cached, and keeping them on their own key stops a capped
 * spark payload from ever being served to the full-series detail chart (or vice versa).
 *
 * PP-INTEGRATION-POINT: pool AUM series ← analytics GET /analytics/pools/:id/timeseries (PR #12).
 */
import "server-only";

import { analyticsFetch } from "@/lib/analytics-api/client";
import { observeAnalyticsFailure } from "@/lib/analytics-api/observeFailure";
import { poolTimeseriesSchema, type TimeseriesPoint } from "./timeseriesSchema";

/** AUM drifts slowly and the series is wallet-independent, so a short cache collapses repeat renders. */
const TIMESERIES_REVALIDATE_SECONDS = 300;

/**
 * A supported analytics `?period` window. The controller accepts `1M` (trailing month); the full
 * history series is requested by OMITTING the param (POO-782 R1). Kept a string-literal union so a new
 * caller can't silently pass an unsupported window.
 */
export type TimeseriesPeriod = "1M";

/** Options for {@link fetchPoolTimeseries}. */
export interface FetchPoolTimeseriesOptions {
  /**
   * Trailing window to request. Omit for the FULL history series (the detail-chart default). Passing a
   * period appends `?period=<value>` and, by design, splits this read onto its own Next cache key
   * (POO-782 R1) so a capped spark payload never collides with the full-series detail chart.
   */
  period?: TimeseriesPeriod;
}

/**
 * Fetch a pool's AUM series. `poolId` is the PP pool's `position_contract` or raw position id
 * (our `strategy.id`). Never throws — a missing/empty series or any upstream error yields [].
 */
export async function fetchPoolTimeseries(
  poolId: string,
  options: FetchPoolTimeseriesOptions = {},
): Promise<TimeseriesPoint[]> {
  const { period } = options;
  // POO-782 R1: the period rides in the URL, so a period read is a DISTINCT Next cache key from the
  // full-history read for the same pool. The observe key stays the bare pool id (period variants are
  // the same pool for outage attribution).
  const endpoint = period
    ? `analytics/pools/${poolId}/timeseries?period=${period}`
    : `analytics/pools/${poolId}/timeseries`;
  try {
    const response = await analyticsFetch(endpoint, {
      schema: poolTimeseriesSchema,
      revalidate: TIMESERIES_REVALIDATE_SECONDS,
    });
    return response?.series ?? [];
  } catch (error) {
    // [R2] Observe the outage before degrading to []; [R3]/[R4] expected non-outages stay silent.
    observeAnalyticsFailure({ endpoint, error, key: poolId });
    return [];
  }
}
