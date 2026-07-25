/**
 * @id PP-CORE-LIB-051 (POO-1028)
 * @name Uniswap Trading API schemas
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Zod contracts for every Trading API endpoint we call. Nothing from Uniswap reaches application
 * code without passing through here first: provider responses are untrusted input, and one of them
 * ends up as calldata a user signs.
 *
 * Two opposing pressures shape the strictness, and the split between them is deliberate:
 *
 *   STRICT on anything that can influence a transaction. `TransactionRequest.data` must be non-empty
 *   hex, `routing` must be a value we recognize, and a cross-chain request must be EXACT_INPUT. A
 *   permissive schema here does not prevent a failure, it just moves it to the point where the user
 *   has already signed.
 *
 *   TOLERANT on display-only blocks (gas estimates, fee breakdowns). A malformed gas figure should
 *   hide a row, never reject the quote it rides on. This mirrors the shipped `swapInfoSchema`
 *   precedent (`src/lib/tx/builtTxSchema.ts`), which learned the same lesson the hard way.
 *
 * Money convention follows the one already pinned in `src/lib/provisioning/types.ts`: token-native
 * amounts are decimal STRINGS (never JS numbers, which lose precision above 2^53 and drift under
 * arithmetic), USD figures are display-grade numbers.
 */
import { z } from "zod";

/**
 * Calldata. **Must be non-empty** ([R2]): the docs are explicit that `data` is always present on a
 * swap, and an empty `data` (`""` or `"0x"`) reverts on-chain. Rejecting it here turns a wasted gas
 * fee into a re-quote.
 */
const calldata = z
  .string()
  .regex(/^0x[0-9a-fA-F]+$/, "calldata must be non-empty hex")
  .refine((value) => value !== "0x", "calldata must not be empty");

/** An EVM address. Case-insensitive: the API is not consistent about checksumming. */
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected an EVM address");

/** A token-native amount. Decimal string, never a number (precision). */
const amount = z.string().regex(/^\d+$/, "expected a decimal amount string");

/**
 * Route classification ([R1]). A discriminated set rather than `z.string()`: an unrecognized routing
 * value must fail LOUDLY. Silently falling through to the classic path means signing something that
 * was priced as something else.
 */
export const routingSchema = z.enum([
  "CLASSIC",
  "WRAP",
  "UNWRAP",
  "BRIDGE",
  "CHAINED",
  "DUTCH_V2",
  "DUTCH_V3",
  "PRIORITY",
]);
export type UniswapRouting = z.infer<typeof routingSchema>;

/** Routes that settle as a plain transaction we build, sign and broadcast ourselves. */
export const AMM_ROUTINGS = ["CLASSIC", "WRAP", "UNWRAP", "BRIDGE"] as const;
/**
 * UniswapX: gasless orders filled by market makers, settling asynchronously through a lifecycle our
 * rail does not model. Out of scope for v1, recognized so it fails legibly rather than silently.
 */
export const UNISWAPX_ROUTINGS = ["DUTCH_V2", "DUTCH_V3", "PRIORITY"] as const;

/** True when a quote is a UniswapX order rather than something we can broadcast. */
export function isUniswapXRouting(routing: UniswapRouting): boolean {
  return (UNISWAPX_ROUTINGS as readonly string[]).includes(routing);
}

/** An unsigned transaction the wallet will broadcast. */
export const transactionRequestSchema = z.object({
  to: address,
  from: address.optional(),
  data: calldata,
  value: z.string(),
  chainId: z.number().int().positive(),
  gasLimit: z.string().optional(),
  maxFeePerGas: z.string().optional(),
  maxPriorityFeePerGas: z.string().optional(),
  gasPrice: z.string().optional(),
});
export type UniswapTransactionRequest = z.infer<typeof transactionRequestSchema>;

/**
 * Gas information off a quote. Display-only and therefore TOLERANT ([R7]): a malformed block
 * degrades to `{}` and hides a row rather than rejecting a perfectly good quote.
 *
 * `passthrough` for the forwarding reason documented on {@link quoteBodySchema}: this block rides
 * INSIDE the quote object we hand straight back to `/swap` and `/plan`, so its unknown keys have to
 * survive too. (Note the `catch` still replaces the whole block when it is not object-shaped at all,
 * which is the deliberate [R7] tolerance, not a stripping bug.)
 *
 * This is what finally gives the provisioning gate a real pre-build gas figure. It previously used a
 * hardcoded `0.5` (`mapManagerStrategyDetail.ts`), because the only genuine number existed *after* a
 * build and the gate runs *before* one.
 */
