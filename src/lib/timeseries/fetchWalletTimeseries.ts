/**
 * @id PP-CORE (POO-366, POO-367)
 * @name wallet timeseries reads (manager AUM + investor portfolio)
 * @implements-rules-version v1
 *
 * Server-side reads of a wallet's value-over-time series from the analytics indexer
 * (`GET /analytics/wallets/:addr/timeseries`), for the investor + manager hero charts. Both return []
 * on empty/missing/error so the chart degrades gracefully.
 *
 * [R2] The degrade-to-[] on error is observed (structured server log) so an analytics OUTAGE is
 * distinguishable from a clean 200 with no series (a non-manager / brand-new-investor wallet, or the
 * historical `investor_portfolio: { note: "pending" }` stub). [R3] the clean empty case is not logged.
 *
 * PP-INTEGRATION-POINT: manager AUM series ← analytics manager_aum (POO-366).
 * PP-INTEGRATION-POINT: per-investor portfolio value series ← analytics investor_portfolio (a bare
 * array on the live contract; legacy { series } / { note } object shapes tolerated, POO-645).
 */
import "server-only";

import type { z } from "zod";
import { analyticsFetch } from "@/lib/analytics-api/client";
import { observeAnalyticsFailure } from "@/lib/analytics-api/observeFailure";
import { type TimeseriesPoint, walletTimeseriesSchema } from "./timeseriesSchema";

/** AUM/portfolio value drift slowly and the series is wallet-keyed but read-only, so a short cache is fine. */
const TIMESERIES_REVALIDATE_SECONDS = 300;

/**
 * Read one field of the wallet timeseries endpoint, never throwing: empty/missing/error all yield [].
 * An outage is observed (structured log) before degrading; a clean empty response is not (R2/R3).
 */
async function readWalletSeries(
  address: string,
  pick: (response: z.infer<typeof walletTimeseriesSchema> | null) => TimeseriesPoint[] | undefined,
): Promise<TimeseriesPoint[]> {
  const endpoint = `analytics/wallets/${address}/timeseries`;
  try {
    const response = await analyticsFetch(endpoint, {
      schema: walletTimeseriesSchema,
      revalidate: TIMESERIES_REVALIDATE_SECONDS,
    });
    return pick(response) ?? [];
  } catch (error) {
    // [R2] Observe the outage before degrading to []; [R3] expected empties stay silent.
    observeAnalyticsFailure({ endpoint, error, key: address });
    return [];
  }
}

/** Fetch a manager wallet's AUM series. Never throws — empty/missing/error all yield []. */
export async function fetchManagerAumTimeseries(address: string): Promise<TimeseriesPoint[]> {
  return readWalletSeries(address, (response) => response?.manager_aum);
}

/**
 * Fetch a wallet's per-investor portfolio value series (its TOTAL value across all positions over
 * time, POO-368). Never throws — the pending stub, an absent field, an empty series, and an outage
 * all yield [] (POO-367 R2), so the hero chart falls back to the honest-empty state (R3).
 */
export async function fetchInvestorPortfolioTimeseries(
  address: string,
): Promise<TimeseriesPoint[]> {
  return readWalletSeries(address, (response) => {
    // POO-645 R2: the live contract is a bare array (matches manager_aum); the legacy object
    // shape carried the series under .series. Either way manager_aum parsing is never poisoned.
    const value = response?.investor_portfolio;
    return Array.isArray(value) ? value : value?.series;
  });
}
