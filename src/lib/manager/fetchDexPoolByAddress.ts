/**
 * @id PP-MGR (POO-1429/POO-1430)
 * @name fetchDexPoolByAddress
 * @implements-rules-version v1
 *
 * Server-side read of a Uniswap v3 pool by its own contract address
 * (GET /api/v1/dex-pools?network&poolAddress), the endpoint's third, mutually exclusive way to
 * address a pool alongside the currency0(+currency1) pair path in `fetchDexPools`. A sibling file,
 * not an overload: the response envelope, `unwrapData` setting and return shape all differ, and a
 * shared function would force a union return type onto every existing `fetchDexPools` caller.
 *
 * Not-found is a plain 200 `{ data: [] }` on this endpoint (unlike the pair path, this one needs
 * no 404-to-[] catch). Any thrown error (network failure, a non-2xx status) propagates as-is.
 *
 * PP-INTEGRATION-POINT: builder pool-by-address resolve ← pool-party-api dex-pools (POO-1429).
 */
import "server-only";

import { apiFetch } from "@/lib/api/client";
import { type DexPool, dexPoolByAddressResponseSchema } from "./dexPoolsSchema";

/** Fetch the pool at `poolAddress` on a network, if any. */
export async function fetchDexPoolByAddress(
  network: string,
  poolAddress: string,
  authHeader: Record<string, string> = {},
): Promise<{ pools: DexPool[]; foundOnNetwork?: string }> {
  const params = new URLSearchParams({ network, poolAddress: poolAddress.toLowerCase() });
  const path = `dex-pools?${params.toString()}`;

  const result = await apiFetch(path, {
    schema: dexPoolByAddressResponseSchema,
    // The wrong-network response is a TWO-key envelope (`{ data, foundOnNetwork }`); apiFetch's
    // generic maybeUnwrap only unwraps a single-key `{ data }`, so this schema validates the whole
    // envelope itself rather than relying on the generic unwrap.
    unwrapData: false,
    network,
    headers: authHeader,
  });
  return { pools: result?.data ?? [], foundOnNetwork: result?.foundOnNetwork };
}