export const gasInfoSchema = z
  .object({
    gasFee: z.string().optional(),
    gasFeeUSD: z.union([z.string(), z.number()]).optional(),
    gasUseEstimate: z.string().optional(),
  })
  .partial()
  .passthrough()
  .catch({});

/**
 * One side of a quote. `passthrough` for the same forwarding reason as {@link quoteBodySchema}: this
 * object is nested inside the quote we forward VERBATIM, so stripping its unknown keys drops them
 * from the payload just as surely as stripping a top-level one.
 */
const quoteSideSchema = z
  .object({
    amount: amount,
    token: z.string(),
  })
  .passthrough();

/**
 * The quote body. Kept `passthrough` on purpose: `/swap` and `/plan` take the quote object back
 * VERBATIM, so stripping unknown keys would silently drop fields the API needs and produce a
 * confusing upstream 400. We validate what we read and forward the rest untouched.
 *
 * **This applies to every NESTED object reachable from the quote too**, not just its top level.
 * `uniswapFetch` returns `parsed.data`, so any object in here that is not `passthrough` is a hole
 * the forwarded payload leaks through: `input`, `output` and `gasInfo` are therefore passthrough as
 * well. The one place we deliberately do NOT do this is {@link transactionRequestSchema}, which is
 * broadcast rather than forwarded, and where an unknown key riding into something the user signs is
 * the risk we are guarding against.
 */
export const quoteBodySchema = z
  .object({
    quoteId: z.string().optional(),
    chainId: z.number().int().positive().optional(),
    tokenInChainId: z.number().int().positive().optional(),
    tokenOutChainId: z.number().int().positive().optional(),
    input: quoteSideSchema.optional(),
    output: quoteSideSchema.optional(),
    slippage: z.number().optional(),
    priceImpact: z.number().optional(),
    gasFeeUSD: z.union([z.string(), z.number()]).optional(),
    gasInfo: gasInfoSchema.optional(),
    encodedOrder: z.string().optional(),
  })
  .passthrough();

/**
 * EIP-712 permit data returned alongside a quote. Forwarded verbatim to `/swap`, and already leak
 * proof under the nested rule above: `passthrough` covers its own unknown keys, and `domain`,
 * `types` and `values` are open records rather than fixed objects, so everything inside them
 * survives untouched. That matters more here than anywhere else, since these are the exact bytes the
 * user signs.
 */
export const permitDataSchema = z
  .object({
    domain: z.record(z.unknown()),
    types: z.record(z.unknown()),
    values: z.record(z.unknown()),
  })
  .passthrough();

/** `POST /quote` response. */
export const quoteResponseSchema = z.object({
  requestId: z.string().optional(),
  routing: routingSchema,
  quote: quoteBodySchema,
  /**
   * [R3] `null` on a chained quote, and the API REJECTS an explicit `null` on the way back into
   * `/swap`. Modelled as nullish so both `null` and an absent field parse, and callers strip rather
   * than forward it.
   */
  permitData: permitDataSchema.nullish(),
});
export type UniswapQuoteResponse = z.infer<typeof quoteResponseSchema>;

/** `POST /check_approval` response. Empty object means no approval is required. */
export const checkApprovalResponseSchema = z.object({
  requestId: z.string().optional(),
  /** Present ONLY when an approval is actually needed; absent means the allowance already covers it. */
  approval: transactionRequestSchema.nullish(),
  cancel: transactionRequestSchema.nullish(),
});
export type UniswapCheckApprovalResponse = z.infer<typeof checkApprovalResponseSchema>;

/** `POST /swap` response. */
export const swapResponseSchema = z.object({
  requestId: z.string().optional(),
  swap: transactionRequestSchema,
  gasFee: z.string().optional(),
});
export type UniswapSwapResponse = z.infer<typeof swapResponseSchema>;

/** How a chained-plan step is executed ([R5]). */
export const stepMethodSchema = z.enum(["SEND_TX", "SIGN_MSG", "SEND_CALLS"]);
export type UniswapStepMethod = z.infer<typeof stepMethodSchema>;

