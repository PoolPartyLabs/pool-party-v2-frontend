/**
 * @id PP-CORE-LIB-052 (POO-1029)
 * @name Uniswap server-action layer tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Rules under test (POO-1029 rules v1):
 *   [R1] the wallet comes from the SIWE session; a body-supplied address is IGNORED, not validated
 *   [R2] no action throws across the RSC boundary; each returns a typed discriminated result
 *   [R3] `listSwappableTokens` is cache-tagged and must not re-fetch per keystroke
 *   [R4] `advancePlan` is idempotent: a proof for an already-advanced step returns current state
 *   [R5] `getPlan` exposes `forceRefresh` but never force-refreshes implicitly
 *   [R6] slippage rides through to the quote; bridge legs are Across-quoted and ignore it
 *   [R7] `createPlan` is NOT idempotent: an ambiguous timeout must never be replayed
 *
 * `uniswapFetch` and `getSessionWallet` are mocked: this suite is about the action contract (session
 * derivation, request shaping, failure mapping, cache options), not about transport, which has its
 * own suite in `client.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UniswapApiError, UniswapParseError } from "./errors";
import {
  checkApprovalResponseSchema,
  planResponseSchema,
  quoteResponseSchema,
  swappableTokensResponseSchema,
  swapResponseSchema,
  type UniswapQuoteResponse,
} from "./schemas";

const mocks = vi.hoisted(() => ({
  uniswapFetch: vi.fn(),
  wallet: null as string | null,
}));

vi.mock("./client", () => ({ uniswapFetch: mocks.uniswapFetch }));
vi.mock("@/lib/auth/session", () => ({ getSessionWallet: async () => mocks.wallet }));

import {
  advancePlan,
  buildSwapTx,
  checkApproval,
  createPlan,
  getPlan,
  listSwappableTokens,
  quoteSwap,
} from "./actions";

/** The address the SIWE session vouches for. Lowercased, as `walletFromToken` returns it. */
const SESSION_WALLET = "0x1111111111111111111111111111111111111111";
/** An address a malicious or merely stale client might put in the action body. */
const ATTACKER_WALLET = "0x2222222222222222222222222222222222222222";

const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const WETH_POLYGON = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";

/** The options `uniswapFetch` was called with on call `index`. */
function fetchOptions(index = 0): Record<string, unknown> {
  const call = mocks.uniswapFetch.mock.calls[index] as [string, Record<string, unknown>];
  return call[1];
}

/** The path `uniswapFetch` was called with on call `index`. */
function fetchPath(index = 0): string {
  return (mocks.uniswapFetch.mock.calls[index] as [string, unknown])[0];
}

/** The request body `uniswapFetch` was called with on call `index`. */
function fetchBody(index = 0): Record<string, unknown> {
  return fetchOptions(index).body as Record<string, unknown>;
}

const sameChainQuote = {
  requestId: "req-1",
  routing: "CLASSIC",
  quote: {
    tokenInChainId: 42161,
    tokenOutChainId: 42161,
    input: { token: USDC_ARBITRUM, amount: "1000000" },
    output: { token: WETH_POLYGON, amount: "250000000000000" },
  },
  permitData: null,
} as unknown as UniswapQuoteResponse;

const swapResponse = {
  swap: {
    to: "0x3333333333333333333333333333333333333333",
    data: "0xdeadbeef",
    value: "0",
    chainId: 42161,
  },
};

const planResponse = {
  planId: "plan-1",
  currentStepIndex: 1,
  steps: [
    { stepIndex: 0, method: "SEND_TX", status: "COMPLETE" },
    { stepIndex: 1, method: "SEND_TX", status: "AWAITING_ACTION" },
  ],
};

const quoteInput = {
  tokenIn: WETH_POLYGON,
  tokenOut: USDC_ARBITRUM,
  tokenInChainId: 137,
  tokenOutChainId: 42161,
  amount: "1000000000000000000",
};

beforeEach(() => {
  mocks.uniswapFetch.mockReset();
  mocks.wallet = SESSION_WALLET;
});

