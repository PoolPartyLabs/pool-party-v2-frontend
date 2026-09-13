/**
 * @id PP-CORE-LIB-050 (POO-1027, POO-1107)
 * @name Uniswap Trading API error types
 * @implements-rules-version v2 (POO-1107 rules v1) · v1 (POO-1027 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * Typed errors for the Uniswap Trading API client, mirroring `@/lib/api/errors` so both upstreams
 * fail the same shape. `UniswapApiError` is an upstream HTTP failure; `UniswapParseError` is a Zod
 * validation failure, i.e. contract drift between the live API and our schemas.
 *
 * Why typed codes matter here specifically: this codebase already learned that classifying failures
 * by regex-matching provider prose is fragile across chains and routers (see `classifyTxError`). The
 * Trading API returns a machine code on its error bodies, so we surface it as data and let callers
 * branch on `error.code` instead of matching strings.
 *
 * Kept in its own module (not `client.ts`) so tests and client-side callers can import the classes
 * without pulling in the `server-only` transport.
 */
import type { ZodIssue } from "zod";

/** An upstream HTTP failure from the Trading API. */
export class UniswapApiError extends Error {
  /** HTTP status. `0` for a network-level failure, and for local configuration errors. */
  readonly status: number;
  /** Machine-readable code: the upstream `errorCode` when present, else a status-class fallback. */
  readonly code: string;
  /**
   * POO-1251 [R1]: the cross-service correlation id, mirroring `ApiError.requestId`.
   *
   * Since POO-1097 the transport for this class is `fundingFetch`, which calls OUR backend
   * (`/api/v1/funding`) and therefore gets an `ApiError` carrying a real correlation id. Without this
   * field the translation in `fundingClient.ts` dropped it, and the FOURTH drop point (the funding
   * rail, i.e. the money path this work exists for) survived the fix to the other three.
   *
   * Absent when the call never reached the backend (no config, a network failure, a local guard).
   */
  readonly requestId?: string;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = "UniswapApiError";
    this.status = status;
    this.code = code;
    if (requestId) this.requestId = requestId;
  }
}

/** A response that did not match its schema: the API contract moved under us. */
export class UniswapParseError extends Error {
  readonly issues: ZodIssue[];
  /** POO-1251 [R1]: same correlation id, mirroring `ApiParseError.requestId`. Contract drift is a
   * failure of a REAL request, so it has a trace to point at exactly like an HTTP failure does. */
  readonly requestId?: string;

  constructor(path: string, issues: ZodIssue[], requestId?: string) {
    super(`Uniswap response for "${path}" did not match its schema`);
    this.name = "UniswapParseError";
    this.issues = issues;
    if (requestId) this.requestId = requestId;
  }
}

/**
 * Transient upstream statuses worth a bounded retry: throttling (429), gateway blips (502/503/504),
 * and request timeout (408). `0` covers network failures and our own abort. Mirrors
 * `RETRYABLE_STATUS` in `@/lib/api/client`.
 *
 * Deliberately excludes every other 4xx: a 400 for a malformed quote request, or a 404 for a pair
 * with no route, will fail identically on retry and would only burn the time budget.
 */
const TRANSIENT_STATUSES = new Set([0, 408, 429, 502, 503, 504]);

/**
 * True when a failure is worth retrying rather than surfacing.
 *
 * PP-DEBT(SEV:LOW) POO-1107: dead on the live path since POO-1097 deleted `client.ts`, the only
 * caller. Kept because it is the STATUS-based statement of the same question, and status is the
 * field the action layer throws away. Nothing above the transport holds a throwable to pass it, so
 * use {@link isTransientFailureCode} there. Anchoring a classifier to this file's now-unreachable
 * vocabulary is exactly how POO-1107 shipped a fix that could not fire; do not read the codes below
 * as the live set.
 */
export function isTransientUniswapError(error: unknown): boolean {
  return error instanceof UniswapApiError && TRANSIENT_STATUSES.has(error.status);
}

