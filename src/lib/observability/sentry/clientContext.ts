/**
 * @id PP-CORE-LIB-082 (POO-1251)
 * @name browser Sentry context
 * @implements-rules-version v1 (POO-1251 rules v1)
 *
 * The two runtime values the transaction error dialog needs from Sentry in the BROWSER: the trace id
 * of the current page context, and the release this bundle was built as.
 *
 * ## Why this exists at all
 *
 * A failed money-path operation currently lands in Sentry LOGS and usually nowhere else: the backend
 * throws curated failures as `HttpException`, which `@SentryExceptionCaptured` classifies as expected
 * and never files as an Issue, and the money path is trace-sampled well below 1, so most failures
 * record no spans either. The correlation id is then the only handle that finds anything at all, and
 * a user who cannot read it off the dialog cannot hand it to support.
 *
 * ## Why not `activeSentryTraceId` (PP-CORE-LIB-076)
 *
 * It reads the same SDK API and it is `server-only` on purpose: on the server, with no `Sentry.init`,
 * the GLOBAL scope's propagation context would hand every request in the container the same id
 * forever, which is why that module documents its fallback as load-bearing. In the browser there is
 * one document and one user, so the propagation context IS this page's trace and no such hazard
 * exists. Dropping `server-only` from that module to share four lines would erase a boundary that is
 * doing real work, so this is a separate function rather than a shared one.
 *
 * ## Why the release comes from the SDK and not from an env var
 *
 * The Sentry bundler plugin injects the release name (`next.config.ts` -> `release.name`, the same
 * string `scripts/push_image.sh` tags the ECR image with) into the bundles, and the SDK resolves it
 * into the client options. Reading it back off the client is therefore guaranteed to be the exact
 * string an event is filed under. A `NEXT_PUBLIC_` twin would be a second version scheme that can
 * disagree with the first, which is the whole failure this avoids.
 *
 * Both functions return `undefined` when Sentry is not enabled (no DSN: local dev, tests, Storybook)
 * and neither ever throws: a support handle must never be the thing that breaks an error dialog.
 *
 * Client-safe: no `server-only`, no Node APIs.
 */
import { getClient, getTraceData } from "@sentry/nextjs";

/** 32 lowercase hex characters, the one trace-id format this app puts on the wire (PP-CORE-LIB-069). */
const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;

/** The invalid trace id every W3C implementation reserves; never a usable search term. */
const ZERO_TRACE_ID = "0".repeat(32);

/**
 * The trace id of the browser context an error was raised in, or `undefined` when Sentry is not
 * enabled or has no context. Validated here rather than at the call site so a malformed or all-zero
 * id can never be shown to a user as something to quote at support.
 *
 * ## What this id actually finds, and what it does not
 *
 * It is NOT usually a handle on a frontend Sentry EVENT. A transaction failure on these paths is
 * caught and rendered, so it never reaches the global handler `instrumentation-client.ts` files
 * events from; there is no `useMutation` on them, so `MutationCache.onError` never fires either; the
 * frontend has no Sentry Logs; and `tracesSampleRate` is 0.1 in production, so roughly nine in ten
 * purely client-side failures resolve to NOTHING in Sentry under this id.
 *
 * What it does find is the FRONTEND CONTAINER LOGS. `propagateTraceparent: true` puts this same trace
 * on the wire, so a failure raised in a Server Action carries it into the server's structured log
 * lines, and support greps for it there. Adding a Sentry capture to close the gap is a deliberate
 * volume decision, tracked separately, not something to slip in here.
 *
 * ## It is PER-PAGELOAD, not per-error
 *
 * The browser propagation context is minted for the document (and per client-side navigation), not
 * per failure. Two failures on the same route therefore hand support the SAME reference. That is a
 * coarse handle rather than a wrong one: it narrows to one user's one session on one route, which is
 * enough to find the log window. The backend's `correlationId` is per-REQUEST and is why it is the
 * first source; this is the fallback for the case where there is no request at all.
 */
export function browserTraceId(): string | undefined {
  let candidate: string | undefined;
  try {
    const data = getTraceData({ propagateTraceparent: true });
    // `traceparent` is `00-<trace-id>-<span-id>-<flags>`; `sentry-trace` is `<trace-id>-<span-id>-<n>`.
    candidate = data.traceparent?.split("-")[1] ?? data["sentry-trace"]?.split("-")[0];
  } catch {
    return undefined;
  }
  if (!candidate || candidate === ZERO_TRACE_ID) return undefined;
  return TRACE_ID_PATTERN.test(candidate) ? candidate : undefined;
}

/**
 * The release this bundle reports events under, or `undefined` when no release was injected (every
 * local build) or Sentry is not enabled.
 */
export function sentryRelease(): string | undefined {
  try {
    const release = getClient()?.getOptions().release;
    return typeof release === "string" && release.length > 0 ? release : undefined;
  } catch {
    return undefined;
  }
}
