/**
 * @id PP-CORE-LIB-063 (POO-1132, POO-1153, POO-1367, POO-1578, POO-1573, POO-1599)
 * @name on-ramp server-action layer
 * @implements-rules-version v5 (POO-1599 rules v1) · v4 (POO-1573 rules v2) · v3 (POO-1153 / POO-1129 rules v3) · v2 (POO-1132 rules v2) · v2 (POO-1367 rules v2) · v1 (POO-1578 rules v1)
 *
 * The server side of the Paybis fiat on-ramp, and the only place it touches a secret or the network.
 * Four `"use server"` actions: a received-fixed price {@link getOnRampQuoteAction}, the
 * {@link createOnRampRequestAction} that returns what the widget needs to open (`requestId`, plus the
 * one-time token when the backend mints one), and {@link getOnRampPaymentMethodsAction}, which lists the
 * methods for a pair (POO-1153) so the picker can pick a default to quote against and surface its own
 * minimum, and {@link getOnRampEthTargetAction}, which prices the gas-first leg's ETH target
 * (POO-1573) so that leg can be received-fixed too and stop pinning the buyer to dollars.
 *
 * A `"use server"` module is a boundary, not an edge: Next compiles it to an RPC stub on the client, so
 * a `"use client"` component may import these functions freely while `apiFetch` (and the `PP_API_KEY`
 * it injects) never enters a bundle. `serverBoundary.test.ts` guards that the PURE half of
 * `src/lib/onramp/` (`schemas.ts`, `signatureMessage.ts`) stays client-safe.
 *
 * Two contracts are inherited from every shipped build action (`investActions.ts`, `planActions.ts`,
 * `uniswap/actions.ts`), not invented here:
 *
 *   The wallet comes from the SIWE session (`getSessionWallet`), NEVER the caller. The request body is
 *   assembled field by field, so `recipientAddress` and `partnerUserId` are the session wallet and no
 *   part of the caller's object reaches the upstream unexamined. The field does not exist on the input
 *   at all, which is stronger than validating it away: there is no check to loosen later.
 *
 *   No action throws across the RSC boundary. Next masks a thrown Server Action error in production,
 *   which would strip the upstream code a caller branches on. So every action returns
 *   `{ ok: true, … } | BuildTxFailure`. An upstream `ApiError` keeps its machine code; a response
 *   `ApiParseError` (contract drift) becomes SCHEMA_MISMATCH; a request we refuse to send fails
 *   locally as ONRAMP_INVALID_REQUEST with a reason, never as a puzzling upstream 400.
 *
 *   POO-1251: the failure branch IS the house `BuildTxFailure` and the mapping IS `buildTxFailure`,
 *   replacing a private copy of both. That copy dropped `ApiError.requestId`, so a failed on-ramp
 *   mint reached the error dialog with no correlation id even though the backend had sent one.
 *
 * ## Path prefix (confirmed with Murilo, POO-1132)
 *
 * `apiFetch` builds `{PP_API_URL}/api/{version}/{path}` (`client.ts:196`), so `apiFetch("on-ramp/quote")`
 * resolves to `/api/v1/on-ramp/quote`. v1 baked `/api/v1` into its base URL; v2 does NOT, so the path
 * must NOT carry the prefix.
 *
 * ## Double-submit dedupe (POO-1132)
 *
 * `apiFetch` retries only GETs (`client.ts:221`), because replaying a write is unsafe. But nothing
 * stopped a user double-tapping "continue" from firing `createOnRampRequestAction` twice and creating
 * two Paybis purchase intents. The signed `signature` is already a per-submit idempotency token (a
 * fresh sign carries a fresh `Timestamp`, so a genuine new intent has a new signature; a re-tap of the
 * SAME signed request repeats it), so identical in-flight requests are COALESCED onto one upstream call
 * keyed by `session-wallet:signature`. The entry is dropped as soon as the request settles, so a
 * genuine retry after a failure still goes through. This collapses the double-tap window within one
 * server process; cross-instance idempotency needs the backend to dedupe on the same key.
 *
 * PP-INTEGRATION-POINT: for true cross-instance idempotency the backend should treat the on-ramp
 * `signature` (or an explicit idempotency key) as a dedupe token on `POST /on-ramp/request-id`; the
 * in-flight map here only covers a double-tap inside one process.
 *
 * ## Quote coalescing (POO-1578)
 *
 * {@link getOnRampQuoteAction} gets the SAME treatment for a different reason: quota, not double
 * spend. It is a POST, so `apiFetch` cannot cache it, and a payment-method picker re-quotes on every
 * selection change. pp_api throttles per API KEY (20/60 s), shared across all users and both
 * interface versions, so one user toggling methods burns everyone's budget. Identical in-flight
 * quotes coalesce onto one upstream POST, keyed by everything that decides the answer. The entry is
 * dropped when the request settles, so nothing is ever served stale.
 */
