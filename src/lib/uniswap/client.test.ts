/**
 * @id PP-CORE-LIB-050 (POO-1027)
 * @name uniswapFetch tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Rules under test (POO-1027 rules v1):
 *   [R1] server-only; `UNISWAP_API_KEY` has no NEXT_PUBLIC_ prefix and is sent as `x-api-key`
 *   [R2] every response is Zod-validated before it reaches a caller
 *   [R3] bounded retry on the transient class only, never on a 4xx business error
 *   [R4] per-attempt AbortController timeout, with a cumulative budget across retries
 *   [R5] non-2xx produces a typed UniswapApiError carrying the upstream code
 *   [R6] the key never appears in a thrown error or a returned value
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const KEY = "uni_test_key_do_not_leak_1234567890";

/** Fresh module per test: the client reads env at call time and we swap the global fetch. */
async function loadClient() {
  vi.resetModules();
  return await import("./client");
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.UNISWAP_API_KEY = KEY;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.UNISWAP_API_KEY;
});

/** A minimal JSON Response. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const schema = z.object({ routing: z.string() });

describe("uniswapFetch (POO-1027)", () => {
  // [R1] The key rides as x-api-key on every request, against the documented base URL.
  it("sends the API key as x-api-key against the trading-api base URL", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ routing: "CLASSIC" }));
    const { uniswapFetch } = await loadClient();

    await uniswapFetch("quote", { method: "POST", body: { a: 1 }, schema });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://trade-api.gateway.uniswap.org/v1/quote");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(KEY);
    expect(init.method).toBe("POST");
  });

  // [R1] A missing key is a configuration failure, and must say so rather than 401 mysteriously.
  it("fails with a typed configuration error when the key is unset", async () => {
    // `= undefined` would set the STRING "undefined", which is truthy. Delete the key instead.
    delete process.env.UNISWAP_API_KEY;
    const { uniswapFetch, UniswapApiError } = await loadClient();

    await expect(uniswapFetch("quote", { schema })).rejects.toBeInstanceOf(UniswapApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // [R2] A response that does not match the contract is a failure, not a silently-wrong object.
  it("rejects a response that fails schema validation", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ unexpected: true }));
    const { uniswapFetch, UniswapParseError } = await loadClient();

    await expect(uniswapFetch("quote", { schema })).rejects.toBeInstanceOf(UniswapParseError);
  });

  // [R3] Transient statuses retry and can recover.
  it("retries a transient 429 and returns the eventual success", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: "slow down" }, 429))
      .mockResolvedValueOnce(jsonResponse({ routing: "CLASSIC" }));
    const { uniswapFetch } = await loadClient();

    await expect(uniswapFetch("quote", { schema })).resolves.toEqual({ routing: "CLASSIC" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // [R3] A business error must NOT be retried: retrying a 400 just wastes the budget.
  it("does not retry a 400", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ errorCode: "INVALID_TOKEN", detail: "bad tokenIn" }, 400),
    );
    const { uniswapFetch, UniswapApiError } = await loadClient();

    await expect(uniswapFetch("quote", { schema })).rejects.toBeInstanceOf(UniswapApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // [R3] Retries are bounded, so a sustained outage fails fast instead of hanging.
  it("gives up after the retry cap", async () => {
    // mockImplementation, not mockResolvedValue: a Response body can only be read once, and a real
    // fetch hands back a fresh Response per call.
    fetchMock.mockImplementation(async () => jsonResponse({ message: "down" }, 503));
    const { uniswapFetch, uniswapMaxAttempts } = await loadClient();

    await expect(uniswapFetch("quote", { schema })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(uniswapMaxAttempts);
  });

  // [R5] The upstream machine code survives onto the typed error, so callers never regex a message.
  it("surfaces the upstream error code on the typed error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ errorCode: "QUOTE_ERROR", detail: "No quotes available" }, 404),
    );
    const { uniswapFetch, UniswapApiError } = await loadClient();

    const error = await uniswapFetch("quote", { schema }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UniswapApiError);
    expect((error as InstanceType<typeof UniswapApiError>).code).toBe("QUOTE_ERROR");
    expect((error as InstanceType<typeof UniswapApiError>).status).toBe(404);
  });

  // [R4] An aborted attempt is transient: it retries rather than propagating an AbortError.
  it("treats a request timeout as transient", async () => {
    fetchMock
      .mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }))
      .mockResolvedValueOnce(jsonResponse({ routing: "CLASSIC" }));
    const { uniswapFetch } = await loadClient();

    await expect(uniswapFetch("quote", { schema })).resolves.toEqual({ routing: "CLASSIC" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // [R4] Every attempt carries an abort signal, or a stuck upstream would hang the render.
  it("passes an abort signal on every attempt", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ routing: "CLASSIC" }));
    const { uniswapFetch } = await loadClient();

    await uniswapFetch("quote", { schema });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeDefined();
  });

  // [R6] THE security assertion. A leaked key in an error message reaches logs and error reporting.
  it("never leaks the API key into a thrown error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ errorCode: "NOPE", detail: "denied" }, 401));
    const { uniswapFetch } = await loadClient();

    const error = (await uniswapFetch("quote", { schema }).catch((e: unknown) => e)) as Error;
    const serialized = `${error.message} ${error.stack ?? ""} ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`;
    expect(serialized).not.toContain(KEY);
  });

  // [R6] And not into a successful return value either.
  it("never leaks the API key into a returned value", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ routing: "CLASSIC" }));
    const { uniswapFetch } = await loadClient();

    const result = await uniswapFetch("quote", { schema });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
});
