/**
 * @id PP-CORE-LIB-070 (POO-243, POO-1147, POO-1471, POO-1713)
 * @name reportClientError
 * @implements-rules-version v2 (POO-1713 rules v1: an OPT-IN Sentry fingerprint, for the callers
 *   whose `Error` has a synthetic stack) · v1 (POO-243 rules v1, POO-1471 rules v1)
 * @analytics-events none, because this is the first-party + Sentry error rail rather than GA4: it
 *   beacons to `/api/client-error` and calls `captureException`, and never `track`. The GA4
 *   counterpart to a failure is `app_error_shown`, emitted by the surfaces that RENDER one.
 *
 * Browser-side failure reporting. Thirteen `console.error` sites across the wallet-connect, SIWE,
 * profile-save and funding-recovery paths wrote ONLY to the user's own devtools console, so the
 * failure rate of the two flows that gate every session — connect a wallet, sign in — was not
 * observable in aggregate at all. This posts them to a first-party ingest so they land in the
 * container's log stream next to the server-side lines for the same trace.
 *
 * ## v2 (POO-1147): Sentry is now a SECOND sink, not a replacement
 *
 * The vendor landed, and as predicted the call sites did not change - only this function did. It now
 * fans out to three places, and each earns its keep:
 *
 * - `console.error`: unchanged local DX.
 * - the first-party ingest: the container log line, sitting next to the server-side lines for the
 *   same trace, and the thing that still works when a browser extension blocks the vendor.
 * - Sentry: grouping, alerting, release attribution and the browser half of a trace whose server half
 *   `onRequestError` already reports.
 *
 * Two rules keep Sentry usable. It receives the CAUGHT VALUE, not the flattened description, because
 * an error tracker's whole value is the stack it can group on; the `beforeSend` scrubber
 * (PP-CORE-LIB-073) is what makes that safe. And an EXPECTED non-outage is never sent
 * ({@link isExpectedNonOutage}): POO-243 wired a global `QueryCache`/`MutationCache` `onError`, so
 * without that gate every mock-mode read and every young wallet's 404 would become a Sentry event and
 * put a permanent floor of noise under the error rate. The first-party ingest still gets those - a
 * grep can filter, an alert threshold cannot.
 *
 * ## What it sends, and what it does not
 *
 * An `event` token, a `describeError` description (name / message / status / code / digest), and the
 * caller's flat context. NOT: a stack, a wallet address, a private key, a full request or response
 * body. It is capped at {@link MAX_PAYLOAD_BYTES} before it leaves the browser and re-clipped
 * server-side, because a client-supplied payload is never trusted by the thing that logs it.
 *
 * ## v3 (POO-1471): this is the CAUGHT half of the rail, and it was never the whole of it
 *
 * Every caller here is a `catch` block, so this function only ever sees a failure someone caught.
 * Measured over 30 days of production (POO-1438, re-measured in POO-1471): 62% of browser errors
 * reach Sentry through here and therefore have a first-party twin in the container log; the other
 * 38% arrive at the SDK's own global handlers for uncaught exceptions and unhandled rejections and
 * post NOTHING first-party, which makes a blocked or filtered vendor a total, invisible loss for
 * exactly the failures nobody caught. {@link shipClientErrorReport} is the seam that let
 * `reportFirstPartyTwin` (PP-CORE-LIB-098) close that half without a second transport.
 *
 * This is distinct from what the ROUTE ERROR BOUNDARIES send. `[locale]/error.tsx` [R3] and
 * `(auth)/(app)/error.tsx` [R11] deliberately send only `error.digest` to GA4/GTM and never the
 * message, because that leaves our infrastructure and goes to a third party. This ingest is
 * first-party and same-origin, so it may carry more, and that difference is the reason it exists as
 * a separate channel rather than as another analytics event.
 *
 * Client-safe: no `server-only`, no Node APIs.
 */
import { captureException } from "@sentry/nextjs";
import { describeError } from "./describeError";
import { isExpectedNonOutage } from "./expectedFailure";

/** First-party, same-origin. Never a third-party host: that is the whole privacy argument above. */
export const CLIENT_ERROR_INGEST_PATH = "/api/client-error";

/**
 * Hard cap before the payload leaves the browser. `sendBeacon` silently returns false past the UA
 * quota, and the route rejects past 8 KiB, so a payload that would be dropped is not worth building.
 */
const MAX_PAYLOAD_BYTES = 4_096;

/** Flat context. Values are JSON-serialized as-is, so keep them primitives. */
export type ClientErrorFields = Record<string, unknown>;

/** Exactly what the ingest route parses. Kept minimal: every field here is one the route reads. */
export interface ClientErrorPayload extends ClientErrorFields {
  event: string;
  /** Where it happened. Path only, never the query string (it can carry a wallet). */
  path?: string;
}

/**
 * The current path, without query or hash. `undefined` outside a browser (SSR, tests).
 *
 * Exported for the ONE other sender on this rail, `reportFirstPartyTwin` (PP-CORE-LIB-098). The
 * rule it encodes — path only, never the query string, which can carry a wallet — has to hold for
 * every payload that reaches this ingest, so it lives here once rather than at each sender.
 */
export function currentPath(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.pathname;
}

/**
 * Ship the payload without blocking or throwing.
 *
 * `sendBeacon` first: it survives the page unload that follows many of these failures (a wallet
 * error is often immediately followed by a navigation), which a plain `fetch` does not. `keepalive`
 * fetch is the fallback for the browsers and payloads beacon refuses. Both failures are swallowed:
 * a reporting call that can throw would turn a handled error into an unhandled one.
 */
