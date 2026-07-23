/**
 * @id PP-REW (POO-207)
 * @name Analytics client
 * @implements-rules-version v1
 *
 * Typed fetch wrapper for the analytics indexer (Data_Analytics_PoolParty).
 * Server-only: used by Server Actions and Server Components. The browser never
 * imports this module.
 *
 * Reads ANALYTICS_API_URL from a server-only env var (no NEXT_PUBLIC_ prefix).
 * Unlike the pool-party-api client (src/lib/api), the analytics controllers mount
 * at root (no /api/v1 prefix), the error body is { error, message } (error = code),
 * and responses are returned as-is (no { data } unwrap — analytics paginates with
 * { data, meta }, so the per-service schema extracts what it needs).
 *
 * Resilience (POO-567): brought to apiFetch v3 parity. Without it a hung analytics upstream
 * hangs SSR until the platform 504s, and a brief blip takes a chart down. [R1] every attempt
 * has an AbortController timeout (REQUEST_TIMEOUT_MS), bounded by a cumulative budget
 * (MAX_TOTAL_MS) kept under the CDN/ALB 504 window, plus a GET-only bounded retry on transient
 * upstream statuses (408/429/502/503/504) and on network/abort. Writes never retry (idempotency);
 * a sustained timeout throws AnalyticsError(408, SYSTEM_TIMEOUT), failing fast and contained.
 *
 * PP-INTEGRATION-POINT: all reads/writes to the analytics indexer go through analyticsFetch().
 */
import "server-only";

import type { ZodType, ZodTypeDef } from "zod";
import type { Session } from "@/lib/services";
import { AnalyticsError, AnalyticsParseError } from "./errors";

export { AnalyticsError, AnalyticsParseError };

interface AnalyticsFetchOptions<T = unknown> {
  /** HTTP method. Defaults to "GET". */
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  /** JSON body for writes. Serialized automatically. */
  body?: unknown;
  /** Additional headers. */
  headers?: Record<string, string>;
  /** Zod schema to validate the response against. The Input type param is `unknown` (not the
   * default Input = Output) so transforming schemas — whose wire Input differs from the parsed
   * Output — infer T from the OUTPUT alone. Plain schemas are unaffected. */
  schema?: ZodType<T, ZodTypeDef, unknown>;
  /**
   * GET-only Next data-cache revalidation window in seconds. Defaults to 60.
   * Use a shorter value (or 0) for fast-changing reads like duck-shoot status.
   * Ignored for non-GET requests, which are always `cache: "no-store"`.
   */
  revalidate?: number;
  /**
   * Explicit fetch cache mode. When set it overrides the default GET revalidation — pass
   * `"no-store"` for reads that must always be fresh (Rubber Rush points/tier/duck-shoot, POO-763 R5).
   */
  cache?: RequestCache;
}

/** A fetch init that also accepts Next's `next` data-cache option. */
type NextRequestInit = RequestInit & { next?: { revalidate: number } };

/**
 * [R1] Transient upstream statuses worth a bounded retry: throttling (429), transient
 * gateway/DB blips (502/503/504), and 408 (the upstream's own timeout signal, not a client
 * mistake). Hard errors (other 4xx, 500) are NOT retried. Mirrors apiFetch v3.
 */
const RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504]);
/** [R1] Total attempts = 1 + MAX_RETRIES. Bounded so an SSR render never hangs on retries. */
const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 300;
const MAX_RETRY_DELAY_MS = 1000;
/**
 * [R1] Per-attempt client-side timeout. Without it a stuck upstream hangs the SSR `fetch`
 * until the CDN/ALB returns a 504. We abort each attempt and treat it as a transient failure:
 * a GET retries, a write fails fast.
 */
const REQUEST_TIMEOUT_MS = 12_000;
/**
 * [R1] Cumulative ceiling across all attempts (timeout + backoff), kept under the CDN/ALB 504
 * window. A brief blip recovers on the first retry; a sustained outage stops here, failing fast
 * and contained (a 408 we can render) instead of stacking timeouts into a gateway 504.
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
 * [R1] Delay before the next attempt, or null to stop retrying. Honors `Retry-After` when the
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
 * Fetch from the analytics indexer with server-side execution.
 *
 * @param path - Path without a leading slash (e.g. "points/0xabc/summary").
 *   Query params can be appended directly.
 * @param options - Method, body, headers, schema, revalidate.
 * @returns The (optionally validated) parsed response, or null for 204.
 * @throws {AnalyticsError} On HTTP errors or network failures.
 * @throws {AnalyticsParseError} On zod validation failures.
 */