"use server";

import { headers } from "next/headers";
import { apiFetch } from "@/lib/api/client";
import { getSessionWallet } from "@/lib/auth/session";
import { logError, logInfo } from "@/lib/observability/logger";
import { type BuildTxFailure, buildTxFailure } from "@/lib/tx/actionResult";
import { resolveClientIp } from "./clientIp";
import { resolveOnRampEthTarget } from "./ethTarget";
import { readSupportedFiat, resolveOnRampCurrency } from "./resolveOnRampCurrency";
import {
  normalizeOnRampPaymentMethods,
  normalizeOnRampQuote,
  type OnRampEthTargetInput,
  type OnRampPaymentMethod,
  type OnRampPaymentMethodsInput,
  type OnRampPaymentMethodsResponse,
  type OnRampQuote,
  type OnRampQuoteInput,
  type OnRampQuoteResponse,
  type OnRampRequest,
  type OnRampRequestInput,
  type OnRampSupportedCurrenciesInput,
  onRampEthTargetInputSchema,
  onRampPaymentMethodsInputSchema,
  onRampPaymentMethodsResponseSchema,
  onRampQuoteInputSchema,
  onRampQuoteResponseSchema,
  onRampRequestInputSchema,
  onRampRequestResponseSchema,
  onRampSupportedCurrenciesInputSchema,
} from "./schemas";

/** {@link getOnRampQuoteAction}'s result. Mirrors the house `BuildTxResult` contract. */
export type OnRampQuoteResult = { ok: true; quote: OnRampQuote } | BuildTxFailure;

/** {@link createOnRampRequestAction}'s result: what the widget needs, or a typed failure. */
export type OnRampRequestResult =
  | { ok: true; requestId: string; oneTimeToken?: string }
  | BuildTxFailure;

/**
 * {@link getOnRampPaymentMethodsAction}'s result: the pair's methods, or a typed failure (POO-1153).
 *
 * `currencyCodeFrom` is the fiat the list was actually fetched for: the caller's override when one was
 * given, else the server-resolved buyer currency (POO-1512). Echoed so a caller making a FOLLOW-UP call
 * (the prefill's quote) can pin the same currency instead of triggering a second resolution that a
 * cache expiry or profile write in between could answer differently.
 */
export type OnRampPaymentMethodsResult =
  | { ok: true; currencyCodeFrom: string; methods: OnRampPaymentMethod[] }
  | BuildTxFailure;

/**
 * {@link getOnRampSupportedCurrenciesAction}'s result (POO-1621): the ISO-4217 codes this pair can be
 * bought with, sorted, or a typed failure. Never an empty list on the `ok` branch: a control with no
 * options is not a control, and the caller has a truthful read-only state for exactly that case.
 */
export type OnRampSupportedCurrenciesResult = { ok: true; currencies: string[] } | BuildTxFailure;

/**
 * {@link getOnRampEthTargetAction}'s result (POO-1573): the ETH figure to quote received-fixed with,
 * as a decimal STRING (up to 18dp is not float-safe), or a typed failure the caller degrades on.
 */
