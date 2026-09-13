/**
 * @id PP-CORE-LIB-096 (POO-1797) - tests
 * @name on-ramp buyer-currency resolver (server) - tests
 * @implements-rules-version v1 (POO-1797 rules v1)
 * @analytics-events none, the resolver emits STRUCTURED LOG events (`onramp.currency_*`), which reach
 *   Sentry through `logger.ts` and are asserted below. It fires no GA4/dataLayer event: it runs inside
 *   the `"use server"` boundary, where no analytics client exists and no user gesture to attribute.
 *
 * `resolveOnRampCurrency.ts` was the only module in `src/lib/onramp/` with no test, and it is about to
 * be rewritten onto the Privy rail (POO-1793). This file exists so the rewrite INHERITS the rules
 * rather than rediscovering them, and so the one rule the current code breaks is written down before
 * the code that breaks it is gone.
 *
 * ## One test here is committed RED, on purpose
 *
 * [R1]'s reporting half is an `it.fails`; its degrade half is a plain `it()` beside it, because
 * `it.fails` inverts the whole test and would swallow a broken degrade asserted inside it.
 * `readSupportedFiat` asks `isExpectedNonOutage(error)` FIRST, and `expectedFailure.ts:47` answers
 * `true` for `status === 404`, so a 404 on
 * `on-ramp/currency-pairs-to-buy` returns `null` before the `logError` can fire: every buyer is
 * charged USD and nothing reaches an alert. The block above that test says what must change for it to
 * pass, and what to do the day it starts failing.
 *
 * Everything else is GREEN against the shipped module and must stay green: [R2] to [R5] are the
 * behaviour the rewrite is not allowed to drop quietly.
 *
 * ## Whose rules the tags below are
 *
 * `[R1]` is POO-1797's own rule. `[R2]` to `[R5]` are the SHIPPED MODULE's rules, carried over from
 * the issues that wrote them (POO-1512 [R4], the degrade that never blocks a purchase; POO-1601
 * [R5]/[R6], outage-only reporting and the `unreadable` / `empty` split; POO-1618 [R2], the classes
 * that stay silent), so the rewrite can be diffed against them by tag. POO-1797's own [R2] ("the
 * resolver's degrade path is asserted directly, not through the actions that happen to call it") has
 * no `it()` of its own: it is satisfied by this file existing as a direct unit suite on
 * `readSupportedFiat` and `resolveOnRampCurrency`, rather than reaching them through
 * `onRampActions.test.ts`.
 *
 * ## What is mocked, and what deliberately is not
 *
 * Only the SINKS are replaced. `isExpectedNonOutage` (the repo-wide suppression rule that PRODUCES the
 * defect) and `summarizeZodIssues` (the shared issue masker) come from the real module, because they
 * are precisely what is under test. Errors are built with the real `ApiError` / `ApiParseError`
 * classes so their shape matches what `apiFetch` actually throws, and the drifted-response issues are
 * produced by running the real schema against the real POO-1601 payload shape rather than hand-written.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodIssue } from "zod";
import { ApiError, ApiParseError } from "@/lib/api/errors";
import type { LoggedZodIssue } from "@/lib/observability/logger";
import { onRampCurrencyPairsResponseSchema } from "./currencyPairs";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  /** Request headers the resolver reads for `cloudfront-viewer-country`. Absent by default, as off the edge. */
  requestHeaders: {} as Record<string, string>,
  /** `profile.country` (POO-675). Blank by default, as it is for most users. */
  profileCountry: "" as string,
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({ apiFetch: mocks.apiFetch }));
// Only the SINKS are replaced. `isExpectedNonOutage` and `summarizeZodIssues` are pure and are what
// this suite exists to pin, so they come from the real module.
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

import capture from "./fixtures/currencyPairsToBuy.dev.capture.json";
import { readSupportedFiat, resolveOnRampCurrency } from "./resolveOnRampCurrency";

/**
 * What `apiFetch` hands back: the recorded live response with our own `{ data }` envelope already
 * stripped (`client.ts` `maybeUnwrap`). The pairs schema is a record-of-unknown per group, so nothing
 * is dropped on the way through and the mock returns exactly what the real client would.
 */
