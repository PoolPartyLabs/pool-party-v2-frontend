/**
 * @id PP-REW (POO-567)
 * @name Analytics failure observability
 * @implements-rules-version v1
 *
 * Structured, server-side outage signal for the never-throw analytics fetchers.
 *
 * The timeseries / activity / rewards fetchers deliberately degrade an upstream
 * failure to an empty default so a chart or feed renders instead of breaking the
 * page. That resilience has a cost: an analytics OUTAGE becomes indistinguishable
 * from a clean "no data yet" response (young/uncovered pool, non-manager wallet).
 * This opacity is exactly how fabricated/derived charts stayed invisible.
 *
 * [R2] A genuine outage (network error, client timeout, 5xx, schema-parse failure,
 * or an unexpected throw) is logged once, with the endpoint, the HTTP status/code,
 * and the wallet/pool key, so it is observable in server logs.
 *
 * [R3]/[R4] Expected non-outage signals stay SILENT: `SYSTEM_NOT_CONFIGURED` (mock
 * mode / unset ANALYTICS_API_URL) and a per-wallet 404 `WALLET_NOT_FOUND` (the wallet
 * simply has no data for this slice yet) are not outages and must not create log noise.
 * A clean 200-with-empty-series never reaches here at all (no throw), so it is silent
 * by construction.
 *
 * Server-only: imported by Server Actions / Server Components only.
 *
 * PP-INTEGRATION-POINT: swap console.warn for the platform structured logger once one exists.
 */
import "server-only";

import { AnalyticsError, AnalyticsParseError } from "./errors";

/** The structured context recorded for an observed analytics failure. */
interface AnalyticsFailureContext {
  /** The analytics endpoint path that failed (no query string), e.g. "analytics/pools/0x/timeseries". */
  endpoint: string;
  /** The caught error (AnalyticsError, AnalyticsParseError, or an unexpected throw). */
  error: unknown;
  /** The wallet or pool key the read was scoped to, for correlating an outage to a surface. */
  key?: string;
}

/**
 * True when the error is an EXPECTED non-outage signal that must stay silent:
 * mock-mode misconfiguration or a per-wallet "no data yet" 404.
 */
function isExpectedNonOutage(error: unknown): boolean {
  if (!(error instanceof AnalyticsError)) return false;
  // [R4] Mock mode / unset ANALYTICS_API_URL is silent by design.
  if (error.code === "SYSTEM_NOT_CONFIGURED") return true;
  // [R3] A young/uncovered wallet (404 / WALLET_NOT_FOUND) is "no data yet", not an outage.
  if (error.status === 404 || error.code === "WALLET_NOT_FOUND") return true;
  return false;
}

/** Normalize any caught value to a { status, code } pair for the structured log. */
function describeError(error: unknown): { status: number; code: string } {
  if (error instanceof AnalyticsError) return { status: error.status, code: error.code };
  if (error instanceof AnalyticsParseError) return { status: error.status, code: error.code };
  return { status: 0, code: "SYSTEM_UNKNOWN" };
}

/**
 * [R2] Record a structured server-side warning for a genuine analytics outage, so it is
 * observable and DISTINCT from a clean empty-series response. No-op for expected non-outage
 * signals ([R3]/[R4]). Never throws: observing a failure must not turn a degraded render fatal.
 */
export function observeAnalyticsFailure({ endpoint, error, key }: AnalyticsFailureContext): void {
  if (isExpectedNonOutage(error)) return;

  const { status, code } = describeError(error);
  const message = error instanceof Error ? error.message : String(error);

  // A single structured warning is enough to page/alert on; keep the shape flat and greppable.
  console.warn("[analytics] upstream read failed (chart degraded to empty)", {
    endpoint,
    status,
    code,
    key,
    message,
  });
}