describe("uniswap actions — session derivation (POO-1029 [R1])", () => {
  it("quotes with the session wallet as swapper", async () => {
    mocks.uniswapFetch.mockResolvedValue(sameChainQuote);

    await quoteSwap(quoteInput);

    expect(fetchBody().swapper).toBe(SESSION_WALLET);
  });

  // THE load-bearing [R1] assertion. A client-supplied address is IGNORED, not merely validated:
  // validation would still let a caller shape the request if the check were ever loosened, whereas
  // an ignored field cannot influence anything no matter what the body contains.
  it("ignores a swapper supplied in the action body", async () => {
    mocks.uniswapFetch.mockResolvedValue(sameChainQuote);

    await quoteSwap({ ...quoteInput, swapper: ATTACKER_WALLET } as typeof quoteInput);

    expect(fetchBody().swapper).toBe(SESSION_WALLET);
    expect(JSON.stringify(fetchBody())).not.toContain(ATTACKER_WALLET);
  });

  it("ignores a walletAddress supplied to checkApproval", async () => {
    mocks.uniswapFetch.mockResolvedValue({ approval: null });

    const input = { token: WETH_POLYGON, amount: "1000", chainId: 137 };
    await checkApproval({ ...input, walletAddress: ATTACKER_WALLET } as typeof input);

    expect(fetchBody().walletAddress).toBe(SESSION_WALLET);
    expect(JSON.stringify(fetchBody())).not.toContain(ATTACKER_WALLET);
  });

  // Every action is gated, including the two that do not send the wallet upstream (`getPlan`,
  // `listSwappableTokens`): without the gate an anonymous visitor could spend our rate-limited,
  // key-authenticated upstream quota through our own server.
  it.each([
    ["quoteSwap", () => quoteSwap(quoteInput)],
    ["checkApproval", () => checkApproval({ token: WETH_POLYGON, amount: "1", chainId: 137 })],
    ["buildSwapTx", () => buildSwapTx({ quote: sameChainQuote })],
    ["createPlan", () => createPlan({ quote: sameChainQuote })],
    ["advancePlan", () => advancePlan({ planId: "p", stepIndex: 0, proof: "0xhash" })],
    ["getPlan", () => getPlan({ planId: "p" })],
    ["listSwappableTokens", () => listSwappableTokens()],
  ])("%s returns SESSION_MISSING without an upstream call when not signed in", async (_, run) => {
    mocks.wallet = null;

    await expect(run()).resolves.toEqual({
      ok: false,
      code: "SESSION_MISSING",
      message: "Wallet session not established",
    });
    expect(mocks.uniswapFetch).not.toHaveBeenCalled();
  });
});

describe("uniswap actions — typed results (POO-1029 [R2])", () => {
  it("returns the upstream code and message verbatim on a UniswapApiError", async () => {
    mocks.uniswapFetch.mockRejectedValue(
      new UniswapApiError(404, "QUOTE_ERROR", "No quotes available"),
    );

    await expect(quoteSwap(quoteInput)).resolves.toEqual({
      ok: false,
      code: "QUOTE_ERROR",
      message: "No quotes available",
    });
  });

  it("maps contract drift to SCHEMA_MISMATCH", async () => {
    mocks.uniswapFetch.mockRejectedValue(new UniswapParseError("quote", []));

    const result = await quoteSwap(quoteInput);

    expect(result).toMatchObject({ ok: false, code: "SCHEMA_MISMATCH" });
  });

  it("maps an unmapped throw to SYSTEM_INTERNAL rather than rejecting", async () => {
    mocks.uniswapFetch.mockRejectedValue(new Error("boom"));

    await expect(buildSwapTx({ quote: sameChainQuote })).resolves.toMatchObject({
      ok: false,
      code: "SYSTEM_INTERNAL",
      message: "Error: boom",
    });
  });

  it("returns ok:true payloads on success", async () => {
    mocks.uniswapFetch.mockResolvedValue(swapResponse);

    await expect(buildSwapTx({ quote: sameChainQuote })).resolves.toEqual({
      ok: true,
      swap: swapResponse.swap,
    });
  });

  // Provider responses are untrusted input: every action hands its schema to the transport, which
  // validates before the value can reach a caller. Asserting the schema identity is what stops an
  // action from ever quietly returning an unvalidated provider object.
  it.each([
    ["quoteSwap", () => quoteSwap(quoteInput), quoteResponseSchema],
    [
      "checkApproval",
      () => checkApproval({ token: WETH_POLYGON, amount: "1", chainId: 137 }),
      checkApprovalResponseSchema,
    ],
    ["buildSwapTx", () => buildSwapTx({ quote: sameChainQuote }), swapResponseSchema],
    ["createPlan", () => createPlan({ quote: sameChainQuote }), planResponseSchema],
    ["getPlan", () => getPlan({ planId: "p" }), planResponseSchema],
    ["listSwappableTokens", () => listSwappableTokens(), swappableTokensResponseSchema],
  ])("%s validates its response against its schema", async (_, run, schema) => {
    mocks.uniswapFetch.mockResolvedValue({
      ...sameChainQuote,
      ...swapResponse,
      ...planResponse,
      tokens: [],
      approval: null,
    });

    await run();

    expect(fetchOptions().schema).toBe(schema);
  });
});

