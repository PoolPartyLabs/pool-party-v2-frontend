/**
 * @id PP-BALANCES (POO-815, POO-1893)
 * @name walletHoldingsSchema
 * @implements-rules-version v3 (POO-1893 rules v2) · v2 (POO-1893 rules v1) · v1 (POO-815)
 * Zod schema for one network's response from pool-party-api `GET /wallet/{address}?network=`
 * (verified against pool-party-interface `fetchWalletMetadata`). We only need `tokensBalance` for
 * the wallet modal; `transactions` is ignored. The mapper drops unpriced rows, so `priceUSD` is
 * nullable/optional. No `.default()` / `.coerce` on purpose: they make the zod input and output
 * types diverge, which `apiFetch<T>` (one type param) then resolves to the looser input type.
 *
 * ## v2 (POO-1893): the row is parsed on its own, and an unpriced row is not a failure
 *
 * The backend drifted against the contract `mapHolding`'s header records. An unpriced token used to
 * arrive with `priceUSD` absent and `formattedBalanceInUSD: "NaN"`; it now arrives with the key
 * OMITTED. Sentry `POOL-PARTY-FRONTEND-1` logged 388+ HTTP 200 responses rejected on
 * `tokensBalance.{3,4,5,6}.formattedBalanceInUSD` in six days, on all three networks at once,
 * because the trigger (a token `tokens/multi` could not price) is not network-specific. The user
 * was silently served the USDC-only on-chain balance the whole time.
 *
 * [R1] `formattedBalanceInUSD` is OPTIONAL. An omitted value is the backend saying "unpriced",
 * which is exactly what `"NaN"` used to say, and `mapHolding` already drops that row
 * (`Number(undefined)` is `NaN`). The mapper needed no change and did not get one.
 *
 * [R2] `tokensBalance` holds UNKNOWN rows here and is parsed ROW BY ROW by {@link parseHoldingRows},
 * so one row the backend breaks next costs its own row instead of the whole network's holdings —
 * three valid rows were discarded alongside the four drifted ones, which is what turned a metadata
 * change into an outage. The rejected rows are returned rather than swallowed: silent tolerance is
 * how the NEXT dropped field becomes invisible instead of merely wrong, so the caller logs them.
 *
 * Tolerance stops where it would hide a contract break. A `tokensBalance` that is not an array is
 * still a hard failure, and a non-empty list in which NOT ONE row parses is one the caller treats
 * as a failed network (`fetchWalletHoldings`) rather than as an empty wallet.
 *
 * Rules v2 [R5] adds the mirror of that last sentence for rows that DO parse and are then all
 * dropped for having no price. Nothing here changes for it: the guard belongs to the caller, since
 * pricing is decided by `mapHolding` and not by this schema. The version tag advances only to keep
 * the rule-set version this file implements in step with the issue and the PR.
 *
 * PP-INTEGRATION-POINT (POO-813): the backend contract this validates.
 */
import { type ZodIssue, z } from "zod";

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
  /**
   * Human-readable USD value of the holding. [R1] OPTIONAL: absent is the backend's way of saying
   * the token could not be priced (it used to say it with the string `"NaN"`), and the mapper drops
   * the row either way. Not a `.default()`: that would diverge the zod input and output types.
   */
  formattedBalanceInUSD: z.string().optional(),
  isNative: z.boolean(),
});

/**
 * The `data` payload of `GET /wallet/{address}?network=`.
 *
 * [R2] `tokensBalance` is deliberately an array of UNKNOWN. Typing the rows here is what made one
 * drifted field reject a whole network: {@link parseHoldingRows} asks each row for its own shape.
 */
export const walletHoldingsSchema = z.object({
  wallet: z.string().optional(),
  tokensBalance: z.array(z.unknown()).optional(),
  transactions: z.array(z.unknown()).optional(),
});

/** One held token (parsed). */
export type WalletHolding = z.infer<typeof walletHoldingSchema>;
/** A network's parsed wallet-holdings payload (rows still unparsed, see {@link parseHoldingRows}). */
export type WalletHoldings = z.infer<typeof walletHoldingsSchema>;

/** The outcome of a row-by-row parse: what was readable, and what was not. */
export interface ParsedHoldingRows {
  /** The rows that parsed, in payload order. */
  holdings: WalletHolding[];
  /**
   * The issues from the rows that did NOT parse, re-pathed to `tokensBalance.<index>.<field>`.
   * Empty on a clean payload. The path is the whole diagnosis, and it is deliberately the same path
   * the pre-POO-1893 Sentry evidence is written in, so one grep still spans both sides of this fix.
   */
  rejected: ZodIssue[];
}

/**
 * [R2] Parse `tokensBalance` one row at a time.
 *
 * A row that fails is dropped and reported; the rest are returned. This is the same per-item
 * tolerance `onRampCurrencyPairsResponseSchema` applies to payment-method groups, for the same
 * reason: a whole-array parse makes every consumer hostage to the least stable field in the
 * payload, and this array's least stable field is one the backend fills in only when an external
 * price feed answers.
 */
export function parseHoldingRows(rows: readonly unknown[]): ParsedHoldingRows {
  const holdings: WalletHolding[] = [];
  const rejected: ZodIssue[] = [];

  for (const [index, row] of rows.entries()) {
    const result = walletHoldingSchema.safeParse(row);
    if (result.success) {
      holdings.push(result.data);
      continue;
    }
    for (const issue of result.error.issues) {
      rejected.push({ ...issue, path: ["tokensBalance", index, ...issue.path] });
    }
  }

  return { holdings, rejected };
}
