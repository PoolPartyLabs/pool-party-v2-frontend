/**
 * @id PP-CORE-LIB-052 (POO-1029, POO-1054)
 * @name Uniswap server-action layer tests
 * @implements-rules-version v2
 * @hackathon POO-1022 (Universal Funding)
 *
 * Rules under test (POO-1029 rules v2, as amended by POO-1054 [R3]):
 *   [R1] the wallet comes from the SIWE session; a body-supplied address is IGNORED, not validated
 *   [R2] no action throws across the RSC boundary; each returns a typed discriminated result
 *   [R3] `listSwappableTokens` is cache-tagged and must not re-fetch per keystroke
 *   [R6] slippage rides through to the quote; bridge legs are Across-quoted and ignore it
 *
 * RETIRED by POO-1054 [R3], with the actions they governed: [R4] `advancePlan` idempotency,
 * [R5] `getPlan` forceRefresh, [R7] `createPlan` non-idempotence. The live Trading API never returns
 * `routing: "CHAINED"`, so the `/plan` lifecycle those rules described is unreachable.
 *
 * `uniswapFetch` and `getSessionWallet` are mocked: this suite is about the action contract (session
 * derivation, request shaping, failure mapping, cache options), not about transport, which has its
 * own suite in `client.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UniswapApiError, UniswapParseError } from "./errors";
import {
  checkApprovalResponseSchema,
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

import { buildSwapTx, checkApproval, listSwappableTokens, quoteSwap } from "./actions";

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

/**
 * A cross-chain BRIDGE quote, shaped after the live P2 probe (`01_UNISWAP_INTEGRATION.md` §1.1):
 * same token, two chains, a real fill-time estimate, and no permit.
 */
const crossChainQuote = {
  requestId: "req-2",
  routing: "BRIDGE",
  quote: {
    tokenInChainId: 137,
    tokenOutChainId: 42161,
    input: { token: WETH_POLYGON, amount: "1000000000000000000" },
    output: { token: USDC_ARBITRUM, amount: "1000000" },
    estimatedFillTimeMs: 1000,
  },
} as unknown as UniswapQuoteResponse;

const swapResponse = {
  swap: {
    to: "0x3333333333333333333333333333333333333333",
    data: "0xdeadbeef",
    value: "0",
    chainId: 42161,
  },
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

// POO-1054 [R3]. A read-only probe of the live Trading API on 2026-07-25 never returned
// `routing: "CHAINED"` on any pair, and `POST /plan` requires a chained quote as its body. The three
// plan-lifecycle actions were therefore unreachable: not "untested", but impossible to call with a
// payload the API would accept. Locking the export surface is what keeps them from coming back,
// because an unreachable action is worse than an absent one — it reads to the next author as a
// capability the rail has.
describe("action surface (POO-1054 [R3])", () => {
  it("exports only the actions the live API can serve", async () => {
    const actions = await import("./actions");

    expect(Object.keys(actions).sort()).toEqual([
      "buildSwapTx",
      "checkApproval",
      "listSwappableTokens",
      "quoteSwap",
    ]);
  });
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

  // Every action is gated, including `listSwappableTokens`, which does not send the wallet upstream
  // at all: without the gate an anonymous visitor could spend our rate-limited, key-authenticated
  // upstream quota through our own server.
  it.each([
    ["quoteSwap", () => quoteSwap(quoteInput)],
    ["checkApproval", () => checkApproval({ token: WETH_POLYGON, amount: "1", chainId: 137 })],
    ["buildSwapTx", () => buildSwapTx({ quote: sameChainQuote })],
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
    ["listSwappableTokens", () => listSwappableTokens(), swappableTokensResponseSchema],
  ])("%s validates its response against its schema", async (_, run, schema) => {
    mocks.uniswapFetch.mockResolvedValue({
      ...sameChainQuote,
      ...swapResponse,
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

  // A bridge leg is quoted by Across, which does not take our tolerance, so a tolerance sent with a
  // cross-chain quote governs nothing on that leg. There is no longer a second endpoint to withhold
  // it from (POO-1054 [R3] retired `/plan`), so the rule now lives where it can actually be
  // asserted: the cost breakdown (UF-13 R3) excludes bridge legs from the slippage line.
});

// `POST /plan` was the only call in this module that created state upstream, and it opted out of the
// transport's ambiguous-failure replay for that reason. With it gone (POO-1054 [R3]) every remaining
// call is a read or a pure build, so all of them keep the default replay. Asserting that keeps the
// transport's `idempotent: false` affordance honest: the day something here creates state again, the
// opt-out has to be a deliberate diff against this test rather than an omission nobody notices.
describe("transport replay", () => {
  it.each([
    ["quoteSwap", () => quoteSwap(quoteInput)],
    ["checkApproval", () => checkApproval({ token: WETH_POLYGON, amount: "1", chainId: 137 })],
    ["buildSwapTx", () => buildSwapTx({ quote: sameChainQuote })],
    ["listSwappableTokens", () => listSwappableTokens()],
  ])("%s keeps the default replay behaviour", async (_, run) => {
    mocks.uniswapFetch.mockResolvedValue({
      ...sameChainQuote,
      ...swapResponse,
      tokens: [],
      approval: null,
    });

    await run();

    expect(fetchOptions().idempotent).toBeUndefined();
  });
});

describe("request shaping and pre-flight rejection", () => {
  // POO-1034 [R6] — the measurement the PP-TODO was waiting on came back: a live cross-chain
  // EXACT_OUTPUT quote answers `200` with `routing: "BRIDGE"`. The guard was refusing a route the
  // API serves, so it is gone, and this asserts the request now reaches the network with the type
  // the caller asked for. The planner depends on it: it sizes a decomposed route backwards from the
  // amount that has to LAND, which is an exact-output question by construction.
  it("forwards a cross-chain EXACT_OUTPUT quote instead of refusing it", async () => {
    mocks.uniswapFetch.mockResolvedValue(crossChainQuote);

    const result = await quoteSwap({ ...quoteInput, type: "EXACT_OUTPUT" });

    expect(result).toMatchObject({ ok: true });
    expect(fetchBody().type).toBe("EXACT_OUTPUT");
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

  // …but never cross-chain, where pinning the classic AMM path would exclude the BRIDGE route the
  // whole cross-chain rail depends on.
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