describe("listSwappableTokens — cache (POO-1029 [R3])", () => {
  it("is cache-tagged with a stable tag and a revalidate window", async () => {
    mocks.uniswapFetch.mockResolvedValue({ tokens: [{ address: USDC_ARBITRUM, chainId: 42161 }] });

    const result = await listSwappableTokens();

    expect(result).toEqual({ ok: true, tokens: [{ address: USDC_ARBITRUM, chainId: 42161 }] });
    expect(fetchOptions().next).toEqual({
      revalidate: 3600,
      tags: ["uniswap-swappable-tokens"],
    });
  });

  // The allowlist is wallet-independent, so nothing per-session may enter the request: a query
  // parameter or a header that varied per user would fragment the cache entry the tag exists to
  // share, and the funding selector would be back to one upstream read per keystroke.
  it("sends no per-wallet input, so every session shares one cache entry", async () => {
    mocks.uniswapFetch.mockResolvedValue({ tokens: [] });

    await listSwappableTokens();

    expect(fetchOptions().body).toBeUndefined();
    expect(fetchOptions().query).toBeUndefined();
  });

  // POO-1031 [R1]: the funding inventory asks what ONE held token can reach, which is a property of
  // the token, not of the wallet — so the scoped read stays as shareable as the unscoped one.
  it("scopes the allowlist to a single token when asked, and stays cached", async () => {
    mocks.uniswapFetch.mockResolvedValue({ tokens: [{ address: USDC_ARBITRUM, chainId: 42161 }] });

    await listSwappableTokens({ tokenIn: WETH_POLYGON, tokenInChainId: 137 });

    expect(fetchOptions().query).toEqual({ tokenIn: WETH_POLYGON, tokenInChainId: 137 });
    expect(fetchOptions().next).toEqual({
      revalidate: 3600,
      tags: ["uniswap-swappable-tokens"],
    });
  });
});

