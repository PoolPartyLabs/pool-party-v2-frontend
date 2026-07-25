/**
 * @id PP-BALANCES (POO-238, POO-239, POO-815)
 * @name TokenBalance
 * @implements-rules-version v1
 * Shape of a single token holding shown in the wallet modal: a human-readable token amount plus
 * its USD value at read time (price-at-time), tagged with the chain it lives on.
 */

/** A single token holding for the connected wallet, on one chain. */
export interface TokenBalance {
  /** Token symbol, e.g. "USDC". */
  symbol: string;
  /** Full token name, e.g. "USD Coin". */
  name: string;
  /** Human-readable token amount held (already scaled by `decimals`). */
  amount: number;
  /**
   * The SAME amount as the exact decimal string the backend returned, unrounded (POO-1031 [R2]).
   *
   * {@link amount} is a float, which is fine for display and wrong for sizing a transaction: an
   * 18-decimal balance loses its tail past ~17 significant digits and can round UP, so a swap sized
   * from it asks for more than the wallet holds and reverts. Anything converting a balance to base
   * units must read this; anything rendering it can keep reading `amount`. Absent on the degraded
   * USDC-only path, where the balance is a number to begin with.
   */
  amountExact?: string;
  /** Token decimals (for precision/formatting). */
  decimals: number;
  /** USD value of the holding at read time (price-at-time). */
  usd: number;
  /** Chain id the balance lives on (matches `supportedChains` ids). */
  chainId: number;
  /** Token logo URL (CoinGecko CDN, same source as the token catalog). */
  logoUrl: string;
  /** Token contract address (`0x000…000` for the native token). Real path only (POO-815). */
  address?: string;
  /** Whether this is the chain's native token (ETH / POL). Real path only (POO-815). */
  isNative?: boolean;
}
