/**
 * @id PP-CORE-LIB-055 (POO-1034)
 * @name recorded Uniswap quote fixtures
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Recorded `POST /quote` responses for the planner's tests. Every field is shaped after the live
 * probe recorded in `docs/_hackathon/01_UNISWAP_INTEGRATION.md` §1.1: a same-chain pair answers
 * `CLASSIC` with `permitData` present, a cross-chain SAME-token pair answers `BRIDGE` with a real
 * `estimatedFillTimeMs`, and a cross-chain DIFFERENT-token pair answers `404 ResourceNotFound`,
 * which is why this file offers no fixture for it: the planner must never ask that question.
 *
 * Test-only. It exists so the planner suite runs offline and deterministically; nothing in the
 * application imports it.
 */
import type { UniswapQuoteResponse, UniswapRouting } from "@/lib/uniswap/schemas";

/** Everything a recorded quote needs to stand in for one leg. */
export interface QuoteFixtureInput {
  routing: UniswapRouting;
  tokenIn: string;
  tokenInChainId: number;
  tokenOut: string;
  tokenOutChainId: number;
  /** Base units in, decimal string. */
  amountIn: string;
  /** Base units out, decimal string. */
  amountOut: string;
  /** The USD gas figure the planner reads ([R5]). Absent means the API gave none. */
  gasFeeUSD?: string;
  /** Bridge legs only, from the live probe (Base→Arbitrum USDC measured ≈ 1000 ms). */
  estimatedFillTimeMs?: number;
  priceImpact?: number;
  /** Unix SECONDS. Present on a CLASSIC quote's Permit2 payload; tightens the plan's TTL ([R7]). */
  permitDeadline?: number;
}

/** A recorded `POST /quote` response. */
export function quoteFixture(input: QuoteFixtureInput): UniswapQuoteResponse {
  return {
    requestId: `req-${input.tokenInChainId}-${input.tokenOutChainId}`,
    routing: input.routing,
    quote: {
      quoteId: "quote-1",
      tokenInChainId: input.tokenInChainId,
      tokenOutChainId: input.tokenOutChainId,
      input: { token: input.tokenIn, amount: input.amountIn },
      output: { token: input.tokenOut, amount: input.amountOut },
      ...(input.gasFeeUSD === undefined ? {} : { gasFeeUSD: input.gasFeeUSD }),
      ...(input.estimatedFillTimeMs === undefined
        ? {}
        : { estimatedFillTimeMs: input.estimatedFillTimeMs }),
      ...(input.priceImpact === undefined ? {} : { priceImpact: input.priceImpact }),
    },
    ...(input.permitDeadline === undefined
      ? {}
      : {
          permitData: {
            domain: { name: "Permit2", chainId: input.tokenInChainId },
            types: {},
            values: { sigDeadline: String(input.permitDeadline) },
          },
        }),
  } as UniswapQuoteResponse;
}
