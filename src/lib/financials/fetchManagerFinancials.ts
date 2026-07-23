/**
 * @id PP-CORE-LIB-047
 * @name fetchManagerFinancials
 * @implements-rules-version v1
 *
 * Server-only read of a manager wallet's ledger/snapshot-sourced financials from the analytics
 * indexer (`GET /analytics/manager/:address/financials`, POO-932 C9 serving layer). The C1 source for
 * the Manager console money tiles: Total AUM, the 30d change % (server-computed, field 16), Net inflows
 * 30d (A3 override), Yield generated (incl. closed-unsettled), Performance fees (all-time + 30d),
 * Active/Total investors, and the field-16 chart series (each from the SAME table as its KPI).
 * PP-CORE-LIB-048 (POO-990): read unconditionally in real mode (the `financialsV2` flag was removed).
 *
 * Honest degrade (POO-698 / POO-936 [R5]): every money field is served nullable and a NULL is honest
 * absence, never $0. This fetcher NEVER throws — a 204/empty body, a non-manager wallet, an outage, or
 * a schema-parse failure all coalesce to `null`. An outage is observed before degrading; a clean empty
 * is not. (The manager console keeps a non-null pp_api/summary fallback for its non-nullable schema
 * fields — a served NULL there degrades to the pp_api figure, documented in buildManagerConsole.)
 *
 * PP-INTEGRATION-POINT: manager financials ← analytics `GET /manager/:addr/financials` (POO-932). NULL
 * fields mean the POO-933 backfill has not populated that source yet; the FE renders them as
 * unavailable, never as a fabricated zero.
 */
import "server-only";

import { analyticsFetch } from "@/lib/analytics-api/client";
import { observeAnalyticsFailure } from "@/lib/analytics-api/observeFailure";
import { type ManagerFinancials, managerFinancialsSchema } from "./financialsSchema";

/** AUM/flows recompute on the ledger cycle; a short manager-keyed cache is fine. */
const FINANCIALS_REVALIDATE_SECONDS = 300;

/**
 * Read a manager wallet's financials payload, or `null` when unavailable (empty/missing/outage/parse
 * failure) so the console degrades to its non-null pp_api/summary fallback. Never throws.
 */
export async function fetchManagerFinancials(address: string): Promise<ManagerFinancials | null> {
  const endpoint = `analytics/manager/${address}/financials`;
  try {
    const response = await analyticsFetch(endpoint, {
      schema: managerFinancialsSchema,
      revalidate: FINANCIALS_REVALIDATE_SECONDS,
    });
    return response ?? null;
  } catch (error) {
    observeAnalyticsFailure({ endpoint, error, key: address });
    return null;
  }
}
