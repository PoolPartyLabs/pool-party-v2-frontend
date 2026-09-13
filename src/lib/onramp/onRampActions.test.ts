/**
 * @id PP-CORE-LIB-063 (POO-1132, POO-1578, POO-1573, POO-1629)
 * @name on-ramp server-action tests
 * @implements-rules-version v4 (POO-1629 rules v2) · v3 (POO-1573 rules v2) · v2 (POO-1132 rules v2) · v1 (POO-1578 rules v1)
 *
 * Rules under test (POO-1132 rules v2):
 *   the wallet comes from `getSessionWallet()`, never the caller: `recipientAddress` / `partnerUserId`
 *         are the SESSION wallet, and no such field exists on the action input to override them.
 *   the house error contract holds: no action throws across the RSC boundary; each returns
 *         `{ ok: true, … } | { ok: false, code, message }`. Upstream `ApiError` keeps its code; an
 *         `ApiParseError` becomes SCHEMA_MISMATCH; a bad input fails locally with no network call.
 *   `apiFetch("on-ramp/quote")` / `("on-ramp/request-id")` — v2 does NOT bake `/api/v1` into the path.
 *   the received-fixed `direction` rides through only when provided.
 *   double-submit dedupe: `apiFetch` retries only GETs and these are POSTs, so a rapid resubmit of the
 *         SAME signed request must coalesce onto one upstream call rather than create two purchases.
 *
 * POO-1578 extends that coalescing to the QUOTE, on quota rather than double spend: a picker
 * re-quotes on every selection change and pp_api throttles per API KEY, shared across all users and
 * both interface versions. It is a coalescer and not a cache, so a settled quote is never re-served.
 *
 * `apiFetch` and `getSessionWallet` are mocked: this suite is about the action CONTRACT (session
 * derivation, request shaping, failure mapping, dedupe), not the schemas (their own suite) or the
 * transport (`api/client.ts`'s own suite).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiParseError } from "@/lib/api/errors";
import { onRampCurrencyPairsResponseSchema } from "./currencyPairs";
import { normalizeOnRampQuote } from "./schemas";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  wallet: null as string | null,
  /**
   * POO-1367: request headers the mint reads to resolve the end user's public IP. A real public
   * address by default so the existing cases exercise the happy path; individual tests override it.
   */
  requestHeaders: { "x-forwarded-for": "198.51.100.4" } as Record<string, string>,
  logInfo: vi.fn(),
  logError: vi.fn(),
  /** POO-1512 [R2]: the profile link of the currency chain. Blank by default, as it is for most users. */
  profileCountry: "" as string,
}));

vi.mock("@/lib/api/client", () => ({ apiFetch: mocks.apiFetch }));
vi.mock("@/lib/auth/session", () => ({ getSessionWallet: async () => mocks.wallet }));
// Only the SINKS are replaced. `isExpectedNonOutage` (the repo-wide suppression rule) and
// `summarizeZodIssues` (the shared issue masker) are pure and are exactly what is under test here,
// so they come from the real module.
vi.mock("@/lib/observability/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/observability/logger")>()),
  logInfo: mocks.logInfo,
  logError: mocks.logError,
}));
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => mocks.requestHeaders[name.toLowerCase()] ?? null,
  }),
}));
vi.mock("@/lib/profile/loadInvestorProfile", () => ({
  loadInvestorProfile: async () => ({ country: mocks.profileCountry }),
}));

import {
  createOnRampRequestAction,
  getOnRampEthTargetAction,
  getOnRampPaymentMethodsAction,
  getOnRampQuoteAction,
  getOnRampSupportedCurrenciesAction,
} from "./onRampActions";

/** The address the SIWE session vouches for (lowercased, as `walletFromToken` returns it). */
const SESSION_WALLET = "0x1111111111111111111111111111111111111111";

/** The path `apiFetch` was called with on call `index`. */
function fetchPath(index = 0): string {
  return (mocks.apiFetch.mock.calls[index] as [string, unknown])[0];
}

/** The options `apiFetch` was called with on call `index`. */
function fetchOptions(index = 0): Record<string, unknown> {
  return (mocks.apiFetch.mock.calls[index] as [string, Record<string, unknown>])[1];
}

/** The request body `apiFetch` was called with on call `index`. */
function fetchBody(index = 0): Record<string, unknown> {
  return fetchOptions(index).body as Record<string, unknown>;
}

/** A never-yet-resolved promise plus its resolver, for driving concurrency deterministically. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Flush the microtask + timer queue so awaited mocks settle before assertions. */
function flush(): Promise<void> {
  return new Promise((res) => setTimeout(res, 0));
}

/**
 * POO-1512: `currencyCodeFrom` is EXPLICIT here so these cases keep testing the request builder alone.
 * Omitting it now triggers the [R2] resolution, which fetches `currency-pairs-to-buy` FIRST and would
 * shift every `fetchPath()` index by one. The resolution itself has its own cases below.
 */
const quoteInput = {
  currencyCodeTo: "USDC-BASE",
  amount: 100,
  paymentMethod: "credit_card",
  direction: "receive" as const,
  currencyCodeFrom: "USD",
};

/** The RAW wire quote `apiFetch` resolves to; the action normalizes it before returning. */
const rawQuote = {
  id: "quote_123",
  currencyCodeFrom: "USD",
  currencyCodeTo: "USDC-BASE",
  requestedAmountType: "destination",
  paymentMethods: [
    {
      id: "poolparty-credit-card",
      name: "Credit Card",
      amountTo: { amount: "100.000000", currencyCode: "USDC-BASE" },
      amountFrom: { amount: "104.53", currencyCode: "USD" },
    },
  ],
};

const requestInput = {
  signature: "0xabcdef0123456789",
  message: `Pool Party On-Ramp Verification\nWallet: ${SESSION_WALLET}\nTimestamp: 2026-07-30T12:00:00.000Z`,
  currencyCode: "USDC-BASE",
  quoteId: "quote_123",
  paymentMethod: "credit_card",
};

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.wallet = SESSION_WALLET;
  mocks.requestHeaders = { "x-forwarded-for": "198.51.100.4" };
  mocks.logInfo.mockReset();
  mocks.logError.mockReset();
});

