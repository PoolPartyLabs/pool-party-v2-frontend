/**
 * @id PP-PORT-LIB-001 (POO-668)
 * @name fetchPortfolioPage tests
 * @implements-rules-version v1
 *
 * The server-paged (ONE page) portfolio read that backs the Portfolio "Load more" (active + closed):
 * - [R1] reads /portfolio/:wallet/all?closed=<f>&page&limit for exactly ONE page (no drain), returns
 *   the mapped Position[] for that page + the backend grand aggregates (KPIs).
 * - [R2] preserves the backend row ORDER verbatim (closed-with-balance-first for the exited feed).
 * - [R3] the KPI aggregates come from the envelope (totalBalanceUsd / claimableFeesUsd /
 *   totalFeesInUsd / totalPerformanceFeesInUsd), NEVER summed over the page.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

async function importFetch() {
  vi.resetModules();
  return import("./fetchPortfolioPage");
}

/** An envelope page with the grand aggregates + a 2-row page. */
const pageEnvelope = {
  totalPositions: 13, // GRAND total incl closed — a PHANTOM; never drives hasMore.
  totalBalanceUsd: 4532.5,
  claimableFeesUsd: 120.4,
  totalFeesInUsd: 612.5,
  totalPerformanceFeesInUsd: 88.2,
  networkCounts: { base: 3, arbitrum: 1 },
  positions: [
    {
      totalBalanceUsd: 2050,
      totalFeesInUsd: 40,
      poolPartyPosition: { positionId: "0xact1", closed: false },
    },
    {
      totalBalanceUsd: 100,
      totalFeesInUsd: 2,
      poolPartyPosition: { positionId: "0xact2", closed: false },
    },
  ],
};

