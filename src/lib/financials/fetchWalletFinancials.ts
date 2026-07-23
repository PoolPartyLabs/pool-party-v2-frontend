/**
 * @id PP-CORE-LIB-046
 * @name fetchWalletFinancials
 * @implements-rules-version v1
 *
 * Server-only read of the connected wallet's ledger/snapshot-sourced financials from the analytics
 * indexer (`GET /analytics/wallets/:address/financials`, POO-932 C9 serving layer). PP-CORE-LIB-048
 * (POO-990): this is the SOLE money source in real mode — it serves the corrected Part I fields (Earned
 * today, Invested, Total Yield, Portfolio value, Available/claimable, per-strategy) DIRECTLY; the legacy
 * client-side cross-backend join over /portfolio + /metrics was fully removed.
 *
 * Honest degrade (POO-698 / POO-936 [R5]): every money field is served nullable and a NULL is honest
 * absence, never $0. This fetcher NEVER throws — a 204/empty body, an unknown wallet, an outage, or a
 * schema-parse failure all coalesce to `null`, so the caller renders the money KPIs as "not available
 * yet" (never a legacy figure) rather than blanking the surface. A genuine outage is observed (structured
 * log) before degrading; a clean empty is not. Returning `null` (not an empty object) lets the caller
 * distinguish "financials unavailable → render unavailable" from "financials present but a field is null
 * → render that field unavailable".
 *
 * PP-INTEGRATION-POINT: investor financials ← analytics `GET /wallets/:addr/financials` (POO-932). NULL
 * fields mean the POO-933 backfill has not populated that source yet; the FE renders them as
 * unavailable/loading, never as a fabricated zero.
 */
import "server-only";

import { analyticsFetch } from "@/lib/analytics-api/client";
import { observeAnalyticsFailure } from "@/lib/analytics-api/observeFailure";
import { type WalletFinancials, walletFinancialsSchema } from "./financialsSchema";

/** Financials drift slowly (the ledger recomputes on a 4h cycle); a short wallet-keyed cache is fine. */
const FINANCIALS_REVALIDATE_SECONDS = 300;

/**
 * Read the wallet's financials payload, or `null` when it is unavailable (empty/missing/outage/parse
 * failure) so the caller renders the money KPIs as the honest "not available yet" state (POO-990: there
 * is NO legacy path — the legacy `/metrics` reader was removed). Never throws.
 */
export async function fetchWalletFinancials(address: string): Promise<WalletFinancials | null> {
  const endpoint = `analytics/wallets/${address}/financials`;
  try {
    const response = await analyticsFetch(endpoint, {
      schema: walletFinancialsSchema,
      revalidate: FINANCIALS_REVALIDATE_SECONDS,
    });
    // A 204 (null) / absent body is a clean empty, not an outage → null (the caller renders the KPIs
    // as the honest unavailable state; POO-990 removed the legacy `/metrics` fallback path).
    return response ?? null;
  } catch (error) {
    // Observe the outage before degrading; a clean empty parses above and never reaches here.
    observeAnalyticsFailure({ endpoint, error, key: address });
    return null;
  }
}
