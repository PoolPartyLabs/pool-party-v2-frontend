/**
 * @id PP-CORE-LIB-096 (POO-1512, POO-1573, POO-1601, POO-1618, POO-1810)
 * @name on-ramp buyer-currency resolver (server)
 * @implements-rules-version v5 (POO-1810 rules v1) · v4 (POO-1618 rules v1, decided on POO-1576) · v3 (POO-1601 rules v1) · v2 (POO-1573 rules v2) · v1 (POO-1512 rules v1)
 *
 * The server half of [R2]: gather the three inputs {@link resolveBuyerCurrency} needs, from places
 * only the server can reach, and hand back the currency to charge in.
 *
 * ## Why this is server-side, and not a parameter
 *
 * `cloudfront-viewer-country` is a REQUEST HEADER. A client hook cannot read it, and a currency passed
 * up from the browser would be caller-controlled input on a money path, which this folder's header
 * already refuses for the wallet ("the wallet comes from the SIWE session, NEVER the caller"). So the
 * currency is resolved HERE, inside the `"use server"` boundary, and `currencyCodeFrom` becomes an
 * override for the one case that needs it ([R6]) rather than a required argument every caller must
 * remember to compute.
 *
 * ## The buyer may now CHOOSE, and the rule above is what makes that safe (POO-1618 [R2])
 *
 * POO-1576 ships a currency control on the buy step, so a currency does now come up from the browser.
 * Nothing above is relaxed for it. The choice arrives as a PROPOSAL on its own parameter, is matched
 * against the supported set this function already reads, and is discarded in favour of the resolved
 * default when the set does not contain it. The browser proposes, the server disposes, and the walk
 * that POO-1512 [R2] describes becomes the DEFAULT ([R1]) rather than the answer.
 *
 * Two things it deliberately does NOT become:
 *
 *   * it is not the `currencyCodeFrom` override. That one is the app pinning a currency it resolved
 *     itself - the spend-fixed leg's `order.fiatCurrency`, and the quote pinning what the methods
 *     call echoed - and it must keep short-circuiting this function entirely, because re-resolving a
 *     pin is the second resolution [R4] forbids (a cache expiry between the two calls could then
 *     list EUR methods and price a USD purchase).
 *   * it is not validated twice. The proposal is checked on the METHODS call, which is the call whose
 *     `currencyFrom` decides what the buyer is offered; the quote pins that call's echoed answer. One
 *     resolution per flow, unchanged.
 *
 * ## Every input degrades independently ([R4])
 *
 * Each of the three reads is wrapped so that its failure costs precision, never the purchase:
 *
 *   * the supported set -> `null`, which {@link resolveBuyerCurrency} answers with USD
 *   * the viewer country -> absent, so the chain falls to the profile
 *   * the profile country -> absent, so the chain falls to USD
 *
 * ## Degrading quietly is what let POO-1601 run for five days (POO-1601 [R5])
 *
 * The pairs read threw an `ApiParseError` on EVERY request (the schema expected a flat array; the
 * endpoint returns payment-method groups) and this file's `catch` turned it into a `null` that is
 * indistinguishable from a 404. Every buyer was charged USD and offered the dollar payment-method set,
 * which is a plausible answer, so nothing 500'd and no purchase was blocked.
 *
 * **A signal DID exist, and it was not acted on.** `apiFetch` logs `api.response_parse_failed` at
 * ERROR level before it throws (`src/lib/api/client.ts:381`), carrying the endpoint, the status, the
 * request id and `summarizeZodIssues`, which would have printed the drifted path `0.pairs`; `logger.ts`
 * forwards every error record to Sentry as an issue. That line landed 2026-07-31, twelve days before
 * v1.5.0 reached production on 2026-08-12, so it fired on every single request for the whole five days.
 * Nobody read it. So the fix here is NOT "add the missing signal", it is that the existing one names
 * the DRIFT and nothing names the CONSEQUENCE: `api.response_parse_failed` says a response did not
 * match a schema, and cannot say that the buyer is now being charged in the wrong currency.
 * `onramp.currency_pairs_unreadable` is that second event, emitted from the degrade site that knows
 * what the degrade costs, and the `pairs` field below has three states instead of two. (Emitted is all
 * that is claimed for the existing event: whether anything ALERTED on it is a separate question this
 * file cannot answer.)
 *
 * PP-INTEGRATION-POINT: the fiat/crypto pairs Paybis sells ← pool-party-api
 * `GET /api/v1/on-ramp/currency-pairs-to-buy` (Paybis `/v2/currency/pairs/buy-crypto` behind it).
 * Shipped since POO-1368 and unread by the frontend until POO-1512.
 *
 * They run in parallel because the profile read is data-cached per wallet
 * (`fetchInvestorProfile`, seconds-long window) and the pairs read is cached for an hour, so this adds
 * no meaningful load to the per-keystroke quote path. That matters: pp-api throttles per API KEY, not
 * per IP, and v1 and v2 share one bucket.
 */

