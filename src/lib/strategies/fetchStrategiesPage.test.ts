/**
 * @id PP-STR-LIB-007 (POO-667) · PP-STR-LIB-008 (POO-579)
 * @name fetchStrategiesPage tests
 * @implements-rules-version v1
 *
 * Real-mode server-paged Explore read. POO-579 points the real path at the v2 catalog
 * (`GET /api/v2/strategies`, envelope `{ strategies, totalItems }`, mapped by mapStrategyV2), with the
 * v1 `GET /pools/all` read as the error fallback. POO-667 always sends `lifecycle=live` for discovery.
 * [R11] one call = one page (`?page&limit`) with `lifecycle=live`; total = the backend (live) total.
 * [R12] tvl→tvlInUSD, return→feesApr, risk→riskLevel, investors→totalInvestors (server-honored); only min sends NO `sorting`.
 * [R13] risk band 1/3/5 → steady/dynamic/wild; bands 2 & 4 short-circuit to an empty page.
 * [R14] search is passed through verbatim (blank omitted).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/schemas";

const fetchStrategiesV2 = vi.fn();
const fetchPage = vi.fn();

vi.mock("./v2/fetchStrategiesV2", () => ({
  fetchStrategiesV2: (...args: unknown[]) => fetchStrategiesV2(...args),
}));
vi.mock("./v2/mapStrategyV2", () => ({
  mapStrategyV2: (row: { id: string }) => ({ id: row.id, estReturn: 0 }) as unknown as Strategy,
}));
vi.mock("@/lib/api/pagedFetch", () => ({
  fetchPage: (...args: unknown[]) => fetchPage(...args),
  computeHasMore: (page: number, limit: number, total: number) => (page + 1) * limit < total,
}));

import { fetchStrategiesPage } from "./fetchStrategiesPage";
import type { ApiPool } from "./poolsSchema";

function v2Row(id: string) {
  return { id, status: "live" };
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

/** The single params object fetchStrategiesPage passed to the v2 reader. */
function lastV2Params(): Record<string, unknown> {
  return fetchStrategiesV2.mock.calls[0]?.[0] as Record<string, unknown>;
}

beforeEach(() => {
  fetchStrategiesV2.mockReset();
  fetchPage.mockReset();
});