/**
 * Every failure code that names an OUTAGE rather than an answer about routing.
 *
 * The action layer returns `{ ok: false, code }`, NOT an Error, so callers above it cannot use
 * `isTransientUniswapError`. POO-1107: every one of them treated any failure as a routing verdict,
 * which turned a throttled quote into "no route exists" and a funded wallet into "insufficient
 * funds".
 *
 * Since POO-1097 a quote crosses TWO hops, and the set has to cover both or the fix no-ops on the
 * case that actually happens. The codes below are verified against the live sources, not assumed:
 *
 *   hop 2, pool-party-api → Uniswap. `funding.errors.ts` (`UniswapUpstreamException`) forwards
 *   Uniswap's own machine code verbatim, and the `fallbackCode` that supplies it when the body
 *   carries none is the one below, moved server-side by POO-1097.
 *
 *   pool-party-api's OWN back-pressure. This is the throttle that actually fires, and missing it
 *   was the whole defect: the per-wallet Uniswap-quota shed POO-1097 [R2] added
 *   (`FundingWalletRateLimitedException`), and the global per-API-key `ThrottlerGuard`, whose
 *   codeless body `AllExceptionsFilter.toMachineCode` names after its exception class.
 *
 *   hop 1, this app → pool-party-api. The request never reaches the backend, so there is no backend
 *   code and `@/lib/api/client` supplies its own.
 *
 * Deliberately NOT here: `UNISWAP_UNAUTHORIZED` and `UNISWAP_KEY_MISSING` (a bad or absent
 * credential does not come right on its own, and a retry prompt would hide the outage),
 * `SYSTEM_NOT_CONFIGURED` (the same, for our own env), `SCHEMA_MISMATCH` (contract drift fails
 * identically on retry), and `UNISWAP_REQUEST_ERROR` (the 404 that IS a routing verdict, [R1]).
 */
const TRANSIENT_FAILURE_CODES: ReadonlySet<string> = new Set([
  // hop 2: pool-party-api → Uniswap
  "UNISWAP_NETWORK_ERROR",
  "UNISWAP_TIMEOUT",
  "UNISWAP_RATE_LIMITED",
  "UNISWAP_UPSTREAM_ERROR",
  // pool-party-api's own back-pressure
  "FUNDING_WALLET_RATE_LIMITED",
  "THROTTLER",
  // hop 1: this app → pool-party-api. Every one of these is already `isRetryable` in the repo's own
  // taxonomy (`@/lib/api/toUserError`), which is the authoritative list to agree with.
  "SYSTEM_NETWORK_ERROR",
  "SYSTEM_TIMEOUT",
  "SYSTEM_RATE_LIMITED",
  "SYSTEM_UPSTREAM_UNAVAILABLE",
]);

/** True when an action-result `code` names an outage rather than an answer about routing. */
export function isTransientFailureCode(code: string | undefined): boolean {
  return code !== undefined && TRANSIENT_FAILURE_CODES.has(code);
}

/**
 * Status-class fallback when an error body carries no machine code.
 *
 * PP-DEBT(SEV:LOW) POO-1107: dead here since POO-1097. The live copy of this mapping now runs
 * SERVER-side in pool-party-api (`funding/uniswap-trading-api.errors.ts`), and its output reaches us
 * forwarded through `UniswapUpstreamException`, which is why the `UNISWAP_*` codes still appear in
 * {@link TRANSIENT_FAILURE_CODES} despite nothing in this repo producing them.
 */
function fallbackCode(status: number): string {
  if (status === 0) return "UNISWAP_NETWORK_ERROR";
  if (status === 408) return "UNISWAP_TIMEOUT";
  if (status === 429) return "UNISWAP_RATE_LIMITED";
  if (status === 401 || status === 403) return "UNISWAP_UNAUTHORIZED";
  if (status >= 500) return "UNISWAP_UPSTREAM_ERROR";
  return "UNISWAP_REQUEST_ERROR";
}

/**
 * Extract a machine code + human message from a non-2xx Trading API body.
 *
 * The API is not consistent about the field names across endpoints (`errorCode` / `code`, and
 * `detail` / `message` / `errorMessage`), so we accept the observed variants rather than pinning one
 * and silently collapsing every error into the fallback.
 */
export function parseUniswapErrorBody(
  status: number,
  body: unknown,
): { code: string; message: string } {
  const record = (body ?? {}) as Record<string, unknown>;
  const rawCode = record.errorCode ?? record.code;
  const rawMessage = record.detail ?? record.message ?? record.errorMessage;

  return {
    code: typeof rawCode === "string" && rawCode.length > 0 ? rawCode : fallbackCode(status),
    message:
      typeof rawMessage === "string" && rawMessage.length > 0
        ? rawMessage
        : `Uniswap Trading API responded ${status}`,
  };
}
