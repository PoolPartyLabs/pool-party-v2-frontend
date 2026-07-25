/**
 * @id PP-CORE-LIB-052 (POO-1029, POO-1054)
 * @name Uniswap server-action layer
 * @implements-rules-version v2
 * @hackathon POO-1022 (Universal Funding)
 *
 * v2 (POO-1054 [R3]): the chained-plan lifecycle is GONE. A read-only probe of the live Trading API
 * on 2026-07-25 never returned `routing: "CHAINED"`, and `POST /plan` takes a chained quote as its
 * body, so `createPlan` / `advancePlan` / `getPlan` could not be called with anything the API
 * accepts. POO-1029 [R4] (advancePlan idempotency), [R5] (getPlan forceRefresh) and [R7] (createPlan
 * opts out of replay) are retired with them. Cross-chain now runs on the same two calls as
 * same-chain: a same-token cross-chain pair quotes as `routing: "BRIDGE"` and settles as ONE
 * transaction through `POST /swap`. A different-token cross-chain pair is not routable in one call
 * (404 `ResourceNotFound`) and is decomposed by our own planner into swap-then-bridge legs. See
 * `docs/_hackathon/02_BRIDGE_ARCHITECTURE.md` and the ADR 0002 addendum.
 *
 * The ONLY public surface of the Uniswap Trading API integration (ADR 0003 §3). `client.ts`
 * (`uniswapFetch`) and `schemas.ts` are server-only; this module is the `"use server"` boundary the
 * browser is allowed to see. Next compiles it to an RPC stub on the client, so a `"use client"`
 * module may import these functions freely while the transport, and `UNISWAP_API_KEY` with it, never
 * enters a bundle. If a change here ever seems to need a CSP `connect-src` entry for
 * `trade-api.gateway.uniswap.org`, a call has moved to the browser and the boundary is broken.
 *
 * Two contracts are inherited rather than invented:
 *
 *   [R1] The wallet comes from the SIWE session (`getSessionWallet`), exactly as every shipped build
 *   action does (`investActions.ts`). A client-supplied address is IGNORED, never validated: each
 *   outgoing body is assembled field by field, so no part of the caller's object can reach the
 *   upstream unexamined. Validation would still leave a path open the day a check is loosened.
 *
 *   [R2] No action throws across the RSC boundary. Next masks a thrown Server Action error in
 *   production, which would strip the upstream code that `classifyTxError` and the retry ladder act
 *   on. So every action returns `{ ok: true, … } | { ok: false, code, message }`, reusing the shipped
 *   {@link BuildTxFailure} shape rather than inventing a parallel one. The mapper is local because
 *   the throwables are Uniswap's, not pool-party-api's; making `buildTxFailure` aware of them would
 *   point `@/lib/tx` at this module for no gain.
 *
 * Requests are validated on the way OUT as well as in: `quoteRequestSchema` carries the cross-chain
 * EXACT_INPUT-only constraint (UF-06 R4), so an impossible request fails here with a message that
 * says why, instead of as a puzzling upstream 400.
 *
 * Money convention (pinned by `src/lib/provisioning/types.ts`): token-native amounts are decimal
 * STRINGS, USD figures are display-grade numbers. Nothing in this file does arithmetic on either.
 *
 * PP-INTEGRATION-POINT: every Uniswap Trading API read/write the app performs enters here.
 */
"use server";

import { getSessionWallet } from "@/lib/auth/session";
import type { BuildTxFailure } from "@/lib/tx/actionResult";
import { uniswapFetch } from "./client";
import { UniswapApiError, UniswapParseError } from "./errors";
import {
  checkApprovalRequestSchema,
  checkApprovalResponseSchema,
  isUniswapXRouting,
  quoteRequestSchema,
  quoteResponseSchema,
  swappableTokensResponseSchema,
  swapResponseSchema,
  type UniswapQuoteResponse,
  type UniswapSwappableTokens,
  type UniswapTransactionRequest,
} from "./schemas";