import "server-only";

import { headers } from "next/headers";
import { apiFetch } from "@/lib/api/client";
import { ApiError, ApiParseError } from "@/lib/api/errors";
import {
  isExpectedNonOutage,
  logError,
  logInfo,
  summarizeZodIssues,
} from "@/lib/observability/logger";
import { loadInvestorProfile } from "@/lib/profile/loadInvestorProfile";
import { type ResolvedBuyerCurrency, resolveBuyerCurrency } from "./buyerCurrency";
import { onRampCurrencyPairsResponseSchema, supportedFiatFor } from "./currencyPairs";

/**
 * Which fiat Paybis sells which crypto for changes on the order of vendor onboarding, not minutes, so
 * this is cached far longer than a quote. One hour keeps it off the shared throttle bucket entirely.
 */
const CURRENCY_PAIRS_REVALIDATE_SECONDS = 3600;

/** The CloudFront header carrying the viewer's ISO 3166-1 alpha-2 country. */
const VIEWER_COUNTRY_HEADER = "cloudfront-viewer-country";

/**
 * POO-1601 [R5] Describe WHY the pairs read failed, in fields a triager can act on.
 *
 * Three classes, because they call for three different actions: contract drift means ship a fix,
 * an upstream failure means wait (or chase the backend with the request id), and anything else is
 * neither and must not be dressed up as either. The zod paths are the whole diagnosis for the first
 * class: `0.pairs` is the difference between "the vendor changed" and "we read the wrong nesting
 * level", and it is what five days of `pairs: "unreadable"` could not say.
 *
 * Those paths come from `summarizeZodIssues`, which is what BOTH api clients already use for exactly
 * this (`api/client.ts`, `analytics-api/client.ts`): it clips the list, address-masks and length-clips
 * every field, and is unit-tested. Hand-joining `issue.path` here would be a second, weaker copy of a
 * masking rule that has to hold identically on every path that prints a drifted response.
 */
function describePairsFailure(error: unknown): Record<string, unknown> {
  if (error instanceof ApiParseError) {
    return {
      failure: "contract-drift",
      code: error.code,
      requestId: error.requestId,
      // The drifted FIELD PATHS, not the values: enough to name the shape, nothing about a buyer.
      issues: summarizeZodIssues(error.issues),
      detail:
        "the pairs response no longer matches the schema, so EVERY buyer falls back to USD; see POO-1601",
    };
  }
  if (error instanceof ApiError) {
    return {
      failure: "upstream",
      status: error.status,
      code: error.code,
      requestId: error.requestId,
    };
  }
  return { failure: "unknown", detail: error instanceof Error ? error.message : String(error) };
}

/**
 * [R3] The fiat codes Paybis sells `currencyCodeTo` for, or `null` when the set could not be read.
 *
 * `null` and "empty" are deliberately the same answer to the caller ([R4]) but are reached differently:
 * a 404/throttle/timeout/parse failure lands here in the catch, an honestly-empty list lands as an
 * empty set. Neither can produce a currency, and neither may block a purchase.
 *
 * POO-1601 [R5]: the catch REPORTS before it degrades. Degrading is right and is unchanged, but this
 * exact catch swallowed an `ApiParseError` thrown on every single request from the moment POO-1512
 * reached production (v1.5.0, 2026-08-12) until 2026-08-14, and the only visible consequence was that
 * non-US buyers were charged in dollars, which looks like a correct answer (POO-1512's own reporter
 * filed the same symptom three times). `apiFetch` was already logging that drift as
 * `api.response_parse_failed` the whole time (`api/client.ts:381`, shipped 2026-07-31); what nothing
 * emitted was the CONSEQUENCE, that the buyer's currency had just been decided by a failure. This line
 * is that. It is `logError` (so it reaches Sentry, unlike `logInfo`, `logger.ts:166`) on a stable event
 * token, so it groups as one issue rather than one per request. It sits BESIDE
 * `onramp.currency_resolution_degraded` rather than replacing it: that one is quiet when no viewer
 * country arrived, this one names the CAUSE and is loud regardless, because a broken contract is
 * broken wherever the buyer is standing.
 *
 * [R5] It is loud for OUTAGES only. `isExpectedNonOutage` is the repo-wide rule for which degrades
 * stay silent, and every degrade path inherits it rather than re-deriving it (`observeCatalogDegrade`
 * opens with the identical line). Two of its three classes land here constantly and neither is a
 * failure: mock mode makes `apiFetch` throw `SYSTEM_NOT_CONFIGURED` when `PP_API_URL`/`PP_API_KEY` are
 * unset, which is this repo's DEFAULT state, so without the guard every buy-panel open in local dev
 * and on every mock deploy files a Sentry issue; and a 429 is our OWN per-API-key throttle answering,
 * where the report volume scales with the problem instead of describing it. A genuine outage (a 500,
 * an unreachable host) and a contract drift are neither, and both still report.
 */
