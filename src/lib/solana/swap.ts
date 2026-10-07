import { z } from "zod";
import { requireSolanaLpChoice } from "./lpChoices";

/** TODO(decision): confirm API policy/default; 1 bps defaults to the strictest positive bound. */
export const SOLANA_PRICE_IMPACT_CONFIG = Object.freeze({
  defaultBps: 1,
  minimumBps: 1,
  maximumBps: 500,
});

export function resolveMaxPriceImpactBps(
  value: number = SOLANA_PRICE_IMPACT_CONFIG.defaultBps,
): number {
  if (
    !Number.isInteger(value) ||
    value < SOLANA_PRICE_IMPACT_CONFIG.minimumBps ||
    value > SOLANA_PRICE_IMPACT_CONFIG.maximumBps
  )
    throw new Error("SOLANA_PRICE_IMPACT_INVALID");
  return value;
}

export interface SolanaSwapQuoteRequest {
  poolId: string;
  fund: string;
  solanaAddress: string;
  maxPriceImpactBps: number;
}

const amount = z.string().regex(/^[1-9]\d*$/);
const hex = z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/);
/** TODO(interface): API owner must finalize this signed quote envelope and payload encoding. */
export const solanaApiSignedQuoteSchema = z
  .object({
    version: z.literal(1),
    poolId: z.string(),
    fund: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    solanaAddress: z.string(),
    maxPriceImpactBps: z.number().int(),
    tokenIn: z.string(),
    tokenOut: z.string(),
    amountIn: amount,
    minAmountOut: amount,
    referenceAmountOut: amount,
    priceImpactBps: z.number().int().min(0).max(10000),
    expiresAt: z.number().int().positive().safe(),
    signedPayload: hex,
    signature: hex,
  })
  .strict();
export type SolanaApiSignedQuote = z.infer<typeof solanaApiSignedQuoteSchema>;

/** DEC-197, R6.3: API quote only; Manager authorizes a bound, not a reference price. */
export function validateSolanaApiQuote(
  value: unknown,
  request: SolanaSwapQuoteRequest,
  now = Math.floor(Date.now() / 1000),
): SolanaApiSignedQuote {
  const parsed = solanaApiSignedQuoteSchema.safeParse(value);
  if (!parsed.success) throw new Error("SOLANA_API_QUOTE_INVALID");
  const quote = parsed.data;
  const choice = requireSolanaLpChoice(request.poolId);
  const mints = choice.tokens.map((token) => token.mint as string);
  const maximum = resolveMaxPriceImpactBps(request.maxPriceImpactBps);
  if (
    quote.poolId !== request.poolId ||
    quote.fund.toLowerCase() !== request.fund.toLowerCase() ||
    quote.solanaAddress !== request.solanaAddress ||
    quote.maxPriceImpactBps !== maximum ||
    quote.priceImpactBps > maximum ||
    quote.expiresAt <= now ||
    quote.tokenIn === quote.tokenOut ||
    !mints.includes(quote.tokenIn) ||
    !mints.includes(quote.tokenOut)
  )
    throw new Error("SOLANA_API_QUOTE_INVALID");
  return Object.freeze(quote);
}
