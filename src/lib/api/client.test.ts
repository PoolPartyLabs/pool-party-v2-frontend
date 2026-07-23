/**
 * @id PP-CORE (POO-206)
 * @name API client tests
 * @implements-rules-version v3
 *
 * TDD tests for the server-side API client that calls pool-party-api directly
 * with PP_API_KEY. Used by Server Actions only; the browser never imports this.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// server-only is aliased to a noop in vitest.config.ts (resolve.alias).

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function setEnv(url?: string, key?: string) {
  if (url) vi.stubEnv("PP_API_URL", url);
  else delete process.env.PP_API_URL;
  if (key) vi.stubEnv("PP_API_KEY", key);
  else delete process.env.PP_API_KEY;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function upstreamOk(body: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function upstreamError(status: number, body: unknown = { message: "not found" }) {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function upstreamHtml(status: number) {
  mockFetch.mockResolvedValueOnce(
    new Response("<html>Error</html>", {
      status,
      headers: { "content-type": "text/html" },
    }),
  );
}

function upstreamNetworkFailure() {
  mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
}

/**
 * [R12] A request that never responds on its own — it only settles when the caller's
 * AbortSignal fires (the per-attempt timeout). Used to exercise the client-side timeout.
 */
function upstreamHang() {
  mockFetch.mockImplementationOnce(
    (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }),
  );
}

async function importClient() {
  vi.resetModules();
  return import("./client");
}

/** Returns the [url, init] args of the Nth fetch call, asserting the call exists. */
function fetchCall(n = 0): [string, RequestInit] {
  const call = mockFetch.mock.calls[n];
  if (!call) throw new Error(`expected fetch call #${n} but none was made`);
  return call as [string, RequestInit];
}

