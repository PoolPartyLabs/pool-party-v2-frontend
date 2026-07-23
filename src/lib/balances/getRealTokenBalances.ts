/**
 * @id PP-BALANCES (POO-239)
 * @name getRealTokenBalances
 * @implements-rules-version v1
 * Real on-chain balance source for the wallet modal + header chip: the connected wallet's USDC
 * across EVERY supported network (Arbitrum + Base + Polygon), priced 1:1 (USDC is a USD stablecoin).
 * One {@link TokenBalance} per network that holds a non-zero balance.
 *
 * The investor app is chain-agnostic (a zap/bridge picks the chain at execution), so the modal lists
 * these without a network switcher and the total is simply their sum. Per-network RPC failures are
 * tolerated: a degraded endpoint is skipped, never hiding funds the wallet holds elsewhere.
 *
 * PP-INTEGRATION-POINT (POO-239): extend to non-USDC holdings and a real mark-to-market price source.
 */
import { readUsdcBalance } from "@/lib/account/readUsdcBalance";
import { type ChainMeta, supportedChainMetas } from "@/lib/chains/config";
import type { TokenBalance } from "./types";

/** CoinGecko USDC logo (same CDN source as the token catalog + mock fixtures). */
const USDC_LOGO = "https://assets.coingecko.com/coins/images/6319/large/usdc.png";

/** One network's resolved USDC holding. */
interface NetworkUsdc {
  meta: ChainMeta;
  amount: number;
}

/** The connected wallet's USDC across all supported networks (zero balances omitted). */
export async function getRealTokenBalances(address: `0x${string}`): Promise<TokenBalance[]> {
  const results = await Promise.allSettled(
    supportedChainMetas.map(
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
      symbol: "USDC",
      name: "USD Coin",
      amount,
      decimals: meta.usdc.decimals,
      // USDC is a USD stablecoin → its USD value equals the token amount (price-at-time ≈ 1).
      usd: amount,
      chainId: meta.chain.id,
      logoUrl: USDC_LOGO,
    }));
}
