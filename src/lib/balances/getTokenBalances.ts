/**
 * @id PP-BALANCES (POO-238, POO-239)
 * @name getTokenBalances
 * @implements-rules-version v1
 * Multi-token, multi-chain balance source for the wallet modal. Returns the connected wallet's
 * holdings (token amount + USD value at read time) across the supported networks, hiding any
 * zero balances.
 *
 * PP-MOCK: reads static fixtures from src/mocks/data/balances.ts.
 * PP-INTEGRATION-POINT (POO-239): the real TokenBalanceService reads ERC-20 balanceOf across the
 * configured chains via viem and prices each holding via the mark-to-market source; this mock
 * branch is replaced there. Kept separate from the account service (POO-197) so the wallet-stack
 * integration (INT-W) is not touched.
 */
import { tokenBalances } from "@/mocks/data/balances";
import type { TokenBalance } from "./types";

/** Simulated read latency (ms) so loading states are exercised. */
const MOCK_LATENCY = 250;

/**
 * Returns the connected wallet's token balances, zero balances omitted. When `chainId` is given,
 * only that chain's holdings are returned; otherwise holdings across all chains are merged.
 */
export async function getTokenBalances(chainId?: number): Promise<TokenBalance[]> {
  await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY));
  const held = tokenBalances.filter((balance) => balance.amount > 0);
  return chainId == null ? held : held.filter((balance) => balance.chainId === chainId);
}