const RECORDED: unknown = capture.data;

/** The testnet spelling of the bought pair, as the 2026-08-14 capture recorded it. */
const RECORDED_USDC = "USDC-SEPOLIA";

/**
 * Two groups, one fiat each, for the cases that need a set small enough to name. The group names are
 * the vendor's own, so the shape stays the shape `supportedFiatFor` reads in production.
 */
const EUR_AND_BRL_ONLY = [
  {
    name: "poolparty-credit-card",
    pairs: [{ from: "EUR", to: [{ currencyCode: RECORDED_USDC }] }],
  },
  {
    name: "poolparty_bridgerpay_directa24_pix",
    pairs: [{ from: "BRL", to: [{ currencyCode: RECORDED_USDC }] }],
  },
];

/** The POO-1601 drift itself: the flat `[{ from, to }]` shape, with the group nesting gone. */
const FLAT_POO_1601_SHAPE = [{ from: "BRL", to: [{ currencyCode: RECORDED_USDC }] }];

/**
 * Real zod issues for that drift, from the real schema. Hand-writing them would assert the masker
 * against a belief about zod rather than against zod, and `0.pairs` (the whole diagnosis, POO-1601)
 * is produced by the schema's re-pathing, not by this file.
 */
function driftIssues(): ZodIssue[] {
  const parsed = onRampCurrencyPairsResponseSchema.safeParse(FLAT_POO_1601_SHAPE);
  if (parsed.success) throw new Error("the POO-1601 flat shape must not parse");
  return parsed.error.issues;
}

/** The fields logged for `event`, or undefined when nothing emitted it. */
function loggedFields(
  spy: typeof mocks.logError,
  event: string,
): Record<string, unknown> | undefined {
  const call = spy.mock.calls.find(([name]) => name === event) as
    | [string, Record<string, unknown>]
    | undefined;
  return call?.[1];
}

/** Every event name that reached a sink, in order. Used to assert that nothing EXTRA was emitted. */
function emittedEvents(): string[] {
  return [...mocks.logError.mock.calls, ...mocks.logInfo.mock.calls].map(([name]) => String(name));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requestHeaders = {};
  mocks.profileCountry = "";
});

