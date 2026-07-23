/**
 * @id PP-STR-SCR-001 (POO-667)
 * @name Explore paging action tests
 * @implements-rules-version v1
 *
 * The server action the client "Load more" hook calls. It reads one page of the real catalog via
 * fetchStrategiesPage, which sends `lifecycle=live` so the BACKEND excludes closed (discovery, POO-458).
 * [R21] returns the mapped page items + backend total.
 * [R22] the action passes the backend page through unchanged — it MUST NOT re-filter per page, which
 *       shrank the page below `total` → empty page 0 + phantom "Load more" (the POO-667 bug).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/schemas";

const fetchStrategiesPage = vi.fn();
vi.mock("@/lib/strategies/fetchStrategiesPage", () => ({
  fetchStrategiesPage: (...args: unknown[]) => fetchStrategiesPage(...args),
}));

import { loadExplorePageAction } from "./exploreActions";

function mk(id: string, status: Strategy["status"] = "active"): Strategy {
  return {
    id,
    name: id,
    manager: "0x",
    riskLevel: 3,
    minInvestment: 0,
    tvl: 0,
    investors: 0,
    estReturn: 0,
    rateType: "APR",
    status,
  };
}

beforeEach(() => fetchStrategiesPage.mockReset());

describe("loadExplorePageAction", () => {
  // @rule R21
  it("[R21] returns the page items and backend total", async () => {
    fetchStrategiesPage.mockResolvedValueOnce({ items: [mk("a"), mk("b")], total: 177 });

    const result = await loadExplorePageAction({ page: 0, limit: 5 });

    expect(result).toEqual({ items: [mk("a"), mk("b")], total: 177 });
    expect(fetchStrategiesPage).toHaveBeenCalledWith({ page: 0, limit: 5 });
  });

  // @rule R22
  it("[R22] passes the backend's already-live page through unchanged (no client-side filter)", async () => {
    // The backend now filters to live (lifecycle=live), so a page is dense and its total honest. The
    // action MUST NOT re-filter: re-filtering shrank a page below `total`, so computeHasMore rendered
    // an empty page 0 + a phantom "Load more" (POO-667). Even a row the OLD per-page filter would have
    // dropped is kept — this locks the regression: the total stays consistent with the returned rows.
    fetchStrategiesPage.mockResolvedValueOnce({
      items: [mk("a", "active"), mk("c", "closed"), mk("p", "paused")],
      total: 3,
    });

    const result = await loadExplorePageAction({ page: 0, limit: 5 });

    expect(result.items.map((s) => s.id)).toEqual(["a", "c", "p"]);
    expect(result.total).toBe(3);
  });

  // @rule R22 — the honest-total shape: visible count == total, so there is no phantom next page.
  it("[R22] a full live page reports total == visible count (no phantom hasMore)", async () => {
    const live = [mk("a"), mk("b"), mk("c"), mk("d"), mk("e")];
    fetchStrategiesPage.mockResolvedValueOnce({ items: live, total: 5 });

    const result = await loadExplorePageAction({ page: 0, limit: 5 });

    expect(result.items).toEqual(live);
    // computeHasMore(0, 5, 5) === false → the "Load more" affordance does not appear.
    expect(result.total).toBe(5);
  });

  it("threads sort, risk and search through to fetchStrategiesPage", async () => {
    fetchStrategiesPage.mockResolvedValueOnce({ items: [], total: 0 });

    await loadExplorePageAction({
      page: 2,
      limit: 5,
      sort: { key: "return", dir: "desc" },
      risk: 1,
      search: "eth",
    });

    expect(fetchStrategiesPage).toHaveBeenCalledWith({
      page: 2,
      limit: 5,
      sort: { key: "return", dir: "desc" },
      risk: 1,
      search: "eth",
    });
  });
});
