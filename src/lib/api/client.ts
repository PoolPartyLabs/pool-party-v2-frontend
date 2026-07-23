/**
 * @id PP-CORE (POO-206)
 * @name Server-side API client
 * @implements-rules-version v4
 *
 * Typed fetch wrapper for pool-party-api. Server-only: used by Server Actions
 * and Server Components. The browser never imports this module.
 *
 * Reads PP_API_URL and PP_API_KEY from server-only env vars (no NEXT_PUBLIC_ prefix).
 * Injects x-api-key on every request, unwraps the { data } envelope, and validates
 * responses against an optional zod schema.
 *
 * v2 (resilience): the backend rate-limits per-IP (NestJS ThrottlerGuard) and all SSR
 * requests share one container IP, so a `force-dynamic` page that re-fetched on every
 * navigation tripped 429s that bubbled to the error boundary. Two additions fix that:
 * [R9] an opt-in `revalidate` data-cache window (wallet-independent reads stop re-hitting
 * the backend every render) and [R10] a bounded, GET-only retry on transient upstream
 * failures (429/502/503/504/network) so a brief throttle no longer takes the page down.
 *
 * v3 (timeout resilience, POO-398): a brief DB blip in pool-party-api makes core reads
 * (/portfolio, /pools) hang and return HTTP 408 from its own 15s timeout interceptor. Two
 * gaps let that take down the manager console / home / portfolio with a 500 (or a gateway
 * 504 when the SSR `fetch` hung): 408 was treated as fatal, and there was no client timeout.
 * [R11] 408 joins the transient retry class (it is a timeout signal, not a client error).
 * [R12] every attempt has an `AbortController` timeout, with a cumulative budget bounding all
 * retries under the CDN/ALB 504 window — so a blip recovers and a sustained outage fails fast
 * and contained instead of hanging the render.
 *
 * v4 (error contract, POO-886 rules v1): the backend's AllExceptionsFilter historically emitted
 * `{ statusCode, timestamp, path, response }` with NO top-level code/message, so every real
 * backend error surfaced as SYSTEM_INTERNAL. [R13] non-2xx bodies now go through
 * `parseApiErrorBody` (errors.ts): top-level code/message first (new filter contract), nested
 * Nest `response` data second (old contract), status-class fallback last (codeless 429 becomes
 * SYSTEM_RATE_LIMITED). Works against BOTH old and new API shapes.
 *
 * PP-INTEGRATION-POINT: all reads/writes to pool-party-api go through apiFetch().
 */
import "server-only";

import type { ZodType } from "zod";
import { isLegacyNetwork } from "@/lib/chains/config";
import { ApiError, ApiParseError, parseApiErrorBody } from "./errors";

export { ApiError, ApiParseError };

interface ApiFetchOptions<T = unknown> {
  /** HTTP method. Defaults to "GET". */
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  /**
   * pool-party-api version prefix. Defaults to `"v1"` (`/api/v1/...`). The v2 strategy reads/writes
   * (POO-636/POO-307/POO-638) mount at `/api/v2/...`; everything else stays on v1. Same host + key.
   */
  apiVersion?: "v1" | "v2";
  /** JSON body for POST/PUT/PATCH. Serialized automatically. */
  body?: unknown;
  /** Additional headers (e.g. Authorization for authed endpoints). */
  headers?: Record<string, string>;
  /**
   * The API network slug this call targets. Legacy networks (Arbitrum / Base) route to
   * `PP_API_URL_LEGACY` when set; everything else (and an unset legacy URL) uses `PP_API_URL`.
   * Omit for network-agnostic endpoints.
   */
  network?: string;
  /** Zod schema to validate the (unwrapped) response against. */
  schema?: ZodType<T>;
  /**
   * Whether to unwrap the TransformInterceptor `{ data }` envelope.
   * When true (default), if the parsed JSON is `{ data: <payload> }` with no other
   * top-level keys, returns `<payload>`. When false, returns the raw parsed JSON.
   */
  unwrapData?: boolean;
  /**
   * [R9] GET-only Next data-cache window in seconds. OMIT (default) to skip the cache so
   * per-wallet reads (positions, balances) stay fresh. SET it only for wallet-independent
   * reads (e.g. the strategy catalog) so repeated navigations reuse one upstream hit instead
   * of re-fetching on every `force-dynamic` render. Ignored for non-GET requests.
   */
  revalidate?: number;
  /**
   * Cache tags for the GET data-cache entry (Next `next.tags`). Lets a mutation invalidate this read
   * on demand via `revalidateTag(tag)` — e.g. a new pool shows in the catalog right after create
   * instead of waiting out `revalidate`. Ignored without `revalidate` / for non-GET.
   */
  tags?: string[];
}

