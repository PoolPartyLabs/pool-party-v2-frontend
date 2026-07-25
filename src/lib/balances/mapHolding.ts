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
 *
 * POO-1031 [R2]: the row's exact decimal balance rides along as `amountExact` beside the float, for
 * the funding inventory, which converts it to base units and must not overstate what the wallet holds.
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
    // The float above is the display value; this is the same balance unrounded, for whoever has to
    // size a transaction from it (POO-1031 [R2]). Passed through verbatim, never re-serialized.
    amountExact: row.formattedBalance,
    decimals: row.decimals,
    usd: Number.isFinite(usd) ? usd : 0,
    chainId,
    logoUrl: row.logo ?? "",
    address: row.address,
    isNative: row.isNative,
  };
}
