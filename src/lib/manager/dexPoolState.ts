/**
 * @id PP-MGR (POO-315)
 * @name fetchDexPoolState
 * @implements-rules-version v1
 *
 * Server-side read of one DEX pool's on-chain state (GET /dex-pools/:c0/:c1/:feeTier?network=),
 * which the dex-pools LIST endpoint omits. Provides the `sqrtPriceX96` / `liquidity` / `tickCurrent`
 * needed to size create-pool mint mins (mintAmountsWithSlippage). The browser never calls the API.
 *
 * PP-INTEGRATION-POINT: dex pool state ← pool-party-api single dex-pool (POO-315).
 */
import "server-only";

import { z } from "zod";
import { ApiError, apiFetch } from "@/lib/api/client";

const stateCurrencySchema = z.object({
  address: z.string(),
  decimals: z.number().int().min(0),
});

/** One DEX pool's on-chain state + the sorted token decimals. */
export const dexPoolStateSchema = z.object({
  feeTier: z.number().int().positive(),
  currency0: stateCurrencySchema,
  currency1: stateCurrencySchema,
  sqrtPriceX96: z.string(),
  liquidity: z.string(),
  tickCurrent: z.number().int(),
});
export type DexPoolState = z.infer<typeof dexPoolStateSchema>;

/**
 * Fetch one pool's state by token pair + fee tier. Returns null on 404.
 *
 * @param revalidate Optional data-cache window (seconds). Omit for a fresh read (create-pool mint
 *   mins at submit time). Set a short window for the live paired-amount quote, which re-reads on
 *   every amount edit — the price is stable within a create-pool session and the final mint re-reads
 *   fresh, so a brief cache spares the rate-limited backend.
 */
export async function fetchDexPoolState(
  network: string,
  currency0: string,
  currency1: string,
  feeTier: number,
  authHeader: Record<string, string> = {},
  revalidate?: number,
): Promise<DexPoolState | null> {
  const path = `dex-pools/${currency0}/${currency1}/${feeTier}?network=${encodeURIComponent(network)}`;
  try {
    return await apiFetch(path, {
      schema: dexPoolStateSchema,
      network,
      headers: authHeader,
      revalidate,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
