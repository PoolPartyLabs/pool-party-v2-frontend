/**
 * @id PP-BALANCES (POO-815)
 * @name mapHolding
 * @implements-rules-version v1
 * Maps one pool-party-api wallet-holding row (for a given chain) to our {@link TokenBalance}, or
 * `null` when the row has no resolvable price (can't be valued, sorted, or dust-filtered — POO-815
 * [R3]).
 *
 * The backend (pool-party-api `wallet.service.ts`) already labels the native token per network
 * (POL / Polygon on Polygon, ETH / Ether elsewhere, `isNative: true`, address `0x000…0`) and prices
 * via CoinGecko keeping only unit prices > $0.01 — so unpriced tokens arrive with `priceUSD` absent
 * and `formattedBalanceInUSD: "NaN"`. We pass symbol/name straight through (the backend is
 * authoritative) and drop the unpriced rows.
 */
import type { TokenBalance } from "./types";
import type { WalletHolding } from "./walletHoldingsSchema";

/**
 * Map a backend holding row to a {@link TokenBalance}. Returns `null` for an unpriced row
 * (`priceUSD` absent/NaN or a non-numeric USD value) so the surface never shows a valueless holding.
 */
export function mapHolding(row: WalletHolding, chainId: number): TokenBalance | null {
  const usd = Number(row.formattedBalanceInUSD);
  if (row.priceUSD == null || Number.isNaN(row.priceUSD) || Number.isNaN(usd)) return null;

  const amount = Number(row.formattedBalance);
  return {
    symbol: row.symbol,
    name: row.name,
    amount: Number.isFinite(amount) ? amount : 0,
    decimals: row.decimals,
    usd: Number.isFinite(usd) ? usd : 0,
    chainId,
    logoUrl: row.logo ?? "",
    address: row.address,
    isNative: row.isNative,
  };
}
