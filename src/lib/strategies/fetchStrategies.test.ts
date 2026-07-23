/**
 * @id PP-STR (POO-298)
 * @name fetchStrategies tests
 * @implements-rules-version v1
 *
 * [R1] per-network reads merged. [R6] getStrategyById. [R7] partial vs total failure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import type { ApiPool } from "./poolsSchema";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

async function importFetch() {
  vi.resetModules();
  return import("./fetchStrategies");
}

function pool(positionId: string, overrides: Partial<ApiPool> = {}): ApiPool {
  return {
    positionId,
    name: `pool-${positionId}`,
    poolManager: "0xBb7433F0F9EBc996Aa15269cA08a0De3cF1AFab1",
    poolTvlUsd: 100,
    feesApr: 5,
    totalInvestors: "1",
    closed: false,
    currency0: { symbol: "ETH" },
    currency1: { symbol: "USDC" },
    network: "arbitrum",
    pool: "0xPOOLcontract0000000000000000000000000000",
    ...overrides,
  };
}

const response = (...pools: ApiPool[]) => ({ totalItems: pools.length, pools });

describe("fetchStrategies", () => {
  beforeEach(() => apiFetch.mockReset());

  it("[R1] queries each supported network (page 0) and merges the mapped pools", async () => {
    // A short first page (< limit) is the last page, so each network is one request.
    apiFetch
      .mockResolvedValueOnce(response(pool("0xarb")))
      .mockResolvedValueOnce(response(pool("0xbase")))
      .mockResolvedValueOnce(response(pool("0xpoly")));

    const { fetchStrategies } = await importFetch();
    const strategies = await fetchStrategies();

    const paths = apiFetch.mock.calls.map((c) => c[0]);
    expect(paths).toEqual([
      "pools?network=arbitrum&page=0&limit=100",
      "pools?network=base&page=0&limit=100",
      "pools?network=polygon&page=0&limit=100",
    ]);
    expect(strategies.map((s) => s.id)).toEqual(["0xarb", "0xbase", "0xpoly"]);
  });

  it("[R1][R2] drains a 250-pool network across 3 pages (>100 rows are NOT truncated)", async () => {
    // Networks fetch concurrently, so route each response by the requested path (page + network),
    // not by call order: arbitrum holds 250 pools across 3 pages, base + polygon are empty.
    const rows = Array.from({ length: 250 }, (_, i) => pool(`0xarb-${i}`, { network: "arbitrum" }));
    // Route each concurrent per-network call by its requested path (page + network); base + polygon
    // resolve empty, arbitrum yields the paged slice.
    apiFetch.mockImplementation(async (path?: string) => {
      const params = new URLSearchParams((path ?? "").split("?")[1] ?? "");
      const network = params.get("network");
      const page = Number(params.get("page"));
      if (network !== "arbitrum") return response();
      const slice = rows.slice(page * 100, page * 100 + 100);
      return { totalItems: rows.length, pools: slice };
    });

    const { fetchStrategies } = await importFetch();
    const strategies = await fetchStrategies();

    // [R2] the full 250-row set survives the drain (the count is over the COMPLETE fetched set).
    expect(strategies).toHaveLength(250);

    // [R3] arbitrum was drained SEQUENTIALLY page 0 → 1 → 2 (short final page stops the loop).
    const arbPaths = apiFetch.mock.calls
      .map((c) => c[0] as string)
      .filter((p) => p.startsWith("pools?network=arbitrum"));
    expect(arbPaths).toEqual([
      "pools?network=arbitrum&page=0&limit=100",
      "pools?network=arbitrum&page=1&limit=100",
      "pools?network=arbitrum&page=2&limit=100",
    ]);
  });

  it("caches each network read with a revalidate window (avoids per-render rate limiting)", async () => {
    apiFetch
      .mockResolvedValueOnce(response(pool("0xarb")))
      .mockResolvedValueOnce(response(pool("0xbase")))
      .mockResolvedValueOnce(response(pool("0xpoly")));

    const { fetchStrategies } = await importFetch();
    await fetchStrategies();

    for (const call of apiFetch.mock.calls) {
      expect(call[1]).toMatchObject({ revalidate: expect.any(Number) });
      expect((call[1] as { revalidate: number }).revalidate).toBeGreaterThan(0);
    }
  });

  it("[POO-316] fills `network` from the queried slug when a legacy row omits it", async () => {
    // Legacy (v0.8.0) Arbitrum list rows omit `network`; the strategy must still be kept and carry it.
    apiFetch
      .mockResolvedValueOnce(response(pool("0xleg", { network: undefined }))) // arbitrum
      .mockResolvedValueOnce(response()) // base
      .mockResolvedValueOnce(response()); // polygon

    const { fetchStrategies } = await importFetch();
    const strategies = await fetchStrategies();

    expect(strategies).toHaveLength(1);
    expect(strategies[0]).toMatchObject({ id: "0xleg", network: "arbitrum" });
  });

  it("[R7] tolerates one network failing (partial catalog)", async () => {
    apiFetch
      .mockResolvedValueOnce(response(pool("0xarb")))
      .mockRejectedValueOnce(new ApiError(500, "SYSTEM_INTERNAL", "base down"))
      .mockResolvedValueOnce(response(pool("0xpoly")));

    const { fetchStrategies } = await importFetch();
    const strategies = await fetchStrategies();
    expect(strategies.map((s) => s.id)).toEqual(["0xarb", "0xpoly"]);
  });

  it("[R7] rethrows when every network fails", async () => {
    apiFetch.mockResolvedValue(undefined);
    apiFetch.mockRejectedValueOnce(new ApiError(503, "SYSTEM_NOT_CONFIGURED", "arb down"));
    apiFetch.mockRejectedValueOnce(new ApiError(503, "SYSTEM_NOT_CONFIGURED", "base down"));
    apiFetch.mockRejectedValueOnce(new ApiError(503, "SYSTEM_NOT_CONFIGURED", "poly down"));

    const { fetchStrategies } = await importFetch();
    let caught: unknown;
    try {
      await fetchStrategies();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiError);
  });

  it("[R6] getStrategyById finds the matching positionId", async () => {
    apiFetch
      .mockResolvedValueOnce(response(pool("0xarb")))
      .mockResolvedValueOnce(response(pool("0xbase")))
      .mockResolvedValueOnce(response());

    const { fetchStrategyById } = await importFetch();
    const strategy = await fetchStrategyById("0xbase");
    expect(strategy?.id).toBe("0xbase");
  });

  it("[R6] getStrategyById returns null when not found", async () => {
    apiFetch.mockResolvedValue(response());
    const { fetchStrategyById } = await importFetch();
    expect(await fetchStrategyById("0xmissing")).toBeNull();
  });
});
