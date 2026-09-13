/**
 * @id PP-BALANCES (POO-239)
 * @name getRealTokenBalances
 * @implements-rules-version v1
 * Real on-chain balance source for the wallet modal + header chip: the connected wallet's USDC
 * across every ACTIVE network (`activeChainMetas`, so a flag-gated chain is skipped while its flag
 * is off), priced 1:1 (USDC is a USD stablecoin).
 * One {@link TokenBalance} per network that holds a non-zero balance.
 *
 * POO-1776 [R1]: a flag-gated chain is skipped while its flag is off. This runs on the DEGRADED
 * path of every connected wallet, so an ungated alpha chain would mean one RPC round-trip per user
 * to an endpoint the environment has not switched on.
 *
 * The investor app is chain-agnostic (a zap/bridge picks the chain at execution), so the modal lists
 * these without a network switcher and the total is simply their sum. Per-network RPC failures are
 * tolerated: a degraded endpoint is skipped, never hiding funds the wallet holds elsewhere.
 *
 * PP-INTEGRATION-POINT (POO-239): extend to non-USDC holdings and a real mark-to-market price source.
 */
import { readUsdcBalance } from "@/lib/account/readUsdcBalance";
import { activeChainMetas, type ChainMeta } from "@/lib/chains/config";
import { isFeatureEnabled } from "@/lib/features";
import type { TokenBalance } from "./types";

/** One network's resolved USDC holding. */
interface NetworkUsdc {
  meta: ChainMeta;
  amount: number;
}

/** The connected wallet's USDC across all ACTIVE networks (zero balances omitted). */
export async function getRealTokenBalances(address: `0x${string}`): Promise<TokenBalance[]> {
  const results = await Promise.allSettled(
    // [R1] `isFeatureEnabled` (not `useFeatureFlags`): this is a plain async function called from a
    // hook's effect and from the `server-only` funding inventory, so it has no hook context. It also
    // keeps both branches of the same read consistent — `getWalletHoldingsAction` runs on the server,
    // where the Dev menu's client-side overrides do not exist either.
    activeChainMetas(isFeatureEnabled).map(
      async (meta): Promise<NetworkUsdc> => ({
        meta,
        amount: await readUsdcBalance(address, meta.chain.id),
      }),
    ),
  );

  return results
    .filter(
      (result): result is PromiseFulfilledResult<NetworkUsdc> =>
        result.status === "fulfilled" && result.value.amount > 0,
    )
    .map(({ value: { meta, amount } }) => ({
      // POO-1779 [R1]/[R3]: the LABEL comes off the same meta entry the address and decimals do, so
      // a Robinhood row reads "USDG · Global Dollar" over the USDG mark, and can never print a
      // symbol — or an icon — the balance is not. The read itself is unchanged: every configured
      // stable is 6 decimals at parity.
      symbol: meta.usdc.symbol,
      name: meta.usdc.name,
      amount,
      decimals: meta.usdc.decimals,
      // USDC is a USD stablecoin → its USD value equals the token amount (price-at-time ≈ 1).
      usd: amount,
      chainId: meta.chain.id,
      logoUrl: meta.usdc.logoUrl,
      // The contract this balance was read from (POO-1031 [R4]): on the degraded path this is still
      // a spendable funding source, and a source with no token address cannot be quoted or routed.
      address: meta.usdc.address,
      isNative: false,
    }));
}
