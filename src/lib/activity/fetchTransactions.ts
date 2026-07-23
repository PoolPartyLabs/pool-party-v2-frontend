/**
 * @id PP-ACT (POO-212)
 * @name fetchTransactions
 * @implements-rules-version v1
 *
 * Server-side read of the OAMS activity feed (GET /analytics/wallets/:a/transactions),
 * mapped to the FE Transaction shape. Analytics covers only LiquidityAdded/Removed;
 * non-OAMS transaction types (fiat deposit, swap, card, savings) have no source and
 * are absent (tracked gap). No wallet → []; a per-wallet 404 → []; other errors propagate.
 *
 * [R2]/[R3] A per-wallet 404 (WALLET_NOT_FOUND) is "no data yet" and stays silent; a genuine
 * outage (network/timeout/5xx/parse) is observed (structured server log) before it rethrows.
 *
 * PP-INTEGRATION-POINT: activity feed ← analytics indexer (OAMS subset only).
 */
import "server-only";

import { AnalyticsError, analyticsFetch } from "@/lib/analytics-api/client";
import { observeAnalyticsFailure } from "@/lib/analytics-api/observeFailure";
import type { Transaction } from "@/lib/schemas";
import { mapTransaction } from "./mapTransaction";
import { analyticsTransactionsResponseSchema } from "./transactionsSchema";

/** Most-recent-first page size requested from the indexer. */
const PAGE_LIMIT = 50;

/** Fetch and map the activity feed for a wallet. No address → empty list. */
export async function fetchTransactions(address?: string): Promise<Transaction[]> {
  if (!address) return [];

  const endpoint = `analytics/wallets/${address}/transactions`;
  try {
    const res = await analyticsFetch(`${endpoint}?limit=${PAGE_LIMIT}`, {
      schema: analyticsTransactionsResponseSchema,
      revalidate: 60,
    });
    if (!res) return [];
    return res.data.map(mapTransaction);
  } catch (error) {
    if (
      error instanceof AnalyticsError &&
      (error.status === 404 || error.code === "WALLET_NOT_FOUND")
    ) {
      return [];
    }
    // [R2] A genuine outage is observed before propagating; [R3] the 404 above never reaches here.
    observeAnalyticsFailure({ endpoint, error, key: address });
    throw error;
  }
}
