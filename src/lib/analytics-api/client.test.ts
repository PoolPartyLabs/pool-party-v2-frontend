/**
 * @id PP-REW (POO-207)
 * @name Analytics client tests
 * @implements-rules-version v1
 *
 * TDD tests for the server-side Analytics HTTP client (Data_Analytics_PoolParty).
 * Server-only: used by Server Actions / Server Components only; the browser never
 * imports it. Mirrors src/lib/api/ (POO-206) but for the analytics indexer, whose
 * controllers mount at root (no /api/v1 prefix) and whose error body is { error, message }.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// server-only is aliased to a noop in vitest.config.ts (resolve.alias).

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function setEnv(url?: string) {
  if (url) vi.stubEnv("ANALYTICS_API_URL", url);
  else delete process.env.ANALYTICS_API_URL;
}

function setApiKey(key?: string) {
  if (key) vi.stubEnv("ANALYTICS_API_KEY", key);
  else delete process.env.ANALYTICS_API_KEY;
}

function upstreamOk(body: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function upstreamError(status: number, body: unknown = { error: "WALLET_NOT_FOUND" }) {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function upstreamHtml(status: number) {
  mockFetch.mockResolvedValueOnce(
    new Response("<html>Bad Gateway</html>", {
      status,
      headers: { "content-type": "text/html" },
    }),
  );
}

function upstreamNetworkFailure() {
  mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
}

/**
 * [R1] A request that never responds on its own — it settles only when the caller's
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
function fetchCall(n = 0): [string, RequestInit & { next?: { revalidate?: number } }] {
  const call = mockFetch.mock.calls[n];
  if (!call) throw new Error(`expected fetch call #${n} but none was made`);
  return call as [string, RequestInit & { next?: { revalidate?: number } }];
}

describe("analyticsFetch", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    setEnv("https://analytics.poolparty.example");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // -----------------------------------------------------------------------
  // [R1][R2] URL construction + config
  // -----------------------------------------------------------------------
  describe("URL and config", () => {
    it("calls {ANALYTICS_API_URL}/{path} with no version prefix", async () => {
      upstreamOk({ totalPoints: 0 });
      const { analyticsFetch } = await importClient();

      await analyticsFetch("points/0xabc/summary");

      const [url] = fetchCall();
      expect(url).toBe("https://analytics.poolparty.example/points/0xabc/summary");
    });

    it("preserves query parameters", async () => {
      upstreamOk({ data: [], meta: {} });
      const { analyticsFetch } = await importClient();

      await analyticsFetch("analytics/wallets/0xabc/transactions?limit=20");

      const [url] = fetchCall();
      expect(url).toBe(
        "https://analytics.poolparty.example/analytics/wallets/0xabc/transactions?limit=20",
      );
    });

    it("throws AnalyticsError SYSTEM_NOT_CONFIGURED when ANALYTICS_API_URL is missing", async () => {
      setEnv(undefined);
      const { analyticsFetch, AnalyticsError } = await importClient();

      await expect(analyticsFetch("points/0xabc/summary")).rejects.toThrow(AnalyticsError);
      await expect(analyticsFetch("points/0xabc/summary")).rejects.toMatchObject({
        code: "SYSTEM_NOT_CONFIGURED",
        status: 503,
      });
    });
  });

  // -----------------------------------------------------------------------
  // [R3] Caching semantics
  // -----------------------------------------------------------------------
  describe("caching", () => {
    it("GET sets next.revalidate to 60 by default and no cache override", async () => {
      upstreamOk({ totalPoints: 1 });
      const { analyticsFetch } = await importClient();

      await analyticsFetch("points/0xabc/summary");

      const [, init] = fetchCall();
      expect(init.next).toEqual({ revalidate: 60 });
      expect(init.cache).toBeUndefined();
      expect(init.method).toBe("GET");
    });

    it("GET honors a caller-provided revalidate (e.g. duck-shoot status)", async () => {
      upstreamOk({ triesRemaining: 3 });
      const { analyticsFetch } = await importClient();

      await analyticsFetch("points/0xabc/duck-shoot/status", { revalidate: 5 });

      const [, init] = fetchCall();
      expect(init.next).toEqual({ revalidate: 5 });
    });

    it("non-GET sets cache no-store and no next.revalidate", async () => {
      upstreamOk({ pointsAwarded: 10 });
      const { analyticsFetch } = await importClient();

      await analyticsFetch("points/quacks/daily", {
        method: "POST",
        body: { wallet: "0xabc", signature: "0xsig", date: "2026-06-10" },
      });

      const [, init] = fetchCall();
      expect(init.cache).toBe("no-store");
      expect(init.next).toBeUndefined();
    });

    // POO-763 R5: Rubber Rush always-fresh reads pass an explicit `cache` that must win over the
    // default GET revalidation and land verbatim in the fetch RequestInit.
    it("forwards an explicit cache override into fetch and skips next.revalidate", async () => {
      upstreamOk({ triesRemaining: 3 });
      const { analyticsFetch } = await importClient();

      await analyticsFetch("points/0xabc/duck-shoot/status", { cache: "no-store" });

      const [, init] = fetchCall();
      expect(init.cache).toBe("no-store");
      expect(init.next).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // [R3] Body + headers
  // -----------------------------------------------------------------------
  describe("body and headers", () => {
    it("POST serializes JSON body and sets content-type", async () => {
      upstreamOk({ pointsAwarded: 10 });
      const { analyticsFetch } = await importClient();
      const payload = { wallet: "0xabc" };

      await analyticsFetch("points/duck-shoot/play", { method: "POST", body: payload });

      const [, init] = fetchCall();
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify(payload));
      const headers = init.headers as Headers;
      expect(headers.get("content-type")).toBe("application/json");
    });
  });

  // -----------------------------------------------------------------------
  // POO-763 R6: env-gated x-api-key header (no-op when the key env is unset)
  // -----------------------------------------------------------------------
  describe("x-api-key header", () => {
    afterEach(() => setApiKey(undefined));

    it("attaches x-api-key when ANALYTICS_API_KEY is set", async () => {
      setApiKey("secret-analytics-key");
      upstreamOk({ totalPoints: 0 });
      const { analyticsFetch } = await importClient();

      await analyticsFetch("points/0xabc/summary");

      const [, init] = fetchCall();
      const headers = init.headers as Headers;
      expect(headers.get("x-api-key")).toBe("secret-analytics-key");
    });

    it("does NOT attach x-api-key when ANALYTICS_API_KEY is unset", async () => {
      setApiKey(undefined);
      upstreamOk({ totalPoints: 0 });
      const { analyticsFetch } = await importClient();

      await analyticsFetch("points/0xabc/summary");

      const [, init] = fetchCall();
      const headers = init.headers as Headers;
      expect(headers.has("x-api-key")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // [R7] Response handling (no envelope unwrap)
  // -----------------------------------------------------------------------
  describe("response handling", () => {
    it("returns the parsed body as-is (does NOT unwrap { data, meta })", async () => {
      upstreamOk({ data: [{ id: 1 }], meta: { total: 1 } });
      const { analyticsFetch } = await importClient();

      const result = await analyticsFetch("analytics/wallets/0xabc/transactions");

      expect(result).toEqual({ data: [{ id: 1 }], meta: { total: 1 } });
    });

    it("returns a bare object without unwrapping a lone data key", async () => {
      upstreamOk({ data: { totalPoints: 42 } });
      const { analyticsFetch } = await importClient();

      const result = await analyticsFetch("points/0xabc/summary");

      expect(result).toEqual({ data: { totalPoints: 42 } });
    });

    it("returns null for 204 No Content", async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
      const { analyticsFetch } = await importClient();

      const result = await analyticsFetch("points/0xabc/something", { method: "POST" });

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // [R6] Zod schema validation
  // -----------------------------------------------------------------------
  describe("schema validation", () => {
    const summarySchema = z.object({ totalPoints: z.number() });

    it("validates and returns data when the schema matches", async () => {
      upstreamOk({ totalPoints: 1200, extra: "ignored" });
      const { analyticsFetch } = await importClient();

      const result = await analyticsFetch("points/0xabc/summary", { schema: summarySchema });

      expect(result).toEqual({ totalPoints: 1200 });
    });

    it("throws AnalyticsParseError when a required field is missing", async () => {
      upstreamOk({ notTotalPoints: 1 });
      const { analyticsFetch, AnalyticsParseError } = await importClient();

      try {
        await analyticsFetch("points/0xabc/summary", { schema: summarySchema });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AnalyticsParseError);
        expect((err as InstanceType<typeof AnalyticsParseError>).code).toBe("SYSTEM_PARSE_ERROR");
        expect((err as InstanceType<typeof AnalyticsParseError>).status).toBe(422);
      }
    });
  });

  // -----------------------------------------------------------------------
  // [R4] API errors ({ error, message } envelope)
  // -----------------------------------------------------------------------
  describe("API errors", () => {
    it("parses { error, message } into AnalyticsError with code from error", async () => {
      upstreamError(404, { error: "WALLET_NOT_FOUND", message: "no wallet" });
      const { analyticsFetch, AnalyticsError } = await importClient();

      try {
        await analyticsFetch("points/0xdead/summary");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AnalyticsError);
        const e = err as InstanceType<typeof AnalyticsError>;
        expect(e.status).toBe(404);
        expect(e.code).toBe("WALLET_NOT_FOUND");
        expect(e.message).toBe("no wallet");
      }
    });

    it("falls back to { ok: false, reason } for the code (duck-shoot envelope)", async () => {
      upstreamError(400, { ok: false, reason: "NO_TRIES" });
      const { analyticsFetch, AnalyticsError } = await importClient();

      try {
        await analyticsFetch("points/duck-shoot/play", { method: "POST", body: {} });
        expect.unreachable("should have thrown");
      } catch (err) {
        const e = err as InstanceType<typeof AnalyticsError>;
        expect(e.status).toBe(400);
        expect(e.code).toBe("NO_TRIES");
      }
    });

    it("prefers error over reason when both are present", async () => {
      upstreamError(409, { error: "ALREADY_CLAIMED", reason: "SOMETHING", message: "dup" });
      const { analyticsFetch, AnalyticsError } = await importClient();

      try {
        await analyticsFetch("points/quacks/daily", { method: "POST", body: {} });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as InstanceType<typeof AnalyticsError>).code).toBe("ALREADY_CLAIMED");
      }
    });

    it("maps a coded write error (ALREADY_CLAIMED)", async () => {
      upstreamError(409, { error: "ALREADY_CLAIMED", message: "already checked in" });
      const { analyticsFetch, AnalyticsError } = await importClient();

      try {
        await analyticsFetch("points/quacks/daily", { method: "POST", body: {} });
        expect.unreachable("should have thrown");
      } catch (err) {
        const e = err as InstanceType<typeof AnalyticsError>;
        expect(e.status).toBe(409);
        expect(e.code).toBe("ALREADY_CLAIMED");
      }
    });

    it("defaults code to SYSTEM_INTERNAL when the body has no error field", async () => {
      upstreamError(500, { message: "boom" });
      const { analyticsFetch } = await importClient();

      try {
        await analyticsFetch("points/0xabc/summary");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as { code: string }).code).toBe("SYSTEM_INTERNAL");
      }
    });

    it("handles a non-JSON error body (HTML)", async () => {
      // 500 is non-transient (not in RETRYABLE_STATUS), so this stays a single attempt.
      upstreamHtml(500);
      const { analyticsFetch, AnalyticsError } = await importClient();

      try {
        await analyticsFetch("points/0xabc/summary");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AnalyticsError);
        const e = err as InstanceType<typeof AnalyticsError>;
        expect(e.status).toBe(500);
        expect(e.code).toBe("SYSTEM_INTERNAL");
      }
    });
  });

  // -----------------------------------------------------------------------
  // [R5] Network failure
  // -----------------------------------------------------------------------
  describe("network failure", () => {
    // [R1] A network failure is transient, so a GET retries within the cap; it surfaces
    // SYSTEM_NETWORK_ERROR only after every attempt fails. Fake timers skip the backoff waits.
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("retries then throws SYSTEM_NETWORK_ERROR when every attempt fails", async () => {
      upstreamNetworkFailure();
      upstreamNetworkFailure();
      upstreamNetworkFailure();
      const { analyticsFetch } = await importClient();

      const promise = analyticsFetch("points/0xabc/summary");
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
  // [R8] Wallet threading
  // -----------------------------------------------------------------------
  describe("requireWalletAddress", () => {
    it("returns the session address when a wallet is connected", async () => {
      const { requireWalletAddress } = await importClient();
      const address = requireWalletAddress({
        userId: "u1",
        method: "google",
        address: "0xWALLET",
        isNewWallet: false,
      });
      expect(address).toBe("0xWALLET");
    });

    it("throws AnalyticsError WALLET_NOT_CONNECTED when the session is null", async () => {
      const { requireWalletAddress, AnalyticsError } = await importClient();
      try {
        requireWalletAddress(null);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AnalyticsError);
        const e = err as InstanceType<typeof AnalyticsError>;
        expect(e.status).toBe(401);
        expect(e.code).toBe("WALLET_NOT_CONNECTED");
      }
    });

    it("throws WALLET_NOT_CONNECTED when the address is empty", async () => {
      const { requireWalletAddress, AnalyticsError } = await importClient();
      try {
        requireWalletAddress({ userId: "u1", method: "google", address: "", isNewWallet: false });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AnalyticsError);
        expect((err as InstanceType<typeof AnalyticsError>).code).toBe("WALLET_NOT_CONNECTED");
      }
    });
  });

  // -----------------------------------------------------------------------
  // [R1] Resilience: bounded GET-only transient retry (mirrors apiFetch v3)
  // -----------------------------------------------------------------------
  describe("[R1] transient retry", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("retries a GET on 503 and resolves when a retry succeeds", async () => {
      upstreamError(503, { error: "SYSTEM_INTERNAL", message: "unavailable" });
      upstreamOk({ series: [] });
      const { analyticsFetch } = await importClient();

      const promise = analyticsFetch("analytics/pools/0xpool/timeseries");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({ series: [] });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("retries on a network error then a transient 429 before succeeding", async () => {
      upstreamNetworkFailure();
      upstreamError(429);
      upstreamOk({ totalPoints: 7 });
      const { analyticsFetch } = await importClient();

      const promise = analyticsFetch("points/0xabc/summary");
      await vi.runAllTimersAsync();
      const result = await promise;

      // network failure (retryable) → 429 (retryable) → success = 3 attempts (1 + MAX_RETRIES).
      expect(result).toEqual({ totalPoints: 7 });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("retries a GET on 408 (upstream timeout signal) and resolves on retry", async () => {
      upstreamError(408, { error: "SYSTEM_TIMEOUT", message: "request timeout" });
      upstreamOk({ series: [{ date: "2026-06-01", value_usd: 1 }] });
      const { analyticsFetch } = await importClient();

      const promise = analyticsFetch("analytics/pools/0xpool/timeseries");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({ series: [{ date: "2026-06-01", value_usd: 1 }] });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("gives up after the retry cap and throws the last AnalyticsError", async () => {
      upstreamError(503);
      upstreamError(503);
      upstreamError(503);
      const { analyticsFetch } = await importClient();

      const promise = analyticsFetch("analytics/pools/0xpool/timeseries");
      const assertion = expect(promise).rejects.toMatchObject({ status: 503 });
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("does NOT retry a non-GET write on 503 (idempotency)", async () => {
      upstreamError(503);
      const { analyticsFetch } = await importClient();

      const promise = analyticsFetch("points/duck-shoot/play", { method: "POST", body: {} });
      const assertion = expect(promise).rejects.toMatchObject({ status: 503 });
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry a non-transient status (404 WALLET_NOT_FOUND)", async () => {
      upstreamError(404, { error: "WALLET_NOT_FOUND", message: "no wallet" });
      const { analyticsFetch } = await importClient();

      const promise = analyticsFetch("points/0xdead/summary");
      const assertion = expect(promise).rejects.toMatchObject({ status: 404 });
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("gives up immediately when Retry-After exceeds the SSR cap", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "RATE_LIMITED", message: "slow down" }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "60" },
        }),
      );
      const { analyticsFetch } = await importClient();

      const promise = analyticsFetch("points/0xabc/summary");
      const assertion = expect(promise).rejects.toMatchObject({ status: 429 });
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // [R1] Resilience: bounded per-attempt client timeout (AbortController)
  // -----------------------------------------------------------------------
  describe("[R1] request timeout", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("passes an AbortSignal to fetch", async () => {
      upstreamOk({ series: [] });
      const { analyticsFetch } = await importClient();

      await analyticsFetch("analytics/pools/0xpool/timeseries");

      const [, init] = fetchCall();
      expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
    });

    it("aborts a hanging GET after the per-attempt timeout, then recovers on retry", async () => {
      upstreamHang();
      upstreamOk({ series: [] });
      const { analyticsFetch } = await importClient();

      const promise = analyticsFetch("analytics/pools/0xpool/timeseries");
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toEqual({ series: [] });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("throws SYSTEM_TIMEOUT (408) when a GET keeps timing out, bounded by the budget", async () => {
      upstreamHang();
      upstreamHang();
      upstreamHang();
      const { analyticsFetch } = await importClient();

      const promise = analyticsFetch("analytics/pools/0xpool/timeseries");
      const assertion = expect(promise).rejects.toMatchObject({
        status: 408,
        code: "SYSTEM_TIMEOUT",
      });
      await vi.runAllTimersAsync();
      await assertion;

      const calls = mockFetch.mock.calls.length;
      expect(calls).toBeGreaterThanOrEqual(1);
      expect(calls).toBeLessThanOrEqual(2);
    });

    it("does NOT retry a hanging non-GET write — aborts once and throws SYSTEM_TIMEOUT", async () => {
      upstreamHang();
      const { analyticsFetch } = await importClient();

      const promise = analyticsFetch("points/duck-shoot/play", { method: "POST", body: {} });
      const assertion = expect(promise).rejects.toMatchObject({
        status: 408,
        code: "SYSTEM_TIMEOUT",
      });
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
