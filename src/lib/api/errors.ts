/**
 * @id PP-CORE (POO-206)
 * @name API error types
 * @implements-rules-version v3
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
 *
 * v3 (POO-243, cross-service tracing): pool-party-api is ADDITIVELY growing a nested
 * `error: { code, message, correlationId, timestamp }` object while keeping every existing field.
 * This repo's hard-won deploy rule is that the frontend is made tolerant and ships FIRST, so the
 * parser now reads that object at the HIGHEST precedence and falls back through the whole v2 chain
 * untouched. Nothing on this path is zod-parsed, so no schema can hard-fail on the added key: the
 * error body is hand-parsed by design, and that property is worth keeping. Both error classes also
 * carry an optional `requestId` — the backend's echoed correlation id — so an error that reaches a
 * boundary or a log line can be tied back to the upstream request that produced it.
 */
import type { ZodIssue } from "zod";

/** Error from the upstream API (non-2xx response or network failure). */
export class ApiError extends Error {
  /** HTTP status code (0 for network failures). */
  readonly status: number;
  /** Machine-readable error code (e.g. "POOL_NOT_FOUND", "SYSTEM_INTERNAL"). */
  readonly code: string;
  /**
   * Cross-service correlation id for the failed call (POO-243): the backend's echoed `x-request-id`,
   * or the `correlationId` off its error envelope. Absent when the call never reached the backend
   * (network failure, client timeout, missing config).
   */
  readonly requestId?: string;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    if (requestId) this.requestId = requestId;
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
  /**
   * The `correlationId` off the new nested `error` envelope (POO-243), when the backend sent one.
   * Undefined against every older API build, which is exactly why it is optional and never required.
   */
  correlationId?: string;
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

/** A non-empty string, or undefined. Used for the several optional string fields read below. */
function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * [R2 / POO-243] Extract `{ code, message, correlationId }` from a non-2xx pp_api body without
 * collapsing structured errors into SYSTEM_INTERNAL, against EVERY API build we may be deployed
 * against. Precedence, highest first:
 *
 *   1. nested `error: { code, message, correlationId }`  — the new additive envelope (POO-243)
 *   2. top-level `code` / `message`                      — the POO-886 AllExceptionsFilter contract
 *   3. nested `response`                                 — the original Nest shape (string message,
 *      or `{ code?, message: string | string[], error? }` where `error` is the "Bad Request" label)
 *   4. status class                                      — a codeless 429 becomes SYSTEM_RATE_LIMITED
 *
 * The frontend ships before the backend adds (1), so every rung below it must keep working
 * unchanged; that ordering is the whole tolerance requirement, and the tests pin each rung.
 * `body` may be undefined for non-JSON error pages.
 */
export function parseApiErrorBody(status: number, body: unknown): ParsedApiErrorBody {
  let code: string | undefined;
  let message: string | undefined;
  let correlationId: string | undefined;
  if (body !== null && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    // (1) The new nested envelope. Read first so its code wins, per the POO-243 contract.
    const envelope = obj.error;
    if (envelope !== null && typeof envelope === "object" && !Array.isArray(envelope)) {
      const envelopeObj = envelope as Record<string, unknown>;
      code = readString(envelopeObj.code);
      message = readMessage(envelopeObj.message);
      correlationId = readString(envelopeObj.correlationId);
    }
    // (2) Top-level code/message.
    code ??= readString(obj.code);
    message ??= readMessage(obj.message);
    // (3) The original nested Nest `response`.
    const nested = obj.response;
    if (typeof nested === "string" && nested.length > 0) {
      message ??= nested;
    } else if (nested !== null && typeof nested === "object") {
      const nestedObj = nested as Record<string, unknown>;
      code ??= readString(nestedObj.code);
      if (code === undefined) {
        const label = readString(nestedObj.error);
        if (label) code = toMachineCode(label);
      }
      message ??= readMessage(nestedObj.message);
    }
  }
  return {
    // (4) Status-class fallback.
    code: code ?? statusFallbackCode(status),
    message: message ?? "An unexpected error occurred",
    ...(correlationId ? { correlationId } : {}),
  };
}

/** Zod validation failure when the API response does not match the expected schema. */
export class ApiParseError extends Error {
  readonly status = 422;
  readonly code = "SYSTEM_PARSE_ERROR" as const;
  /** Zod validation issues for debugging. */
  readonly issues: ZodIssue[];
  /** The backend's echoed `x-request-id` for the drifted response (POO-243). */
  readonly requestId?: string;

  constructor(message: string, issues: ZodIssue[], requestId?: string) {
    super(message);
    this.name = "ApiParseError";
    this.issues = issues;
    if (requestId) this.requestId = requestId;
  }
}