describe("getOnRampQuoteAction (POO-1132)", () => {
  // @rule POO-1132: the wallet comes from the SIWE session, so no session means no call to make,
  // and the refusal is a code rather than a throw.
  it("returns SESSION_MISSING without hitting the network when not signed in", async () => {
    mocks.wallet = null;
    const result = await getOnRampQuoteAction(quoteInput);
    expect(result).toEqual({ ok: false, code: "SESSION_MISSING", message: expect.any(String) });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  // @rule POO-1132: `apiFetch` builds `/api/{version}/{path}`, so the path carries no `/api/v1`.
  // @rule POO-1139: the received-fixed `direction` rides through to the backend verbatim.
  it("POSTs a received-fixed quote to on-ramp/quote and returns the normalized quote", async () => {
    mocks.apiFetch.mockResolvedValue(rawQuote);
    const result = await getOnRampQuoteAction(quoteInput);

    expect(fetchPath()).toBe("on-ramp/quote");
    expect(fetchOptions().method).toBe("POST");
    expect(fetchBody()).toMatchObject({
      currencyCodeFrom: "USD",
      currencyCodeTo: "USDC-BASE",
      amount: 100,
      paymentMethod: "credit_card",
      direction: "receive",
    });
    // The action composes apiFetch (validate) then normalizeOnRampQuote (unit convention).
    expect(result).toEqual({ ok: true, quote: normalizeOnRampQuote(rawQuote) });
  });

  // @rule POO-1139: `direction` is optional upstream and omitted means `"spend"`, so the FE sends
  // nothing rather than a default of its own.
  it("omits direction from the body when the caller does not set it (backend defaults to spend)", async () => {
    mocks.apiFetch.mockResolvedValue(rawQuote);
    await getOnRampQuoteAction({
      currencyCodeTo: "USDC-BASE",
      amount: 100,
      paymentMethod: "card",
      currencyCodeFrom: "USD",
    });
    expect(fetchBody()).not.toHaveProperty("direction");
  });

  // @rule POO-1132: a bad input fails locally as ONRAMP_INVALID_REQUEST, with no round trip spent
  // on a call the backend would reject anyway.
  it("refuses an amount below the backend minimum locally, with no network call", async () => {
    const result = await getOnRampQuoteAction({ ...quoteInput, amount: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ONRAMP_INVALID_REQUEST");
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  // @rule POO-1132: the house error contract. An upstream `ApiError` keeps its code and never
  // crosses the RSC boundary as a throw.
  it("maps an upstream ApiError to its code verbatim", async () => {
    mocks.apiFetch.mockRejectedValue(new ApiError(429, "SYSTEM_RATE_LIMITED", "slow down"));
    const result = await getOnRampQuoteAction(quoteInput);
    expect(result).toEqual({ ok: false, code: "SYSTEM_RATE_LIMITED", message: "slow down" });
  });

  // @rule POO-1132: an ApiParseError becomes SCHEMA_MISMATCH, so drift surfaces as a handled code.
  it("maps a response contract drift to SCHEMA_MISMATCH", async () => {
    mocks.apiFetch.mockRejectedValue(new ApiParseError("bad shape", []));
    const result = await getOnRampQuoteAction(quoteInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SCHEMA_MISMATCH");
  });

  // @rule POO-1132: an empty body is drift too. There is no quote to normalize, so it cannot be ok.
  it("treats an empty (204) quote body as SCHEMA_MISMATCH", async () => {
    mocks.apiFetch.mockResolvedValue(null);
    const result = await getOnRampQuoteAction(quoteInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SCHEMA_MISMATCH");
  });

  // @rule POO-1132: nothing throws across the RSC boundary, whatever the cause.
  it("maps a non-Api throwable to SYSTEM_INTERNAL rather than leaking it across RSC", async () => {
    mocks.apiFetch.mockRejectedValue(new Error("boom"));
    const result = await getOnRampQuoteAction(quoteInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SYSTEM_INTERNAL");
  });

  /**
   * @rule POO-1599 [R1]: the LISTING quote omits `paymentMethod` entirely.
   *
   * Paybis prices every method available for the pair when the field is absent; sending it as
   * `undefined` or `null` is not the same thing, and the backend `QuoteQueryDto` whitelist would
   * carry a null through to the upstream as a null identifier. So the KEY has to be gone.
   */
  it("omits paymentMethod from the body when the caller pins none (the listing quote)", async () => {
    mocks.apiFetch.mockResolvedValue(rawQuote);
    await getOnRampQuoteAction({
      currencyCodeTo: "USDC-BASE",
      amount: 100,
      currencyCodeFrom: "USD",
      direction: "receive",
    });

    expect(fetchBody()).not.toHaveProperty("paymentMethod");
    expect(fetchBody()).toMatchObject({
      currencyCodeFrom: "USD",
      currencyCodeTo: "USDC-BASE",
      amount: 100,
      direction: "receive",
    });
  });

  // @rule POO-1599: and a pinned method still rides through verbatim (POO-1578's threading).
  it("still sends a pinned paymentMethod verbatim", async () => {
    mocks.apiFetch.mockResolvedValue(rawQuote);
    await getOnRampQuoteAction({ ...quoteInput, paymentMethod: "poolparty-trustly" });

    expect(fetchBody()).toHaveProperty("paymentMethod", "poolparty-trustly");
  });

  /**
   * @rule POO-1599: an unpinned quote is a DIFFERENT question from a pinned one, so the coalescer
   * must not answer one with the other. It asks about every method; a pinned one asks about one.
   * Collapsing them would hand a picker a single-method payload where it expected the full set (or
   * the reverse), which is the POO-1413 class of defect: assuming the answer matches the question.
   */
  it("does NOT coalesce an unpinned quote with a pinned one for the same amount", async () => {
    mocks.apiFetch.mockResolvedValue(rawQuote);
    const { paymentMethod: _pinned, ...unpinnedInput } = quoteInput;

    await Promise.all([getOnRampQuoteAction(quoteInput), getOnRampQuoteAction(unpinnedInput)]);

    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
  });

  // @rule POO-1578: two unpinned quotes for the same pair and amount ARE the same question, so the
  // quota saving survives the change.
  it("still coalesces two identical UNPINNED quotes into one upstream POST", async () => {
    const d = deferred<typeof rawQuote>();
    mocks.apiFetch.mockReturnValue(d.promise);
    const { paymentMethod: _pinned, ...unpinnedInput } = quoteInput;

    const p1 = getOnRampQuoteAction(unpinnedInput);
    const p2 = getOnRampQuoteAction(unpinnedInput);
    await flush();
    d.resolve(rawQuote);
    await Promise.all([p1, p2]);

    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
  });

  /**
   * @rule POO-1578: coalesce identical in-flight quotes, on QUOTA rather than double spend.
   *
   * This is a POST, so `apiFetch` cannot cache it (`client.ts` caches GETs only), and a payment-method
   * picker re-quotes on every selection change. pp_api throttles 20 requests / 60 s per API KEY, not
   * per IP, shared across every user AND both interface versions, so one user toggling between
   * methods spends everyone's budget. Same `inFlightRequests` shape the mint below already uses.
   */
  it("coalesces two rapid identical quotes into ONE upstream POST", async () => {
    const d = deferred<typeof rawQuote>();
    mocks.apiFetch.mockReturnValue(d.promise);

    const p1 = getOnRampQuoteAction(quoteInput);
    const p2 = getOnRampQuoteAction(quoteInput);
    await flush();
    d.resolve(rawQuote);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    expect(r1).toEqual({ ok: true, quote: normalizeOnRampQuote(rawQuote) });
    expect(r2).toEqual(r1);
  });

  // @rule POO-1578: keyed on everything that decides the answer, so a DIFFERENT method is a
  // different quote. Coalescing these would hand the picker one method's charge under another's name.
  it("does NOT coalesce quotes that differ in payment method", async () => {
    mocks.apiFetch.mockResolvedValue(rawQuote);
    await Promise.all([
      getOnRampQuoteAction(quoteInput),
      getOnRampQuoteAction({ ...quoteInput, paymentMethod: "poolparty-trustly" }),
    ]);
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
  });

  // @rule POO-1578: it is a coalescer, NOT a cache. The entry is dropped when the request settles, so
  // a quote is never served stale (a quote expires) and a retry after a failure still goes upstream.
  it("lets a later identical quote through once the first has settled", async () => {
    mocks.apiFetch.mockResolvedValue(rawQuote);
    await getOnRampQuoteAction(quoteInput);
    await getOnRampQuoteAction(quoteInput);
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
  });
});

describe("createOnRampRequestAction (POO-1132)", () => {
  // @rule POO-1367 [R1]: Paybis `/v3/request` requires the END USER's public IP and 422s on anything
  // else. `apiFetch` is server-only, so without this header the backend falls back to `req.ip`, the
  // NEXT CONTAINER's Docker address, and every prod purchase fails at the final step.
  it("forwards the end user's public IP as x-forwarded-for on the mint", async () => {
    mocks.apiFetch.mockResolvedValue({ requestId: "req_1" });
    mocks.requestHeaders = { "x-forwarded-for": "198.51.100.4" };

    await createOnRampRequestAction(requestInput);

    expect((fetchOptions().headers as Record<string, string>)["x-forwarded-for"]).toBe(
      "198.51.100.4",
    );
  });

  // @rule POO-1367 [R2]: prod sits behind CloudFront, whose viewer address is `IP:port`. Forwarding
  // it raw is ITSELF an invalid IP, which is the exact 422 this fixes.
  it("strips the port from a CloudFront viewer address before forwarding it", async () => {
    mocks.apiFetch.mockResolvedValue({ requestId: "req_1" });
    mocks.requestHeaders = { "cloudfront-viewer-address": "[2001:db8::1]:52456" };

    await createOnRampRequestAction(requestInput);

    expect((fetchOptions().headers as Record<string, string>)["x-forwarded-for"]).toBe(
      "2001:db8::1",
    );
  });

  // @rule POO-1367 [R5]: every deployed environment is behind CloudFront, so resolving from anything
  // else means the origin-request-policy stopped forwarding the unforgeable header and `userIp`
  // became client-spoofable. The purchase still succeeds, so this is the ONLY thing that would ever
  // surface it. `logError` is the level that reaches Sentry.
  it("escalates to Sentry when the CloudFront viewer address is not the source", async () => {
    mocks.apiFetch.mockResolvedValue({ requestId: "req_1" });
    mocks.requestHeaders = { "x-forwarded-for": "198.51.100.4" };

    await createOnRampRequestAction(requestInput);

    expect(mocks.logError).toHaveBeenCalledWith(
      "onramp.client_ip_edge_degraded",
      expect.objectContaining({ source: "x-forwarded-for" }),
    );
  });

  // @rule POO-1367 [R5]: the healthy path must NOT page. An alarm that fires on every request is an
  // alarm nobody reads.
  it("does not escalate when CloudFront supplied the address", async () => {
    mocks.apiFetch.mockResolvedValue({ requestId: "req_1" });
    mocks.requestHeaders = { "cloudfront-viewer-address": "203.0.113.7:52456" };

    await createOnRampRequestAction(requestInput);

    expect(mocks.logError).not.toHaveBeenCalled();
    expect(mocks.logInfo).toHaveBeenCalledWith(
      "onramp.client_ip_resolved",
      expect.objectContaining({ source: "cloudfront-viewer-address" }),
    );
  });

  // @rule POO-1367 [R1]: no address is refused locally rather than sent. A fabricated `127.0.0.1`
  // would pass Paybis's format check while being a lie on a money path, and would fail upstream for
  // a reason nobody can read.
  it("refuses the mint locally when no public IP can be established, with no network call", async () => {
    // Only the container's own private address, which is precisely the outage condition.
    mocks.requestHeaders = { "x-forwarded-for": "172.18.0.5" };

    const result = await createOnRampRequestAction(requestInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ONRAMP_INVALID_REQUEST");
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  // @rule POO-1132: same session precondition, and a purchase intent is the last place to relax it.
  it("returns SESSION_MISSING without hitting the network when not signed in", async () => {
    mocks.wallet = null;
    const result = await createOnRampRequestAction(requestInput);
    expect(result).toEqual({ ok: false, code: "SESSION_MISSING", message: expect.any(String) });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  // @rule POO-1132: the wallet comes from `getSessionWallet()`, so both `recipientAddress` and
  // `partnerUserId` are the session's. The path again carries no `/api/v1`.
  it("derives recipient + partner from the SESSION wallet and POSTs to on-ramp/request-id", async () => {
    mocks.apiFetch.mockResolvedValue({ requestId: "req_1", oneTimeToken: "otp" });
    const result = await createOnRampRequestAction(requestInput);

    expect(fetchPath()).toBe("on-ramp/request-id");
    expect(fetchOptions().method).toBe("POST");
    expect(fetchBody()).toMatchObject({
      recipientAddress: SESSION_WALLET,
      partnerUserId: SESSION_WALLET,
      locale: "en",
      currencyCode: "USDC-BASE",
      signature: requestInput.signature,
      message: requestInput.message,
      quoteId: "quote_123",
      paymentMethod: "credit_card",
    });
    expect(result).toEqual({ ok: true, requestId: "req_1", oneTimeToken: "otp" });
  });

  // @rule POO-1132: never from the caller. The crypto lands at the session's address even when the
  // input carries a competing one, which is the money-safety half of the rule.
  it("uses the session wallet even if a rogue recipientAddress is smuggled in the input", async () => {
    mocks.apiFetch.mockResolvedValue({ requestId: "req_1" });
    // A pre-built object (not a literal at the call site) dodges the excess-property check without a
    // cast: structurally it is a valid OnRampRequestInput with two extra keys the action must ignore.
    const rogue = {
      ...requestInput,
      recipientAddress: "0x2222222222222222222222222222222222222222",
      partnerUserId: "0x2222222222222222222222222222222222222222",
    };
    await createOnRampRequestAction(rogue);
    expect(fetchBody().recipientAddress).toBe(SESSION_WALLET);
    expect(fetchBody().partnerUserId).toBe(SESSION_WALLET);
  });

  // @rule POO-1132: both are optional on the wire, so an absent one is omitted, not sent empty.
  it("omits quoteId and paymentMethod from the body when absent", async () => {
    mocks.apiFetch.mockResolvedValue({ requestId: "req_1" });
    await createOnRampRequestAction({
      signature: "0xdeadbeef",
      message: requestInput.message,
      currencyCode: "USDC-BASE",
    });
    expect(fetchBody()).not.toHaveProperty("quoteId");
    expect(fetchBody()).not.toHaveProperty("paymentMethod");
  });

  // @rule POO-1132: a bad input fails locally, so a malformed signature never reaches the backend's
  // replay check.
  it("refuses a non-hex signature locally, with no network call", async () => {
    const result = await createOnRampRequestAction({ ...requestInput, signature: "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ONRAMP_INVALID_REQUEST");
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  // @rule POO-1132: no `requestId` means no widget to open, so an empty body is SCHEMA_MISMATCH.
  it("treats an empty (204) request-id body as SCHEMA_MISMATCH", async () => {
    mocks.apiFetch.mockResolvedValue(null);
    const result = await createOnRampRequestAction({ ...requestInput, signature: "0xdeadbeef00" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SCHEMA_MISMATCH");
  });

  // @rule POO-1132: double-submit dedupe. `apiFetch` retries only GETs and this is a POST, so a
  // rapid resubmit of the SAME signed request has to coalesce instead of creating two purchases.
  it("coalesces a double-submitted identical request into ONE upstream POST", async () => {
    const d = deferred<{ requestId: string }>();
    mocks.apiFetch.mockReturnValue(d.promise);

    const p1 = createOnRampRequestAction(requestInput);
    const p2 = createOnRampRequestAction(requestInput);
    await flush();
    d.resolve({ requestId: "req_1" });
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    expect(r1).toEqual({ ok: true, requestId: "req_1" });
    expect(r2).toEqual(r1);
  });

  // @rule POO-1132: the dedupe is keyed on the signed request, so two genuine purchases stay two.
  it("does NOT coalesce two distinct signed requests", async () => {
    mocks.apiFetch.mockResolvedValue({ requestId: "req_1" });
    await createOnRampRequestAction(requestInput);
    await createOnRampRequestAction({ ...requestInput, signature: "0xfeed" });
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
  });

  // @rule POO-1132: the dedupe covers only in-flight calls, so a failed attempt stays retryable.
  it("lets a genuine retry through after the first attempt settles", async () => {
    mocks.apiFetch.mockRejectedValueOnce(new ApiError(503, "SYSTEM_UNAVAILABLE", "down"));
    const first = await createOnRampRequestAction(requestInput);
    expect(first.ok).toBe(false);

    mocks.apiFetch.mockResolvedValueOnce({ requestId: "req_2" });
    const second = await createOnRampRequestAction(requestInput);
    expect(second).toEqual({ ok: true, requestId: "req_2" });
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
  });

  // @rule POO-1132: the house error contract again, on a code the picker must explain to the user.
  it("maps an upstream ApiError to its code verbatim", async () => {
    mocks.apiFetch.mockRejectedValue(
      new ApiError(400, "PAYBIS_BAD_SIGNATURE", "invalid signature"),
    );
    const result = await createOnRampRequestAction(requestInput);
    expect(result).toEqual({
      ok: false,
      code: "PAYBIS_BAD_SIGNATURE",
      message: "invalid signature",
    });
  });
});

const rawMethods = [
  {
    paymentMethod: "poolparty-credit-card",
    displayName: "Credit Card",
    id: "cc_001",
    name: "Visa/Mastercard",
    icon: "https://example.com/cc.png",
    minAmount: { amount: "10.00", currencyCode: "USD" },
    maxAmount: { amount: "10000.00", currencyCode: "USD" },
    fees: { amount: "2.50", isPercent: false },
    labels: ["popular"],
  },
];

describe("getOnRampPaymentMethodsAction (POO-1153)", () => {
  // @rule POO-1153: wallet-gated like the quote — an anonymous visitor cannot spend the rate-limited
  // upstream quota, and the refusal is a code, not a throw.
  it("returns SESSION_MISSING without hitting the network when not signed in", async () => {
    mocks.wallet = null;
    const result = await getOnRampPaymentMethodsAction({ currencyCodeTo: "USDC-BASE" });
    expect(result).toEqual({ ok: false, code: "SESSION_MISSING", message: expect.any(String) });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  // @rule POO-1153: GETs the pair as query params (no `/api/v1` in the path) and returns the methods
  // normalized.
  // @rule POO-1512: `currencyCodeFrom` is passed explicitly so this case tests the request builder
  // alone; omitting it now resolves the buyer's currency first (covered separately below).
  it("GETs on-ramp/payment-methods for the pair and returns normalized methods", async () => {
    mocks.apiFetch.mockResolvedValue(rawMethods);
    const result = await getOnRampPaymentMethodsAction({
      currencyCodeTo: "USDC-BASE",
      currencyCodeFrom: "USD",
    });

    expect(fetchPath()).toBe("on-ramp/payment-methods?currencyFrom=USD&currencyTo=USDC-BASE");
    // GET (no explicit method), and cached so repeated gate opens do not hit the rate limit.
    expect(fetchOptions().method).toBeUndefined();
    expect(fetchOptions().revalidate).toBe(300);
    expect(result).toEqual({
      ok: true,
      // POO-1512: the fiat the list was actually fetched for, echoed so a follow-up quote can pin the
      // SAME currency (one resolution per flow).
      currencyCodeFrom: "USD",
      // POO-1603: the vendor's `labels`, `icon` and `maxAmount` reach the caller through the ACTION's
      // normalizer. `apiFetch` is MOCKED in this suite (see this file's header), so the response
      // schema does not run here and this asserts the normalizer + the action's result shape only.
      // That the three fields survive the PARSE, which is the half of the defect that discarded them
      // on arrival, is covered by the composed schema-then-normalizer assertion in `schemas.test.ts`.
      // `fees`, `id` and `name` are still stripped, deliberately ([R6]).
      methods: [
        {
          paymentMethod: "poolparty-credit-card",
          displayName: "Credit Card",
          minUsd: 10,
          minCurrencyCode: "USD",
          labels: ["popular"],
          icon: "https://example.com/cc.png",
          maxUsd: 10000,
          maxCurrencyCode: "USD",
        },
      ],
    });
  });

  // @rule POO-1153: the graceful-degradation source. A pair Paybis will not sell 404s, and the action
  // returns that as a typed failure the caller falls back on, never a throw across the RSC boundary.
  // POO-1626: the sandbox's missing `USDC-BASE` pair used to be cited here as the everyday instance
  // of this. POO-1605 removed it, by mapping our production codes onto sandbox ones inside
  // pool-party-api, so that is no longer what this fixture describes.
  // @rule POO-1629 [R1]/[R3]: the code is `ONRAMP_PAIR_UNAVAILABLE` at HTTP 404, which is what pp-api
  // actually sends since POO-1619 (`throwIfPairUnavailable`, api `13c4c5b`). This fixture used to
  // carry a vendor-named invention that no API has ever sent and that appears in no error catalog:
  // pp-api's codes are domain-grouped, never vendor-named, and are a stable contract that is never
  // renamed. [R4] retires that string outright, which is why it is not quoted here. The 404 stays, so
  // this describes the real wire end to end rather than a plausible-looking guess.
  // Scope, rules v2 [R5]: this is the PAYMENT-METHODS read, the only path that reaches
  // `throwIfPairUnavailable` and therefore the only one that can answer this code. A quote refusal is
  // `ONRAMP_UPSTREAM_REJECTED` (422) via `asQuoteFailure`, deliberately, so do not align the two.
  it("maps a 404 unsupported-pair ApiError to its code verbatim, without throwing", async () => {
    mocks.apiFetch.mockRejectedValue(new ApiError(404, "ONRAMP_PAIR_UNAVAILABLE", "no such pair"));
    const result = await getOnRampPaymentMethodsAction({ currencyCodeTo: "USDC-BASE" });
    expect(result).toEqual({
      ok: false,
      code: "ONRAMP_PAIR_UNAVAILABLE",
      message: "no such pair",
    });
  });

  // @rule POO-1153: contract drift surfaces as SCHEMA_MISMATCH, not a plausible-but-wrong list.
  it("maps a response contract drift to SCHEMA_MISMATCH", async () => {
    mocks.apiFetch.mockRejectedValue(new ApiParseError("bad shape", []));
    const result = await getOnRampPaymentMethodsAction({ currencyCodeTo: "USDC-BASE" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SCHEMA_MISMATCH");
  });

  // @rule POO-1153: an empty (204) body is drift too — there is no list to normalize.
  it("treats an empty (204) body as SCHEMA_MISMATCH", async () => {
    mocks.apiFetch.mockResolvedValue(null);
    const result = await getOnRampPaymentMethodsAction({ currencyCodeTo: "USDC-BASE" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SCHEMA_MISMATCH");
  });
});

/**
 * A `currency-pairs-to-buy` payload in the shape the endpoint ACTUALLY returns (POO-1601): an array of
 * payment-method GROUPS, each carrying its own `pairs`, the fiat on `from` and the network-qualified
 * crypto on `to[].currencyCode` beside the bare `currency`.
 *
 * Built by one helper rather than repeated as literals, because the literal that used to sit in this
 * file described a FLAT shape the endpoint has never sent, and it passed for five days while
 * production billed every buyer in USD. `apiFetch` is mocked here, so the schema never runs and only
 * the shape matters; the schema itself is pinned against the committed capture in
 * `currencyPairs.test.ts`.
 */
function pairsPayload(fiatsByMethod: Record<string, readonly string[]>): unknown {
  return Object.entries(fiatsByMethod).map(([name, fiats]) => ({
    name,
    displayName: name,
    pairs: fiats.map((from) => ({
      from,
      to: [{ currency: "USDC", currencyCode: "USDC-BASE" }],
    })),
  }));
}

/**
 * POO-1512 [R1]/[R2]/[R3]/[R4]/[R6]: the currency the buyer is CHARGED in, resolved server-side when
 * the caller does not override it.
 *
 * These assert the currency that reaches the WIRE, not the resolver's internals (it has its own
 * suite). The wire is the point: `currencyFrom` is what decides which payment methods Paybis offers,
 * so a European seeing SEPA depends on this exact query string.
 */
describe("buyer currency resolution (POO-1512)", () => {
  /** Serve the pairs read its own payload and everything else the caller's, keyed on the path. */
  function routeApiFetch(pairs: unknown, other: unknown): void {
    mocks.apiFetch.mockImplementation(async (path: string) =>
      path.startsWith("on-ramp/currency-pairs-to-buy") ? pairs : other,
    );
  }

  /** USD and EUR on the card rail, BRL only on Pix: a union across groups, as the live payload is. */
  const PAIRS = pairsPayload({
    "poolparty-credit-card": ["USD", "EUR"],
    poolparty_bridgerpay_directa24_pix: ["BRL"],
  });

  beforeEach(() => {
    mocks.wallet = SESSION_WALLET;
    mocks.profileCountry = "";
    mocks.requestHeaders = { "x-forwarded-for": "198.51.100.4" };
  });

  it("[R1] lists payment methods in the buyer's own currency, not USD", async () => {
    // The reported defect at the exact call that caused it: a buyer in Portugal was sent
    // `currencyFrom=USD`, so Paybis was asked which methods serve a DOLLAR purchase and SEPA was
    // never among them.
    mocks.requestHeaders["cloudfront-viewer-country"] = "PT";
    routeApiFetch(PAIRS, rawMethods);

    await getOnRampPaymentMethodsAction({ currencyCodeTo: "USDC-BASE" });

    expect(fetchPath(1)).toBe("on-ramp/payment-methods?currencyFrom=EUR&currencyTo=USDC-BASE");
  });

  it("[R1] quotes in the buyer's own currency", async () => {
    mocks.requestHeaders["cloudfront-viewer-country"] = "PT";
    routeApiFetch(PAIRS, rawQuote);

    await getOnRampQuoteAction({
      currencyCodeTo: "USDC-BASE",
      amount: 100,
      paymentMethod: "credit_card",
      direction: "receive",
    });

    expect(fetchBody(1)).toMatchObject({ currencyCodeFrom: "EUR" });
  });

  it("[R2] falls through to the profile country when the edge header is absent", async () => {
    // The state prod is in until `cloudfront-viewer-country` is added to the origin-request-policy,
    // and the permanent state anywhere not behind CloudFront.
    // "Brazil", not "BR": `profile.country` stores an ISO 3166 common NAME (`lib/data/countries.ts`).
    // BRL is sold by the Pix group ALONE in this payload, so this also proves POO-1601 [R2]: a fiat
    // that no card rail carries still reaches the wire.
    mocks.profileCountry = "Brazil";
    routeApiFetch(PAIRS, rawMethods);

    await getOnRampPaymentMethodsAction({ currencyCodeTo: "USDC-BASE" });

    expect(fetchPath(1)).toContain("currencyFrom=BRL");
  });

  it("[R2] prefers where the buyer IS over where they say they live", async () => {
    // The reporter's own case: a Brazilian profile, physically in Europe, holding a euro card.
    mocks.requestHeaders["cloudfront-viewer-country"] = "DE";
    mocks.profileCountry = "Brazil";
    routeApiFetch(PAIRS, rawMethods);

    await getOnRampPaymentMethodsAction({ currencyCodeTo: "USDC-BASE" });

    expect(fetchPath(1)).toContain("currencyFrom=EUR");
  });

  it("[R4] degrades to USD when the supported set cannot be read, and still lists methods", async () => {
    mocks.requestHeaders["cloudfront-viewer-country"] = "PT";
    mocks.apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith("on-ramp/currency-pairs-to-buy")) throw new Error("upstream down");
      return rawMethods;
    });

    const result = await getOnRampPaymentMethodsAction({ currencyCodeTo: "USDC-BASE" });

    // Degrades to the pre-POO-1512 behaviour rather than failing the purchase.
    expect(fetchPath(1)).toContain("currencyFrom=USD");
    expect(result.ok).toBe(true);
  });

  it("[R3] never sends a currency Paybis does not sell the pair for", async () => {
    // Japan maps to JPY. With JPY absent from the pairs, sending it would produce a dead quote.
    mocks.requestHeaders["cloudfront-viewer-country"] = "JP";
    routeApiFetch(PAIRS, rawMethods);

    await getOnRampPaymentMethodsAction({ currencyCodeTo: "USDC-BASE" });

    expect(fetchPath(1)).toContain("currencyFrom=USD");
  });

  it("[R6] an explicit currency overrides the chain and skips the resolution entirely", async () => {
    // The spend-fixed leg. Its amount is USD-denominated, so resolving it to EUR would charge EUR 208
    // where 208 was computed as dollars. An override must not even READ the pairs endpoint.
    mocks.requestHeaders["cloudfront-viewer-country"] = "PT";
    routeApiFetch(PAIRS, rawQuote);

    await getOnRampQuoteAction({
      currencyCodeTo: "ETH-BASE",
      amount: 208,
      paymentMethod: "credit_card",
      currencyCodeFrom: "USD",
    });

    expect(fetchPath(0)).toBe("on-ramp/quote");
    expect(fetchBody(0)).toMatchObject({ currencyCodeFrom: "USD" });
  });
});

/**
 * POO-1573 [R4]: every on-ramp currency resolution EMITS its source.
 *
 * `resolveBuyerCurrency` has returned a `source` since POO-1512 and both call sites discarded it,
 * which is why the live report could not be told apart from a missing CloudFront header, a failed
 * pairs read, or a genuinely American buyer: all four produce the identical silent `USD`. The four
 * facts that separate them are emitted here, and a `fallback` on a request that DID carry a viewer
 * country is a degraded read, so it is LOUD (`logError` reaches Sentry; `logInfo` does not), on the
 * same split `onramp.client_ip_resolved` / `onramp.client_ip_edge_degraded` already uses.
 *
 * No country VALUE is logged, only whether each link of the chain was present: the four booleans
 * answer the diagnostic question and a viewer country is the user's location.
 */
describe("currency resolution observability (POO-1573 [R4], POO-1601 [R5]/[R6])", () => {
  const PAIRS = pairsPayload({ "poolparty-credit-card": ["USD", "EUR"] });

  function routeApiFetch(pairs: unknown, other: unknown): void {
    mocks.apiFetch.mockImplementation(async (path: string) =>
      path.startsWith("on-ramp/currency-pairs-to-buy") ? pairs : other,
    );
  }

  /** The fields of the first call to `logInfo`/`logError` carrying `event`. */
  function loggedFields(spy: typeof mocks.logInfo, event: string): Record<string, unknown> {
    const call = spy.mock.calls.find((entry) => entry[0] === event) as
      | [string, Record<string, unknown>]
      | undefined;
    if (!call) throw new Error(`no ${event} was logged`);
    return call[1];
  }

  beforeEach(() => {
    mocks.wallet = SESSION_WALLET;
    mocks.profileCountry = "";
    mocks.requestHeaders = { "x-forwarded-for": "198.51.100.4" };
  });

  it("[R4] reports the source of a resolved currency on the payment-methods call", async () => {
    mocks.requestHeaders["cloudfront-viewer-country"] = "PT";
    routeApiFetch(PAIRS, rawMethods);

    await getOnRampPaymentMethodsAction({ currencyCodeTo: "USDC-BASE" });

    expect(loggedFields(mocks.logInfo, "onramp.currency_resolved")).toMatchObject({
      source: "cloudfront-viewer-country",
      currency: "EUR",
      currencyCodeTo: "USDC-BASE",
      action: "payment-methods",
    });
    expect(mocks.logError).not.toHaveBeenCalledWith(
      "onramp.currency_resolution_degraded",
      expect.anything(),
    );
  });

  it("[R4] reports the source on the quote call too", async () => {
    mocks.profileCountry = "Portugal";
    routeApiFetch(PAIRS, rawQuote);

    await getOnRampQuoteAction({
      currencyCodeTo: "USDC-BASE",
      amount: 100,
      paymentMethod: "credit_card",
      direction: "receive",
    });

    expect(loggedFields(mocks.logInfo, "onramp.currency_resolved")).toMatchObject({
      source: "profile-country",
      currency: "EUR",
      action: "quote",
    });
  });

  it("[R4] a fallback on a request that DID carry a viewer country is LOUD", async () => {
    // Japan maps to JPY, which these pairs do not sell, so the walk ends on USD. The header arrived,
    // so this is a degraded answer and not an American buyer: exactly the distinction production
    // could not make.
    mocks.requestHeaders["cloudfront-viewer-country"] = "JP";
    routeApiFetch(PAIRS, rawMethods);

    await getOnRampPaymentMethodsAction({ currencyCodeTo: "USDC-BASE" });

    expect(loggedFields(mocks.logError, "onramp.currency_resolution_degraded")).toMatchObject({
      source: "fallback",
      currency: "USD",
      viewerCountry: "present",
      pairs: "read",
      // POO-1810 [R3]: the line NAMES the refused money. `pairs: "read"` says the set was there and
      // `rejected: "JPY"` says what it turned down, which together are the whole diagnosis of this
      // dollar charge. Without it the reader knows only that a Japanese buyer paid in dollars.
      rejected: "JPY",
    });
  });

  it("[R4] a failed pairs read is named as such rather than looking like a US buyer", async () => {
    mocks.requestHeaders["cloudfront-viewer-country"] = "PT";
    mocks.apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith("on-ramp/currency-pairs-to-buy")) throw new Error("upstream down");
      return rawMethods;
    });

    await getOnRampPaymentMethodsAction({ currencyCodeTo: "USDC-BASE" });

    expect(loggedFields(mocks.logError, "onramp.currency_resolution_degraded")).toMatchObject({
      source: "fallback",
      pairs: "unreadable",
      // POO-1810 [R3]: nothing was refused because there was no set to refuse against, and the
      // marker is what stops that reading as "Portugal was turned down".
      rejected: "none",
    });
  });

  it("[R4] a USD fallback with NO viewer country is reported quietly, not as a degrade", async () => {
    // Local dev and anything not behind the edge. Nothing is wrong, so nothing is escalated; the
    // absence itself is still recorded, which is what tells the two apart.
    routeApiFetch(PAIRS, rawMethods);

    await getOnRampPaymentMethodsAction({ currencyCodeTo: "USDC-BASE" });

    expect(loggedFields(mocks.logInfo, "onramp.currency_resolved")).toMatchObject({
      source: "fallback",
      viewerCountry: "absent",
      profileCountry: "absent",
    });
    expect(mocks.logError).not.toHaveBeenCalledWith(
      "onramp.currency_resolution_degraded",
      expect.anything(),
    );
  });

  // POO-1618 defect 3 asked for this case to be REWRITTEN rather than kept, on the grounds that a
  // population where every flow is an override loses the currency signal entirely. It stays as it is
  // because that population never arrives: the BUYER's choice travels on `proposedCurrencyCodeFrom`
  // and is reported both ways (see the POO-1618 [R2] suite below), while `currencyCodeFrom` is the
  // app's own pin and resolving it again is the second resolution [R4] forbids. Nothing resolved
  // here, so there is nothing to report, and the blind spot is closed on the field that carries the
  // buyers rather than by making a pin talk about a walk it never took.
  it("[R4] an explicit override resolves nothing, so it reports nothing", async () => {
    mocks.requestHeaders["cloudfront-viewer-country"] = "PT";
    routeApiFetch(PAIRS, rawQuote);

    await getOnRampQuoteAction({ ...quoteInput, currencyCodeFrom: "USD" });

    expect(mocks.logInfo).not.toHaveBeenCalledWith("onramp.currency_resolved", expect.anything());
  });

  /** Make the pairs read fail with `error` and serve everything else the method list. */
  function failPairsWith(error: unknown): void {
    mocks.apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith("on-ramp/currency-pairs-to-buy")) throw error;
      return rawMethods;
    });
  }

  it("[R5] names a CONTRACT DRIFT on the pairs read, and the field that drifted", async () => {
    // A REAL zod failure from the real schema, fed the exact flat payload POO-1512 was built against.
    // That failure was thrown on every request for five days and `catch { return null }` ate it.
    const drift = onRampCurrencyPairsResponseSchema.safeParse([
      { from: "USD", to: [{ currency: "USDC", currencyCode: "USDC-BASE" }] },
    ]);
    if (drift.success) throw new Error("the flat shape must not parse; see POO-1601");
    mocks.requestHeaders["cloudfront-viewer-country"] = "PT";
    failPairsWith(new ApiParseError("validation failed", drift.error.issues, "req_pairs_1"));

    await getOnRampPaymentMethodsAction({ currencyCodeTo: "USDC-BASE" });

    const fields = loggedFields(mocks.logError, "onramp.currency_pairs_unreadable");
    expect(fields).toMatchObject({
      action: "payment-methods",
      currencyCodeTo: "USDC-BASE",
      failure: "contract-drift",
      requestId: "req_pairs_1",
    });
    // `summarizeZodIssues` (the same summariser both api clients use) reports objects, not a joined
    // string. The drifted PATH is still the whole point: `0.pairs` is what says "wrong nesting level".
    expect(fields.issues).toContainEqual(expect.objectContaining({ path: "0.pairs" }));
  });

  it("[R5] an upstream OUTAGE is reported as upstream, not as drift", async () => {
    // A 500 and a schema mismatch both ended as `pairs: "unreadable"`, so the one that means
    // "ship a fix" was indistinguishable from the one that means "wait".
    mocks.requestHeaders["cloudfront-viewer-country"] = "PT";
    failPairsWith(new ApiError(500, "SYSTEM_UPSTREAM_ERROR", "boom", "req_pairs_2"));

    await getOnRampPaymentMethodsAction({ currencyCodeTo: "USDC-BASE" });

    expect(loggedFields(mocks.logError, "onramp.currency_pairs_unreadable")).toMatchObject({
      failure: "upstream",
      status: 500,
      code: "SYSTEM_UPSTREAM_ERROR",
      requestId: "req_pairs_2",
    });
  });

  it("[R5] an EXPECTED non-outage degrades silently: mock mode and our own throttle", async () => {
    // This used to assert the 429 was reported. It must not be. `isExpectedNonOutage` is the repo-wide
    // rule (`observeCatalogDegrade.ts:62` opens with the identical line) and both of these are in it.
    // `SYSTEM_NOT_CONFIGURED` is what `apiFetch` throws with `PP_API_URL`/`PP_API_KEY` unset, which is
    // this repo's DEFAULT state, so without the guard every buy-panel open in local dev files a Sentry
    // issue for a non-failure; a 429 is our own per-API-key throttle, where the report volume scales
    // with the problem instead of describing it. The degrade itself is unchanged: still `null`, still
    // recorded as `pairs: "unreadable"`, still a completed purchase in USD.
    for (const expected of [
      new ApiError(503, "SYSTEM_NOT_CONFIGURED", "PP_API_URL or PP_API_KEY is not set"),
      new ApiError(429, "SYSTEM_RATE_LIMITED", "slow down", "req_pairs_3"),
    ]) {
      mocks.logError.mockClear();
      mocks.requestHeaders["cloudfront-viewer-country"] = "PT";
      failPairsWith(expected);

      const result = await getOnRampPaymentMethodsAction({ currencyCodeTo: "USDC-BASE" });

      expect(mocks.logError).not.toHaveBeenCalledWith(
        "onramp.currency_pairs_unreadable",
        expect.anything(),
      );
      expect(loggedFields(mocks.logError, "onramp.currency_resolution_degraded")).toMatchObject({
        pairs: "unreadable",
      });
      expect(result.ok).toBe(true);
    }
  });

  it("[R5] anything else is reported without being classified as either", async () => {
    mocks.requestHeaders["cloudfront-viewer-country"] = "PT";
    failPairsWith(new Error("socket hang up"));

    await getOnRampPaymentMethodsAction({ currencyCodeTo: "USDC-BASE" });

    expect(loggedFields(mocks.logError, "onramp.currency_pairs_unreadable")).toMatchObject({
      failure: "unknown",
      detail: "socket hang up",
    });
  });

  it("[R5] the purchase still proceeds in USD: reporting is not blocking", async () => {
    // [R4] of POO-1512 is untouched. The report is added BESIDE the degrade, never in place of it.
    mocks.requestHeaders["cloudfront-viewer-country"] = "PT";
    failPairsWith(new Error("socket hang up"));

    const result = await getOnRampPaymentMethodsAction({ currencyCodeTo: "USDC-BASE" });

    expect(result.ok).toBe(true);
    expect(fetchPath(1)).toContain("currencyFrom=USD");
  });

  it("[R6] tells an EMPTY supported set apart from an unreadable one", async () => {
    // The read succeeded and Paybis sells this pair to nobody. Same USD answer, opposite diagnosis:
    // nothing to fix here, whereas `unreadable` is a live defect. They were the same log line.
    mocks.requestHeaders["cloudfront-viewer-country"] = "PT";
    routeApiFetch(pairsPayload({ "poolparty-credit-card": [] }), rawMethods);

    await getOnRampPaymentMethodsAction({ currencyCodeTo: "USDC-BASE" });

    expect(loggedFields(mocks.logError, "onramp.currency_resolution_degraded")).toMatchObject({
      source: "fallback",
      pairs: "empty",
    });
    expect(mocks.logError).not.toHaveBeenCalledWith(
      "onramp.currency_pairs_unreadable",
      expect.anything(),
    );
  });
});

/**
 * POO-1573 [R1]/[R3]/[R5]: the ETH target the gas-first leg is quoted received-fixed against.
 *
 * The price is read HERE and not in the browser for the same reason the buyer's currency is: this is
 * the `"use server"` boundary, and `apiFetch` carries `PP_API_KEY`. It replaces the balance ratio the
 * plan path derives (`native.usd / native.amount`), which is exactly 0 for a wallet holding no ETH,
 * i.e. the only wallet this leg ever serves.
 */
describe("getOnRampEthTargetAction (POO-1573)", () => {
  beforeEach(() => {
    mocks.wallet = SESSION_WALLET;
    mocks.apiFetch.mockResolvedValue([
      { address: "0x4200000000000000000000000000000000000006", usd: "2500", derivedNative: "1" },
    ]);
  });

  // @rule POO-1573 [R1]: the recipe resolves to a crypto figure the mint quotes received-fixed with.
  it("resolves the recipe against a real ETH price", async () => {
    const result = await getOnRampEthTargetAction({ gasFloorEth: "0.001", fundingUsd: "50.00" });

    expect(result).toEqual({ ok: true, ethAmount: "0.021" });
  });

  // @rule the folder contract: wallet-gated like the quote beside it, so an anonymous visitor cannot
  // spend our rate-limited, key-authenticated upstream quota.
  it("refuses without a SIWE session and never reaches the network", async () => {
    mocks.wallet = null;

    const result = await getOnRampEthTargetAction({ gasFloorEth: "0.001", fundingUsd: "50.00" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SESSION_MISSING");
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  // @rule the folder contract: a request we refuse to send fails locally with a reason, never as a
  // puzzling upstream 400.
  it("refuses a malformed recipe locally", async () => {
    const result = await getOnRampEthTargetAction({
      gasFloorEth: "nope",
      fundingUsd: "50.00",
    } as never);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ONRAMP_INVALID_REQUEST");
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  // @rule POO-1573 [R5]: a failed price read costs precision, never the purchase. The action answers
  // a typed failure and the caller falls back to the shipped spend-fixed leg.
  it("answers a typed failure when ETH cannot be priced, and never throws", async () => {
    mocks.apiFetch.mockRejectedValue(new ApiError(503, "UPSTREAM", "prices down"));

    const result = await getOnRampEthTargetAction({ gasFloorEth: "0.001", fundingUsd: "50.00" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ONRAMP_ETH_PRICE_UNAVAILABLE");
  });
});

/**
 * POO-1618 [R2] (decided on POO-1576, 2026-08-14): the browser PROPOSES a charge currency and the
 * server DISPOSES.
 *
 * `resolveOnRampCurrency.ts`'s header refuses a browser-supplied currency in as many words ("a
 * currency passed up from the browser would be caller-controlled input on a money path"). The
 * selector that POO-1576 ships does not change that rule, it satisfies it: a chosen code arrives on
 * its OWN field, is checked against the supported set the resolver already reads, and falls back to
 * the resolved default when the set does not contain it. Nothing unchecked reaches the query string
 * that decides which methods a buyer is offered.
 *
 * The proposal is validated on the METHODS call and NOWHERE ELSE, which is POO-1618 [R4] (one
 * resolution per flow). The quote pins the currency this call ECHOES, so a cache expiry between the
 * two can never list EUR methods and price a USD purchase.
 */
describe("the buyer's currency proposal (POO-1618 [R2], POO-1576)", () => {
  const PAIRS = pairsPayload({
    "poolparty-credit-card": ["USD", "EUR"],
    poolparty_bridgerpay_directa24_pix: ["BRL"],
  });

  function routeApiFetch(pairs: unknown, other: unknown): void {
    mocks.apiFetch.mockImplementation(async (path: string) =>
      path.startsWith("on-ramp/currency-pairs-to-buy") ? pairs : other,
    );
  }

  function loggedFields(spy: typeof mocks.logInfo, event: string): Record<string, unknown> {
    const call = spy.mock.calls.find((entry) => entry[0] === event) as
      | [string, Record<string, unknown>]
      | undefined;
    if (!call) throw new Error(`no ${event} was logged`);
    return call[1];
  }

  beforeEach(() => {
    mocks.wallet = SESSION_WALLET;
    mocks.profileCountry = "";
    mocks.requestHeaders = { "x-forwarded-for": "198.51.100.4" };
  });

  // @rule [R2] a supported proposal is honoured, and it is what the LIST is fetched by: that query
  // string is the whole feature (Pix exists on BRL and on nothing else).
  it("[R2] fetches the list in a supported proposed currency", async () => {
    routeApiFetch(PAIRS, rawMethods);

    const result = await getOnRampPaymentMethodsAction({
      currencyCodeTo: "USDC-BASE",
      proposedCurrencyCodeFrom: "BRL",
    });

    expect(fetchPath(1)).toBe("on-ramp/payment-methods?currencyFrom=BRL&currencyTo=USDC-BASE");
    expect(result.ok && result.currencyCodeFrom).toBe("BRL");
  });

  // @rule [R2] ISO-4217 is canonically upper case and the wire is not guaranteed to be, so a code is
  // compared in its normalized form rather than refused for its casing.
  it("[R2] normalizes the proposal before comparing it", async () => {
    routeApiFetch(PAIRS, rawMethods);

    const result = await getOnRampPaymentMethodsAction({
      currencyCodeTo: "USDC-BASE",
      proposedCurrencyCodeFrom: " eur ",
    });

    expect(fetchPath(1)).toContain("currencyFrom=EUR");
    expect(result.ok && result.currencyCodeFrom).toBe("EUR");
  });

  // @rule [R2] the rejection: an unsupported code falls back to the RESOLVED default and never
  // reaches Paybis. The buyer in Portugal keeps the euro list rather than being sent to a dead pair.
  it("[R2] falls back to the resolved default when the set does not contain the proposal", async () => {
    mocks.requestHeaders["cloudfront-viewer-country"] = "PT";
    routeApiFetch(PAIRS, rawMethods);

    const result = await getOnRampPaymentMethodsAction({
      currencyCodeTo: "USDC-BASE",
      proposedCurrencyCodeFrom: "JPY",
    });

    expect(fetchPath(1)).toContain("currencyFrom=EUR");
    expect(result.ok && result.currencyCodeFrom).toBe("EUR");
  });

  // @rule [R2] anything that is not an ISO-4217 alpha code is unrecognised, which is the same answer
  // as unsupported. The value is interpolated into a query string, so this is the trust boundary.
  it.each([
    "US",
    "USDC-BASE",
    "US D",
    "'; DROP",
    "",
  ])("[R2] refuses %j as a currency and uses the resolved default", async (proposal) => {
    routeApiFetch(PAIRS, rawMethods);

    await getOnRampPaymentMethodsAction({
      currencyCodeTo: "USDC-BASE",
      proposedCurrencyCodeFrom: proposal,
    });

    expect(fetchPath(1)).toContain("currencyFrom=USD");
  });

  // @rule [R2] with no readable set nothing is supported, so a proposal cannot be honoured either.
  // The pairs read is the ONLY check there is; honouring the choice would be honouring it unchecked.
  it("[R2] refuses every proposal while the supported set is unreadable", async () => {
    mocks.apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith("on-ramp/currency-pairs-to-buy")) throw new Error("upstream down");
      return rawMethods;
    });

    await getOnRampPaymentMethodsAction({
      currencyCodeTo: "USDC-BASE",
      proposedCurrencyCodeFrom: "EUR",
    });

    expect(fetchPath(1)).toContain("currencyFrom=USD");
  });

  // @rule POO-1618 defect 3: an override used to silence the currency telemetry, and a passing test
  // pinned that silence. A rejected choice is a money decision the product made for the buyer, so it
  // is REPORTED rather than swallowed.
  it("[R2] reports a rejected proposal, naming what was asked for and what was used", async () => {
    mocks.requestHeaders["cloudfront-viewer-country"] = "PT";
    routeApiFetch(PAIRS, rawMethods);

    await getOnRampPaymentMethodsAction({
      currencyCodeTo: "USDC-BASE",
      proposedCurrencyCodeFrom: "JPY",
    });

    expect(loggedFields(mocks.logError, "onramp.currency_override_rejected")).toMatchObject({
      action: "payment-methods",
      proposed: "JPY",
      currency: "EUR",
      currencyCodeTo: "USDC-BASE",
    });
  });

  // @rule POO-1618 defect 3, the other half: an ACCEPTED proposal reports too, on the existing
  // resolution line, so the population-wide currency signal survives a flow where every buyer
  // overrides.
  it("[R2] reports an accepted proposal as the source of the answer", async () => {
    routeApiFetch(PAIRS, rawMethods);

    await getOnRampPaymentMethodsAction({
      currencyCodeTo: "USDC-BASE",
      proposedCurrencyCodeFrom: "BRL",
    });

    expect(loggedFields(mocks.logInfo, "onramp.currency_resolved")).toMatchObject({
      source: "buyer-override",
      currency: "BRL",
    });
  });

  // @rule POO-1618 [R5]: the SPEND-fixed leg pins `order.fiatCurrency` through `currencyCodeFrom`,
  // and that pin is not a proposal. It must keep short-circuiting the resolution entirely, or a
  // USD-denominated figure gets billed as euros.
  it("[R5] an explicit currencyCodeFrom still wins, and still resolves nothing", async () => {
    mocks.requestHeaders["cloudfront-viewer-country"] = "PT";
    routeApiFetch(PAIRS, rawMethods);

    await getOnRampPaymentMethodsAction({
      currencyCodeTo: "USDC-BASE",
      currencyCodeFrom: "USD",
      proposedCurrencyCodeFrom: "EUR",
    });

    expect(fetchPath(0)).toBe("on-ramp/payment-methods?currencyFrom=USD&currencyTo=USDC-BASE");
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
  });
});

/**
 * POO-1621 / POO-1630: the supported fiat set never left the server, so a currency Select had
 * nothing to list.
 *
 * `supportedFiatFor` is computed inside `resolveOnRampCurrency`, which is `server-only`, and only the
 * single RESOLVED code was ever echoed. Hardcoding the list in the client was rejected on POO-1621:
 * the set is the vendor's, it is per pair, and it changes without notice, which is the same defect
 * POO-1513 deleted (a four-value union that offered Pix to a European).
 */
describe("getOnRampSupportedCurrenciesAction (POO-1621)", () => {
  const PAIRS = pairsPayload({
    "poolparty-credit-card": ["USD", "EUR"],
    poolparty_bridgerpay_directa24_pix: ["BRL"],
    poolparty_bridgerpay_astropay: ["EUR", "BRL"],
  });

  beforeEach(() => {
    mocks.wallet = SESSION_WALLET;
  });

  // @rule the UNION across every payment-method group, which is what `supportedFiatFor` computes:
  // a fiat reachable through exactly one rail is still a fiat the buyer can pay in.
  it("returns every fiat that can buy the pair, sorted and de-duplicated", async () => {
    mocks.apiFetch.mockResolvedValue(PAIRS);

    const result = await getOnRampSupportedCurrenciesAction({ currencyCodeTo: "USDC-BASE" });

    expect(result).toEqual({ ok: true, currencies: ["BRL", "EUR", "USD"] });
  });

  // @rule the folder contract: wallet-gated like every other action here, because it spends our
  // rate-limited, key-authenticated upstream quota.
  it("returns SESSION_MISSING without hitting the network when not signed in", async () => {
    mocks.wallet = null;

    const result = await getOnRampSupportedCurrenciesAction({ currencyCodeTo: "USDC-BASE" });

    expect(result.ok).toBe(false);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  // @rule POO-1630: an unreadable set is a typed failure and NOT an empty list. A Select rendered
  // over an empty answer is a control that lies; the caller degrades to the read-only statement.
  it("answers a typed failure when the set cannot be read", async () => {
    mocks.apiFetch.mockRejectedValue(new ApiError(503, "UPSTREAM", "pairs down"));

    const result = await getOnRampSupportedCurrenciesAction({ currencyCodeTo: "USDC-BASE" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ONRAMP_CURRENCIES_UNAVAILABLE");
  });
});
