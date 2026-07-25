/**
 * @id PP-CORE-LIB-053 (POO-1031)
 * @name funding inventory action
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The `"use server"` boundary in front of {@link getFundingInventory}: the funding-source selector
 * (POO-1039) runs in the browser, and the inventory reads the Uniswap Trading API with a server-only
 * key (ADR 0003). Next compiles this to an RPC stub on the client, so the key never enters a bundle.
 *
 * The wallet is the SIWE session's, never the caller's — same contract as `walletHoldingsActions` and
 * every Uniswap action. A client-supplied address is not validated here, it simply has nowhere to go:
 * the parameter does not exist, so no future loosening of a check can open a path to someone else's
 * holdings.
 *
 * Never throws across the RSC boundary: a degraded read is already an empty list rather than an
 * exception (see {@link getFundingInventory}), and no session is an empty list too.
 */
"use server";

import { getSessionWallet } from "@/lib/auth/session";
import { type FundingSource, getFundingInventory } from "./fundingInventory";

/** Everything the signed-in wallet can pay with. Not signed in → `[]`. */
export async function getFundingInventoryAction(): Promise<FundingSource[]> {
  const wallet = await getSessionWallet();
  if (!wallet) return [];
  return getFundingInventory(wallet);
}
