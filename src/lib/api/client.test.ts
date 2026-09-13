/**
 * @id PP-CORE (POO-206; POO-1551 revision)
 * @name API client tests
 * @implements-rules-version v4 (POO-1551 rules v2) · v3
 *
 * TDD tests for the server-side API client that calls pool-party-api directly
 * with PP_API_KEY. Used by Server Actions only; the browser never imports this.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { activeSentryTraceId } from "@/lib/observability/sentry/traceId";

// server-only is aliased to a noop in vitest.config.ts (resolve.alias).

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

/**
 * POO-1147: the Sentry bridge `getRequestTraceId` reads. It returns `undefined` by default, which is
 * "Sentry disabled" and therefore exactly the behaviour every pre-existing test below was written
 * against; the POO-1147 block at the bottom is the only place it returns an id.
 */
vi.mock("@/lib/observability/sentry/traceId", () => ({ activeSentryTraceId: vi.fn() }));
const sentryTraceId = vi.mocked(activeSentryTraceId);

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

    // POO-1777 [R1]: Robinhood Chain (4663) runs the CURRENT v0.5.x manager, so it must reach the
    // current backend even in the environments that still configure a legacy one. There is no
    // per-chain branch to get wrong here, only the `isLegacy` datum on ChainMeta, and a wrong one
    // fails at the wallet prompt rather than at the call.
    it("[POO-1777] uses PP_API_URL for robinhood even when the legacy URL is set", async () => {
      vi.stubEnv("PP_API_URL_LEGACY", "https://legacy.poolparty.example");
      upstreamOk({ data: [] });
      const { apiFetch } = await importClient();

      await apiFetch("pools?network=robinhood", { network: "robinhood" });

      const [url] = fetchCall();
      expect(url).toBe("https://api.poolparty.example/api/v1/pools?network=robinhood");
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

    // POO-1551: the example is a real state-changing write. It used to be `auth/nonce`, which now
    // opts INTO retry via [R16] - leaving it here would document the opposite of the shipped rule.
    it("does NOT retry a non-GET write on 429 (idempotency)", async () => {
      upstreamError(429);
      const { apiFetch } = await importClient();

      const promise = apiFetch("portfolio/build/add-liquidity-tx", { method: "POST", body: {} });
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
  // [R16] Per-call opt-in retry for a non-GET request that is SAFE TO REPLAY (POO-1551)
  // -----------------------------------------------------------------------
  describe("[R16] safeToReplay opt-in retry", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    // The reported incident (reference 2c7e8a851b3f469b8b99c35581007a1b): pp_api was recreated and
    // its port stayed closed for ~34s while migrations ran. One connection refusal on the nonce
    // POST was a hard sign-in failure, because the GET-only gate gave it zero attempts.
    it("retries a safe-to-replay POST through a transport failure", async () => {
      upstreamNetworkFailure();
      upstreamOk({ data: { nonce: "n-1" } });
      const { apiFetch } = await importClient();

      const promise = apiFetch("auth/nonce", {
        method: "POST",
        body: {},
        safeToReplay: true,
      });
      await vi.runAllTimersAsync();

      expect(await promise).toEqual({ nonce: "n-1" });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("retries a safe-to-replay POST on a transient status", async () => {
      upstreamError(503);
      upstreamOk({ data: { nonce: "n-2" } });
      const { apiFetch } = await importClient();

      const promise = apiFetch("auth/nonce", { method: "POST", body: {}, safeToReplay: true });
      await vi.runAllTimersAsync();

      expect(await promise).toEqual({ nonce: "n-2" });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    // The opt-in widens WHICH methods may retry. It must not widen the attempt cap, the time
    // budget, or which statuses count as transient - a sustained outage still fails fast.
    it("still gives up after the retry cap when the upstream never returns", async () => {
      upstreamNetworkFailure();
      upstreamNetworkFailure();
      upstreamNetworkFailure();
      const { apiFetch } = await importClient();

      const promise = apiFetch("auth/nonce", { method: "POST", body: {}, safeToReplay: true });
      const assertion = expect(promise).rejects.toMatchObject({
        status: 0,
        code: "SYSTEM_NETWORK_ERROR",
      });
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("does NOT retry a safe-to-replay POST on a non-transient status", async () => {
      upstreamError(400, { code: "AUTH_WALLET_INVALID", message: "bad wallet" });
      const { apiFetch } = await importClient();

      const promise = apiFetch("auth/nonce", { method: "POST", body: {}, safeToReplay: true });
      const assertion = expect(promise).rejects.toMatchObject({ status: 400 });
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // [R3] The gate stays OPT-IN. A write that does not name itself replayable keeps the exact
    // protection it has today, which is the whole reason this is a per-call flag and not a
    // relaxation of the GET-only default.
    it("leaves an unmarked POST unretried", async () => {
      upstreamNetworkFailure();
      const { apiFetch } = await importClient();

      const promise = apiFetch("portfolio/build/add-liquidity-tx", { method: "POST", body: {} });
      const assertion = expect(promise).rejects.toMatchObject({ code: "SYSTEM_NETWORK_ERROR" });
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

      const promise = apiFetch("portfolio/build/add-liquidity-tx", { method: "POST", body: {} });
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

      const promise = apiFetch("portfolio/build/add-liquidity-tx", { method: "POST", body: {} });
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

  // -----------------------------------------------------------------------
  // [R14]/[R15] Observability + the cross-service trace contract (POO-243)
  // -----------------------------------------------------------------------
  describe("[R14] trace context", () => {
    it("sends a W3C traceparent and x-request-id on an uncached request", async () => {
      upstreamOk({ data: {} });
      const { apiFetch } = await importClient();

      await apiFetch("pools");

      const headers = fetchCall()[1].headers as Headers;
      const traceparent = headers.get("traceparent") ?? "";
      expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
      // The contract: x-request-id IS the trace id, so one value correlates both hops.
      expect(headers.get("x-request-id")).toBe(traceparent.split("-")[1]);
    });

    /**
     * Next keys a data-cached fetch on its HEADERS and strips only `traceparent`/`tracestate`
     * (incremental-cache `calculateCacheKey`). A per-request `x-request-id` would make every cached
     * GET a permanent MISS, silently undoing the [R9] window POO-453 added to survive the per-IP
     * throttle. The trace id is still on the wire inside `traceparent`, so nothing is lost.
     */
    it("OMITS x-request-id on a data-cached GET so the fetch cache key stays stable", async () => {
      upstreamOk({ data: {} });
      const { apiFetch } = await importClient();

      await apiFetch("pools", { revalidate: 60 });

      const headers = fetchCall()[1].headers as Headers;
      expect(headers.get("traceparent")).toMatch(/^00-[0-9a-f]{32}-/);
      expect(headers.get("x-request-id")).toBeNull();
    });

    it("still sends x-request-id on a write (never data-cached)", async () => {
      upstreamOk({ data: {} });
      const { apiFetch } = await importClient();

      await apiFetch("pools", { method: "POST", body: {}, revalidate: 60 });

      expect((fetchCall()[1].headers as Headers).get("x-request-id")).toMatch(/^[0-9a-f]{32}$/);
    });

    it("lets an explicit caller header win over the injected one", async () => {
      upstreamOk({ data: {} });
      const { apiFetch } = await importClient();

      await apiFetch("pools", { headers: { "x-request-id": "caller-supplied" } });

      expect((fetchCall()[1].headers as Headers).get("x-request-id")).toBe("caller-supplied");
    });

    it("attaches the backend's echoed x-request-id to a thrown ApiError", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "POOL_NOT_FOUND", message: "nope" }), {
          status: 404,
          headers: { "content-type": "application/json", "x-request-id": "req-from-backend" },
        }),
      );
      const { apiFetch, ApiError } = await importClient();

      const error = (await apiFetch("pools/0xabc").catch((e: unknown) => e)) as InstanceType<
        typeof ApiError
      >;
      expect(error).toBeInstanceOf(ApiError);
      expect(error.code).toBe("POOL_NOT_FOUND");
      expect(error.requestId).toBe("req-from-backend");
    });

    it("prefers the error envelope's correlationId over the transport header", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            statusCode: 500,
            error: { code: "STRATEGY_SYNC_FAILED", message: "boom", correlationId: "corr-1" },
          }),
          {
            status: 500,
            headers: { "content-type": "application/json", "x-request-id": "transport-1" },
          },
        ),
      );
      const { apiFetch } = await importClient();

      const error = (await apiFetch("pools").catch((e: unknown) => e)) as {
        code: string;
        requestId?: string;
      };
      expect(error.code).toBe("STRATEGY_SYNC_FAILED");
      expect(error.requestId).toBe("corr-1");
    });
  });

  describe("[R15] zod failures are logged, not discarded", () => {
    /**
     * THE regression this whole change exists for. In a Server Component the throw below is a 500
     * for the entire route segment, and until POO-243 the `ZodIssue[]` — the only artefact naming
     * WHICH field drifted — was dropped on the way out. The outage was then detected by a user
     * complaining, and diagnosed with nothing.
     */
    it("logs the drifted field path, expected and received BEFORE throwing", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { tvlUsd: "1200.5" } }), {
          status: 200,
          headers: { "content-type": "application/json", "x-request-id": "req-9" },
        }),
      );
      const { apiFetch, ApiParseError } = await importClient();
      const schema = z.object({ tvlUsd: z.number() });

      await expect(apiFetch("pools/0xabc", { schema })).rejects.toThrow(ApiParseError);

      expect(errorSpy).toHaveBeenCalledOnce();
      const record = JSON.parse(String(errorSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
      expect(record).toMatchObject({
        level: "error",
        event: "api.response_parse_failed",
        endpoint: "GET /api/v1/pools/0xabc",
        status: 200,
        code: "SYSTEM_PARSE_ERROR",
        requestId: "req-9",
        issueCount: 1,
      });
      expect(record.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(record.issues).toEqual([
        expect.objectContaining({ path: "tvlUsd", expected: "number", received: "string" }),
      ]);
      errorSpy.mockRestore();
    });

    it("masks a wallet address in the logged endpoint (never a raw identity in a log)", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const wallet = "0x1234567890abcdef1234567890abcdef12345678";
      upstreamOk({ data: { total: "x" } });
      const { apiFetch } = await importClient();

      await apiFetch(`portfolio/${wallet}`, {
        schema: z.object({ total: z.number() }),
      }).catch(() => {});

      const line = String(errorSpy.mock.calls[0]?.[0]);
      expect(line).not.toContain(wallet);
      expect(line).toContain("0x1234…5678");
      errorSpy.mockRestore();
    });

    it("still carries the issues on the thrown ApiParseError for callers that branch on them", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      upstreamOk({ data: { tvlUsd: "1200.5" } });
      const { apiFetch } = await importClient();

      const error = (await apiFetch("pools", {
        schema: z.object({ tvlUsd: z.number() }),
      }).catch((e: unknown) => e)) as { issues: unknown[] };
      expect(error.issues).toHaveLength(1);
      vi.restoreAllMocks();
    });

    it("logs nothing on a successful parse", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      upstreamOk({ data: { tvlUsd: 1200.5 } });
      const { apiFetch } = await importClient();

      await apiFetch("pools", { schema: z.object({ tvlUsd: z.number() }) });

      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // POO-1147: the Sentry trace id on the wire, and the data-cache key it must not disturb
  // -----------------------------------------------------------------------
  describe("[POO-1147] Sentry trace id and cache-key stability", () => {
    /** The headers Next actually keys a cached fetch on: everything it does NOT strip. */
    function cacheKeyHeaders(n: number): [string, string][] {
      const headers = new Headers(fetchCall(n)[1].headers);
      // `incremental-cache/index.js` deletes exactly these two before hashing the key.
      headers.delete("traceparent");
      headers.delete("tracestate");
      return [...headers.entries()].sort();
    }

    it("puts SENTRY's trace id on the wire, so the API logs the id the Sentry issue shows", async () => {
      const sentryId = "0af7651916cd43dd8448eb211c80319c";
      sentryTraceId.mockReturnValue(sentryId);
      upstreamOk({ data: {} });
      const { apiFetch } = await importClient();

      await apiFetch("pools");

      const headers = fetchCall()[1].headers as Headers;
      expect(headers.get("traceparent")).toBe(
        `00-${sentryId}-${headers.get("traceparent")?.split("-")[2]}-01`,
      );
      expect(headers.get("traceparent")?.split("-")[1]).toBe(sentryId);
      // Same value as the correlation id the backend echoes back and logs against.
      expect(headers.get("x-request-id")).toBe(sentryId);
    });

    it("falls back to a minted id when Sentry is disabled, and still sends a valid traceparent", async () => {
      sentryTraceId.mockReturnValue(undefined);
      upstreamOk({ data: {} });
      const { apiFetch } = await importClient();

      await apiFetch("pools");

      expect((fetchCall()[1].headers as Headers).get("traceparent")).toMatch(
        /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/,
      );
    });

    /**
     * THE regression test the vendor layer needs. Next derives a data-cached fetch's key from its
     * headers and strips ONLY `traceparent`/`tracestate`, so ANY other per-request header - POO-243's
     * `x-request-id`, or Sentry's `sentry-trace`/`baggage` - turns every cached GET into a permanent
     * MISS and silently undoes POO-453's per-IP throttle mitigation.
     *
     * Sentry's Node SDK injects its headers from the `undici:request:create` diagnostics channel,
     * i.e. inside the dispatch and AFTER Next has computed the key from this `RequestInit`, so it
     * cannot reach the key. That is a property of two other projects, not of ours; this test pins
     * OUR half of it - the headers we hand to `fetch` do not vary per request once the two stripped
     * ones are removed - so a regression on this side fails here rather than in production.
     */
    it("keeps a data-cached GET's cache-key headers byte-identical across two renders", async () => {
      sentryTraceId.mockReturnValue(undefined);
      upstreamOk({ data: {} });
      upstreamOk({ data: {} });
      const { apiFetch } = await importClient();

      await apiFetch("pools", { revalidate: 60 });
      await apiFetch("pools", { revalidate: 60 });

      // Different renders, so genuinely different trace ids...
      const traceparents = [0, 1].map((n) =>
        (fetchCall(n)[1].headers as Headers).get("traceparent"),
      );
      expect(traceparents[0]).not.toBe(traceparents[1]);
      // ...and an identical cache key regardless.
      expect(cacheKeyHeaders(0)).toEqual(cacheKeyHeaders(1));
    });

    it("sends no Sentry header of its own on a data-cached GET", async () => {
      sentryTraceId.mockReturnValue("0af7651916cd43dd8448eb211c80319c");
      upstreamOk({ data: {} });
      const { apiFetch } = await importClient();

      await apiFetch("pools", { revalidate: 60 });

      const headers = fetchCall()[1].headers as Headers;
      // Not in Next's strip list: either of these in the RequestInit would be a permanent cache MISS.
      expect(headers.get("sentry-trace")).toBeNull();
      expect(headers.get("baggage")).toBeNull();
      expect(headers.get("x-request-id")).toBeNull();
    });
  });
});
