/**
 * @id PP-CORE-LIB-069 (POO-243)
 * @name request trace context
 * @implements-rules-version v1
 *
 * The frontend half of the cross-service trace contract. Every outbound call to a backend carries a
 * W3C `traceparent`, so one page render is ONE trace across `interface-v2` → `pool-party-api` →
 * (separately) the analytics indexer, and a failure in any of the three can be pulled back to the
 * render that caused it.
 *
 * ## The contract
 *
 *   traceparent: 00-<32 hex trace-id>-<16 hex span-id>-01
 *   x-request-id: <32 hex trace-id>
 *
 * The trace-id doubles as the user-facing correlation id, so it is 32 LOWERCASE hex characters and
 * nothing else. It is minted the same way `middleware.ts` mints its CSP nonce — `crypto.randomUUID()`
 * with the dashes stripped, which is exactly 32 lowercase hex — for one reason beyond consistency:
 * that pattern is already proven to work in every runtime this app is built for (Node server, Edge
 * middleware, jsdom under Vitest). The nonce itself is NOT reused: it is security-sensitive and must
 * stay single-use, and a trace-id travels to third-party backends and into logs.
 *
 * ## Why `cache()` and not `headers()`
 *
 * The requirement is one id for every backend call made while rendering one page. React `cache()`
 * gives exactly that: Next opens a fresh cache scope per request, so a zero-argument memo IS a
 * request-scoped value, and it costs no dynamic API.
 *
 * `headers()` would have been the other way to carry a middleware-minted id into the render, and it
 * was rejected: it is a Dynamic API, so reading it inside `apiFetch` would opt EVERY caller into
 * dynamic rendering, including the `[locale]` subtree that has `generateStaticParams`. Trading away
 * static generation to number a log line is a bad deal, and the only alternative — catching the
 * `DynamicServerError` — is the exact anti-pattern Next warns about.
 *
 * KNOWN LIMIT: outside a React render (a route handler under `src/app/api/**`, or a unit test) there
 * is no cache scope, and React's `cache` degrades to a plain pass-through. Each call there mints its
 * own id. That is correct but less useful, and it is the reason `getRequestTraceId` is exported: a
 * route handler that fans out can resolve the id once and thread it.
 *
 * ## v2 (POO-1147): the id comes FROM Sentry when Sentry is on
 *
 * Sentry mints a trace id per request for its own trace. Minting a second one here would leave an
 * incident as two unrelated searches - the Sentry issue and the container logs - with nothing to join
 * them on, so {@link getRequestTraceId} now ADOPTS Sentry's id when the SDK is enabled and falls back
 * to {@link newTraceId} when it is not (no DSN: local dev, tests, an unconfigured environment). The
 * formats are identical - both are 32 lowercase hex - so the wire contract above is unchanged and no
 * backend can tell the difference.
 *
 * The fallback is not optional. `activeSentryTraceId` returns `undefined` rather than reaching into
 * the SDK's scope precisely so that an uninitialised SDK cannot hand every request in the process the
 * same id; see PP-CORE-LIB-076.
 */
import "server-only";

import { cache } from "react";
import { activeSentryTraceId } from "./sentry/traceId";

/** `00` is the only trace-context version defined today. */
const TRACE_VERSION = "00";
/** Sampled. We do not implement head sampling: every render is one trace, and the volume is renders. */
const TRACE_FLAGS = "01";

/** 32 lowercase hex characters, never all-zero (`randomUUID` cannot produce that). */
export function newTraceId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** 16 lowercase hex characters, for the single client span this app represents in the trace. */
export function newSpanId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

/** True for a well-formed trace-id: exactly 32 lowercase hex characters. */
export function isTraceId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

/**
 * Sentry's trace-id for this request when the SDK is enabled and the value is well-formed, otherwise
 * a fresh one. Separated from the `cache()` wrapper below so it can be unit-tested directly: `cache`
 * outside a React render is a pass-through, which makes the memo itself untestable but this not.
 */
export function resolveRequestTraceId(): string {
  const fromSentry = activeSentryTraceId();
  // Validated HERE and not in the bridge: this module owns the trace-id format, and a malformed or
  // all-zero id from any source must never reach the wire.
  return isTraceId(fromSentry) && fromSentry !== "0".repeat(32) ? fromSentry : newTraceId();
}

/**
 * The trace-id for the current request, stable across every backend call in one render, and equal to
 * the Sentry trace-id whenever Sentry is enabled.
 *
 * See the header for why this is `cache()` and not `headers()`, and for the route-handler limit.
 */
export const getRequestTraceId: () => string = cache(resolveRequestTraceId);

/** Options that decide which headers are safe to attach to a given request. */
export interface TraceHeaderOptions {
  /**
   * True when this request goes through Next's fetch data cache (`next: { revalidate }`).
   *
   * THIS IS NOT COSMETIC. Next derives a cached fetch's key from the url, method, body AND HEADERS
   * (`incremental-cache/index.js`, `calculateCacheKey`), so a per-request header value makes every
   * cached GET a permanent MISS. It special-cases `traceparent`/`tracestate` and deletes them from
   * the key — "w3c trace context headers can break request caching and deduplication" — but it does
   * NOT special-case `x-request-id`.
   *
   * So a data-cached GET sends `traceparent` ONLY. Sending `x-request-id` too would silently undo
   * POO-453's `revalidate` window, which exists because all SSR shares one container IP and the
   * backend throttles per-IP: the cache going cold takes the page down with 429s. The trace-id is
   * still on the wire inside `traceparent`, so nothing is lost but a duplicate header.
   */
  dataCached?: boolean;
}

/**
 * The outbound trace headers for one backend call.
 *
 * A fresh span-id per call, one trace-id per render: each upstream request is its own span within
 * the render's trace, which is what makes a fan-out legible.
 */
export function buildTraceHeaders(
  traceId: string,
  { dataCached = false }: TraceHeaderOptions = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    traceparent: `${TRACE_VERSION}-${traceId}-${newSpanId()}-${TRACE_FLAGS}`,
  };
  if (!dataCached) headers["x-request-id"] = traceId;
  return headers;
}

/**
 * The backend's echoed correlation id for a response, or `undefined`.
 *
 * Prefers the backend's own `x-request-id` over the id we sent: on a data-cached GET we sent none,
 * and a proxy or the backend may mint its own. Falls back to the trace-id embedded in a returned
 * `traceparent`.
 */
export function readResponseRequestId(headers: Headers): string | undefined {
  const echoed = headers.get("x-request-id");
  if (echoed) return echoed.slice(0, 64);
  const traceparent = headers.get("traceparent");
  const traceId = traceparent?.split("-")[1];
  return isTraceId(traceId) ? traceId : undefined;
}
