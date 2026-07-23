/**
 * @id PP-STR (POO-216)
 * @name fetchPositions tests
 * @implements-rules-version v1
 *
 * [R1] Server-side read of the cross-network portfolio, mapped to FE Position[].
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
  return import("./fetchPositions");
}

const portfolio = {
  positions: [
    {
      totalBalanceUsd: 3.76,
      totalFeesInUsd: 0.15,
      poolPartyPosition: { positionId: "0xpos1", closed: false },
    },
    {
      totalBalanceUsd: 100,
      totalFeesInUsd: 2,
      poolPartyPosition: { positionId: "0xpos2", closed: true },
    },
  ],
};

describe("fetchPositions", () => {
  beforeEach(() => apiFetch.mockReset());

  it("[R1] returns [] without a network call when no address is given", async () => {
    const { fetchPositions } = await importFetch();
    expect(await fetchPositions()).toEqual([]);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("[R1] reads /portfolio/:wallet/all (page 0) and maps the positions", async () => {
    apiFetch.mockResolvedValueOnce(portfolio);
    const { fetchPositions } = await importFetch();

    const positions = await fetchPositions("0xWALLET");

    const [path] = apiFetch.mock.calls[0] as [string];
    expect(path).toBe("portfolio/0xWALLET/all?page=0&limit=100");
    expect(positions).toHaveLength(2);
    expect(positions[0]).toMatchObject({
      id: "0xpos1",
      strategyId: "0xpos1",
      currentValue: 3.76,
      status: "active",
    });
    expect(positions[1]).toMatchObject({ id: "0xpos2", status: "closed", totalYield: 2 });
  });

  it("[POO-476] appends the closed filter to the query (the exited history reads closed=exited)", async () => {
    apiFetch.mockResolvedValueOnce(portfolio);
    const { fetchPositions } = await importFetch();

    await fetchPositions("0xWALLET", {}, "exited");

    const [path] = apiFetch.mock.calls[0] as [string];
    expect(path).toBe("portfolio/0xWALLET/all?closed=exited&page=0&limit=100");
  });

  it("appends the closed filter to the query when given (manager console reads closed=all)", async () => {
    apiFetch.mockResolvedValueOnce(portfolio);
    const { fetchPositions } = await importFetch();

    await fetchPositions("0xWALLET", {}, "all");

    const [path] = apiFetch.mock.calls[0] as [string];
    expect(path).toBe("portfolio/0xWALLET/all?closed=all&page=0&limit=100");
  });

  it("[R1][R2] drains a 250-position wallet across 3 pages (>100 positions are NOT truncated)", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({
      totalBalanceUsd: 10 + i,
      totalFeesInUsd: 1,
      poolPartyPosition: { positionId: `0xpos-${i}`, closed: false },
    }));
    const pageOf = (page: number) => ({
      totalPositions: rows.length,
      positions: rows.slice(page * 100, page * 100 + 100),
    });
    apiFetch
      .mockResolvedValueOnce(pageOf(0))
      .mockResolvedValueOnce(pageOf(1))
      .mockResolvedValueOnce(pageOf(2));

    const { fetchPositions } = await importFetch();
    const positions = await fetchPositions("0xWALLET");

    // [R2] the full 250-position set survives the drain (KPIs sum over the COMPLETE set).
    expect(positions).toHaveLength(250);

    // [R3] pages were drained SEQUENTIALLY, zero-based.
    const paths = apiFetch.mock.calls.map((c) => c[0] as string);
    expect(paths).toEqual([
      "portfolio/0xWALLET/all?page=0&limit=100",
      "portfolio/0xWALLET/all?page=1&limit=100",
      "portfolio/0xWALLET/all?page=2&limit=100",
    ]);
  });

  it("[R1] short-caches the read with a per-wallet tag (collapses navigation bursts)", async () => {
    apiFetch.mockResolvedValueOnce(portfolio);
    const { fetchPositions, positionsTag } = await importFetch();

    await fetchPositions("0xWALLET");

    const [, options] = apiFetch.mock.calls[0] as [
      string,
      { revalidate?: number; tags?: string[] },
    ];
    expect(options.revalidate).toBe(10);
    // Tag is per-wallet and lowercased so the writer's session wallet resolves to the same tag.
    expect(options.tags).toEqual([positionsTag("0xWALLET")]);
    expect(positionsTag("0xWALLET")).toBe("positions:0xwallet");
  });

  it("[R1] a 404 degrades to an empty list", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "no wallet"));
    const { fetchPositions } = await importFetch();
    expect(await fetchPositions("0xabc")).toEqual([]);
  });

  it("rethrows a non-404 error", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(500, "SYSTEM_INTERNAL", "boom"));
    const { fetchPositions } = await importFetch();
    await expect(fetchPositions("0xabc")).rejects.toThrow(ApiError);
  });
});
