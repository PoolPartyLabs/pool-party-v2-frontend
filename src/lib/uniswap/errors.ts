/**
 * @id PP-CORE-LIB-050 (POO-1027)
 * @name Uniswap Trading API error types
 * @implements-rules-version v1
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

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "UniswapApiError";
    this.status = status;
    this.code = code;
  }
}

/** A response that did not match its schema: the API contract moved under us. */
export class UniswapParseError extends Error {
  readonly issues: ZodIssue[];

  constructor(path: string, issues: ZodIssue[]) {
    super(`Uniswap response for "${path}" did not match its schema`);
    this.name = "UniswapParseError";
    this.issues = issues;
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

/** True when a failure is worth retrying rather than surfacing. */
export function isTransientUniswapError(error: unknown): boolean {
  return error instanceof UniswapApiError && TRANSIENT_STATUSES.has(error.status);
}

/** Status-class fallback when an error body carries no machine code. */
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