describe("readSupportedFiat", () => {
  /**
   * ## [R1] IS COMMITTED AS AN EXPECTED FAILURE. IT IS RED ON PURPOSE.
   *
   * **The rule.** A 404 from `apiFetch("on-ramp/currency-pairs-to-buy")` is an outage of the currency
   * contract, not an expected non-outage. `readSupportedFiat` must still return `null` (a failed read
   * never blocks a purchase, the module's [R4]) AND must call
   * `logError("onramp.currency_pairs_unreadable", ...)` with `failure: "upstream"` and `status: 404`.
   *
   * **Why it fails today.** `readSupportedFiat` asks `isExpectedNonOutage(error)` before it reports,
   * and `src/lib/observability/expectedFailure.ts:47` returns `true` for `status === 404` (it is
   * written for "the wallet has no data for this slice yet", which a missing currency contract is
   * not). So the catch returns `null` on line 178 and the `logError` on line 180 is never reached:
   * every buyer is charged USD, the resolver records `pairs: "unreadable"`, and NOTHING reaches an
   * alert. That is the five-day POO-1601 incident reachable a second way, and this test is the pin.
   *
   * **What must change for it to pass.** The resolver rewrite under the Privy rail (POO-1793) must
   * stop delegating this decision to the wallet-shaped 404 rule. Exactly two lines can carry that.
   * Option 1, local to this module (`resolveOnRampCurrency.ts:178`): report before the suppression
   * check, or narrow the check at that call site so that only `SYSTEM_NOT_CONFIGURED` and 429 stay
   * silent here ([R2]). Option 2, repo-wide (`expectedFailure.ts:47`): drop the blanket
   * `status === 404`. Option 2 also reds `src/lib/analytics/errorOrigin.test.ts:167`
   * (`expect(isExpectedNonOutage({ status: 404 })).toBe(true)`), which pins that clause as shared by
   * the log and the analytics rails, and that is why the local narrowing at the call site is the
   * expected fix. When that lands, PROMOTE this test: `it.fails` becomes `it`, and this block shrinks
   * to the rule.
   *
   * PP-DEBT(SEV:MED): promote this it.fails to it when the resolver is rewritten for the Privy rail; see POO-1797 [R1] and the follow-up issue POO-1797-followup.
   *
   * **If this test starts FAILING, do not "fix" it.** `it.fails` inverts the result, so red here means
   * the body PASSED, which means somebody fixed the defect. The correct response is to promote the
   * test, never to delete it or to loosen the assertion.
   */
  it.fails("[R1] a 404 on the pairs read reports the outage before it degrades", async () => {
    mocks.apiFetch.mockRejectedValueOnce(
      new ApiError(404, "NOT_FOUND", "Cannot GET /api/v1/on-ramp/currency-pairs-to-buy", "req-404"),
    );

    // ONE expectation, and it is the missing one: the line that says the buyer's currency was just
    // decided by a failure. The degrade this test does NOT object to is asserted below, outside the
    // inversion.
    await readSupportedFiat(RECORDED_USDC, "quote");

    expect(loggedFields(mocks.logError, "onramp.currency_pairs_unreadable")).toMatchObject({
      action: "quote",
      currencyCodeTo: RECORDED_USDC,
      failure: "upstream",
      status: 404,
    });
  });

  /**
   * The other half of [R1], and the reason the test above holds exactly one expectation. `it.fails`
   * inverts the WHOLE test and discards the reason (`@vitest/runner` `chunk-artifact.js:3038-3046`
   * sets `errors = undefined`), so a second assertion inside it is unverifiable: a rewrite that made
   * a 404 THROW instead of degrading would fail that assertion and the inverted test would still
   * report pass. The degrade is correct behaviour today and must survive the rewrite (POO-1512 [R4]:
   * a failed read never blocks a purchase), so it is asserted here, where red means red.
   *
   * Split precedent: `onRampActions.test.ts:1013`, where "the purchase still proceeds in USD" is its
   * own `it()` beside the reporting rule rather than a second expectation inside it.
   */
  it("[R1] a 404 still degrades to null, so a failed read never blocks a purchase", async () => {
    mocks.apiFetch.mockRejectedValueOnce(
      new ApiError(404, "NOT_FOUND", "Cannot GET /api/v1/on-ramp/currency-pairs-to-buy", "req-404"),
    );

    await expect(readSupportedFiat(RECORDED_USDC, "quote")).resolves.toBeNull();
  });

  it("[R2] mock mode degrades in silence", async () => {
    // `apiFetch` throws this whenever PP_API_URL/PP_API_KEY are unset, which is this repo's DEFAULT
    // state: reporting it would file a Sentry issue on every buy-panel open in local dev.
    mocks.apiFetch.mockRejectedValueOnce(
      new ApiError(503, "SYSTEM_NOT_CONFIGURED", "PP_API_URL or PP_API_KEY is not set"),
    );

    await expect(readSupportedFiat(RECORDED_USDC, "payment-methods")).resolves.toBeNull();
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("[R2] our own throttle degrades in silence", async () => {
    // A 429 is our per-API-key throttle answering. It is the one failure class where the volume of
    // reports scales with the problem instead of describing it.
    mocks.apiFetch.mockRejectedValueOnce(
      new ApiError(429, "SYSTEM_RATE_LIMITED", "Too many requests", "req-429"),
    );

    await expect(readSupportedFiat(RECORDED_USDC, "quote")).resolves.toBeNull();
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("[R3] a drifted response reports contract-drift and names the drifted path", async () => {
    mocks.apiFetch.mockRejectedValueOnce(
      new ApiParseError("Response validation failed", driftIssues(), "req-drift"),
    );

    await expect(readSupportedFiat(RECORDED_USDC, "quote")).resolves.toBeNull();

    const fields = loggedFields(mocks.logError, "onramp.currency_pairs_unreadable");
    expect(fields).toMatchObject({
      action: "quote",
      currencyCodeTo: RECORDED_USDC,
      failure: "contract-drift",
      code: "SYSTEM_PARSE_ERROR",
      requestId: "req-drift",
    });
    // `0.pairs` is the whole diagnosis: it is the difference between "the vendor changed" and "we
    // read the wrong nesting level", and it is what five days of `pairs: "unreadable"` could not say.
    expect((fields?.issues as LoggedZodIssue[]).map((issue) => issue.path)).toContain("0.pairs");
  });

  it("[R3] a 500 reports upstream with the status, code and request id", async () => {
    mocks.apiFetch.mockRejectedValueOnce(
      new ApiError(500, "SYSTEM_INTERNAL", "upstream exploded", "req-500"),
    );

    await expect(readSupportedFiat(RECORDED_USDC, "supported-currencies")).resolves.toBeNull();
    expect(loggedFields(mocks.logError, "onramp.currency_pairs_unreadable")).toMatchObject({
      action: "supported-currencies",
      failure: "upstream",
      status: 500,
      code: "SYSTEM_INTERNAL",
      requestId: "req-500",
    });
  });
});

describe("resolveOnRampCurrency", () => {
  it("[R4] a readable set on a located buyer resolves quietly and records pairs: read", async () => {
    mocks.apiFetch.mockResolvedValueOnce(RECORDED);
    mocks.requestHeaders = { "cloudfront-viewer-country": "BR" };

    const resolved = await resolveOnRampCurrency(RECORDED_USDC, "quote");

    expect(resolved).toEqual({ currency: "BRL", source: "cloudfront-viewer-country" });
    expect(mocks.logError).not.toHaveBeenCalled();
    expect(loggedFields(mocks.logInfo, "onramp.currency_resolved")).toMatchObject({
      action: "quote",
      currency: "BRL",
      source: "cloudfront-viewer-country",
      currencyCodeTo: RECORDED_USDC,
      viewerCountry: "present",
      profileCountry: "absent",
      pairs: "read",
    });
  });

  it("[R4] an unreadable set on a located buyer is loud, and records pairs: unreadable", async () => {
    // Suppressed at the read site ([R2]) and still recorded here: this field is unconditional
    // precisely because the WHY can be missing.
    mocks.apiFetch.mockRejectedValueOnce(
      new ApiError(503, "SYSTEM_NOT_CONFIGURED", "PP_API_URL or PP_API_KEY is not set"),
    );
    mocks.requestHeaders = { "cloudfront-viewer-country": "PT" };

    const resolved = await resolveOnRampCurrency(RECORDED_USDC, "quote");

    expect(resolved).toEqual({ currency: "USD", source: "fallback" });
    expect(loggedFields(mocks.logError, "onramp.currency_resolution_degraded")).toMatchObject({
      source: "fallback",
      viewerCountry: "present",
      pairs: "unreadable",
    });
    expect(emittedEvents()).toEqual(["onramp.currency_resolution_degraded"]);
  });

  it("[R4] an honestly empty set is the opposite diagnosis, and records pairs: empty", async () => {
    mocks.apiFetch.mockResolvedValueOnce([]);
    mocks.requestHeaders = { "cloudfront-viewer-country": "PT" };

    const resolved = await resolveOnRampCurrency(RECORDED_USDC, "quote");

    expect(resolved).toEqual({ currency: "USD", source: "fallback" });
    // `unreadable` is a live defect on our side; `empty` is Paybis genuinely not selling this pair to
    // anyone, which is nothing to fix. `resolveBuyerCurrency` answers USD for both.
    expect(loggedFields(mocks.logError, "onramp.currency_resolution_degraded")).toMatchObject({
      pairs: "empty",
    });
  });

  it("[R4] a fallback with no viewer country is quiet", async () => {
    // Nothing degraded: the edge never told us where the buyer is, so USD is the honest answer rather
    // than a symptom, and a logError here would fire on every request off the edge.
    mocks.apiFetch.mockResolvedValueOnce([]);

    const resolved = await resolveOnRampCurrency(RECORDED_USDC, "quote");

    expect(resolved).toEqual({ currency: "USD", source: "fallback" });
    expect(mocks.logError).not.toHaveBeenCalled();
    expect(loggedFields(mocks.logInfo, "onramp.currency_resolved")).toMatchObject({
      source: "fallback",
      viewerCountry: "absent",
      pairs: "empty",
    });
  });

  it("[R5] a proposal inside the supported set is honoured, normalized", async () => {
    mocks.apiFetch.mockResolvedValueOnce(RECORDED);
    mocks.requestHeaders = { "cloudfront-viewer-country": "US" };

    // Lower-cased and padded, as a query string delivers it. The browser proposes, the server
    // disposes: what makes honouring it safe is that it is MATCHED against the same supported set.
    const resolved = await resolveOnRampCurrency(RECORDED_USDC, "payment-methods", "  eur ");

    expect(resolved).toEqual({ currency: "EUR", source: "buyer-override" });
    expect(mocks.logError).not.toHaveBeenCalled();
    expect(loggedFields(mocks.logInfo, "onramp.currency_resolved")).toMatchObject({
      currency: "EUR",
      source: "buyer-override",
      pairs: "read",
    });
  });

  it("[R5] a proposal outside the supported set is refused, loudly, and the default answers", async () => {
    mocks.apiFetch.mockResolvedValueOnce(EUR_AND_BRL_ONLY);
    mocks.requestHeaders = { "cloudfront-viewer-country": "PT" };

    const resolved = await resolveOnRampCurrency(RECORDED_USDC, "payment-methods", "nzd");

    expect(resolved).toEqual({ currency: "EUR", source: "cloudfront-viewer-country" });
    // A selector offering a currency this check then refuses is a defect in the pair between them,
    // and it is invisible from either side alone.
    expect(loggedFields(mocks.logError, "onramp.currency_override_rejected")).toMatchObject({
      action: "payment-methods",
      proposed: "NZD",
      currency: "EUR",
      source: "cloudfront-viewer-country",
      pairs: "read",
    });
  });

  it("[R5] a value with no ISO-4217 reading is refused as unrecognised", async () => {
    mocks.apiFetch.mockResolvedValueOnce(EUR_AND_BRL_ONLY);
    mocks.requestHeaders = { "cloudfront-viewer-country": "PT" };

    // A crypto code where a fiat code belongs. It can only come from a client this app did not ship,
    // and saying which of the two it was is the difference between "the list drifted" and "something
    // is calling us".
    const resolved = await resolveOnRampCurrency(RECORDED_USDC, "quote", "USDC-BASE");

    expect(resolved).toEqual({ currency: "EUR", source: "cloudfront-viewer-country" });
    expect(loggedFields(mocks.logError, "onramp.currency_override_rejected")).toMatchObject({
      proposed: "unrecognised",
    });
  });

  it("[R5] a blank proposal is not a refusal and emits nothing extra", async () => {
    mocks.apiFetch.mockResolvedValueOnce(EUR_AND_BRL_ONLY);
    mocks.requestHeaders = { "cloudfront-viewer-country": "PT" };

    const resolved = await resolveOnRampCurrency(RECORDED_USDC, "quote", "   ");

    expect(resolved).toEqual({ currency: "EUR", source: "cloudfront-viewer-country" });
    expect(emittedEvents()).toEqual(["onramp.currency_resolved"]);
  });

  it("[R5] an unreadable set refuses every proposal", async () => {
    // With no readable set nothing is supported, so nothing can be honoured either: accepting the
    // choice here would be accepting a browser value unchecked on a money path.
    mocks.apiFetch.mockRejectedValueOnce(
      new ApiError(429, "SYSTEM_RATE_LIMITED", "Too many requests", "req-429"),
    );
    mocks.requestHeaders = { "cloudfront-viewer-country": "PT" };

    const resolved = await resolveOnRampCurrency(RECORDED_USDC, "quote", "EUR");

    expect(resolved).toEqual({ currency: "USD", source: "fallback" });
    expect(loggedFields(mocks.logError, "onramp.currency_override_rejected")).toMatchObject({
      proposed: "EUR",
      currency: "USD",
      source: "fallback",
      pairs: "unreadable",
    });
  });
});
