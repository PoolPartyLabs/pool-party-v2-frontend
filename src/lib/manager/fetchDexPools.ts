/**
 * @id PP-MGR (POO-305)
 * @name fetchDexPools
 * @implements-rules-version v1
 *
 * Server-side read of the candidate Uniswap pools for a token pair
 * (GET /api/v1/dex-pools?network&currency0[&currency1]). The browser never calls the API directly.
 *
 * PP-INTEGRATION-POINT: builder pool candidates ← pool-party-api dex-pools (POO-305).
 */
import "server-only";

import { ApiError, apiFetch } from "@/lib/api/client";
import { type DexPool, dexPoolsResponseSchema } from "./dexPoolsSchema";

/** Fetch the candidate dex pools for `currency0` (+ optional `currency1`) on a network. */
export async function fetchDexPools(
  network: string,
  currency0: string,
  currency1?: string,
  authHeader: Record<string, string> = {},
): Promise<DexPool[]> {
  // Encode every value — token symbols can contain `+` (e.g. "USD+"), which would otherwise
  // decode to a space server-side.
  const params = new URLSearchParams({ network, currency0 });
  if (currency1) params.set("currency1", currency1);
  const path = `dex-pools?${params.toString()}`;

  try {
    const pools = await apiFetch(path, {
      schema: dexPoolsResponseSchema,
      network,
      headers: authHeader,
    });
    return pools ?? [];
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return [];
    throw error;
  }
}
