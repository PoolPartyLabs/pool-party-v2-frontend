/**
 * @id PP-MGR-CMP-107
 * @name raydiumPoolsRead tests
 * @implements-rules-version v1 (POO-2343)
 * @analytics-events none, a data adapter
 *
 * Rules R1 and R5 of the DEX Screener read. The fetch is a mock. There is no network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRaydiumPoolsAction } from "./raydiumPoolsAction";
import { RAYDIUM_READ_TIMEOUT_MS, readRaydiumPools } from "./raydiumPoolsRead";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const validPair = {
  dexId: "raydium",
  pairAddress: "PairAddr1",
  labels: ["CLMM"],
  baseToken: { address: SOL, symbol: "SOL", name: "Wrapped SOL" },
  quoteToken: { address: USDC, symbol: "USDC", name: "USD Coin" },
  liquidity: { usd: 100 },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function mockFetch(impl: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  return vi.fn(impl) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("readRaydiumPools", () => {
  // @rule R1
  it("reads the DEX Screener token-pairs URL of the Solana token from the server", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse([validPair]));
    const result = await readRaydiumPools({ tokenAddress: SOL }, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[0]).toBe(
      `https://api.dexscreener.com/token-pairs/v1/solana/${SOL}`,
    );
    expect(result).toMatchObject({ ok: true });
  });

  // @rule R1
  it("does not call DEX Screener for an input that is not a Solana mint", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse([]));
    const result = await readRaydiumPools({ tokenAddress: "../etc/passwd" }, fetchImpl);
    expect(result).toEqual({ ok: false, error: { code: "invalid_input" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // @rule R2
  // @rule R3
  it("returns the filtered and mapped pools", async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse([validPair, { ...validPair, pairAddress: "Other", dexId: "orca" }]),
    );
    const result = await readRaydiumPools(
      { tokenAddress: SOL, secondTokenAddress: USDC },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pools).toHaveLength(1);
      expect(result.pools[0]).toMatchObject({ protocol: "raydium", address: "PairAddr1" });
    }
  });

  // @rule R5
  it("gives a typed failure for a bad HTTP status", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse({}, 429));
    expect(await readRaydiumPools({ tokenAddress: SOL }, fetchImpl)).toEqual({
      ok: false,
      error: { code: "unavailable", status: 429 },
    });
  });

  // @rule R5
  it("gives a typed failure when the network fails", async () => {
    const fetchImpl = mockFetch(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await readRaydiumPools({ tokenAddress: SOL }, fetchImpl)).toEqual({
      ok: false,
      error: { code: "unavailable" },
    });
  });

  // @rule R5
  it("gives a typed failure for a body with an unexpected shape", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse({ pairs: null }));
    expect(await readRaydiumPools({ tokenAddress: SOL }, fetchImpl)).toEqual({
      ok: false,
      error: { code: "invalid_response" },
    });
    const notJson = mockFetch(async () => new Response("<html>", { status: 200 }));
    expect(await readRaydiumPools({ tokenAddress: SOL }, notJson)).toEqual({
      ok: false,
      error: { code: "invalid_response" },
    });
  });

  // @rule R5
  it("keeps the good Raydium pool when the array has one bad pair", async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse([{ dexId: "raydium", pairAddress: 7 }, validPair]),
    );
    const result = await readRaydiumPools({ tokenAddress: SOL }, fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pools.map((p) => p.address)).toEqual(["PairAddr1"]);
  });

  // @rule R1
  it("returns invalid_input and does not throw for a bad server action input", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse([]));
    for (const bad of [
      null,
      undefined,
      "x",
      5,
      {},
      { tokenAddress: 1 },
      { tokenAddress: SOL, secondTokenAddress: 2 },
    ]) {
      expect(await getRaydiumPoolsAction(bad)).toEqual({
        ok: false,
        error: { code: "invalid_input" },
      });
      expect(await readRaydiumPools(bad, fetchImpl)).toEqual({
        ok: false,
        error: { code: "invalid_input" },
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // @rule R5
  it("times out after 10 seconds", async () => {
    vi.useFakeTimers();
    expect(RAYDIUM_READ_TIMEOUT_MS).toBe(10_000);
    const fetchImpl = mockFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const pending = readRaydiumPools({ tokenAddress: SOL }, fetchImpl);
    await vi.advanceTimersByTimeAsync(9_999);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, error: { code: "timeout" } });
  });
});