describe("advancePlan — idempotency (POO-1029 [R4])", () => {
  const advanceInput = { planId: "plan-1", stepIndex: 0, proof: "0xhash" };

  it("submits the proof for the step and returns the plan", async () => {
    mocks.uniswapFetch.mockResolvedValue(planResponse);

    await expect(advancePlan(advanceInput)).resolves.toEqual({ ok: true, plan: planResponse });

    expect(fetchPath()).toBe("plan/plan-1");
    expect(fetchOptions().method).toBe("PATCH");
    expect(fetchBody()).toEqual({ stepIndex: 0, proof: "0xhash" });
    // The happy path costs exactly one call: the reconciling read is a failure-path affordance.
    expect(mocks.uniswapFetch).toHaveBeenCalledTimes(1);
  });

  // THE rule POO-1038 depends on. Re-submitting a proof for a step the server already advanced past
  // must return current state, never an error, or a safe retry would look like a hard failure and
  // push the rail towards re-broadcasting money that already moved.
  it("returns current plan state when the step was already advanced", async () => {
    mocks.uniswapFetch
      .mockRejectedValueOnce(new UniswapApiError(409, "STEP_ALREADY_ADVANCED", "already done"))
      .mockResolvedValueOnce(planResponse);

    await expect(advancePlan(advanceInput)).resolves.toEqual({ ok: true, plan: planResponse });

    // Resolution is a READ of authoritative server state, never a re-broadcast.
    expect(fetchOptions(1).method ?? "GET").toBe("GET");
  });

  // The plan's last step leaves `currentStepIndex` pinned at that index, so the index alone cannot
  // decide the terminal case: the step's own COMPLETE status does.
  it("returns current plan state when the step itself is already COMPLETE", async () => {
    mocks.uniswapFetch
      .mockRejectedValueOnce(new UniswapApiError(409, "NOPE", "no"))
      .mockResolvedValueOnce({
        planId: "plan-1",
        currentStepIndex: 1,
        steps: [{ stepIndex: 1, method: "SEND_TX", status: "COMPLETE" }],
      });

    const result = await advancePlan({ ...advanceInput, stepIndex: 1 });

    expect(result).toMatchObject({ ok: true });
  });

  // Idempotency must not become blanket error-swallowing: when the server says the step has NOT
  // advanced, the original failure is the truth and the caller has to see it.
  it("surfaces the original failure when the server shows the step still pending", async () => {
    mocks.uniswapFetch
      .mockRejectedValueOnce(new UniswapApiError(400, "BAD_PROOF", "malformed proof"))
      .mockResolvedValueOnce(planResponse);

    await expect(advancePlan({ ...advanceInput, stepIndex: 1 })).resolves.toEqual({
      ok: false,
      code: "BAD_PROOF",
      message: "malformed proof",
    });
  });

  it("surfaces the original failure when the reconciling read also fails", async () => {
    mocks.uniswapFetch
      .mockRejectedValueOnce(new UniswapApiError(500, "UNISWAP_UPSTREAM_ERROR", "patch failed"))
      .mockRejectedValueOnce(new UniswapApiError(503, "UNISWAP_UPSTREAM_ERROR", "read failed"));

    await expect(advancePlan(advanceInput)).resolves.toEqual({
      ok: false,
      code: "UNISWAP_UPSTREAM_ERROR",
      message: "patch failed",
    });
  });
});

describe("getPlan — explicit refresh only (POO-1029 [R5])", () => {
  it("does not force a refresh implicitly", async () => {
    mocks.uniswapFetch.mockResolvedValue(planResponse);

    await expect(getPlan({ planId: "plan-1" })).resolves.toEqual({ ok: true, plan: planResponse });

    expect(fetchPath()).toBe("plan/plan-1");
    expect(fetchOptions().query).toBeUndefined();
  });

  it("forces a refresh only when the caller asks", async () => {
    mocks.uniswapFetch.mockResolvedValue(planResponse);

    await getPlan({ planId: "plan-1", forceRefresh: true });

    expect(fetchOptions().query).toEqual({ forceRefresh: true });
  });

  it("passes forceRefresh:false through as no query at all", async () => {
    mocks.uniswapFetch.mockResolvedValue(planResponse);

    await getPlan({ planId: "plan-1", forceRefresh: false });

    expect(fetchOptions().query).toBeUndefined();
  });

  // Plan state is the recovery primitive: a cached read would resume from a stale step index.
  it("never caches plan state", async () => {
    mocks.uniswapFetch.mockResolvedValue(planResponse);

    await getPlan({ planId: "plan-1" });

    expect(fetchOptions().next).toBeUndefined();
  });
});