/**
 * The result of a Uniswap action: a payload on success, or the shipped {@link BuildTxFailure} shape
 * on any failure. Mirrors `BuildTxResult` (`@/lib/tx/actionResult`), generalized over the payload
 * because these actions return quotes, plans and token lists rather than only a built transaction.
 */
export type UniswapActionResult<TPayload> = ({ ok: true } & TPayload) | BuildTxFailure;

/**
 * Cache tag for the swappable-token allowlist ([R3]). Deliberately NOT exported: a `"use server"`
 * module may only export async functions, and nothing revalidates this yet. A future
 * `revalidateTag("uniswap-swappable-tokens")` caller lifts it to a shared module then.
 */
const SWAPPABLE_TOKENS_TAG = "uniswap-swappable-tokens";

/**
 * Data-cache window for that allowlist ([R3]). The set changes when Uniswap starts routing a new
 * token, which is a listing-scale event rather than a per-session one, so an hour bounds staleness
 * while collapsing a whole funding session (and every keystroke in the funding selector) into one
 * upstream read. The tag exists so a manual refresh does not have to wait the window out.
 */
const SWAPPABLE_TOKENS_REVALIDATE_SECONDS = 3600;

/** Not signed in. Matches the shipped `SESSION_MISSING` contract in `investActions.ts`. */
function sessionMissing(): BuildTxFailure {
  return { ok: false, code: "SESSION_MISSING", message: "Wallet session not established" };
}

/** A request we refuse to send, with the reason. Never reaches the network. */
function invalidRequest(message: string): BuildTxFailure {
  return { ok: false, code: "UNISWAP_INVALID_REQUEST", message };
}

/**
 * Map a caught throwable to a typed failure ([R2]). Precedence mirrors `buildTxFailure`: contract
 * drift becomes SCHEMA_MISMATCH, an upstream failure keeps its machine code and message verbatim so
 * callers branch on the code, and anything else is SYSTEM_INTERNAL.
 */
function toFailure(error: unknown): BuildTxFailure {
  if (error instanceof UniswapParseError) {
    return { ok: false, code: "SCHEMA_MISMATCH", message: error.message };
  }
  if (error instanceof UniswapApiError) {
    return { ok: false, code: error.code, message: error.message };
  }
  return { ok: false, code: "SYSTEM_INTERNAL", message: String(error) };
}

/**
 * A route we cannot execute. UniswapX orders (`DUTCH_V2` / `DUTCH_V3` / `PRIORITY`) are gasless,
 * filled by market makers, and settle asynchronously through `/order`, a lifecycle this rail does
 * not model. Failing legibly beats handing the planner a quote that can never be broadcast.
 */
function unsupportedRouting(routing: string): BuildTxFailure {
  return {
    ok: false,
    code: "UNISWAP_ROUTING_UNSUPPORTED",
    message: `Uniswap returned a "${routing}" route, which this rail cannot execute.`,
  };
}

/** Input for {@link quoteSwap}. The swapper is NOT part of it: it comes from the session ([R1]). */
export interface QuoteSwapInput {
  tokenIn: string;
  tokenOut: string;
  tokenInChainId: number;
  tokenOutChainId: number;
  /** Token-native amount of the input token, decimal string. */
  amount: string;
  /**
   * Defaults to EXACT_INPUT. Cross-chain is still pinned to EXACT_INPUT by `quoteRequestSchema`;
   * whether a BRIDGE route accepts EXACT_OUTPUT is an open question the probe did not settle (see
   * that schema's PP-TODO).
   */
  type?: "EXACT_INPUT" | "EXACT_OUTPUT";
  /**
   * Max slippage in percent, from the settings gear ([R6]). It governs the AMM legs of the route.
   * A bridge leg is quoted by Across and does not take it, so it must not be presented as an
   * allowance that applies there (the cost breakdown, UF-13 R3, excludes bridge legs from that line).
   */
  slippageTolerance?: number;
}

