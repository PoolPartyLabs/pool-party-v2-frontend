/**
 * @id PP-MGR (POO-315)
 * @name fetchDexPoolState tests
 * @implements-rules-version v1
 *
 * Calls the single dex-pool endpoint (pair + fee tier), routes by network, and returns null on 404.
 * Stubs global fetch (not the API client) so the real apiFetch / ApiError run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDexPoolState } from "./dexPoolState";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const STATE = {
  feeTier: 500,
  currency0: { address: "0xt0", decimals: 18 },
  currency1: { address: "0xt1", decimals: 6 },
  sqrtPriceX96: "79228162514264337593543950336",
  liquidity: "1000",
  tickCurrent: 0,
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchDexPoolState", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubEnv("PP_API_URL", "https://api.example");
    vi.stubEnv("PP_API_KEY", "k");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("requests the pair + fee-tier path, routed by network, and returns the parsed state", async () => {
    mockFetch.mockResolvedValue(response({ data: STATE }));
    const state = await fetchDexPoolState("polygon", "0xt0", "0xt1", 500);

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("https://api.example/api/v1/dex-pools/0xt0/0xt1/500?network=polygon");
    expect(state?.tickCurrent).toBe(0);
  });

  it("returns null on a 404", async () => {
    mockFetch.mockResolvedValue(response({ message: "no pool" }, 404));
    expect(await fetchDexPoolState("polygon", "0xt0", "0xt1", 500)).toBeNull();
  });

  it("propagates non-404 errors", async () => {
    mockFetch.mockResolvedValue(response({ message: "boom" }, 500));
    await expect(fetchDexPoolState("polygon", "0xt0", "0xt1", 500)).rejects.toThrow();
  });
});
