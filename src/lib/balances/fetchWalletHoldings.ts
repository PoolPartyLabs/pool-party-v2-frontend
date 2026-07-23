/**
 * @id PP-BALANCES (POO-815)
 * @name fetchWalletHoldings
 * @implements-rules-version v1
 *
 * Server-side read of the connected wallet's FULL multi-token holdings (with USD) across every
 * supported network, from pool-party-api `GET /api/v1/wallet/{address}?network=` (backend discovers
 * tokens via Alchemy, prices them via CoinGecko, keeping only unit prices > $0.01). Mirrors
 * pool-party-interface `fetchWalletMetadata`, adapted to our chain-agnostic UI:
 * fan out over the 3 networks and merge. A per-network failure is skipped (never hides funds held
 * elsewhere, POO-815 [R2]); if EVERY network fails the read throws so the caller falls back to the
 * USDC-only on-chain read ([R5]). Unpriced rows are dropped in the mapper ([R3]).
 *
 * `?network=` is a plain query param and the apiFetch `network` ROUTING option is intentionally NOT
 * set: pool-party-interface always calls the CURRENT backend for `/wallet` (network as query only),
 * whereas passing `network` would route Arbitrum/Base to PP_API_URL_LEGACY. See POO-813 [Q2].
 *
 * PP-INTEGRATION-POINT (POO-813): the real wallet-holdings endpoint on pool-party-api.
 */
import "server-only";

import { apiFetch } from "@/lib/api/client";
import { supportedChainMetas } from "@/lib/chains/config";
import { mapHolding } from "./mapHolding";
import type { TokenBalance } from "./types";
import { walletHoldingsSchema } from "./walletHoldingsSchema";

/** One network's holdings, mapped and priced (unpriced rows already dropped). */
async function fetchNetworkHoldings(address: string, apiNetworkId: string, chainId: number) {
  const data = await apiFetch(`wallet/${address}?network=${apiNetworkId}`, {
    schema: walletHoldingsSchema,
    // No `network` routing option on purpose (see file header + POO-813 [Q2]); no `revalidate`
    // so the balance stays fresh (the manual refresh re-reads it, POO-808).
  });
  return (data?.tokensBalance ?? [])
    .map((row) => mapHolding(row, chainId))
    .filter((balance): balance is TokenBalance => balance !== null);
}

/**
 * The connected wallet's holdings across all supported networks, merged. No address → `[]`. Throws
 * only when EVERY network read failed (so the caller can fall back); a partial failure is tolerated.
 */
export async function fetchWalletHoldings(address: string): Promise<TokenBalance[]> {
  if (!address) return [];

  const results = await Promise.allSettled(
    supportedChainMetas.map((meta) =>
      fetchNetworkHoldings(address, meta.apiNetworkId, meta.chain.id),
    ),
  );

  const fulfilled = results.filter(
    (r): r is PromiseFulfilledResult<TokenBalance[]> => r.status === "fulfilled",
  );

  // Every network failed → surface the failure so the caller degrades to the USDC-only read ([R5]).
  if (fulfilled.length === 0) {
    const firstRejected = results.find((r) => r.status === "rejected");
    throw (
      (firstRejected as PromiseRejectedResult | undefined)?.reason ??
      new Error("wallet holdings read failed on every network")
    );
  }

  return fulfilled.flatMap((r) => r.value);
}
