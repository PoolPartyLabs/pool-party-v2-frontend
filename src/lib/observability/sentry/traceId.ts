/**
 * @id PP-CORE-LIB-076 (POO-1147)
 * @name active Sentry trace id
 * @implements-rules-version v1
 *
 * The bridge that makes POO-243's trace-id and Sentry's trace-id the SAME id.
 *
 * Without it there are two: Sentry mints one per request for its own trace, `getRequestTraceId`
 * (PP-CORE-LIB-069) mints another for `traceparent` and the log lines, and an incident is then two
 * unrelated search results - the Sentry issue, and the container logs - with nothing to join them on.
 * Reading Sentry's id and reusing it collapses that into one: the Sentry trace, every frontend log
 * line, and the `traceparent` that `pool-party-api` and the analytics indexer log against all carry
 * the identical 32 hex characters.
 *
 * ## Why `getTraceData` and not `getActiveSpan().traceId`
 *
 * `getTraceData` is the SDK's own resolution order, and on the Node runtime it delegates to the
 * OpenTelemetry async-context strategy, which is where the real per-request context lives. Reading a
 * span directly would miss the trace-WITHOUT-performance case: when `tracesSampleRate` does not
 * sample a request there is no recording span, but there IS still a propagation context with a trace
 * id, and that request needs a correlation id exactly as much as a sampled one does.
 *
 * ## Why the `{}` return is load-bearing
 *
 * `getTraceData` returns `{}` when the SDK is not enabled, and the caller MUST fall back to minting
 * its own id in that case. It cannot instead read the scope's propagation context directly: with no
 * `Sentry.init` there is no per-request isolation scope, so the GLOBAL scope's propagation context
 * would hand every request in the process the same trace id forever - one indistinguishable id for
 * the life of the container, which is strictly worse than no id at all.
 *
 * Server-only. The browser's trace context comes from the SDK's own fetch instrumentation.
 */
import "server-only";

import { getTraceData } from "@sentry/nextjs";

/**
 * The trace id of the request Sentry is currently handling, or `undefined` when Sentry is not
 * enabled (no DSN) or has no context for this call.
 *
 * The value is NOT validated here: the caller owns the trace-id format (`isTraceId`), and validating
 * in two places is how the two definitions drift apart.
 *
 * Never throws: a failure to read an observability id must never fail the request being observed.
 */
export function activeSentryTraceId(): string | undefined {
  try {
    const data = getTraceData({ propagateTraceparent: true });
    // `traceparent` is `00-<trace-id>-<span-id>-<flags>`; `sentry-trace` is `<trace-id>-<span-id>-<n>`.
    // Prefer the W3C header, since that is the one whose id actually goes out on the wire.
    const fromTraceparent = data.traceparent?.split("-")[1];
    if (fromTraceparent) return fromTraceparent;
    return data["sentry-trace"]?.split("-")[0];
  } catch {
    return undefined;
  }
}