/**
 * Price a route ([R6]). Same-chain returns `routing: "CLASSIC"` (with `permitData` present);
 * cross-chain SAME-token returns `routing: "BRIDGE"`. Both go on to `POST /swap`.
 *
 * A cross-chain DIFFERENT-token pair is NOT routable in one call: the live API answers 404
 * `ResourceNotFound` (POO-1054). The planner decomposes that case into a same-chain swap to the
 * bridge asset followed by a same-token bridge, and quotes each leg separately.
 *
 * PP-INTEGRATION-POINT: pricing, gas info and route classification ← Uniswap `POST /quote`.
 */
export async function quoteSwap(
  input: QuoteSwapInput,
): Promise<UniswapActionResult<{ quote: UniswapQuoteResponse }>> {
  const wallet = await getSessionWallet();
  if (!wallet) return sessionMissing();

  const sameChain = input.tokenInChainId === input.tokenOutChainId;
  const request = {
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    tokenInChainId: input.tokenInChainId,
    tokenOutChainId: input.tokenOutChainId,
    amount: input.amount,
    type: input.type ?? "EXACT_INPUT",
    // [R1] The session's wallet, never the caller's.
    swapper: wallet,
    ...(input.slippageTolerance === undefined
      ? {}
      : { slippageTolerance: input.slippageTolerance }),
    // Pin the AMM path same-chain so a UniswapX route is not offered in the first place. NOT pinned
    // cross-chain: `CLASSIC` there would exclude the BRIDGE and CHAINED routes the rail runs on.
    ...(sameChain ? { routingPreference: "CLASSIC" } : {}),
  };

  // UF-06 [R4] lives in this schema: a cross-chain EXACT_OUTPUT is rejected before it leaves us.
  const parsed = quoteRequestSchema.safeParse(request);
  if (!parsed.success) {
    return invalidRequest(parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  try {
    const quote = await uniswapFetch("quote", {
      method: "POST",
      body: parsed.data,
      schema: quoteResponseSchema,
    });
    if (isUniswapXRouting(quote.routing)) return unsupportedRouting(quote.routing);
    return { ok: true, quote };
  } catch (error) {
    return toFailure(error);
  }
}

/** Input for {@link checkApproval}. The wallet is the session's ([R1]). */
export interface CheckApprovalInput {
  /** The source token being spent. */
  token: string;
  /** Token-native amount to be spent, decimal string. Approvals are sized to the plan. */
  amount: string;
  chainId: number;
  /** Destination token + chain, when the approval is for a cross-chain route. */
  tokenOut?: string;
  tokenOutChainId?: number;
}

/**
 * Does the source token need an ERC-20 approval to Permit2 before this amount can move?
 *
 * `approval: null` means the allowance already covers it, which the rail (UF-14 R4) turns into the
 * `{ skipped: true }` step `useWalletSignFlow` already renders. Absent and explicit-null are
 * normalized to `null` here so that check is a single comparison at the call site.
 *
 * PP-INTEGRATION-POINT: approval calldata ← Uniswap `POST /check_approval`.
 */
export async function checkApproval(input: CheckApprovalInput): Promise<
  UniswapActionResult<{
    approval: UniswapTransactionRequest | null;
    /** Some tokens (USDT-class) need the existing allowance zeroed first. */
    cancel: UniswapTransactionRequest | null;
  }>
> {
  const wallet = await getSessionWallet();
  if (!wallet) return sessionMissing();

  const parsed = checkApprovalRequestSchema.safeParse({
    // [R1] The session's wallet, never the caller's.
    walletAddress: wallet,
    token: input.token,
    amount: input.amount,
    chainId: input.chainId,
    ...(input.tokenOut === undefined ? {} : { tokenOut: input.tokenOut }),
    ...(input.tokenOutChainId === undefined ? {} : { tokenOutChainId: input.tokenOutChainId }),
  });
  if (!parsed.success) {
    return invalidRequest(parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  try {
    const response = await uniswapFetch("check_approval", {
      method: "POST",
      body: parsed.data,
      schema: checkApprovalResponseSchema,
    });
    return { ok: true, approval: response.approval ?? null, cancel: response.cancel ?? null };
  } catch (error) {
    return toFailure(error);
  }
}

/** Input for {@link buildSwapTx}. */
export interface BuildSwapTxInput {
  /** The quote to execute, returned verbatim from {@link quoteSwap}. */
  quote: UniswapQuoteResponse;
  /** The Permit2 signature, required exactly when the quote carried `permitData`. */
  signature?: string;
}

/**
 * Turn a quote into an unsigned transaction the wallet will sign and broadcast. Handles both
 * `CLASSIC` (same-chain) and `BRIDGE` (cross-chain, same token) quotes: the live API settles a
 * bridge as ONE transaction through this endpoint, which is why there is no separate bridge path.
 *
 * The body is the quote response SPREAD, not wrapped in a `quote` field, which is why the schemas
 * are passthrough at every level. The probe confirmed the API accepts BOTH shapes and returns
 * identical calldata for each, so the spread is a free choice rather than a requirement; it stays
 * because it is what the schemas and their tests are built around. Two things about `permitData` are
 * easy to get wrong and are enforced here rather than discovered as an upstream 400:
 *
 *   - the API rejects an explicit `permitData: null`, so it is stripped rather than forwarded;
 *   - `signature` and `permitData` travel together or not at all. A permit that was returned but not
 *     signed would otherwise build a transaction that reverts for a missing allowance.
 *
 * (`permitTransaction` needs no stripping: `quoteResponseSchema` is not passthrough at its top
 * level, so the transport already dropped it.)
 *
 * PP-INTEGRATION-POINT: unsigned swap calldata ← Uniswap `POST /swap`.
 */
export async function buildSwapTx(
  input: BuildSwapTxInput,
): Promise<UniswapActionResult<{ swap: UniswapTransactionRequest; gasFee?: string }>> {
  const wallet = await getSessionWallet();
  if (!wallet) return sessionMissing();

  const { permitData, ...quote } = input.quote;
  if (isUniswapXRouting(quote.routing)) return unsupportedRouting(quote.routing);
  if (permitData && !input.signature) {
    return invalidRequest("This quote requires a Permit2 signature, and none was provided.");
  }
  if (input.signature && !permitData) {
    return invalidRequest("A Permit2 signature was provided for a quote that carries no permit.");
  }

  try {
    const response = await uniswapFetch("swap", {
      method: "POST",
      body: {
        ...quote,
        ...(input.signature && permitData ? { signature: input.signature, permitData } : {}),
      },
      schema: swapResponseSchema,
    });
    return {
      ok: true,
      swap: response.swap,
      ...(response.gasFee ? { gasFee: response.gasFee } : {}),
    };
  } catch (error) {
    return toFailure(error);
  }
}

/**
 * The tokens Uniswap can actually swap and bridge: the allowlist for the funding-source picker, so a
 * token we cannot route is never offered ([R3]).
 *
 * Cache-tagged and windowed, because this feeds a selector that filters as the user types and the
 * set itself barely moves. The request carries nothing per-wallet, so every session shares one entry
 * rather than fragmenting the cache the tag exists to share. It is still session-gated: without that,
 * an anonymous visitor could spend our rate-limited, key-authenticated upstream quota at will.
 *
 * PP-INTEGRATION-POINT: routable-token allowlist ← Uniswap `GET /swappable_tokens`.
 */
export async function listSwappableTokens(): Promise<
  UniswapActionResult<{ tokens: UniswapSwappableTokens["tokens"] }>
> {
  const wallet = await getSessionWallet();
  if (!wallet) return sessionMissing();

  try {
    const response = await uniswapFetch("swappable_tokens", {
      schema: swappableTokensResponseSchema,
      next: {
        revalidate: SWAPPABLE_TOKENS_REVALIDATE_SECONDS,
        tags: [SWAPPABLE_TOKENS_TAG],
      },
    });
    return { ok: true, tokens: response.tokens };
  } catch (error) {
    return toFailure(error);
  }
}
