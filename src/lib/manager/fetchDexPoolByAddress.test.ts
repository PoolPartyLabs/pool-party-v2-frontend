/**
 * @id PP-MGR (POO-1430)
 * @name fetchDexPoolByAddress tests
 * @implements-rules-version v1
 *
 * Stubs global fetch (not the API client) so the real apiFetch / envelope-unwrap logic runs.
 * The endpoint this hits has a response shape the pair path doesn't: a two-key envelope
 * (`{ data, foundOnNetwork }`) that `apiFetch`'s generic `maybeUnwrap` does NOT unwrap (it only
 * unwraps a single-key `{ data }`), so this file exists specifically to pin that down.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDexPoolByAddress } from "./fetchDexPoolByAddress";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const POOL = {
  address: "0xpool",
  feeTier: 500,
  tvlInUsd: "1000000",
  currency0: { address: "0xt0", symbol: "USDC" },
  currency1: { address: "0xt1", symbol: "WETH" },
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchDexPoolByAddress", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubEnv("PP_API_URL", "https://api.example");
    vi.stubEnv("PP_API_KEY", "k");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("requests the poolAddress path, lowercased, and returns the parsed pool", async () => {
    mockFetch.mockResolvedValue(response({ data: [POOL] }));
    const result = await fetchDexPoolByAddress(
      "arbitrum",
      "0xABCDEF0000000000000000000000000000000000",
    );

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe(
      "https://api.example/api/v1/dex-pools?network=arbitrum&poolAddress=0xabcdef0000000000000000000000000000000000",
    );
    expect(result.pools).toEqual([POOL]);
    expect(result.foundOnNetwork).toBeUndefined();
  });

  it("parses the plain single-key envelope (the common case) with no foundOnNetwork", async () => {
    mockFetch.mockResolvedValue(response({ data: [] }));
    const result = await fetchDexPoolByAddress("arbitrum", "0xpool");
    expect(result).toEqual({ pools: [], foundOnNetwork: undefined });
  });

  it("parses the two-key wrong-network envelope, which maybeUnwrap would otherwise leave un-unwrapped", async () => {
    mockFetch.mockResolvedValue(response({ data: [], foundOnNetwork: "base" }));
    const result = await fetchDexPoolByAddress("arbitrum", "0xpool");
    expect(result).toEqual({ pools: [], foundOnNetwork: "base" });
  });

  it("does not swallow a non-2xx status into an empty result (unlike the pair endpoint's 404 handling)", async () => {
    mockFetch.mockResolvedValue(
      response({ code: "POOL_INVALID_ADDRESS", message: "bad address" }, 400),
    );
    await expect(fetchDexPoolByAddress("arbitrum", "0xpool")).rejects.toThrow();
  });

  it("propagates a 404 as an error rather than returning an empty result", async () => {
    // Unlike fetchDexPools, this endpoint's own contract says "not found" is a 200 []; a 404 here
    // would be unexpected upstream behavior, not a normal outcome, so it must NOT be caught.
    mockFetch.mockResolvedValue(response({ message: "not found" }, 404));
    await expect(fetchDexPoolByAddress("arbitrum", "0xpool")).rejects.toThrow();
  });
});