function ship(body: string): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(CLIENT_ERROR_INGEST_PATH, blob)) return;
    }
    void fetch(CLIENT_ERROR_INGEST_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting is best-effort by definition.
  }
}

/**
 * Serialize, cap and ship one payload to the first-party ingest. The whole transport of this rail,
 * in one function, so the second sender cannot end up with a different one.
 *
 * Exported for `reportFirstPartyTwin` (PP-CORE-LIB-098, POO-1471), which reports the captures this
 * function's own caller never sees: an uncaught exception and an unhandled rejection reach the SDK's
 * global handlers, not a `catch` block, so nothing calls {@link reportClientError} for them. It
 * needs the SAME `sendBeacon`-then-`keepalive` transport and the SAME 4 KiB cap, and those are
 * properties of the INGEST rather than of any one sender. Duplicating them would let the two halves
 * drift on the one behaviour ([R5]) that decides whether a report survives the unload that usually
 * follows the failure.
 *
 * It deliberately does NOT capture to Sentry or write to the console: the twin's caller is already
 * inside `beforeSend` (capturing there would recurse and file the same failure twice) and the
 * browser has already printed the uncaught error itself.
 *
 * Never throws.
 */
export function shipClientErrorReport(payload: ClientErrorPayload): void {
  let body: string;
  try {
    body = JSON.stringify(payload);
  } catch {
    return;
  }
  if (body.length > MAX_PAYLOAD_BYTES) {
    body = JSON.stringify({ event: payload.event, path: payload.path, truncated: true });
  }
  ship(body);
}

/**
 * Report a caught browser-side error: to the devtools console (unchanged local DX) AND to the
 * first-party ingest (the aggregate signal that did not exist).
 *
 * @param event - A stable, greppable token, e.g. `"PP-PROFILE-SAVE failed"` or `"wallet.connect_failed"`.
 * @param error - The caught value. Reduced by `describeError`; the stack is never sent.
 * @param fields - Flat, non-identifying context (surface, action, asset...).
 * @param tags - POO-1387: extra Sentry TAGS. Use sparingly, and only for a value support will
 *   SEARCH BY. `fields` land in `extra`, which Sentry stores but does not index, so a value that has
 *   to be findable (the support reference) cannot go there. Tags are indexed and low-cardinality by
 *   design, so this is not a general-purpose second context bag.
 * @param fingerprint - POO-1713 [R1]: override Sentry's grouping for this event. OMIT IT unless the
 *   `error` you pass has a SYNTHETIC stack.
 *
 *   Sentry groups a JavaScript exception by its stack trace whenever one exists, and consults the
 *   message only when there is none. That is the right behaviour for almost every caller here: they
 *   pass a genuinely caught error, thrown at the place it went wrong, and its stack separates one
 *   failure from another for free.
 *
 *   It is the WRONG behaviour for a caller that manufactures an `Error` in order to report
 *   something, because every such event is constructed at the same line and therefore carries the
 *   same stack. {@link useReportRenderedError} (PP-CORE-HOK-029) is the caller POO-1713 FIXED, and
 *   the result there was one Sentry issue holding 21 distinct error codes across 4 routes, titled
 *   by whichever event arrived last, with a `firstSeen` 13 days older than most of the failures
 *   inside it.
 *
 *   It is NOT the only such caller, and saying otherwise here would repeat the exact mistake
 *   POO-1713 exists to delete: a confident header claim that outlived the code it described. Three
 *   more manufacture an `Error` at one shared line with varying content and are still grouped by
 *   reporter rather than by failure, tracked as POO-1715:
 *
 *   - `useBuyRouteQuote.ts:466`, an Error built from a template of event + code, both varying.
 *   - `useSiweSession.tsx:775`, `new Error(failure.code)`. The highest-volume first-party reporter
 *     in the repo (`docs/09_ANALYTICS.md:227`: 182 lines in 30 days), so it collapses the most.
 *   - `useAuth.ts:124`, `new Error(String(errorCode))`.
 *
 *   (`SiweChainSwitchAction` also manufactures one, but its message is constant, so a single group
 *   is the correct answer there and it needs nothing.)
 *
 *   Supplying this is therefore a statement about the SHAPE of the error, not a preference.
 */
export function reportClientError(
  event: string,
  error: unknown,
  fields: ClientErrorFields = {},
  tags: Record<string, string> = {},
  fingerprint?: string[],
): void {
  const description = describeError(error);
  // Unchanged from the sites this replaces: a developer with devtools open still sees the object.
  console.error(event, { ...fields, ...description });

  // POO-1147: the vendor sink. The caught value goes in whole (the stack is what groups an issue);
  // an expected non-outage never does (see the header).
  if (!isExpectedNonOutage(error)) {
    try {
      captureException(error, {
        // POO-1713 [R1]/[R5]: only when the caller asked. Spreading a conditional key rather than
        // passing `fingerprint: undefined` keeps the property ABSENT for the 43 callers that do not
        // supply one, so their default stack grouping is untouched rather than merely re-derived.
        ...(fingerprint ? { fingerprint } : {}),
        tags: { pp_event: event, ...tags },
        extra: { ...fields, ...description },
      });
    } catch {
      // Never let the tracker break the flow it is observing.
    }
  }

  shipClientErrorReport({ event, path: currentPath(), ...fields, ...description });
}