/** Lifecycle of a single plan step. */
export const stepStatusSchema = z.enum([
  "NOT_STARTED",
  "AWAITING_ACTION",
  "IN_PROGRESS",
  "COMPLETE",
  "FAILED",
]);
export type UniswapStepStatus = z.infer<typeof stepStatusSchema>;

/**
 * One step of a chained plan. The payload is narrowed per method at the rail (POO-1036) rather than
 * here: the API nests it differently per method, and a mis-shaped payload for a step we have not
 * reached yet must not invalidate the whole plan we are mid-way through executing.
 */
export const planStepSchema = z
  .object({
    stepIndex: z.number().int().nonnegative(),
    method: stepMethodSchema,
    status: stepStatusSchema.optional(),
    chainId: z.number().int().positive().optional(),
    /** Seconds until this step is expected to settle. Bridge legs take minutes. */
    etaSeconds: z.number().optional(),
    payload: z.unknown().optional(),
  })
  .passthrough();
export type UniswapPlanStep = z.infer<typeof planStepSchema>;

/** `POST /plan` and `GET /plan/:planId` response. */
export const planResponseSchema = z.object({
  requestId: z.string().optional(),
  planId: z.string(),
  /** The server's authoritative resume point. Never infer this client-side (POO-1038). */
  currentStepIndex: z.number().int().nonnegative(),
  steps: z.array(planStepSchema),
  status: z.string().optional(),
});
export type UniswapPlanResponse = z.infer<typeof planResponseSchema>;

/** One token in the swappable/bridgeable set. */
export const swappableTokenSchema = z
  .object({
    address: z.string(),
    chainId: z.number().int().positive(),
    symbol: z.string().optional(),
    decimals: z.number().int().nonnegative().optional(),
    name: z.string().optional(),
  })
  .passthrough();

/** `GET /swappable_tokens` response. */
export const swappableTokensResponseSchema = z.object({
  tokens: z.array(swappableTokenSchema),
});
export type UniswapSwappableTokens = z.infer<typeof swappableTokensResponseSchema>;

/** `GET /swaps` response. */
export const swapStatusResponseSchema = z.object({
  requestId: z.string().optional(),
  swaps: z.array(
    z
      .object({
        status: z.string(),
        txHash: z.string().optional(),
        chainId: z.number().int().positive().optional(),
      })
      .passthrough(),
  ),
});

// --- Request shapes ------------------------------------------------------------------------------

/** Trade direction. */
export const tradeTypeSchema = z.enum(["EXACT_INPUT", "EXACT_OUTPUT"]);

/**
 * `POST /quote` request ([R4]).
 *
 * **Chained Actions support `EXACT_INPUT` only.** Enforced here rather than discovered at runtime:
 * a cross-chain pair (`tokenInChainId !== tokenOutChainId`) with `EXACT_OUTPUT` is rejected before
 * the request leaves us, with a message that says why.
 */
export const quoteRequestSchema = z
  .object({
    tokenIn: z.string(),
    tokenOut: z.string(),
    tokenInChainId: z.number().int().positive(),
    tokenOutChainId: z.number().int().positive(),
    amount: amount,
    type: tradeTypeSchema,
    swapper: address,
    slippageTolerance: z.number().min(0).max(100).optional(),
    routingPreference: z.string().optional(),
    urgency: z.string().optional(),
  })
  .refine(
    (value) => value.tokenInChainId === value.tokenOutChainId || value.type === "EXACT_INPUT",
    { message: "cross-chain (chained) quotes support EXACT_INPUT only", path: ["type"] },
  );
export type UniswapQuoteRequest = z.infer<typeof quoteRequestSchema>;

/** `POST /check_approval` request. */
export const checkApprovalRequestSchema = z.object({
  walletAddress: address,
  token: z.string(),
  amount: amount,
  chainId: z.number().int().positive(),
  tokenOut: z.string().optional(),
  tokenOutChainId: z.number().int().positive().optional(),
});

/** True when a quote crosses chains, and therefore needs the `/plan` rail rather than `/swap`. */
export function isCrossChainQuote(quote: UniswapQuoteResponse): boolean {
  const inChain = quote.quote.tokenInChainId;
  const outChain = quote.quote.tokenOutChainId;
  if (inChain == null || outChain == null) return quote.routing === "CHAINED";
  return inChain !== outChain;
}