/** A fetch init that also accepts Next's `next` data-cache options. */
type NextRequestInit = RequestInit & { next?: { revalidate: number; tags?: string[] } };

/**
 * Detect the `{ data: ... }` envelope from NestJS TransformInterceptor.
 * Returns the inner payload if the object has exactly one key named "data".
 */
function maybeUnwrap(json: unknown): unknown {
  if (
    json !== null &&
    typeof json === "object" &&
    !Array.isArray(json) &&
    "data" in json &&
    Object.keys(json).length === 1
  ) {
    return (json as Record<string, unknown>).data;
  }
  return json;
}

/**
 * [R10] Transient upstream statuses worth a bounded retry: throttling (429) and transient
 * gateway/DB blips (502/503/504). [R11] 408 Request Timeout is the backend's own 15s
 * timeout-interceptor signal (a slow/stuck DB query, not a client mistake), so it is transient
 * too — a momentary blip recovers on retry instead of taking the whole SSR render down. Hard
 * errors (4xx other than 408/429, 500) are NOT retried.
 */
const RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504]);
/** [R10] Total attempts = 1 + MAX_RETRIES. Bounded so an SSR render never hangs on retries. */
const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 300;
const MAX_RETRY_DELAY_MS = 1000;

/**
 * [R12] Per-attempt client-side timeout. Without it a stuck upstream hangs the SSR `fetch`
 * indefinitely until the CDN/ALB returns a 504 — the worst outcome (no error we can shape, no
 * retry). We abort each attempt at REQUEST_TIMEOUT_MS (chosen below the backend's own 15s ceiling
 * so we fail before it does, yet above the p99 of a healthy multi-network read) and treat the
 * abort as a transient failure: a GET retries, a write fails fast.
 */
const REQUEST_TIMEOUT_MS = 12_000;
/**
 * [R12] Cumulative ceiling across all attempts (timeout + backoff), kept under the CDN/ALB 504
 * window. A brief blip recovers on the first retry; a *sustained* outage stops here — failing fast
 * and contained (a 408 we can render) beats stacking 3 × REQUEST_TIMEOUT_MS into a gateway 504.
 */
const MAX_TOTAL_MS = 24_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Parse a `Retry-After` header in delta-seconds form into ms; null when absent/unparseable. */
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

/**
 * [R10] Delay before the next attempt, or null to stop retrying. Honors `Retry-After` when the
 * server asks for a wait we are willing to make in SSR; if it asks for longer than the cap we
 * give up (failing fast beats hanging the render). Otherwise: capped exponential backoff + jitter.
 */
