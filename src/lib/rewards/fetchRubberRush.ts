/**
 * @id PP-REW (POO-209)
 * @name fetchRubberRush
 * @implements-rules-version v2
 *
 * Server-side orchestration for the Rubber Rush read: merges the four analytics
 * indexer slices (P1 summary, P2 tier, P3 duck-shoot status, P6 referrals) into
 * a RubberRush. Each
 * slice is fetched independently so a per-wallet 404 (WALLET_NOT_FOUND) on one
 * slice degrades to that slice's zero defaults rather than failing the page
 * ([R5]). With no wallet address, returns a full zero-state without any network
 * call ([R6]). Non-404 errors (parse, network, 5xx) propagate to the caller.
 *
 * [R2]/[R3] A per-wallet 404 slice is "no data yet" and stays silent; a genuine outage on a slice
 * is observed (structured server log, keyed by the slice endpoint + wallet) before it rethrows.
 *
 * PP-INTEGRATION-POINT: Rubber Rush points/tier/duck-shoot reads ← analytics indexer.
 */
import "server-only";

import { AnalyticsError, analyticsFetch } from "@/lib/analytics-api/client";
import { observeAnalyticsFailure } from "@/lib/analytics-api/observeFailure";
import type { RubberRush } from "@/lib/schemas";
import {
  type DuckShootStatus,
  duckShootStatusSchema,
  type PointsSummary,
  pointsSummarySchema,
  type ReferralsSummary,
  referralsSummarySchema,
  type TierInfo,
  tierInfoSchema,
} from "./analyticsSchemas";
import { mapRubberRush } from "./mapRubberRush";

/** True when the error means "this wallet has no data for this slice" (graceful default). */
function isWalletAbsent(error: unknown): boolean {
  return (
    error instanceof AnalyticsError && (error.status === 404 || error.code === "WALLET_NOT_FOUND")
  );
}

/**
 * Run one slice read, degrading a wallet-absent error to null; other errors propagate.
 * [R2] A non-wallet-absent failure is observed (slice endpoint + wallet key) before it rethrows,
 * so a slice outage is visible in server logs; [R3] the silent wallet-absent 404 never reaches it.
 */
async function readSlice<T>(
  endpoint: string,
  key: string,
  promise: Promise<T | null>,
): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (isWalletAbsent(error)) return null;
    observeAnalyticsFailure({ endpoint, error, key });
    throw error;
  }
}

/**
 * Fetch and map the Rubber Rush dashboard for a wallet. Pass `undefined` (no
 * connected wallet) to get the zero-state without touching the network.
 */
export async function fetchRubberRush(address?: string): Promise<RubberRush> {
  if (!address) {
    return mapRubberRush({ summary: null, tier: null, status: null, referrals: null });
  }

  const summaryPath = `points/${address}/summary`;
  const tierPath = `points/${address}/tier`;
  const statusPath = `points/${address}/duck-shoot/status`;
  const referralsPath = `points/${address}/referrals/summary`;

  // [POO-763 R5] These figures change on every deposit / check-in / duck-shoot play, so they are read
  // uncached (`no-store`, matching the reference): a post-write refetch must reflect the new value
  // immediately rather than serving a stale time-revalidated cache entry.
  const [summary, tier, status, referrals] = await Promise.all([
    readSlice<PointsSummary>(
      summaryPath,
      address,
      analyticsFetch(summaryPath, { schema: pointsSummarySchema, cache: "no-store" }),
    ),
    readSlice<TierInfo>(
      tierPath,
      address,
      analyticsFetch(tierPath, { schema: tierInfoSchema, cache: "no-store" }),
    ),
    readSlice<DuckShootStatus>(
      statusPath,
      address,
      analyticsFetch(statusPath, { schema: duckShootStatusSchema, cache: "no-store" }),
    ),
    readSlice<ReferralsSummary>(
      referralsPath,
      address,
      analyticsFetch(referralsPath, { schema: referralsSummarySchema, cache: "no-store" }),
    ),
  ]);

  return mapRubberRush({ summary, tier, status, referrals });
}
