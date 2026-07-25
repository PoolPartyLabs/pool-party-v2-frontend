/**
 * @id PP-CORE-LIB-050 (POO-1027)
 * @name Uniswap Trading API server client
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Typed fetch wrapper for the Uniswap Trading API. **Server-only**: used by Server Actions, never
 * imported by the browser. Deliberately mirrors `@/lib/api/client` (`apiFetch`) so this repo has one
 * resilience story for both upstreams: injected key, Zod-validated responses, a bounded retry on the
 * transient class only, and an `AbortController` budget across attempts.
 *
 * **The secret boundary is the point of this file** (ADR 0003). `UNISWAP_API_KEY` has no
 * `NEXT_PUBLIC_` prefix and is read only here. Because nothing is fetched from the browser, no CSP
 * `connect-src` entry for `trade-api.gateway.uniswap.org` is needed, and the ABSENCE of one is
 * load-bearing: if a future change requires it, a call has moved to the client and the boundary has
 * been broken. Treat that diff as a security regression, not a config gap.
 *
 * Note the client also never logs. A key that reaches a log line has leaked just as surely as one in
 * a bundle, and error-reporting pipelines eagerly serialize thrown errors, so the key is never
 * interpolated into a message either (there is a test asserting exactly that).
 *
 * PP-INTEGRATION-POINT: all Uniswap Trading API reads/writes go through {@link uniswapFetch}.
 */
import "server-only";

import type { ZodType } from "zod";
import { parseUniswapErrorBody, UniswapApiError, UniswapParseError } from "./errors";

export { UniswapApiError, UniswapParseError };

/** Documented base URL for the Trading API. */
const BASE_URL = "https://trade-api.gateway.uniswap.org/v1";

/**
 * Transient statuses worth a bounded retry. Mirrors `RETRYABLE_STATUS` in `@/lib/api/client`;
 * everything else (a 400 for a malformed request, a 404 for a pair with no route) fails identically
 * on retry and would only burn the budget.
 */
const RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504]);

/** Total attempts = 1 + MAX_RETRIES. */
const MAX_RETRIES = 2;
/** Exposed so tests assert the cap rather than hard-coding a number that can drift. */
export const uniswapMaxAttempts = MAX_RETRIES + 1;

const BASE_RETRY_DELAY_MS = 300;
const MAX_RETRY_DELAY_MS = 1000;

/**
 * Per-attempt timeout. A quote is a fast call; anything slower than this is a stuck upstream, and
 * without an abort a stuck upstream hangs the Server Action until the platform kills it.
 */
const REQUEST_TIMEOUT_MS = 10_000;
/**
 * Cumulative ceiling across every attempt (timeouts + backoff). A brief blip recovers on the first
 * retry; a sustained outage stops here rather than stacking timeouts. This matters more than usual
 * because provisioning quotes several legs, so a slow path multiplies.
 */
const MAX_TOTAL_MS = 20_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Parse `Retry-After` in delta-seconds form into ms; null when absent or unparseable. */
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

/**
 * Delay before the next attempt, or null to stop. Honors `Retry-After` when the wait is one we are
 * willing to make inside a request; a longer ask means give up, because failing fast beats hanging.
 * Otherwise capped exponential backoff with jitter.
 */
function nextRetryDelayMs(attempt: number, retryAfterMs: number | null): number | null {
  if (retryAfterMs != null) {
    return retryAfterMs <= MAX_RETRY_DELAY_MS ? retryAfterMs : null;
  }
  const expo = Math.min(BASE_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
  return Math.min(expo + Math.random() * BASE_RETRY_DELAY_MS, MAX_RETRY_DELAY_MS);
}

/** Options for {@link uniswapFetch}. */
export interface UniswapFetchOptions<T> {
  /** HTTP method. Defaults to "GET". */
  method?: "GET" | "POST" | "PATCH";
  /** JSON body for POST/PATCH. Serialized automatically. */
  body?: unknown;
  /** Query parameters appended to the path. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Schema the response is validated against before it reaches the caller. Required by [R2]. */
  schema: ZodType<T>;
  /** Next.js cache options, e.g. `{ revalidate: 3600, tags: ["uniswap-tokens"] }`. */
  next?: { revalidate?: number; tags?: string[] };
}

/** Read the server-only key, failing with a typed configuration error rather than a mystery 401. */
function readApiKey(): string {
  const key = process.env.UNISWAP_API_KEY;
  if (!key) {
    throw new UniswapApiError(
      0,
      "UNISWAP_KEY_MISSING",
      "UNISWAP_API_KEY is not configured on the server.",
    );
  }
  return key;
}

/** Build the absolute URL for `path`, appending any defined query parameters. */
function buildUrl(path: string, query: UniswapFetchOptions<unknown>["query"]): string {
  const url = new URL(`${BASE_URL}/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * Read a response body as JSON, tolerating an empty body, a non-JSON body, and a body that cannot be
 * read at all (already consumed, or a stream that errored). A failure to read the body must never
 * become the caller's error: the STATUS is the signal we act on, and losing the detail message is
 * strictly better than replacing a meaningful 503 with an opaque TypeError.
 */
async function readJson(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

/**
 * Call the Uniswap Trading API with server-side credentials.
 *
 * @param path Path without the base, e.g. `"quote"`, `"plan/abc-123"`.
 * @throws {UniswapApiError} On an HTTP or network failure, after exhausting transient retries.
 * @throws {UniswapParseError} When the response does not match `schema`.
 */
export async function uniswapFetch<T>(path: string, options: UniswapFetchOptions<T>): Promise<T> {
  const { method = "GET", body, query, schema, next } = options;
  const apiKey = readApiKey();
  const url = buildUrl(path, query);
  const startedAt = Date.now();

  let lastError: UniswapApiError | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
        ...(next ? { next } : {}),
      });
    } catch (caught) {
      // An abort is our own timeout; both it and a network failure are transient (status 0). The
      // caught error is NOT attached: it can carry the request init, and therefore the key.
      const aborted = (caught as { name?: string })?.name === "AbortError";
      lastError = new UniswapApiError(
        0,
        aborted ? "UNISWAP_TIMEOUT" : "UNISWAP_NETWORK_ERROR",
        aborted
          ? `Uniswap request to "${path}" timed out.`
          : `Uniswap request to "${path}" failed to reach the network.`,
      );
      clearTimeout(timeoutId);
      const delay = nextRetryDelayMs(attempt, null);
      if (
        attempt === MAX_RETRIES ||
        delay == null ||
        Date.now() - startedAt + delay > MAX_TOTAL_MS
      ) {
        throw lastError;
      }
      await sleep(delay);
      continue;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const parsed = parseUniswapErrorBody(response.status, await readJson(response));
      lastError = new UniswapApiError(response.status, parsed.code, parsed.message);

      // Only the transient class is worth another attempt.
      if (!RETRYABLE_STATUS.has(response.status)) throw lastError;

      const delay = nextRetryDelayMs(
        attempt,
        parseRetryAfterMs(response.headers.get("retry-after")),
      );
      if (
        attempt === MAX_RETRIES ||
        delay == null ||
        Date.now() - startedAt + delay > MAX_TOTAL_MS
      ) {
        throw lastError;
      }
      await sleep(delay);
      continue;
    }

    const parsed = schema.safeParse(await readJson(response));
    if (!parsed.success) throw new UniswapParseError(path, parsed.error.issues);
    return parsed.data;
  }

  // Unreachable: the loop either returns or throws. Kept typed rather than a non-null assertion.
  throw lastError ?? new UniswapApiError(0, "UNISWAP_NETWORK_ERROR", "Uniswap request failed.");
}
