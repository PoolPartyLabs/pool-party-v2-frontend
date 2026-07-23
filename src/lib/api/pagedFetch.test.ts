/**
 * @id PP-CORE-LIB-031 (POO-666)
 * @name pagedFetch tests
 * @implements-rules-version v1
 *
 * The shared server-side paging seam over apiFetch.
 * [R1] one page = one apiFetch call carrying page/limit/sorting/riskProfile/search/network.
 * [R2] the `{ totalItems, <itemsKey> }` envelope is validated and returned as `{ items, total }`.
 * [R3] computeHasMore is the single hasMore math: (page+1)*limit < total.
 * [R4] only provided query params are appended (no empty sorting=/search= noise).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

import { fetchPage } from "./pagedFetch";
import { computeHasMore } from "./pagination";

const itemSchema = z.object({ id: z.string() });

beforeEach(() => apiFetch.mockReset());

describe("computeHasMore", () => {
  // @rule R3
  it("[R3] is true while the next page start is still below total", () => {
    // page 0, limit 5, total 12 → served 5 < 12 → more.
    expect(computeHasMore(0, 5, 12)).toBe(true);
    // page 1 → served 10 < 12 → more.
    expect(computeHasMore(1, 5, 12)).toBe(true);
  });

  // @rule R3
  it("[R3] is false once the served count reaches total", () => {
    // page 2, limit 5, total 12 → served 15 >= 12 → done.
    expect(computeHasMore(2, 5, 12)).toBe(false);
    // exact multiple: page 1, limit 5, total 10 → served 10 >= 10 → done.
    expect(computeHasMore(1, 5, 10)).toBe(false);
  });

  // @rule R3
  it("[R3] is false for an empty result set", () => {
    expect(computeHasMore(0, 5, 0)).toBe(false);
  });
});

describe("fetchPage", () => {
  // @rule R1 @rule R2
  it("[R1][R2] calls apiFetch once and returns { items, total } from the envelope", async () => {
    apiFetch.mockResolvedValueOnce({ totalItems: 42, pools: [{ id: "a" }, { id: "b" }] });

    const result = await fetchPage({
      path: "pools/all",
      page: 0,
      limit: 5,
      itemsKey: "pools",
      itemSchema,
    });

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ items: [{ id: "a" }, { id: "b" }], total: 42 });
  });

  // @rule R1
  it("[R1] threads page, limit, sorting, riskProfile, search and network onto the query", async () => {
    apiFetch.mockResolvedValueOnce({ totalItems: 0, pools: [] });

    await fetchPage({
      path: "pools/all",
      page: 3,
      limit: 5,
      itemsKey: "pools",
      itemSchema,
      sorting: "feesApr:desc",
      riskProfile: "steady",
      search: "usdc",
      network: "arbitrum",
    });

    const calledPath = apiFetch.mock.calls[0]?.[0] as string;
    const query = new URLSearchParams(calledPath.split("?")[1]);
    expect(query.get("page")).toBe("3");
    expect(query.get("limit")).toBe("5");
    expect(query.get("sorting")).toBe("feesApr:desc");
    expect(query.get("riskProfile")).toBe("steady");
    expect(query.get("search")).toBe("usdc");
    expect(query.get("network")).toBe("arbitrum");
    expect(calledPath.startsWith("pools/all?")).toBe(true);
  });

  // @rule R4
  it("[R4] omits sorting/riskProfile/search/network when not provided", async () => {
    apiFetch.mockResolvedValueOnce({ totalItems: 0, pools: [] });

    await fetchPage({
      path: "pools/all",
      page: 0,
      limit: 5,
      itemsKey: "pools",
      itemSchema,
    });

    const calledPath = apiFetch.mock.calls[0]?.[0] as string;
    const query = new URLSearchParams(calledPath.split("?")[1]);
    expect(query.has("sorting")).toBe(false);
    expect(query.has("riskProfile")).toBe(false);
    expect(query.has("search")).toBe(false);
    expect(query.has("network")).toBe(false);
    // page + limit always present.
    expect(query.get("page")).toBe("0");
    expect(query.get("limit")).toBe("5");
  });

  // @rule R2
  it("[R2] a 204/empty response yields an empty page with total 0", async () => {
    apiFetch.mockResolvedValueOnce(null);
    const result = await fetchPage({
      path: "pools/all",
      page: 9,
      limit: 5,
      itemsKey: "pools",
      itemSchema,
    });
    expect(result).toEqual({ items: [], total: 0 });
  });
});
