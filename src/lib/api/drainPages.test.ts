/**
 * @id PP-CORE-LIB-027 (POO-646)
 * @name drainPages tests
 * @implements-rules-version v1
 *
 * [R1] drains every page until a short page (or the reported total) is reached.
 * [R3] pages are fetched SEQUENTIALLY (never in parallel — the backend throttles per API key).
 */
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PAGE_LIMIT, drainPages } from "./drainPages";

describe("drainPages", () => {
  it("[R1] returns a single short page without asking for a second page", async () => {
    // A page shorter than the limit is the last page: no page 1 request.
    const fetchPage = vi.fn(async () => ({ items: [1, 2, 3] }));

    const items = await drainPages(fetchPage, { limit: 100 });

    expect(items).toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(0, 100);
  });

  it("[R1] drains a full page, then a short page, and concatenates in order", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [1, 2] }) // full page (limit 2) → ask for more
      .mockResolvedValueOnce({ items: [3] }); // short page → stop

    const items = await drainPages(fetchPage, { limit: 2 });

    expect(items).toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });

  it("[R1] stops after an EXACTLY-full final page once the reported total is reached", async () => {
    // Total = 4, limit = 2: two full pages exhaust the set with no wasteful third (empty) page.
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [1, 2], total: 4 })
      .mockResolvedValueOnce({ items: [3, 4], total: 4 });

    const items = await drainPages(fetchPage, { limit: 2 });

    expect(items).toEqual([1, 2, 3, 4]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("[R1] drains a 250-row set split across 3 pages of 100", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => i);
    const fetchPage = vi.fn(async (page: number, limit: number) => ({
      items: rows.slice(page * limit, page * limit + limit),
      total: rows.length,
    }));

    const items = await drainPages(fetchPage, { limit: 100 });

    expect(items).toHaveLength(250);
    expect(items).toEqual(rows);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("[R1] treats an empty first page as an empty list", async () => {
    const fetchPage = vi.fn(async () => ({ items: [] as number[] }));

    const items = await drainPages(fetchPage, { limit: 100 });

    expect(items).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("[R3] fetches pages sequentially, never overlapping requests", async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    const rows = Array.from({ length: 5 }, (_, i) => i);
    const fetchPage = vi.fn(async (page: number, limit: number) => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return { items: rows.slice(page * limit, page * limit + limit), total: rows.length };
    });

    const items = await drainPages(fetchPage, { limit: 2 });

    expect(maxConcurrent).toBe(1);
    expect(items).toEqual(rows);
  });

  it("[R3] caps the drain so a misbehaving backend cannot loop forever", async () => {
    // A backend that always returns a full page with an unbounded total must not hang the render.
    const fetchPage = vi.fn(async () => ({ items: [1, 2], total: Number.MAX_SAFE_INTEGER }));

    await expect(drainPages(fetchPage, { limit: 2, maxPages: 3 })).rejects.toThrow();
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("exposes the pp_api default page limit (100)", () => {
    expect(DEFAULT_PAGE_LIMIT).toBe(100);
  });
});
