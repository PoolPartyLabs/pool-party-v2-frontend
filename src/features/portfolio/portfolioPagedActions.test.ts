/**
 * @id PP-PORT-SCR-001 (POO-668)
 * @name Portfolio paged server action tests
 * @implements-rules-version v2
 *
 * - loadPortfolioPageAction reads ONE page of EITHER feed (`closed=none` active / `closed=exited`
 *   history), joins each position to its strategy, and returns the page + the backend GRAND
 *   aggregates. [R2] backend order verbatim. v3 (POO-829): it is now the ONLY portfolio page action —
 *   the active drain (getActivePortfolioAction) was retired by the server-paged cutover.
 * - [R3] the KPI aggregates come straight from the read, never recomputed over the page/set.
 * - [R5] the `sorting` param threads through to fetchPortfolioPage (POO-828 honors it).
 * - not signed in → empty result + zeroed aggregates, no read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortfolioAggregates } from "@/lib/portfolio/positionsSchema";
import type { Position } from "@/lib/schemas";

const mocks = vi.hoisted(() => ({
  wallet: "0xWALLET" as string | null,
  authHeader: { Authorization: "Bearer t" } as Record<string, string>,
  fetchPortfolioPage: vi.fn(),
  listStrategiesForHoldings: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionWallet: async () => mocks.wallet,
  getAuthHeader: async () => mocks.authHeader,
}));
vi.mock("@/lib/portfolio/fetchPortfolioPage", () => ({
  fetchPortfolioPage: (...args: unknown[]) => mocks.fetchPortfolioPage(...args),
}));
vi.mock("@/lib/strategies/strategyCatalog", () => ({
  listStrategiesForHoldings: (...args: unknown[]) => mocks.listStrategiesForHoldings(...args),
}));

import { loadPortfolioPageAction } from "./portfolioPagedActions";

const strategy = {
  id: "s1",
  name: "Stable Yield",
  manager: "Pool Party Labs",
  riskLevel: 2,
  minInvestment: 100,
  tvl: 1_250_000,
  investors: 312,
  estReturn: 7.4,
  rateType: "APY" as const,
  status: "active" as const,
};

const funded: Position = {
  id: "0xfunded",
  strategyId: "s1",
  invested: 500,
  currentValue: 500,
  totalYield: 5,
  available: 500,
  reinvestment: "manual-payout",
  status: "closed",
};
const zero: Position = { ...funded, id: "0xzero", currentValue: 0, totalYield: 0 };

const AGG: PortfolioAggregates = {
  totalBalanceUsd: 4532.5,
  claimableFeesUsd: 120.4,
  totalFeesInUsd: 612.5,
  totalPerformanceFeesInUsd: 88.2,
};

describe("loadPortfolioPageAction", () => {
  beforeEach(() => {
    mocks.wallet = "0xWALLET";
    mocks.fetchPortfolioPage.mockReset();
    mocks.listStrategiesForHoldings.mockReset();
    mocks.listStrategiesForHoldings.mockResolvedValue([strategy]);
  });

  it("returns an empty page + zeroed aggregates without a read when not signed in", async () => {
    mocks.wallet = null;
    const result = await loadPortfolioPageAction({ closed: "none", page: 0, limit: 5 });
    expect(result.items).toEqual([]);
    expect(result.aggregates.totalBalanceUsd).toBe(0);
    expect(mocks.fetchPortfolioPage).not.toHaveBeenCalled();
  });

  it("[R1] reads the ACTIVE feed page (closed=none) with the session wallet + auth", async () => {
    mocks.fetchPortfolioPage.mockResolvedValue({ items: [funded], total: 13, aggregates: AGG });

    await loadPortfolioPageAction({ closed: "none", page: 1, limit: 5 });

    expect(mocks.fetchPortfolioPage).toHaveBeenCalledWith({
      address: "0xWALLET",
      page: 1,
      limit: 5,
      closed: "none",
      authHeader: mocks.authHeader,
    });
  });

  it("[R2] preserves the backend row order verbatim (funded-closed BEFORE zero-balance)", async () => {
    // The backend returns closed-with-balance first; the action must NOT re-sort.
    mocks.fetchPortfolioPage.mockResolvedValue({
      items: [funded, zero],
      total: 13,
      aggregates: AGG,
    });

    const result = await loadPortfolioPageAction({ closed: "exited", page: 0, limit: 5 });

    expect(result.items.map((e) => e.position.id)).toEqual(["0xfunded", "0xzero"]);
    expect(mocks.fetchPortfolioPage).toHaveBeenCalledWith(
      expect.objectContaining({ closed: "exited" }),
    );
  });

  it("[R3] passes the backend GRAND aggregates through untouched", async () => {
    mocks.fetchPortfolioPage.mockResolvedValue({ items: [funded], total: 13, aggregates: AGG });
    const result = await loadPortfolioPageAction({ closed: "none", page: 0, limit: 5 });
    expect(result.aggregates).toEqual(AGG);
  });

  it("[R1] carries the phantom total through (the client hook ignores it for hasMore)", async () => {
    mocks.fetchPortfolioPage.mockResolvedValue({ items: [funded], total: 13, aggregates: AGG });
    const result = await loadPortfolioPageAction({ closed: "none", page: 0, limit: 5 });
    expect(result.total).toBe(13);
  });

  it("[R5] threads the sorting param through to fetchPortfolioPage", async () => {
    mocks.fetchPortfolioPage.mockResolvedValue({ items: [funded], total: 13, aggregates: AGG });

    await loadPortfolioPageAction({
      closed: "none",
      page: 0,
      limit: 5,
      sorting: { key: "yield", dir: "desc" },
    });

    expect(mocks.fetchPortfolioPage).toHaveBeenCalledWith(
      expect.objectContaining({ sorting: { key: "yield", dir: "desc" } }),
    );
  });

  it("joins a position via its fallbackStrategy when the holdings catalog misses (POO-526)", async () => {
    const synth = { ...strategy, id: "s-gone", status: "closed" as const };
    const orphan: Position = {
      ...funded,
      id: "0xorphan",
      strategyId: "s-gone",
      fallbackStrategy: synth,
    };
    mocks.fetchPortfolioPage.mockResolvedValue({ items: [orphan], total: 1, aggregates: AGG });
    mocks.listStrategiesForHoldings.mockResolvedValue([]); // catalog cannot resolve it

    const result = await loadPortfolioPageAction({ closed: "exited", page: 0, limit: 5 });

    expect(result.items).toEqual([{ position: orphan, strategy: synth }]);
  });

  it("drops a position with neither a catalog match nor a fallback (no fabricated data)", async () => {
    const orphan: Position = { ...funded, id: "0xghost", strategyId: "s-missing" };
    mocks.fetchPortfolioPage.mockResolvedValue({ items: [orphan], total: 1, aggregates: AGG });
    mocks.listStrategiesForHoldings.mockResolvedValue([]);

    const result = await loadPortfolioPageAction({ closed: "none", page: 0, limit: 5 });

    expect(result.items).toEqual([]);
  });
});
