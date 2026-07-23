/**
 * @id PP-MGR-SCR-004 (POO-304)
 * @name fetchManagedPoolDetail
 * @implements-rules-version v1
 *
 * Server-side read of one pool's full detail (GET /api/v1/pools/:poolAddress) for the manager
 * manage-detail. The single-pool endpoint returns the rich pool object (ticks, fees, pair,
 * in-range) the manage view needs beyond the lean catalog row.
 *
 * PP-INTEGRATION-POINT: managed pool detail ← pool-party-api single-pool endpoint (POO-304).
 */
import "server-only";

import { ApiError, apiFetch } from "@/lib/api/client";
import { type ApiPool, apiPoolSchema } from "@/lib/strategies/poolsSchema";

/** Fetch the full pool detail by contract address + network, or null on a 404. */
export async function fetchManagedPoolDetail(
  poolAddress: string,
  network: string,
  authHeader: Record<string, string> = {},
): Promise<ApiPool | null> {
  try {
    return await apiFetch(`pools/${poolAddress}?network=${network}`, {
      schema: apiPoolSchema,
      network,
      headers: authHeader,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