describe("fetchStrategiesPage (v2 path)", () => {
  // @rule R11
  it("[R11] reads one page of /api/v2/strategies and maps rows with the total", async () => {
    fetchStrategiesV2.mockResolvedValueOnce({
      strategies: [v2Row("0xa"), v2Row("0xb")],
      totalItems: 177,
    });

    const result = await fetchStrategiesPage({ page: 0, limit: 5 });

    // POO-667: DISCOVERY always sends lifecycle=live so the backend excludes closed from BOTH the rows
    // and the total — the page is dense and its total honest (no phantom "Load more").
    expect(lastV2Params()).toMatchObject({ page: 0, limit: 5, lifecycle: "live" });
    expect(result.total).toBe(177);
    expect(result.items.map((s) => s.id)).toEqual(["0xa", "0xb"]);
    // The v1 fallback is NOT hit on the happy path.
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("returns an empty page (total 0) when the v2 read yields null", async () => {
    fetchStrategiesV2.mockResolvedValueOnce(null);
    const result = await fetchStrategiesPage({ page: 3, limit: 5 });
    expect(result).toEqual({ items: [], total: 0 });
  });

  // @rule R12
  it("[R12] maps tvl/return/risk/investors to the server-honored sort fields", async () => {
    fetchStrategiesV2.mockResolvedValue({ strategies: [], totalItems: 0 });

    const cases = [
      { key: "tvl", dir: "desc", field: "tvlInUSD:desc" },
      { key: "return", dir: "asc", field: "feesApr:asc" },
      // POO-726: the risk-band ordinal (steady<dynamic<wild) + total investors are now server-sortable.
      { key: "risk", dir: "asc", field: "riskLevel:asc" },
      { key: "investors", dir: "desc", field: "totalInvestors:desc" },
    ] as const;
    for (const { key, dir, field } of cases) {
      fetchStrategiesV2.mockClear();
      await fetchStrategiesPage({ page: 0, limit: 5, sort: { key, dir } });
      expect(lastV2Params().sorting).toBe(field);
    }
  });

  // @rule R12
  it("[R12] sends NO sorting for `min` (the only column with no backend sort field)", async () => {
    fetchStrategiesV2.mockResolvedValue({ strategies: [], totalItems: 0 });

    await fetchStrategiesPage({ page: 0, limit: 5, sort: { key: "min", dir: "desc" } });
    expect(lastV2Params().sorting).toBeUndefined();
  });

  // @rule R13
  it("[R13] maps risk bands 1/3/5 to steady/dynamic/wild", async () => {
    fetchStrategiesV2.mockResolvedValue({ strategies: [], totalItems: 0 });

    for (const [band, profile] of [
      [1, "steady"],
      [3, "dynamic"],
      [5, "wild"],
    ] as const) {
      fetchStrategiesV2.mockClear();
      await fetchStrategiesPage({ page: 0, limit: 5, risk: band });
      expect(lastV2Params().riskProfile).toBe(profile);
    }
  });

  // @rule R13
  it("[R13] sends no riskProfile for bands 2 & 4 and returns an empty page (never calls the API)", async () => {
    for (const band of [2, 4] as const) {
      fetchStrategiesV2.mockClear();
      const result = await fetchStrategiesPage({ page: 0, limit: 5, risk: band });
      expect(fetchStrategiesV2).not.toHaveBeenCalled();
      expect(result).toEqual({ items: [], total: 0 });
    }
  });

  // @rule R14
  it("[R14] passes a search query through, and omits it when blank", async () => {
    fetchStrategiesV2.mockResolvedValue({ strategies: [], totalItems: 0 });

    await fetchStrategiesPage({ page: 0, limit: 5, search: "usdc" });
    expect(lastV2Params().search).toBe("usdc");

    fetchStrategiesV2.mockClear();
    await fetchStrategiesPage({ page: 0, limit: 5, search: "   " });
    expect(lastV2Params().search).toBeUndefined();
  });

  // @rule POO-894 R1
  it("[POO-894 R1] joins the selected categories into the v2 `category` param, omitted when empty", async () => {
    fetchStrategiesV2.mockResolvedValue({ strategies: [], totalItems: 0 });

    await fetchStrategiesPage({ page: 0, limit: 5, categories: ["ethereum", "bitcoin"] });
    expect(lastV2Params().category).toBe("ethereum,bitcoin");

    fetchStrategiesV2.mockClear();
    await fetchStrategiesPage({ page: 0, limit: 5, categories: [] });
    expect(lastV2Params().category).toBeUndefined();

    fetchStrategiesV2.mockClear();
    await fetchStrategiesPage({ page: 0, limit: 5 });
    expect(lastV2Params().category).toBeUndefined();
  });

  // @rule POO-894 R6
  it("[POO-894 R6] categories compose with risk/search/sort in the same v2 read", async () => {
    fetchStrategiesV2.mockResolvedValue({ strategies: [], totalItems: 0 });

    await fetchStrategiesPage({
      page: 0,
      limit: 5,
      categories: ["stablecoins"],
      risk: 1,
      search: "usdc",
      sort: { key: "tvl", dir: "desc" },
    });
    expect(lastV2Params()).toMatchObject({
      category: "stablecoins",
      riskProfile: "steady",
      search: "usdc",
      sorting: "tvlInUSD:desc",
    });
  });
});

describe("fetchStrategiesPage (v1 fallback)", () => {
  it("[POO-579] falls back to /pools/all + mapStrategy when the v2 read errors", async () => {
    fetchStrategiesV2.mockRejectedValueOnce(new Error("v2 down"));
    fetchPage.mockResolvedValueOnce({ items: [pool("0xa"), pool("0xb")], total: 42 });

    const result = await fetchStrategiesPage({
      page: 1,
      limit: 5,
      sort: { key: "tvl", dir: "desc" },
      risk: 1,
      search: "eth",
    });

    const fallbackOptions = fetchPage.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(fallbackOptions.path).toBe("pools/all");
    expect(fallbackOptions.page).toBe(1);
    expect(fallbackOptions.sorting).toBe("tvlInUSD:desc");
    expect(fallbackOptions.riskProfile).toBe("steady");
    expect(fallbackOptions.search).toBe("eth");
    // Rows come back through the real v1 mapStrategy (id = positionId, estReturn = feesApr).
    expect(result.items.map((s) => s.id)).toEqual(["0xa", "0xb"]);
    expect(result.items[0]?.estReturn).toBe(5);
    expect(result.total).toBe(42);
  });

  // @rule POO-894 R8
  it("[POO-894 R8] narrows the v1 page client-side as the degraded path (no category param sent)", async () => {
    fetchStrategiesV2.mockRejectedValueOnce(new Error("v2 down"));
    fetchPage.mockResolvedValueOnce({
      items: [
        // Real v1 mapStrategy derives assetTags from the symbols: ETH/USDC -> ethereum.
        pool("0xeth"),
        // WBTC/USDC -> bitcoin.
        pool("0xbtc", { currency0: { symbol: "WBTC" }, currency1: { symbol: "USDC" } }),
      ],
      total: 42,
    });

    const result = await fetchStrategiesPage({ page: 0, limit: 5, categories: ["bitcoin"] });

    // The v1 endpoint has NO category param, so none is sent.
    const fallbackOptions = fetchPage.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(fallbackOptions.category).toBeUndefined();
    expect("categories" in fallbackOptions).toBe(false);
    // Belt-and-suspenders narrowing over THIS page only (degraded, loaded-rows-only semantics).
    expect(result.items.map((s) => s.id)).toEqual(["0xbtc"]);
    // The unfiltered v1 total passes through (v1 cannot count per-category); never an error.
    expect(result.total).toBe(42);
  });

  it("[POO-894 R8] leaves the v1 fallback page untouched when no category is selected", async () => {
    fetchStrategiesV2.mockRejectedValueOnce(new Error("v2 down"));
    fetchPage.mockResolvedValueOnce({ items: [pool("0xa"), pool("0xb")], total: 42 });

    const result = await fetchStrategiesPage({ page: 0, limit: 5 });
    expect(result.items.map((s) => s.id)).toEqual(["0xa", "0xb"]);
  });
});
