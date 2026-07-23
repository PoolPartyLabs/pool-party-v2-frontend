/**
 * @id PP-CORE (POO-206)
 * @name API error types
 * @implements-rules-version v2
 *
 * Typed error classes for the server-side API client. ApiError represents
 * upstream HTTP errors; ApiParseError represents zod validation failures
 * (contract drift between the API response and the FE schema).
 *
 * v2 (POO-886 R2): `parseApiErrorBody` extracts a machine code + human message from a non-2xx
 * pp_api body. The backend's global AllExceptionsFilter historically responded with
 * `{ statusCode, timestamp, path, response }` and NO top-level code/message, so apiFetch
 * collapsed every real backend error into SYSTEM_INTERNAL. The parser understands BOTH shapes:
 * the new additive top-level `code`/`message`, and the old nested Nest `response` (string, or
 * `{ code?, message: string | string[], error? }`). When no code is present, the status class
 * decides: 429 maps to SYSTEM_RATE_LIMITED (already in the toUserError taxonomy) instead of
 * SYSTEM_INTERNAL. Lives here (not client.ts) so tests on the client side of the server-only
 * boundary (diagnostics fixtures) can exercise the real parse.
 */
import type { ZodIssue } from "zod";

/** Error from the upstream API (non-2xx response or network failure). */
export class ApiError extends Error {
  /** HTTP status code (0 for network failures). */
  readonly status: number;
  /** Machine-readable error code (e.g. "POOL_NOT_FOUND", "SYSTEM_INTERNAL"). */
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Transient upstream statuses worth a bounded client-side retry: throttling (429), gateway/DB blips
 * (502/503/504), and the backend's own timeout signal (408). Network failures use status 0. Mirrors
 * the server-side `RETRYABLE_STATUS` in client.ts so the client can distinguish "retry, do not
 * hard-fail the page" from a genuine error. (POO-453)
 */
const TRANSIENT_STATUSES = new Set([0, 408, 429, 502, 503, 504]);

/**
 * True when an error is a transient upstream failure the client should retry (throttle, gateway/DB
 * blip, timeout, network) rather than surface to the error boundary. Anything else (500, other 4xx,
 * parse/session errors, non-ApiError throwables) is treated as non-transient by the caller.
 */
export function isTransientApiError(error: unknown): boolean {
  return error instanceof ApiError && TRANSIENT_STATUSES.has(error.status);
}

/** Parsed machine code + human message from a non-2xx pp_api body (POO-886 R2). */
export interface ParsedApiErrorBody {
  code: string;
  message: string;
}

/** [R2] Status-class fallback when the body carries no code: 429 is a throttle, not an outage. */
function statusFallbackCode(status: number): string {
  return status === 429 ? "SYSTEM_RATE_LIMITED" : "SYSTEM_INTERNAL";
}

/** A Nest message field is a string or a validation string array; join arrays for humans. */
function readMessage(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value)) {
    const parts = value.filter((item): item is string => typeof item === "string");
    if (parts.length > 0) return parts.join("; ");
  }
  return undefined;
}

/** Normalize the Nest `error` label ("Bad Request") into a machine code ("BAD_REQUEST"). */
function toMachineCode(label: string): string {
  return label.trim().replace(/\W+/g, "_").toUpperCase();
}

/**
 * [R2] Extract `{ code, message }` from a non-2xx pp_api body without collapsing structured
 * errors into SYSTEM_INTERNAL. Precedence: top-level `code`/`message` (new AllExceptionsFilter
 * contract) > nested `response` data (old shape: string message, or object with `code`,
 * `message` string/array and the Nest `error` label) > status-class fallback (429 becomes
 * SYSTEM_RATE_LIMITED). `body` may be undefined for non-JSON error pages.
 */
export function parseApiErrorBody(status: number, body: unknown): ParsedApiErrorBody {
  let code: string | undefined;
  let message: string | undefined;
  if (body !== null && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    if (typeof obj.code === "string" && obj.code.length > 0) code = obj.code;
    message = readMessage(obj.message);
    const nested = obj.response;
    if (typeof nested === "string" && nested.length > 0) {
      message ??= nested;
    } else if (nested !== null && typeof nested === "object") {
      const nestedObj = nested as Record<string, unknown>;
      if (code === undefined && typeof nestedObj.code === "string" && nestedObj.code.length > 0) {
        code = nestedObj.code;
      }
      if (code === undefined && typeof nestedObj.error === "string" && nestedObj.error.length > 0) {
        code = toMachineCode(nestedObj.error);
      }
      message ??= readMessage(nestedObj.message);
    }
  }
  return {
    code: code ?? statusFallbackCode(status),
    message: message ?? "An unexpected error occurred",
  };
}

/** Zod validation failure when the API response does not match the expected schema. */
export class ApiParseError extends Error {
  readonly status = 422;
  readonly code = "SYSTEM_PARSE_ERROR" as const;
  /** Zod validation issues for debugging. */
  readonly issues: ZodIssue[];

  constructor(message: string, issues: ZodIssue[]) {
    super(message);
    this.name = "ApiParseError";
    this.issues = issues;
  }
}