export async function analyticsFetch<T = unknown>(
  path: string,
  options: AnalyticsFetchOptions<T> = {},
): Promise<T | null> {
  const base = process.env.ANALYTICS_API_URL;

  // [R1] Missing config: throw immediately. Expected in mock mode.
  if (!base) {
    throw new AnalyticsError(503, "SYSTEM_NOT_CONFIGURED", "ANALYTICS_API_URL is not set");
  }

  const { method = "GET", body, headers: extraHeaders, schema, revalidate = 60, cache } = options;

  // [R2] Root-mounted controllers: no version prefix.
  const url = `${base}/${path}`;

  // [R3] Headers: content-type for bodies + custom headers.
  const headers = new Headers();
  if (body !== undefined) {
    headers.set("content-type", "application/json");
  }
  // POO-763 R6: forward the analytics API key when a server-only env var is configured. No-op today
  // (unset), so it never changes a deployment that doesn't require the key.
  const apiKey = process.env.ANALYTICS_API_KEY;
  if (apiKey) {
    headers.set("x-api-key", apiKey);
  }
  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      headers.set(name, value);
    }
  }

  // [R3] Explicit `cache` wins; else GET → revalidated data cache, non-GET → no-store.
  const init: NextRequestInit = {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
  if (cache) {
    init.cache = cache;
  } else if (method === "GET") {
    init.next = { revalidate };
  } else {
    init.cache = "no-store";
  }

  // [R1] Retries are GET-only: replaying a non-idempotent write (quack, duck-shoot play) is unsafe.
  const canRetry = method === "GET";

  // [R1] Bound the total wall-clock across attempts so retries never push past the CDN/ALB 504
  // window. `canRetryNow` gates every retry decision on both the attempt cap and this budget.
  const startedAt = Date.now();
  const canRetryNow = (attempt: number): boolean =>
    canRetry && attempt < MAX_RETRIES && Date.now() - startedAt < MAX_TOTAL_MS;

  for (let attempt = 0; ; attempt++) {
    // [R1] Each attempt gets its own timeout: abort the fetch if the upstream does not respond
    // within REQUEST_TIMEOUT_MS, rather than hanging the SSR render until the gateway 504s.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      // PP-INTEGRATION-POINT: upstream call to the analytics indexer.
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      // [R1] An abort means our own timeout fired; otherwise it is a [R5] network failure. Both
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
        throw new AnalyticsError(
          408,
          "SYSTEM_TIMEOUT",
          `Upstream request timed out after ${REQUEST_TIMEOUT_MS}ms`,
        );
      }
      const message = err instanceof Error ? err.message : "Network request failed";
      throw new AnalyticsError(0, "SYSTEM_NETWORK_ERROR", message);
    } finally {
      clearTimeout(timeoutId);
    }

    // [R7] 204 No Content: return null, skip parsing.
    if (response.status === 204) {
      return null;
    }

    // [R4] Non-2xx: retry transient statuses (GET), else parse { error, message } and throw.
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
      let code = "SYSTEM_INTERNAL";
      let message = "An unexpected error occurred";
      try {
        const errorBody: unknown = await response.json();
        if (errorBody && typeof errorBody === "object") {
          const obj = errorBody as Record<string, unknown>;
          // Points endpoints return { error, message }; duck-shoot returns
          // { ok: false, reason }. Accept either as the error code.
          if (typeof obj.error === "string") code = obj.error;
          else if (typeof obj.reason === "string") code = obj.reason;
          if (typeof obj.message === "string") message = obj.message;
        }
      } catch {
        // Non-JSON error body (e.g. HTML): use defaults.
      }
      throw new AnalyticsError(response.status, code, message);
    }

    // [R7] Parse success body. No envelope unwrap.
    const json: unknown = await response.json();

    // [R6] Zod schema validation.
    if (schema) {
      const result = schema.safeParse(json);
      if (!result.success) {
        throw new AnalyticsParseError(
          `Analytics response validation failed for ${method} /${path}`,
          result.error.issues,
        );
      }
      return result.data;
    }

    return json as T;
  }
}

/**
 * [R8] Resolve the connected wallet address for an analytics call.
 *
 * Analytics endpoints are keyed by wallet address; this throws a typed error
 * (rather than sending a request that would 404) when no wallet is connected.
 *
 * @throws {AnalyticsError} 401 WALLET_NOT_CONNECTED when the session is absent
 *   or carries no address.
 */
export function requireWalletAddress(session: Session | null | undefined): string {
  if (!session?.address) {
    throw new AnalyticsError(401, "WALLET_NOT_CONNECTED", "No wallet is connected");
  }
  return session.address;
}
