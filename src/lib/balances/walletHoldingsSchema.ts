/**
 * @id PP-BALANCES (POO-815)
 * @name walletHoldingsSchema
 * @implements-rules-version v1
 * Zod schema for one network's response from pool-party-api `GET /wallet/{address}?network=`
 * (verified against pool-party-interface `fetchWalletMetadata`). We only need `tokensBalance` for
 * the wallet modal; `transactions` is ignored. The mapper drops unpriced rows, so `priceUSD` is
 * nullable/optional. No `.default()` / `.coerce` on purpose: they make the zod input and output
 * types diverge, which `apiFetch<T>` (one type param) then resolves to the looser input type.
 *
 * PP-INTEGRATION-POINT (POO-813): the backend contract this validates.
 */
import { z } from "zod";

/** One held token as returned by pool-party-api. */
export const walletHoldingSchema = z.object({
  /** Contract address (`0x000…000` for native). */
  address: z.string(),
  name: z.string(),
  symbol: z.string(),
  /** Token logo URL (may be absent for a token CoinGecko has no image for). */
  logo: z.string().optional(),
  decimals: z.number(),
  /** Raw balance (unused by the modal; the formatted fields drive display). */
  balance: z.number().optional(),
  /** Human-readable token amount. */
  formattedBalance: z.string(),
  /** Unit price in USD; null / NaN / absent ⇒ the mapper drops the row. */
  priceUSD: z.number().nullable().optional(),
  /** Human-readable USD value of the holding. */
  formattedBalanceInUSD: z.string(),
  isNative: z.boolean(),
});

/** The `data` payload of `GET /wallet/{address}?network=`. */
export const walletHoldingsSchema = z.object({
  wallet: z.string().optional(),
  tokensBalance: z.array(walletHoldingSchema).optional(),
  transactions: z.array(z.unknown()).optional(),
});

/** One held token (parsed). */
export type WalletHolding = z.infer<typeof walletHoldingSchema>;
/** A network's parsed wallet-holdings payload. */
export type WalletHoldings = z.infer<typeof walletHoldingsSchema>;