export type OnRampEthTargetResult = { ok: true; ethAmount: string } | BuildTxFailure;

/** Not signed in. Matches the shipped `SESSION_MISSING` contract in `investActions.ts`. */
const sessionMissing = {
  ok: false,
  code: "SESSION_MISSING",
  message: "Wallet session not established",
} as const;

/** A request we refuse to send, with the reason. Never reaches the network. */
function invalidRequest(message: string): BuildTxFailure {
  return { ok: false, code: "ONRAMP_INVALID_REQUEST", message };
}

/**
 * Price an on-ramp purchase. The picker calls this received-fixed (`direction: "receive"`): it knows
 * how much USDC has to LAND on Base and asks Paybis what that costs, and the returned
 * `paymentMethods[].chargeUsd` is the [R10] figure it displays. Wallet-gated to keep an anonymous
 * visitor from spending our rate-limited, key-authenticated upstream quota, though the quote itself
 * carries no identity.
 *
 * PP-INTEGRATION-POINT: price + fees ← pool-party-api `POST /api/v1/on-ramp/quote` (Paybis behind it).
 */
export async function getOnRampQuoteAction(input: OnRampQuoteInput): Promise<OnRampQuoteResult> {
  const wallet = await getSessionWallet();
  if (!wallet) return sessionMissing;

  const parsed = onRampQuoteInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidRequest(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  const { currencyCodeFrom, currencyCodeTo, amount, paymentMethod, direction } = parsed.data;
  // POO-1512 [R1]/[R2]: no override means charge the buyer in their OWN currency, resolved from the
  // request rather than passed up from the browser. [R6]'s spend-fixed leg passes "USD" explicitly.
  // POO-1573 [R4]: the resolution reports its own source; no caller can discard it again.
  const chargeCurrency =
    currencyCodeFrom ?? (await resolveOnRampCurrency(currencyCodeTo, "quote")).currency;

  // POO-1578: keyed on the RESOLVED currency, not the caller's optional one, so two callers who
  // resolve to the same fiat coalesce and two who do not never share an answer.
  //
  // POO-1599: an UNPINNED quote asks a different question from a pinned one (every method on
  // the pair, not one), so it gets its OWN key instead of being answered with a neighbour's
  // payload. The empty string is a safe marker for "nothing pinned": the input schema refuses
  // `""`, so no real identifier can collide with it.
  //
  // The separator is written as the ESCAPE `\0` rather than the raw byte it was (POO-1578
  // `7646f6e3`). Runtime-identical, and it makes this the only source file in the repo that is
  // no longer binary to `grep`, which had been silently skipping it in repo-wide searches.
  const key = [
    chargeCurrency,
    currencyCodeTo,
    amount,
    paymentMethod ?? "",
    direction ?? "spend",
  ].join("\0");
  const existing = inFlightQuotes.get(key);
  if (existing) return existing;

  const promise = sendOnRampQuote({
    chargeCurrency,
    currencyCodeTo,
    amount,
    paymentMethod,
    direction,
  }).finally(() => {
    inFlightQuotes.delete(key);
  });
  inFlightQuotes.set(key, promise);
  return promise;
}

/**
 * In-flight {@link getOnRampQuoteAction} calls, keyed by everything that determines the answer:
 * the resolved fiat, the crypto code, the amount, the method and the direction.
 *
 * The same reason {@link inFlightRequests} exists one function down, on a different failure. A picker
 * re-quotes on EVERY selection change, and `apiFetch` cannot cache this one (it is a POST, and
 * `client.ts` caches GETs only), so a user toggling between four methods spends four uncached POSTs.
 * pp_api throttles 20 requests / 60 s **per API KEY**, not per IP, shared across every user and both
 * interface versions, so one indecisive buyer eats everyone's quota. Coalescing collapses the rapid
 * identical calls (a double-render, two components asking for the same figure, a toggle back to a
 * method still in flight) onto one upstream POST.
 *
 * Deliberately NOT a cache: the entry is dropped the moment the request settles, so a quote is never
 * served stale and a genuine retry after a failure still goes upstream. A quote expires, and serving
 * an old one is the class of bug [R8] refuses to bake a `quoteId` into a plan for.
 *
 * Module-scoped, so it persists across action invocations within one server process. Not exported: a
 * `"use server"` module may only export async functions.
 */
const inFlightQuotes = new Map<string, Promise<OnRampQuoteResult>>();

/** The network half of {@link getOnRampQuoteAction}, split out so the dedupe wrapper stays thin. */
async function sendOnRampQuote({
  chargeCurrency,
  currencyCodeTo,
  amount,
  paymentMethod,
  direction,
}: {
  chargeCurrency: string;
  currencyCodeTo: string;
  amount: number;
  /** POO-1599: absent = the LISTING quote, which Paybis prices for EVERY method on the pair. */
  paymentMethod?: string;
  direction?: OnRampQuoteInput["direction"];
}): Promise<OnRampQuoteResult> {
  try {
    const raw = await apiFetch<OnRampQuoteResponse>("on-ramp/quote", {
      method: "POST",
      body: {
        currencyCodeFrom: chargeCurrency,
        currencyCodeTo,
        amount,
        // POO-1599: omit the KEY when nothing is pinned, so Paybis prices every method available for
        // the pair. Sending `undefined` or `null` is not the same request: the backend DTO accepts a
        // null (`@IsOptional()`) and would then have to invent a meaning for it.
        ...(paymentMethod === undefined ? {} : { paymentMethod }),
        // Omit when unset so the backend applies its spend-fixed default (POO-1139).
        ...(direction === undefined ? {} : { direction }),
      },
      schema: onRampQuoteResponseSchema,
    });
    if (!raw) {
      return { ok: false, code: "SCHEMA_MISMATCH", message: "Empty on-ramp quote response" };
    }
    return { ok: true, quote: normalizeOnRampQuote(raw) };
  } catch (error) {
    return buildTxFailure(error);
  }
}

/**
 * List the payment methods for a pair (POO-1153), each with its `displayName` and its own `minAmount`
 * (denominated in the `currencyFrom` the list was fetched for, POO-1512). The picker uses this to pick
 * a default method to quote {@link getOnRampQuoteAction} received-fixed against, to LABEL the [R10]
 * charge with that method's name, and to surface the method's own minimum rather than letting Paybis
 * reject the order. A GET, so `apiFetch` caches and retries it; wallet-gated on the same reasoning as
 * the quote (quota protection), though the list is per-pair and carries no identity.
 *
 * A 404 for an unsupported pair (a code outside the two this app buys, `USDT-BASE` say, which the
 * sandbox map does not touch and which the vendor answers for itself) comes back as
 * a typed failure the caller degrades on: never a throw, never a blocker.
 *
 * POO-1626: this paragraph used to name `USDC-BASE` in the sandbox as the example, and that stopped
 * being true on 2026-08-14. pool-party-api's `sandbox-currency-map.ts` (POO-1605) substitutes
 * `USDC-BASE` -> `USDC-SEPOLIA` and `ETH-BASE` -> `ETH-SEPOLIA` on the wire whenever `PAYBIS_API` points
 * at sandbox, and restores the production codes in the response, so the pairs this app buys DO list and
 * DO quote on dev. Dev is exercisable up to widget open only: settlement watches a Base delta while the
 * sandbox delivers on Sepolia, so a dev purchase never settles (POO-1627).
 *
 * PP-INTEGRATION-POINT: methods + per-method minimums ← pool-party-api
 * `GET /api/v1/on-ramp/payment-methods?currencyFrom=&currencyTo=` (Paybis behind it).
 */
export async function getOnRampPaymentMethodsAction(
  input: OnRampPaymentMethodsInput,
): Promise<OnRampPaymentMethodsResult> {
  const wallet = await getSessionWallet();
  if (!wallet) return sessionMissing;

  const parsed = onRampPaymentMethodsInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidRequest(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  const { currencyCodeFrom, currencyCodeTo, proposedCurrencyCodeFrom } = parsed.data;
  // POO-1512 [R1]/[R2]: this is the call whose currency decided WHICH METHODS the buyer was offered,
  // so resolving it is what puts SEPA in front of a European and Pix in front of a Brazilian.
  //
  // POO-1618 [R2]: and it is therefore the call the buyer's own CHOICE is validated on, once, here.
  // The proposal never short-circuits the resolution the way `currencyCodeFrom` does; it is offered
  // to it and accepted only if the supported set contains it. An explicit `currencyCodeFrom` still
  // wins outright, because it is the app's own pin (the spend-fixed leg's `order.fiatCurrency`,
  // whose `amount` IS a USD figure) and [R5] ignores an override on exactly that leg.
  const chargeCurrency =
    currencyCodeFrom ??
    (await resolveOnRampCurrency(currencyCodeTo, "payment-methods", proposedCurrencyCodeFrom))
      .currency;

  try {
    const path = `on-ramp/payment-methods?currencyFrom=${encodeURIComponent(
      chargeCurrency,
    )}&currencyTo=${encodeURIComponent(currencyCodeTo)}`;
    // The methods + minimums for a pair are quasi-static, so a short revalidate keeps the picker off
    // the per-API-key rate limit on every gate open (GET-only cache, `client.ts` [R9]).
    const raw = await apiFetch<OnRampPaymentMethodsResponse>(path, {
      schema: onRampPaymentMethodsResponseSchema,
      revalidate: 300,
      tags: ["on-ramp-payment-methods"],
    });
    if (!raw) {
      return {
        ok: false,
        code: "SCHEMA_MISMATCH",
        message: "Empty on-ramp payment-methods response",
      };
    }
    return {
      ok: true,
      currencyCodeFrom: chargeCurrency,
      methods: normalizeOnRampPaymentMethods(raw),
    };
  } catch (error) {
    return buildTxFailure(error);
  }
}

/**
 * POO-1621: the fiat currencies Paybis will sell this pair for, so a currency control has options.
 *
 * The set has always been computed on the server (`supportedFiatFor` inside `resolveOnRampCurrency`,
 * which is `server-only`) and only the single RESOLVED code was ever echoed, so a Select had nothing
 * to list. This is that publication and nothing more: it makes no decision, it resolves no currency,
 * and it takes no caller input beyond the pair. Coverage is per PAIR, which is why the target is
 * required rather than assumed.
 *
 * Hardcoding the list in the client was rejected on POO-1621: the set is the vendor's, it is per
 * pair, and it changes without a release. That is the same defect POO-1513 deleted one layer down (a
 * four-value union that offered Pix to a European and hid Google Pay from an Android buyer).
 *
 * An unreadable set is a TYPED FAILURE and never an empty list: a control offering nothing, or
 * offering a fabricated set it cannot switch to, is a control that lies (POO-494 [R1]). The caller
 * degrades to stating the resolved currency, which is what it did before this existed.
 *
 * Wallet-gated on the same reasoning as every other read here: the answer is per-pair and carries no
 * identity, but an anonymous visitor must not spend our rate-limited, key-authenticated quota.
 *
 * PP-INTEGRATION-POINT: the fiat/crypto pairs Paybis sells ← pool-party-api
 * `GET /api/v1/on-ramp/currency-pairs-to-buy` (Paybis `/v2/currency/pairs/buy-crypto` behind it),
 * read and cached by `readSupportedFiat`.
 */
export async function getOnRampSupportedCurrenciesAction(
  input: OnRampSupportedCurrenciesInput,
): Promise<OnRampSupportedCurrenciesResult> {
  const wallet = await getSessionWallet();
  if (!wallet) return sessionMissing;

  const parsed = onRampSupportedCurrenciesInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidRequest(parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  const supported = await readSupportedFiat(parsed.data.currencyCodeTo, "supported-currencies");
  // `null` (unreadable) and an honestly-empty set are the same answer HERE, unlike inside the
  // resolver: neither can populate a control, and offering one option that is not a choice is worse
  // than offering none. The two are still told apart in the logs `readSupportedFiat` emits.
  if (!supported || supported.size === 0) {
    return {
      ok: false,
      code: "ONRAMP_CURRENCIES_UNAVAILABLE",
      message: "Could not read the fiat currencies this pair can be bought with",
    };
  }
  // Sorted so the control's order is stable across renders and deploys: the set's iteration order is
  // the vendor's group order, which changes when a rail is added and would silently reshuffle a
  // 44-row list under the buyer.
  return { ok: true, currencies: [...supported].sort() };
}

/**
 * Solve an `ETH-BASE` order's received-fixed target: `gasFloorEth + fundingUsd / ethUsd`, priced NOW
 * (POO-1573 [R1]).
 *
 * This exists as an action for the same reason {@link resolveOnRampCurrency} is server-side: the
 * price comes from `apiFetch`, which carries `PP_API_KEY` and never enters a bundle. The client holds
 * the recipe (it rides on the plan's `buy` step) and asks for the figure; it cannot read the price
 * itself, and a price passed up from the browser would be caller-controlled input on a money path.
 *
 * Wallet-gated on the same reasoning as the quote: the read is per-token and carries no identity, but
 * an anonymous visitor must not spend our rate-limited, key-authenticated upstream quota.
 *
 * [R5] A failed price read is a typed failure, never a throw: the caller degrades to the shipped
 * spend-fixed USD leg, which costs the buyer their own currency and never the purchase.
 *
 * PP-INTEGRATION-POINT: ETH price ← pool-party-api `GET /api/v1/prices` (CoinGecko behind it), via
 * `resolveOnRampEthTarget`.
 */
export async function getOnRampEthTargetAction(
  input: OnRampEthTargetInput,
): Promise<OnRampEthTargetResult> {
  const wallet = await getSessionWallet();
  if (!wallet) return sessionMissing;

  const parsed = onRampEthTargetInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidRequest(parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  const ethAmount = await resolveOnRampEthTarget(parsed.data);
  if (ethAmount === null) {
    return {
      ok: false,
      code: "ONRAMP_ETH_PRICE_UNAVAILABLE",
      message: "Could not price ETH for the gas-first order",
    };
  }
  return { ok: true, ethAmount };
}

/**
 * In-flight `createOnRampRequestAction` calls keyed by `session-wallet:signature`, so a double-tap of
 * the SAME signed request coalesces onto one upstream POST instead of creating two purchase intents.
 * Module-scoped, so it persists across action invocations within one server process. Not exported: a
 * `"use server"` module may only export async functions.
 */
const inFlightRequests = new Map<string, Promise<OnRampRequestResult>>();

/**
 * Turn a signed verification into a Paybis purchase intent, returning the `requestId` the widget opens
 * with. The recipient of the crypto is the SESSION wallet, and `partnerUserId` is the same wallet
 * (this app's identity IS the wallet, so it is derived, never taken from the caller). The client
 * `personal_sign`s {@link buildOnRampSignatureMessage} and passes `signature` + `message`; the backend
 * re-verifies both against the recipient and enforces a 5-minute replay window before Paybis is called.
 *
 * PP-INTEGRATION-POINT: purchase intent ← pool-party-api `POST /api/v1/on-ramp/request-id` (Paybis
 * behind it), signature verified server-side against the SIWE-derived wallet.
 */
export async function createOnRampRequestAction(
  input: OnRampRequestInput,
): Promise<OnRampRequestResult> {
  const wallet = await getSessionWallet();
  if (!wallet) return sessionMissing;

  const parsed = onRampRequestInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidRequest(parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  const key = `${wallet}:${parsed.data.signature}`;
  const existing = inFlightRequests.get(key);
  if (existing) return existing;

  const promise = sendOnRampRequest(wallet, parsed.data).finally(() => {
    inFlightRequests.delete(key);
  });
  inFlightRequests.set(key, promise);
  return promise;
}

/** The network half of {@link createOnRampRequestAction}, split out so the dedupe wrapper stays thin. */
async function sendOnRampRequest(
  wallet: string,
  input: OnRampRequestInput & { locale: string },
): Promise<OnRampRequestResult> {
  const { signature, message, currencyCode, quoteId, paymentMethod, locale } = input;

  // POO-1367: Paybis `/v3/request` requires the END USER's public IP and 422s on anything else.
  // `apiFetch` is server-only, so without this header the backend's `extractClientIp` falls through
  // to `req.ip`, which is THIS container's Docker address, and every purchase fails at the final
  // step. Resolved here because only the incoming request carries the viewer's address.
  const requestHeaders = await headers();
  const resolvedIp = resolveClientIp((name) => requestHeaders.get(name));

  // Report which HEADER won, never the address: an end-user IP is personal data, the source name is
  // not.
  //
  // `cloudfront-viewer-address` is unforgeable ONLY because the edge writes it. Every deployed
  // environment sits behind CloudFront, so that is the expected source and anything else means the
  // origin-request-policy is not forwarding it. When that happens resolution degrades to the
  // CLIENT-SUPPLIED `x-forwarded-for`, whose leftmost entry a user can forge, and that value reaches
  // Paybis as a fraud/geo/sanctions input on a regulated money rail. The purchase still succeeds, so
  // nothing else in the system would ever surface it: a silently weakened security control is
  // exactly the class of degrade that needs to be LOUD (POO-1068 observable degrades).
  //
  // `logError` is what reaches Sentry (`logger.ts:166`: error forwards, info/warn do not), keyed on
  // the stable event token so it groups as one issue rather than one per request.
  if (resolvedIp?.source === "cloudfront-viewer-address") {
    logInfo("onramp.client_ip_resolved", { source: resolvedIp.source });
  } else {
    logError("onramp.client_ip_edge_degraded", {
      source: resolvedIp?.source ?? "none",
      detail: resolvedIp
        ? "cloudfront-viewer-address absent: userIp fell back to a client-supplied header and is spoofable"
        : "no usable client IP header: the purchase is refused rather than sent with a fabricated address",
    });
  }

  const userIp = resolvedIp?.ip;
  if (!userIp) {
    // No address rather than a fabricated one: `127.0.0.1` would pass Paybis's format check while
    // being a lie on a money path, and would send the purchase on to fail for a reason nobody can
    // read. Failing here names the cause.
    return invalidRequest("Could not establish the client IP address required for the purchase");
  }

  try {
    const response = await apiFetch<OnRampRequest>("on-ramp/request-id", {
      method: "POST",
      // The backend reads `x-forwarded-for` FIRST in `extractClientIp`, so forwarding it is the whole
      // fix and no API change is needed. Matches how interface v1 has always done it.
      headers: { "x-forwarded-for": userIp },
      body: {
        // The session's wallet, never the caller's. Both fields are this same derived identity.
        recipientAddress: wallet,
        partnerUserId: wallet,
        locale,
        currencyCode,
        signature,
        message,
        ...(quoteId === undefined ? {} : { quoteId }),
        ...(paymentMethod === undefined ? {} : { paymentMethod }),
      },
      schema: onRampRequestResponseSchema,
    });
    if (!response) {
      return { ok: false, code: "SCHEMA_MISMATCH", message: "Empty on-ramp request-id response" };
    }
    return {
      ok: true,
      requestId: response.requestId,
      ...(response.oneTimeToken === undefined ? {} : { oneTimeToken: response.oneTimeToken }),
    };
  } catch (error) {
    return buildTxFailure(error);
  }
}