/** A fetch init that also carries Next's `next` data-cache option (asserted in [R9] tests). */
type NextInit = RequestInit & { next?: { revalidate: number; tags?: string[] } };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("apiClient", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    setEnv("https://api.poolparty.example", "test-api-key-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // -----------------------------------------------------------------------
  // [R1] Server-side URL construction + API key injection
  // -----------------------------------------------------------------------
  describe("URL and headers", () => {
    it("calls {PP_API_URL}/api/v1/{path} with x-api-key", async () => {
      upstreamOk({ data: [] });
      const { apiFetch } = await importClient();

      await apiFetch("pools");

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = fetchCall();
      expect(url).toBe("https://api.poolparty.example/api/v1/pools");
      const headers = init.headers as Headers;
      expect(headers.get("x-api-key")).toBe("test-api-key-secret");
    });

    it("[POO-638] targets /api/v2 when apiVersion is v2 (same host + key)", async () => {
      upstreamOk({ data: {} });
      const { apiFetch } = await importClient();

      await apiFetch("strategies/0xabc", { apiVersion: "v2" });

      const [url, init] = fetchCall();
      expect(url).toBe("https://api.poolparty.example/api/v2/strategies/0xabc");
      expect((init.headers as Headers).get("x-api-key")).toBe("test-api-key-secret");
    });

    it("preserves nested path segments", async () => {
      upstreamOk({ data: {} });
      const { apiFetch } = await importClient();

      await apiFetch("managerIncentiveProgram/0xabc");

      const [url] = fetchCall();
      expect(url).toBe("https://api.poolparty.example/api/v1/managerIncentiveProgram/0xabc");
    });

    it("preserves query parameters", async () => {
      upstreamOk({ data: [] });
      const { apiFetch } = await importClient();

      await apiFetch("pools?network=arbitrum&closed=false");

      const [url] = fetchCall();
      expect(url).toBe("https://api.poolparty.example/api/v1/pools?network=arbitrum&closed=false");
    });

    it("[POO-316] routes a legacy network to PP_API_URL_LEGACY when configured", async () => {
      vi.stubEnv("PP_API_URL_LEGACY", "https://legacy.poolparty.example");
      upstreamOk({ data: [] });
      const { apiFetch } = await importClient();

      await apiFetch("pools?network=arbitrum", { network: "arbitrum" });

      const [url] = fetchCall();
      expect(url).toBe("https://legacy.poolparty.example/api/v1/pools?network=arbitrum");
    });

    it("[POO-316] uses PP_API_URL for a current network even when the legacy URL is set", async () => {
      vi.stubEnv("PP_API_URL_LEGACY", "https://legacy.poolparty.example");
      upstreamOk({ data: [] });
      const { apiFetch } = await importClient();

      await apiFetch("pools?network=polygon", { network: "polygon" });

      const [url] = fetchCall();
      expect(url).toBe("https://api.poolparty.example/api/v1/pools?network=polygon");
    });

    it("[POO-316] falls back to PP_API_URL for a legacy network when no legacy URL is set", async () => {
      upstreamOk({ data: [] });
      const { apiFetch } = await importClient();

      await apiFetch("pools?network=base", { network: "base" });

      const [url] = fetchCall();
      expect(url).toBe("https://api.poolparty.example/api/v1/pools?network=base");
    });

    it("throws ApiError with SYSTEM_NOT_CONFIGURED when PP_API_URL is missing", async () => {
      setEnv(undefined, "key");
      const { apiFetch, ApiError } = await importClient();

      await expect(apiFetch("pools")).rejects.toThrow(ApiError);
      await expect(apiFetch("pools")).rejects.toMatchObject({
        code: "SYSTEM_NOT_CONFIGURED",
        status: 503,
      });
    });

    it("throws ApiError with SYSTEM_NOT_CONFIGURED when PP_API_KEY is missing", async () => {
      setEnv("https://api.example.com", undefined);
      const { apiFetch, ApiError } = await importClient();

      await expect(apiFetch("pools")).rejects.toThrow(ApiError);
    });
  });

  // -----------------------------------------------------------------------
  // [R2] HTTP method support
  // -----------------------------------------------------------------------
  describe("HTTP methods", () => {
    it("defaults to GET", async () => {
      upstreamOk({ data: [] });
      const { apiFetch } = await importClient();

      await apiFetch("pools");

      const [, init] = fetchCall();
      expect(init.method).toBe("GET");
    });

    it("sends POST with JSON body", async () => {
      upstreamOk({ data: { nonce: "abc" } });
      const { apiFetch } = await importClient();
      const payload = { wallet: "0xabc" };

      await apiFetch("auth/nonce", { method: "POST", body: payload });

      const [, init] = fetchCall();
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify(payload));
      const headers = init.headers as Headers;
      expect(headers.get("content-type")).toBe("application/json");
    });

    it("sends DELETE without body", async () => {
      upstreamOk({ data: null });
      const { apiFetch } = await importClient();

      await apiFetch("pools/cache", { method: "DELETE" });

      const [, init] = fetchCall();
      expect(init.method).toBe("DELETE");
      expect(init.body).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // [R5] Envelope unwrap
  // -----------------------------------------------------------------------
  describe("envelope unwrap", () => {
    it("unwraps { data } envelope by default", async () => {
      upstreamOk({ data: { pools: [{ id: 1 }] } });
      const { apiFetch } = await importClient();

      const result = await apiFetch("pools");

      expect(result).toEqual({ pools: [{ id: 1 }] });
    });

    it("returns bare response when there is no data envelope", async () => {
      upstreamOk({ pools: [{ id: 1 }], totalItems: 1 });
      const { apiFetch } = await importClient();

      const result = await apiFetch("pools");

      expect(result).toEqual({ pools: [{ id: 1 }], totalItems: 1 });
    });

    it("skips unwrap when unwrapData is false", async () => {
      upstreamOk({ data: { pools: [] } });
      const { apiFetch } = await importClient();

      const result = await apiFetch("pools", { unwrapData: false });

      expect(result).toEqual({ data: { pools: [] } });
    });

    it("returns null for 204 No Content", async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
      const { apiFetch } = await importClient();

      const result = await apiFetch("pools/cache", { method: "DELETE" });

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // [R6] Zod schema validation
  // -----------------------------------------------------------------------
  describe("schema validation", () => {
    const poolsSchema = z.object({
      pools: z.array(z.object({ id: z.number() })),
    });

    it("validates and returns data when schema matches", async () => {
      upstreamOk({ data: { pools: [{ id: 1 }] } });
      const { apiFetch } = await importClient();

      const result = await apiFetch("pools", { schema: poolsSchema });

      expect(result).toEqual({ pools: [{ id: 1 }] });
    });

    it("throws ApiParseError when schema does not match", async () => {
      upstreamOk({ data: { pools: "not-an-array" } });
      const { apiFetch, ApiParseError } = await importClient();

      try {
        await apiFetch("pools", { schema: poolsSchema });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiParseError);
        expect((err as InstanceType<typeof ApiParseError>).code).toBe("SYSTEM_PARSE_ERROR");
      }
    });
  });

  // -----------------------------------------------------------------------
  // [R3] Error handling: API errors
  // -----------------------------------------------------------------------
  describe("API errors", () => {
    it("throws ApiError with status and code from the response body", async () => {
      upstreamError(404, { message: "Pool not found", code: "POOL_NOT_FOUND" });
      const { apiFetch, ApiError } = await importClient();

      try {
        await apiFetch("pools/0xdead");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as InstanceType<typeof ApiError>;
        expect(apiErr.status).toBe(404);
        expect(apiErr.code).toBe("POOL_NOT_FOUND");
        expect(apiErr.message).toBe("Pool not found");
      }
    });

    it("defaults code to SYSTEM_INTERNAL when response body has no code", async () => {
      upstreamError(500, { message: "Something broke" });
      const { apiFetch } = await importClient();

      try {
        await apiFetch("pools");
      } catch (err) {
        expect((err as { code: string }).code).toBe("SYSTEM_INTERNAL");
      }
    });

    it("handles non-JSON error response (HTML error page)", async () => {
      // 500 is non-transient (not in RETRYABLE_STATUS), so this stays a single-attempt
      // body-parsing test even after [R10] retry was added.
      upstreamHtml(500);
      const { apiFetch, ApiError } = await importClient();

      try {
        await apiFetch("pools");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as InstanceType<typeof ApiError>;
        expect(apiErr.status).toBe(500);
        expect(apiErr.code).toBe("SYSTEM_INTERNAL");
      }
    });
  });

  // -----------------------------------------------------------------------
  // [POO-886 R2] Backend error contract: never collapse a structured error
  // into SYSTEM_INTERNAL when status or nested response data is available.
  // Bodies below are verbatim AllExceptionsFilter output shapes (old + new).
  // -----------------------------------------------------------------------
  describe("[POO-886 R2] backend error contract", () => {
    it("prefers top-level code/message (new filter shape) over the nested response", async () => {
      upstreamError(400, {
        statusCode: 400,
        timestamp: "2026-07-14T00:00:00.000Z",
        path: "/api/v1/portfolio/add-liquidity",
        response: { statusCode: 400, message: ["amount must be positive"], error: "Bad Request" },
        code: "BAD_REQUEST",
        message: "amount must be positive",
      });
      const { apiFetch } = await importClient();

      await expect(
        apiFetch("portfolio/add-liquidity", { method: "POST", body: {} }),
      ).rejects.toMatchObject({
        status: 400,
        code: "BAD_REQUEST",
        message: "amount must be positive",
      });
    });

    it("extracts the message from a nested string response (old shape, plain-Error path)", async () => {
      upstreamError(500, {
        statusCode: 500,
        timestamp: "2026-07-14T00:00:00.000Z",
        path: "/api/v1/portfolio/add-liquidity",
        response:
          "Slippage error: The transaction may not be executed due to slippage. Please try again.",
      });
      const { apiFetch } = await importClient();

      await expect(
        apiFetch("portfolio/add-liquidity", { method: "POST", body: {} }),
      ).rejects.toMatchObject({
        status: 500,
        code: "SYSTEM_INTERNAL",
        message:
          "Slippage error: The transaction may not be executed due to slippage. Please try again.",
      });
    });

    it("extracts code + joined messages from a nested validation response (old shape)", async () => {
      upstreamError(400, {
        statusCode: 400,
        timestamp: "2026-07-14T00:00:00.000Z",
        path: "/api/v1/portfolio/add-liquidity",
        response: {
          statusCode: 400,
          message: ["amount must be positive", "tokenId must be a number string"],
          error: "Bad Request",
        },
      });
      const { apiFetch } = await importClient();

      await expect(
        apiFetch("portfolio/add-liquidity", { method: "POST", body: {} }),
      ).rejects.toMatchObject({
        status: 400,
        code: "BAD_REQUEST",
        message: "amount must be positive; tokenId must be a number string",
      });
    });

    it("prefers a stable nested code over the Nest error label", async () => {
      upstreamError(400, {
        statusCode: 400,
        timestamp: "2026-07-14T00:00:00.000Z",
        path: "/api/v1/portfolio/add-liquidity",
        response: { code: "SLIPPAGE_EXCEEDED", message: "Slippage exceeded" },
      });
      const { apiFetch } = await importClient();

      await expect(
        apiFetch("portfolio/add-liquidity", { method: "POST", body: {} }),
      ).rejects.toMatchObject({
        status: 400,
        code: "SLIPPAGE_EXCEEDED",
        message: "Slippage exceeded",
      });
    });

    it("maps a codeless 429 to SYSTEM_RATE_LIMITED, keeping the throttle prose (old shape)", async () => {
      upstreamError(429, {
        statusCode: 429,
        timestamp: "2026-07-14T00:00:00.000Z",
        path: "/api/v1/portfolio/add-liquidity",
        response: "ThrottlerException: Too Many Requests",
      });
      const { apiFetch } = await importClient();

      await expect(
        apiFetch("portfolio/add-liquidity", { method: "POST", body: {} }),
      ).rejects.toMatchObject({
        status: 429,
        code: "SYSTEM_RATE_LIMITED",
        message: "ThrottlerException: Too Many Requests",
      });
    });

    it("maps a 429 with a non-JSON body to SYSTEM_RATE_LIMITED (never SYSTEM_INTERNAL)", async () => {
      upstreamHtml(429);
      const { apiFetch } = await importClient();

      await expect(
        apiFetch("portfolio/add-liquidity", { method: "POST", body: {} }),
      ).rejects.toMatchObject({
        status: 429,
        code: "SYSTEM_RATE_LIMITED",
      });
    });
  });

  // -----------------------------------------------------------------------
  // [R4] Network failure
  // -----------------------------------------------------------------------
  describe("network failure", () => {
    // [R10] A network failure is transient, so a GET retries within the cap; it surfaces
    // SYSTEM_NETWORK_ERROR only after every attempt fails. Fake timers skip the backoff waits.
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("retries then throws ApiError with SYSTEM_NETWORK_ERROR when every attempt fails", async () => {
      upstreamNetworkFailure();
      upstreamNetworkFailure();
      upstreamNetworkFailure();
      const { apiFetch } = await importClient();

      const promise = apiFetch("pools");
      const assertion = expect(promise).rejects.toMatchObject({
        status: 0,
        code: "SYSTEM_NETWORK_ERROR",
      });
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  // -----------------------------------------------------------------------
  // [R9] Opt-in data cache (revalidate)
  // -----------------------------------------------------------------------
  describe("[R9] data cache", () => {
    it("sets next.revalidate for a GET when revalidate is provided", async () => {
      upstreamOk({ data: [] });
      const { apiFetch } = await importClient();

      await apiFetch("pools?network=polygon", { revalidate: 60 });

      const [, init] = fetchCall();
      expect((init as NextInit).next).toEqual({ revalidate: 60 });
    });

    it("omits next when revalidate is not provided (per-wallet reads stay fresh)", async () => {
      upstreamOk({ data: [] });
      const { apiFetch } = await importClient();

      await apiFetch("portfolio/0xabc");

      const [, init] = fetchCall();
      expect((init as NextInit).next).toBeUndefined();
    });

    it("passes next.tags alongside revalidate for on-demand invalidation", async () => {
      upstreamOk({ data: [] });
      const { apiFetch } = await importClient();

      await apiFetch("pools?network=polygon", { revalidate: 60, tags: ["strategies"] });

      const [, init] = fetchCall();
      expect((init as NextInit).next).toEqual({ revalidate: 60, tags: ["strategies"] });
    });

    it("never caches a non-GET request even if revalidate is passed", async () => {
      upstreamOk({ data: {} });
      const { apiFetch } = await importClient();

      await apiFetch("auth/nonce", { method: "POST", body: {}, revalidate: 60 });

      const [, init] = fetchCall();
      expect((init as NextInit).next).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // [R10] Bounded transient retry
  // -----------------------------------------------------------------------
  describe("[R10] transient retry", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("retries a GET on 429 and resolves when a retry succeeds", async () => {
      upstreamError(429, { message: "Too Many Requests" });
      upstreamOk({ data: { pools: [] } });
      const { apiFetch } = await importClient();

      const promise = apiFetch("pools?network=polygon");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({ pools: [] });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("retries on 503 and on a network error before succeeding", async () => {
      upstreamNetworkFailure();
      upstreamError(503);
      upstreamOk({ data: [] });
      const { apiFetch } = await importClient();

      const promise = apiFetch("pools");
      await vi.runAllTimersAsync();
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("gives up after the retry cap and throws the last ApiError", async () => {
      upstreamError(429);
      upstreamError(429);
      upstreamError(429);
      const { apiFetch } = await importClient();

      const promise = apiFetch("pools");
      const assertion = expect(promise).rejects.toMatchObject({ status: 429 });
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("does NOT retry a non-GET write on 429 (idempotency)", async () => {
      upstreamError(429);
      const { apiFetch } = await importClient();

      const promise = apiFetch("auth/nonce", { method: "POST", body: {} });
      const assertion = expect(promise).rejects.toMatchObject({ status: 429 });
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry a non-transient status (404)", async () => {
      upstreamError(404, { code: "POOL_NOT_FOUND", message: "nope" });
      const { apiFetch } = await importClient();

      const promise = apiFetch("pools/0xdead");
      const assertion = expect(promise).rejects.toMatchObject({ status: 404 });
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("gives up immediately when Retry-After exceeds the SSR cap", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "slow down" }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "60" },
        }),
      );
      const { apiFetch } = await importClient();

      const promise = apiFetch("pools");
      const assertion = expect(promise).rejects.toMatchObject({ status: 429 });
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // [R11] 408 Request Timeout is transient (the backend's own 15s timeout signal)
  // -----------------------------------------------------------------------
  describe("[R11] 408 transient retry", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("retries a GET on 408 and resolves when a retry succeeds", async () => {
      upstreamError(408, { message: "Request timeout" });
      upstreamOk({ data: { pools: [] } });
      const { apiFetch } = await importClient();

      const promise = apiFetch("portfolio/0xabc/all");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({ pools: [] });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("does NOT retry a non-GET write on 408 (idempotency)", async () => {
      upstreamError(408, { message: "Request timeout" });
      const { apiFetch } = await importClient();

      const promise = apiFetch("auth/nonce", { method: "POST", body: {} });
      const assertion = expect(promise).rejects.toMatchObject({ status: 408 });
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("gives up after the cap and throws the last 408 when it never recovers", async () => {
      upstreamError(408);
      upstreamError(408);
      upstreamError(408);
      const { apiFetch } = await importClient();

      const promise = apiFetch("pools?network=polygon");
      const assertion = expect(promise).rejects.toMatchObject({ status: 408 });
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  // -----------------------------------------------------------------------
  // [R12] Bounded per-attempt client timeout (AbortController) + total budget
  // -----------------------------------------------------------------------
  describe("[R12] request timeout", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("passes an AbortSignal to fetch", async () => {
      upstreamOk({ data: [] });
      const { apiFetch } = await importClient();

      await apiFetch("pools");

      const [, init] = fetchCall();
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it("aborts a hanging GET after the per-attempt timeout, then recovers on retry", async () => {
      upstreamHang();
      upstreamOk({ data: { pools: [] } });
      const { apiFetch } = await importClient();

      const promise = apiFetch("portfolio/0xabc/all");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({ pools: [] });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("throws SYSTEM_TIMEOUT (408) when the request keeps timing out, bounded by the budget", async () => {
      upstreamHang();
      upstreamHang();
      upstreamHang();
      const { apiFetch } = await importClient();

      const promise = apiFetch("portfolio/0xabc/all");
      const assertion = expect(promise).rejects.toMatchObject({
        status: 408,
        code: "SYSTEM_TIMEOUT",
      });
      await vi.runAllTimersAsync();
      await assertion;

      // The total-time budget caps attempts below the proxy 504 window — never the full 3.
      const calls = mockFetch.mock.calls.length;
      expect(calls).toBeGreaterThanOrEqual(1);
      expect(calls).toBeLessThanOrEqual(2);
    });

    it("does NOT retry a hanging non-GET write — aborts once and throws SYSTEM_TIMEOUT", async () => {
      upstreamHang();
      const { apiFetch } = await importClient();

      const promise = apiFetch("auth/nonce", { method: "POST", body: {} });
      const assertion = expect(promise).rejects.toMatchObject({
        status: 408,
        code: "SYSTEM_TIMEOUT",
      });
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // [R8] Custom headers forwarding
  // -----------------------------------------------------------------------
  describe("custom headers", () => {
    it("forwards Authorization header", async () => {
      upstreamOk({ data: {} });
      const { apiFetch } = await importClient();

      await apiFetch("portfolio/0xabc", {
        headers: { Authorization: "Bearer jwt-123" },
      });

      const [, init] = fetchCall();
      const headers = init.headers as Headers;
      expect(headers.get("authorization")).toBe("Bearer jwt-123");
      // API key still present
      expect(headers.get("x-api-key")).toBe("test-api-key-secret");
    });
  });
});