export async function readSupportedFiat(
  currencyCodeTo: string,
  caller: OnRampCurrencyCaller,
): Promise<Set<string> | null> {
  try {
    const raw = await apiFetch("on-ramp/currency-pairs-to-buy", {
      schema: onRampCurrencyPairsResponseSchema,
      revalidate: CURRENCY_PAIRS_REVALIDATE_SECONDS,
      tags: ["on-ramp-currency-pairs"],
    });
    if (!raw) return null;
    return supportedFiatFor(raw, currencyCodeTo);
  } catch (error) {
    if (isExpectedNonOutage(error)) return null;

    logError("onramp.currency_pairs_unreadable", {
      action: caller,
      currencyCodeTo,
      ...describePairsFailure(error),
    });
    return null;
  }
}

/**
 * Where the buyer IS. Absent off the edge (local dev, and prod until the header is added to the
 * CloudFront origin-request-policy), which is why [R2] has a second link rather than one source.
 */
async function readViewerCountry(): Promise<string | null> {
  try {
    return (await headers()).get(VIEWER_COUNTRY_HEADER);
  } catch {
    return null;
  }
}

/** Where the buyer SAYS they live (POO-675 column). Blank for most users, so it is the fallback. */
async function readProfileCountry(): Promise<string | null> {
  try {
    return (await loadInvestorProfile()).country || null;
  } catch {
    return null;
  }
}

/** Which action asked, so one emitted line names the call it belongs to (POO-1573 [R4]). */
export type OnRampCurrencyCaller = "quote" | "payment-methods" | "supported-currencies";

/**
 * ISO-4217 alpha: exactly three letters. The whole grammar of a currency code, and the only shape
 * this function will compare against the supported set or interpolate into a query string.
 *
 * A proposal is caller-controlled input on a money path, so it is normalized (trimmed, upper-cased)
 * and then MATCHED, never merely trusted. Anything else - a crypto code like `USDC-BASE`, a padded
 * two-letter country, an injection attempt - has no ISO-4217 reading at all and is refused before it
 * can be compared, which is why this is a shape check rather than a sanitizer.
 */
const ISO_4217_ALPHA = /^[A-Z]{3}$/;

/**
 * POO-1618 [R2]: the buyer's PROPOSED currency in its comparable form, or nothing when the value
 * cannot be a currency code at all. Never throws; an unusable proposal is simply absent.
 */
function normalizeProposedCurrency(proposed: string | undefined): string | undefined {
  const code = proposed?.trim().toUpperCase();
  return code && ISO_4217_ALPHA.test(code) ? code : undefined;
}

/**
 * Resolve the fiat currency to charge the buyer in, for a given target crypto, and REPORT how.
 *
 * The source is returned as well as the code, and emitted here rather than left to the caller
 * (POO-1573 [R4]): both call sites discarded it for a full release, which is why the 2026-08-13 live
 * report could not be told apart from a missing CloudFront header, a failed pairs read, or a
 * genuinely-American buyer. All four produce the identical silent `USD`, and the four fields below
 * are exactly what separates them.
 *
 * A `fallback` on a request that DID carry a viewer country is a DEGRADED read and is loud, on the
 * same split `onramp.client_ip_resolved` / `onramp.client_ip_edge_degraded` uses (`logError` reaches
 * Sentry, `logInfo` does not — `logger.ts:166`), keyed on a stable event token so it groups as one
 * issue rather than one per request. That line carries one field the others do not (POO-1810 [R3]):
 * the currency the rail REFUSED, so a dollar charge says which money it was not allowed to use
 * instead of only that it ended up on dollars.
 *
 * No country VALUE is logged, only whether each link was present. The four booleans answer the
 * diagnostic question, and where the buyer is standing is theirs, not ours — the same reasoning
 * `sendOnRampRequest` applies to the client IP ("the source name is not personal data, the address
 * is").
 */