describe("slippage (POO-1029 [R6])", () => {
  it("rides the caller's slippage tolerance through to the quote", async () => {
    mocks.uniswapFetch.mockResolvedValue(sameChainQuote);

    await quoteSwap({ ...quoteInput, slippageTolerance: 2 });

    expect(fetchBody().slippageTolerance).toBe(2);
  });

  it("omits slippageTolerance entirely when the caller does not set one", async () => {
    mocks.uniswapFetch.mockResolvedValue(sameChainQuote);

    await quoteSwap(quoteInput);

    expect(fetchBody()).not.toHaveProperty("slippageTolerance");
  });

  // Bridge legs are quoted by Across, which does not take our tolerance. Sending one to `/plan`
  // would imply an allowance we cannot enforce, and the cost breakdown (UF-13 R3) would then be
  // presenting a number that governs nothing.
  it("never sends a slippage tolerance to the plan endpoint", async () => {
    mocks.uniswapFetch.mockResolvedValue(planResponse);

    await createPlan({ quote: sameChainQuote });

    expect(fetchBody()).not.toHaveProperty("slippageTolerance");
  });
});

describe("createPlan — non-idempotent (POO-1029 [R7])", () => {
  it("opts out of the transport's ambiguous-failure replay", async () => {
    mocks.uniswapFetch.mockResolvedValue(planResponse);

    await expect(createPlan({ quote: sameChainQuote })).resolves.toEqual({
      ok: true,
      plan: planResponse,
    });

    expect(fetchPath()).toBe("plan");
    expect(fetchOptions().method).toBe("POST");
    // POST /plan creates server-side state: a replayed timeout could create a SECOND plan.
    expect(fetchOptions().idempotent).toBe(false);
  });

  it("sends the routing and quote the plan is created from", async () => {
    mocks.uniswapFetch.mockResolvedValue(planResponse);

    await createPlan({ quote: sameChainQuote });

    expect(fetchBody()).toEqual({ routing: "CLASSIC", quote: sameChainQuote.quote });
  });

  // Everything else in this module is a read or a pure computation, so it keeps the transport's
  // default replay. Locking the contrast keeps the opt-out meaningful rather than incidental.
  it.each([
    ["quoteSwap", () => quoteSwap(quoteInput)],
    ["buildSwapTx", () => buildSwapTx({ quote: sameChainQuote })],
    ["advancePlan", () => advancePlan({ planId: "p", stepIndex: 0, proof: "0x1" })],
  ])("%s keeps the default replay behaviour", async (_, run) => {
    mocks.uniswapFetch.mockResolvedValue({ ...sameChainQuote, ...swapResponse, ...planResponse });

    await run();

    expect(fetchOptions().idempotent).toBeUndefined();
  });
});

describe("request shaping and pre-flight rejection", () => {
  // UF-06 [R4]: Chained Actions are EXACT_INPUT only. Rejecting before the request leaves us turns
  // a puzzling upstream 400 into a message that says what is wrong.
  it("rejects a cross-chain EXACT_OUTPUT quote without calling the API", async () => {
    const result = await quoteSwap({ ...quoteInput, type: "EXACT_OUTPUT" });

    expect(result).toMatchObject({ ok: false, code: "UNISWAP_INVALID_REQUEST" });
    expect(mocks.uniswapFetch).not.toHaveBeenCalled();
  });

  it("defaults a quote to EXACT_INPUT", async () => {
    mocks.uniswapFetch.mockResolvedValue(sameChainQuote);

    await quoteSwap(quoteInput);

    expect(fetchBody().type).toBe("EXACT_INPUT");
  });

  // A UniswapX order settles asynchronously through a lifecycle our rail does not model. Pinning
  // the AMM path same-chain keeps it from being offered at all.
  it("pins the classic AMM route on a same-chain quote", async () => {
    mocks.uniswapFetch.mockResolvedValue(sameChainQuote);

    await quoteSwap({ ...quoteInput, tokenInChainId: 42161, tokenOutChainId: 42161 });

    expect(fetchBody().routingPreference).toBe("CLASSIC");
  });

  // …but never cross-chain, where pinning the classic AMM path would exclude the BRIDGE and CHAINED
  // routes the whole cross-chain rail depends on.
  it("does not pin a routing preference on a cross-chain quote", async () => {
    mocks.uniswapFetch.mockResolvedValue(sameChainQuote);

    await quoteSwap(quoteInput);

    expect(fetchBody()).not.toHaveProperty("routingPreference");
  });

  it("fails legibly when the API returns a UniswapX route anyway", async () => {
    mocks.uniswapFetch.mockResolvedValue({ ...sameChainQuote, routing: "DUTCH_V2" });

    await expect(quoteSwap(quoteInput)).resolves.toMatchObject({
      ok: false,
      code: "UNISWAP_ROUTING_UNSUPPORTED",
    });
  });

  it("forwards the optional destination token to checkApproval", async () => {
    mocks.uniswapFetch.mockResolvedValue({ approval: null });

    await checkApproval({
      token: WETH_POLYGON,
      amount: "1000",
      chainId: 137,
      tokenOut: USDC_ARBITRUM,
      tokenOutChainId: 42161,
    });

    expect(fetchBody()).toEqual({
      walletAddress: SESSION_WALLET,
      token: WETH_POLYGON,
      amount: "1000",
      chainId: 137,
      tokenOut: USDC_ARBITRUM,
      tokenOutChainId: 42161,
    });
  });

  // No approval calldata means the allowance already covers the amount. Normalising to `null` lets
  // the rail (UF-14 R4) emit `{ skipped: true }` off a single check.
  it("normalises an absent approval to null", async () => {
    mocks.uniswapFetch.mockResolvedValue({ requestId: "r" });

    await expect(
      checkApproval({ token: WETH_POLYGON, amount: "1000", chainId: 137 }),
    ).resolves.toEqual({ ok: true, approval: null, cancel: null });
  });

  it("rejects a malformed amount without calling the API", async () => {
    const result = await checkApproval({ token: WETH_POLYGON, amount: "1.5", chainId: 137 });

    expect(result).toMatchObject({ ok: false, code: "UNISWAP_INVALID_REQUEST" });
    expect(mocks.uniswapFetch).not.toHaveBeenCalled();
  });
});