function nextRetryDelayMs(attempt: number, retryAfterMs: number | null): number | null {
  if (retryAfterMs != null) {
    return retryAfterMs <= MAX_RETRY_DELAY_MS ? retryAfterMs : null;
  }
  const expo = Math.min(BASE_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
  return Math.min(expo + Math.random() * BASE_RETRY_DELAY_MS, MAX_RETRY_DELAY_MS);
}

/**
 * Fetch from pool-party-api with server-side credentials.
 *
 * @param path - API path without the base (e.g. "pools", "managerIncentiveProgram/0xabc").
 *   Query params can be appended directly (e.g. "pools?network=arbitrum").
 * @param options - Method, body, headers, schema, unwrapData, revalidate.
 * @returns The (optionally unwrapped and validated) response payload, or null for 204.
 * @throws {ApiError} On HTTP errors or network failures (after exhausting transient retries).
 * @throws {ApiParseError} On zod validation failures.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions<T> = {},
): Promise<T | null> {
  const {
    method = "GET",
    apiVersion = "v1",
    body,
    headers: extraHeaders,
    network,
    schema,
    unwrapData = true,
    revalidate,
    tags,
  } = options;

  // Legacy networks (Arbitrum / Base) hit the legacy backend when PP_API_URL_LEGACY is configured;
  // otherwise (and for current networks) the single PP_API_URL is used. The API key is shared.
  const legacyUrl = process.env.PP_API_URL_LEGACY;
  const apiUrl =
    network && isLegacyNetwork(network) && legacyUrl ? legacyUrl : process.env.PP_API_URL;
  const apiKey = process.env.PP_API_KEY;

  // [R1] Missing config: throw immediately. Expected in mock mode.
  if (!apiUrl || !apiKey) {
    throw new ApiError(503, "SYSTEM_NOT_CONFIGURED", "PP_API_URL or PP_API_KEY is not set");
  }

  // [R1] Construct URL: {PP_API_URL}/api/{apiVersion}/{path} (apiVersion defaults to v1).
  const url = `${apiUrl}/api/${apiVersion}/${path}`;

  // [R2] Build headers: x-api-key + content-type for bodies + custom headers.
  const headers = new Headers();
  headers.set("x-api-key", apiKey);
  if (body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      headers.set(name, value);
    }
  }

  const init: NextRequestInit = {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
  // [R9] Opt-in data cache, GET only. Writes and uncached reads keep Next's default (no-store).
  if (method === "GET" && revalidate !== undefined) {
    init.next = tags && tags.length > 0 ? { revalidate, tags } : { revalidate };
  }

  // [R10] Retries are GET-only: replaying a non-idempotent write (deposit, withdraw) is unsafe.
  const canRetry = method === "GET";

  // [R12] Bound the total wall-clock across attempts so retries never push past the CDN/ALB 504
  // window. `canRetryNow` gates every retry decision on both the attempt cap and this budget.
  const startedAt = Date.now();
  const canRetryNow = (attempt: number): boolean =>
    canRetry && attempt < MAX_RETRIES && Date.now() - startedAt < MAX_TOTAL_MS;

  for (let attempt = 0; ; attempt++) {
    // [R12] Each attempt gets its own timeout: abort the fetch if the upstream does not respond
    // within REQUEST_TIMEOUT_MS, rather than hanging the SSR render until the gateway 504s.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      // PP-INTEGRATION-POINT: upstream call to pool-party-api.
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      // [R12] An abort means our own timeout fired; otherwise it is a [R4] network failure. Both
      // are transient, so retry GETs within the cap + budget before giving up.
      const timedOut = controller.signal.aborted;
      if (canRetryNow(attempt)) {
        const delay = nextRetryDelayMs(attempt, null);
        if (delay != null) {
          await sleep(delay);
          continue;
        }
      }
      if (timedOut) {
        throw new ApiError(
          408,
          "SYSTEM_TIMEOUT",
          `Upstream request timed out after ${REQUEST_TIMEOUT_MS}ms`,
        );
      }
      const message = err instanceof Error ? err.message : "Network request failed";
      throw new ApiError(0, "SYSTEM_NETWORK_ERROR", message);
    } finally {
      clearTimeout(timeoutId);
    }

    // [R5] 204 No Content: return null, skip parsing.
    if (response.status === 204) {
      return null;
    }

    // [R3] Non-2xx: retry transient statuses (GET), else parse error body and throw ApiError.
    if (!response.ok) {
      if (canRetryNow(attempt) && RETRYABLE_STATUS.has(response.status)) {
        const delay = nextRetryDelayMs(
          attempt,
          parseRetryAfterMs(response.headers.get("retry-after")),
        );
        if (delay != null) {
          // Discard the unread body before reissuing so the connection can be reused.
          await response.body?.cancel().catch(() => {});
          await sleep(delay);
          continue;
        }
      }
      // [R13] (POO-886 R2) Parse the error body without collapsing structured errors into
      // SYSTEM_INTERNAL: top-level code/message first (new AllExceptionsFilter contract), then
      // the nested Nest { statusCode, response } shape (old contract), then a status-class
      // fallback so a codeless 429 surfaces as SYSTEM_RATE_LIMITED.
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        // Non-JSON error body (e.g. HTML): fall through to the status-class mapping.
      }
      const { code, message } = parseApiErrorBody(response.status, errorBody);
      throw new ApiError(response.status, code, message);
    }

    // [R5] Parse success body.
    const json: unknown = await response.json();

    // [R5] Envelope unwrap.
    const payload = unwrapData ? maybeUnwrap(json) : json;

    // [R6] Zod schema validation.
    if (schema) {
      const result = schema.safeParse(payload);
      if (!result.success) {
        throw new ApiParseError(
          `API response validation failed for ${method} /api/v1/${path}`,
          result.error.issues,
        );
      }
      return result.data;
    }

    return payload as T;
  }
}