describe("fetchPortfolioPage", () => {
  beforeEach(() => apiFetch.mockReset());

  it("[R1] returns an empty page + zeroed aggregates without a call when no address is given", async () => {
    const { fetchPortfolioPage } = await importFetch();
    const result = await fetchPortfolioPage({ page: 0, limit: 5 });
    expect(result.items).toEqual([]);
    expect(result.aggregates.totalBalanceUsd).toBe(0);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("[R1] reads exactly ONE page (no drain) at the given page/limit for the ACTIVE feed", async () => {
    apiFetch.mockResolvedValueOnce(pageEnvelope);
    const { fetchPortfolioPage } = await importFetch();

    const result = await fetchPortfolioPage({ address: "0xWALLET", page: 0, limit: 5 });

    expect(apiFetch).toHaveBeenCalledTimes(1); // ONE page, not a drain
    const [path] = apiFetch.mock.calls[0] as [string];
    // closed=none is the ACTIVE feed.
    expect(path).toBe("portfolio/0xWALLET/all?closed=none&page=0&limit=5");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ id: "0xact1", status: "active", currentValue: 2050 });
  });

  it("[R1] reads the CLOSED feed with closed=exited at the requested page", async () => {
    apiFetch.mockResolvedValueOnce({ ...pageEnvelope, positions: [] });
    const { fetchPortfolioPage } = await importFetch();

    await fetchPortfolioPage({ address: "0xWALLET", page: 2, limit: 5, closed: "exited" });

    const [path] = apiFetch.mock.calls[0] as [string];
    expect(path).toBe("portfolio/0xWALLET/all?closed=exited&page=2&limit=5");
  });

  it("[R2] preserves the backend row order verbatim (no client re-sort)", async () => {
    // The backend orders the exited feed closed-with-balance-FIRST; a zero-balance row comes AFTER a
    // funded closed one. fetchPortfolioPage must NOT reorder.
    apiFetch.mockResolvedValueOnce({
      ...pageEnvelope,
      positions: [
        {
          totalBalanceUsd: 500, // funded closed → backend puts it first
          totalFeesInUsd: 5,
          poolPartyPosition: { positionId: "0xfunded", closed: true },
        },
        {
          totalBalanceUsd: 0, // zero-balance closed → backend puts it after
          totalFeesInUsd: 0,
          poolPartyPosition: { positionId: "0xzero", closed: true },
        },
      ],
    });
    const { fetchPortfolioPage } = await importFetch();

    const result = await fetchPortfolioPage({
      address: "0xWALLET",
      page: 0,
      limit: 5,
      closed: "exited",
    });

    expect(result.items.map((p) => p.id)).toEqual(["0xfunded", "0xzero"]);
  });

  it("[R3] returns the KPI grand aggregates from the envelope (NEVER summed over the page)", async () => {
    apiFetch.mockResolvedValueOnce(pageEnvelope);
    const { fetchPortfolioPage } = await importFetch();

    const { aggregates } = await fetchPortfolioPage({ address: "0xWALLET", page: 0, limit: 5 });

    // These are the GRAND totals, distinct from any sum over the 2 page rows (which would be 2150 / 42).
    expect(aggregates.totalBalanceUsd).toBe(4532.5);
    expect(aggregates.claimableFeesUsd).toBe(120.4);
    expect(aggregates.totalFeesInUsd).toBe(612.5);
    expect(aggregates.totalPerformanceFeesInUsd).toBe(88.2);
  });

  it("[R1] a short-cached per-wallet tagged read (matches fetchPositions caching)", async () => {
    apiFetch.mockResolvedValueOnce(pageEnvelope);
    const { fetchPortfolioPage } = await importFetch();
    const { positionsTag } = await import("./fetchPositions");

    await fetchPortfolioPage({ address: "0xWALLET", page: 0, limit: 5 });

    const [, options] = apiFetch.mock.calls[0] as [
      string,
      { revalidate?: number; tags?: string[] },
    ];
    expect(options.revalidate).toBe(10);
    expect(options.tags).toEqual([positionsTag("0xWALLET")]);
  });

  it("[R1] a 404 degrades to an empty page + zeroed aggregates", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "no wallet"));
    const { fetchPortfolioPage } = await importFetch();
    const result = await fetchPortfolioPage({ address: "0xabc", page: 0, limit: 5 });
    expect(result.items).toEqual([]);
    expect(result.aggregates.totalBalanceUsd).toBe(0);
  });

  it("rethrows a non-404 error", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(500, "SYSTEM_INTERNAL", "boom"));
    const { fetchPortfolioPage } = await importFetch();
    await expect(fetchPortfolioPage({ address: "0xabc", page: 0, limit: 5 })).rejects.toThrow(
      ApiError,
    );
  });

  it("[R3] a lean envelope missing the aggregate fields degrades them to 0 (never NaN)", async () => {
    apiFetch.mockResolvedValueOnce({ positions: [] });
    const { fetchPortfolioPage } = await importFetch();
    const { aggregates } = await fetchPortfolioPage({ address: "0xWALLET", page: 0, limit: 5 });
    expect(aggregates.totalBalanceUsd).toBe(0);
    expect(aggregates.claimableFeesUsd).toBe(0);
    expect(aggregates.totalFeesInUsd).toBe(0);
    expect(aggregates.totalPerformanceFeesInUsd).toBe(0);
  });

  // POO-829 [R5] / POO-828: the FE plumbs a `sorting` param through, mapped to the backend field id.
  // Absent → no `sorting` in the URL (verbatim backend order, current behavior). No caller sends it in
  // PR1, so real mode is untouched until POO-828 honors the param.
  it("[R5] appends the sorting param when a sort is given (default Yield → totalYield:desc)", async () => {
    apiFetch.mockResolvedValueOnce(pageEnvelope);
    const { fetchPortfolioPage } = await importFetch();

    await fetchPortfolioPage({
      address: "0xWALLET",
      page: 0,
      limit: 5,
      sorting: { key: "yield", dir: "desc" },
    });

    const [path] = apiFetch.mock.calls[0] as [string];
    expect(path).toBe("portfolio/0xWALLET/all?closed=none&page=0&limit=5&sorting=totalYield:desc");
  });

  it("[R5] omits the sorting param entirely when no sort is given (verbatim backend order)", async () => {
    apiFetch.mockResolvedValueOnce(pageEnvelope);
    const { fetchPortfolioPage } = await importFetch();

    await fetchPortfolioPage({ address: "0xWALLET", page: 0, limit: 5 });

    const [path] = apiFetch.mock.calls[0] as [string];
    expect(path).not.toContain("sorting");
  });

  it("[R5] maps each sortable column to its backend field id", async () => {
    const { fetchPortfolioPage } = await importFetch();
    const cases = [
      ["invested", "invested"],
      ["value", "currentValue"],
      ["rate", "feesApr"],
    ] as const;
    for (const [key] of cases) {
      apiFetch.mockResolvedValueOnce(pageEnvelope);
      await fetchPortfolioPage({ address: "0xW", page: 0, limit: 5, sorting: { key, dir: "asc" } });
    }
    const paths = apiFetch.mock.calls.map((c) => c[0] as string);
    cases.forEach(([, field], i) => {
      expect(paths[i]).toContain(`&sorting=${field}:asc`);
    });
  });

  // POO-829 [R3] / POO-828: `riskLevel` is NOT a backend sort field (pool-party-api portfolio-sort.ts
  // defers it — not carried on the portfolio payload; an unknown field is silently ignored). The FE
  // must not emit a `sorting` param for it (the paged Risk header renders dead instead, POO-734-style).
  it("[R3] emits NO sorting param for the risk column (no backend field, POO-828 deferred)", async () => {
    apiFetch.mockResolvedValueOnce(pageEnvelope);
    const { fetchPortfolioPage } = await importFetch();

    await fetchPortfolioPage({
      address: "0xW",
      page: 0,
      limit: 5,
      sorting: { key: "risk", dir: "desc" },
    });

    const [path] = apiFetch.mock.calls[0] as [string];
    expect(path).not.toContain("sorting");
  });
});
