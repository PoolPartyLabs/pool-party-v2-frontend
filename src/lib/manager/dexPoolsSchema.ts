/**
 * @id PP-MGR (POO-305)
 * @name dex-pools API schema
 * @implements-rules-version v1
 *
 * Zod for the subset of `GET /api/v1/dex-pools?network&currency0[&currency1]` the builder consumes.
 * The endpoint returns the candidate Uniswap pools for a token pair (one per fee tier).
 */
import { z } from "zod";

const numeric = z.union([z.string(), z.number()]);

const dexCurrencySchema = z.object({
  address: z.string(),
  symbol: z.string(),
  decimals: z.number().optional(),
  /** Whether this currency is the pool's base token (vs quote) — pairs base/quote USD prices below. */
  isBaseToken: z.boolean().optional(),
});

/** One candidate Uniswap v3 pool for a token pair. */
export const dexPoolSchema = z.object({
  /** Dex pool contract address. */
  address: z.string(),
  /** Fee tier in hundredths of a bip (500 = 0.05%). */
  feeTier: z.number(),
  /** Total value locked in USD (string or number). */
  tvlInUsd: numeric,
  /** Price of token0 in token1 (string or number). */
  baseTokenPriceQuoteToken: numeric.optional(),
  /** Base / quote token USD prices — used to value the create-pool seed against the USD minimum. */
  baseTokenPriceUsd: numeric.optional(),
  quoteTokenPriceUsd: numeric.optional(),
  /** Trailing volume in USD. */
  volumeUsd: z.object({ h24: numeric.optional() }).optional(),
  currency0: dexCurrencySchema,
  currency1: dexCurrencySchema,
});

/** A candidate dex pool. */
export type DexPool = z.infer<typeof dexPoolSchema>;

/** The dex-pools list (after the `{ data }` envelope is unwrapped). */
export const dexPoolsResponseSchema = z.array(dexPoolSchema);
