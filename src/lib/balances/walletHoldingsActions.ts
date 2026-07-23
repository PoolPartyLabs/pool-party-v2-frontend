/**
 * @id PP-BALANCES (POO-815, POO-270)
 * @name walletHoldingsActions
 * @implements-rules-version v1
 *
 * Server Action for the connected wallet's full multi-token holdings. The wallet identity is derived
 * server-side from the SIWE session cookie (POO-270), not trusted from the client, and the API read
 * runs server-side (fetchWalletHoldings via apiFetch), so the browser never calls pool-party-api
 * directly. Returns `null` on failure (endpoint not enabled / every network failed) so the client
 * hook can fall back to the USDC-only on-chain read without a thrown Server Action error (POO-815
 * [R5]); `[]` means a signed-in wallet with no priced holdings.
 */
"use server";

import { getSessionWallet } from "@/lib/auth/session";
import { fetchWalletHoldings } from "@/lib/balances/fetchWalletHoldings";
import type { TokenBalance } from "@/lib/balances/types";

/**
 * The signed-in wallet's holdings. Not signed in → `[]`. On any failure → `null` (fall back to the
 * USDC-only read); the array (possibly empty) is the real holdings otherwise.
 */
export async function getWalletHoldingsAction(): Promise<TokenBalance[] | null> {
  const wallet = await getSessionWallet();
  if (!wallet) return [];
  try {
    return await fetchWalletHoldings(wallet);
  } catch {
    // Endpoint not enabled yet / transient outage → signal the client to fall back (no regression).
    return null;
  }
}