describe("buildSwapTx — the Permit2 field-rule matrix", () => {
  const permitData = { domain: {}, types: {}, values: {} };

  // The API rejects an explicit `permitData: null`, so it is stripped rather than forwarded.
  it("strips a null permitData from the swap body", async () => {
    mocks.uniswapFetch.mockResolvedValue(swapResponse);

    await buildSwapTx({ quote: sameChainQuote });

    expect(fetchPath()).toBe("swap");
    expect(fetchBody()).not.toHaveProperty("permitData");
    expect(fetchBody()).not.toHaveProperty("signature");
    expect(fetchBody()).toMatchObject({ routing: "CLASSIC", quote: sameChainQuote.quote });
  });

  it("sends signature and permitData together when a permit was signed", async () => {
    mocks.uniswapFetch.mockResolvedValue(swapResponse);
    const quote = { ...sameChainQuote, permitData } as unknown as UniswapQuoteResponse;

    await buildSwapTx({ quote, signature: "0xsig" });

    expect(fetchBody()).toMatchObject({ signature: "0xsig", permitData });
  });

  // Both invalid rows of the matrix, caught here rather than as an upstream 400 or, worse, a swap
  // that broadcasts without the allowance it needs and reverts.
  it("rejects a permit that was returned but not signed", async () => {
    const quote = { ...sameChainQuote, permitData } as unknown as UniswapQuoteResponse;

    const result = await buildSwapTx({ quote });

    expect(result).toMatchObject({ ok: false, code: "UNISWAP_INVALID_REQUEST" });
    expect(mocks.uniswapFetch).not.toHaveBeenCalled();
  });

  it("rejects a signature with no permit to go with it", async () => {
    const result = await buildSwapTx({ quote: sameChainQuote, signature: "0xsig" });

    expect(result).toMatchObject({ ok: false, code: "UNISWAP_INVALID_REQUEST" });
    expect(mocks.uniswapFetch).not.toHaveBeenCalled();
  });

  it("refuses to build a UniswapX order as a transaction", async () => {
    const quote = { ...sameChainQuote, routing: "PRIORITY" } as unknown as UniswapQuoteResponse;

    const result = await buildSwapTx({ quote });

    expect(result).toMatchObject({ ok: false, code: "UNISWAP_ROUTING_UNSUPPORTED" });
    expect(mocks.uniswapFetch).not.toHaveBeenCalled();
  });
});