export async function resolveOnRampCurrency(
  currencyCodeTo: string,
  caller: OnRampCurrencyCaller,
  /**
   * POO-1618 [R2]: the currency the BUYER asked for, straight off the browser and trusted for
   * nothing. It is honoured only if it is in the same supported set this function already reads,
   * and otherwise the resolved default answers instead - the browser proposes, the server disposes.
   *
   * It is deliberately a separate parameter from the actions' `currencyCodeFrom` override, which is
   * the app pinning a currency it resolved ITSELF (the spend-fixed leg's `order.fiatCurrency`, and
   * the quote pinning what the methods call echoed). Those two are different facts with opposite
   * trust: collapsing them onto one field would either put a browser value beyond checking or put
   * the flow's own pin through a SECOND resolution, and POO-1618 [R4] forbids the second one.
   */
  proposed?: string,
): Promise<ResolvedBuyerCurrency> {
  const [supported, viewerCountry, profileCountry] = await Promise.all([
    readSupportedFiat(currencyCodeTo, caller),
    readViewerCountry(),
    readProfileCountry(),
  ]);
  const walked = resolveBuyerCurrency({ viewerCountry, profileCountry, supported });
  /**
   * [R2] The check, and it is the ONLY one there is: the supported set is what says a currency can
   * buy this pair at all. With no readable set nothing is supported, so nothing can be honoured
   * either - accepting the choice there would be accepting it unchecked, which is exactly the
   * boundary this file's header refuses.
   */
  const choice = normalizeProposedCurrency(proposed);
  const accepted = choice !== undefined && (supported?.has(choice) ?? false);
  const resolved: ResolvedBuyerCurrency = accepted
    ? { currency: choice as string, source: "buyer-override" }
    : walked;

  const fields = {
    action: caller,
    currency: resolved.currency,
    source: resolved.source,
    currencyCodeTo,
    viewerCountry: viewerCountry ? "present" : "absent",
    profileCountry: profileCountry ? "present" : "absent",
    // POO-1601 [R6] THREE states, not two. `resolveBuyerCurrency` answers USD for the first two
    // identically, and they are opposite diagnoses: `unreadable` is a live defect on our side (it was
    // a schema mismatch for five days and this field could only say "unreadable"), `empty` is Paybis
    // genuinely not selling this pair to anyone, which is nothing to fix. The WHY of the first one is
    // on the `onramp.currency_pairs_unreadable` line that `readSupportedFiat` emits, EXCEPT where the
    // cause was an expected non-outage (mock mode, our own 429), which is deliberately silent there
    // and is why this field still records `unreadable` unconditionally.
    pairs: supported === null ? "unreadable" : supported.size === 0 ? "empty" : "read",
  } as const;
  /**
   * POO-1618 defect 3: a REFUSED choice is a money decision the product just made on the buyer's
   * behalf, and the shipped override path emitted nothing at all (a passing test pinned that
   * silence). It is `logError` so it reaches Sentry (`logger.ts:166`), on a stable token so it
   * groups as one issue: a selector offering a currency this check then refuses is a defect in the
   * pair between them, and it is invisible from either side alone.
   *
   * The proposal is a CURRENCY, not a location: it names what the buyer chose to pay in, which is
   * the thing under diagnosis, and it is one of the vendor's own 44 codes.
   */
  const proposalMade = (proposed?.trim() ?? "") !== "";
  if (proposalMade && !accepted) {
    logError("onramp.currency_override_rejected", {
      ...fields,
      // The normalized code, or the marker for a value that has no ISO-4217 reading at all. The
      // second case can only come from a client this app did not ship, and saying which of the two
      // it was is the difference between "the list drifted" and "something is calling us".
      proposed: choice ?? "unrecognised",
      detail:
        "the buyer's chosen currency is not in the supported set for this pair, so the resolved default was used instead",
    });
  }
  if (resolved.source === "fallback" && viewerCountry) {
    logError("onramp.currency_resolution_degraded", {
      ...fields,
      /**
       * POO-1810 [R3]: which of the two degrades this was, which the sentence below could only ever
       * list as alternatives. A code is the rail REFUSING the buyer's own money and names what it
       * refused; `none` is the chain never reaching a refusal at all, so read it with `pairs`: with
       * `unreadable` or `empty` there was nothing to refuse against, and with `read` the viewer
       * country is one this map does not carry. It is a CURRENCY, not a location, the same line the
       * present/absent fields above draw.
       */
      rejected: walked.rejected ?? "none",
      detail:
        "the edge told us where the buyer is and the chain still ended on USD: the pairs read failed, or Paybis does not sell this pair in their currency",
    });
  } else {
    logInfo("onramp.currency_resolved", fields);
  }
  return resolved;
}
