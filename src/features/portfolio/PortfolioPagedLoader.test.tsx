/**
 * @id PP-PORT-SCR-001 (POO-668, POO-829)
 * @name PortfolioPagedLoader tests
 * @implements-rules-version v3 (POO-829 rules v2)
 *
 * The real-mode client boundary. v3 (POO-829, the POO-668 cutover): the ACTIVE side leaves the drain
 * and is SERVER-paged (useServerPage over `loadPortfolioPageAction`, page size 5, short-page
 * termination, its own "Load more"), sorted server-side with the default Yield descending. The CLOSED
 * side stays backend-paged (unchanged). `loadPortfolioPageAction` is mocked; the REAL useServerPage
 * state machine runs, so these tests assert the actual paging/sort behavior:
 * - [R1] page size 5, "Load more" appends the next page, short-page termination.
 * - [R2] default sort `yield:desc` rides page 0; a sort change RESETS the pager to page 0.
 * - [R4] avgApy + allocation KPIs read from the backend grand aggregates when present (POO-696),
 *   falling back to the client compute over the loaded active rows when absent.
 * - the closed reveal stays lazy; a real initial active error bubbles to the route boundary.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PortfolioAggregates } from "@/lib/portfolio/positionsSchema";
import type { PortfolioViewPosition, PortfolioViewProps } from "./PortfolioView";
import type { LoadPortfolioPageParams } from "./portfolioPagedActions";

/** Captured props the (mocked) PortfolioView last rendered with. */
let lastViewProps: PortfolioViewProps | null = null;

const strat = (id: string, riskLevel: number, estReturn: number) => ({
  id,
  name: `Strategy ${id}`,
  manager: "Pool Party Labs",
  riskLevel,
  minInvestment: 100,
  tvl: 1_000_000,
  investors: 100,
  estReturn,
  rateType: "APY" as const,
  status: "active" as const,
});
const activeEntry = (id: string, currentValue = 1000, riskLevel = 2, estReturn = 8) =>
  ({
    position: {
      id,
      strategyId: id,
      invested: currentValue,
      currentValue,
      totalYield: 0,
      available: currentValue,
      reinvestment: "manual-payout" as const,
      status: "active" as const,
    },
    strategy: strat(id, riskLevel, estReturn),
  }) satisfies PortfolioViewPosition;

/** A grand-aggregates fixture; POO-696 fields (avgApr/allocation) added per test. */
const AGG: PortfolioAggregates = {
  totalBalanceUsd: 4532.5,
  claimableFeesUsd: 120.4,
  totalFeesInUsd: 612.5,
  totalPerformanceFeesInUsd: 88.2,
};

const mocks = vi.hoisted(() => ({
  isSignedIn: true,
  loadPortfolioPageAction: vi.fn(),
  financials: null as unknown,
}));

vi.mock("@/lib/auth/useSiweSession", () => ({
  useSiweSession: () => ({ isSignedIn: mocks.isSignedIn, status: "authenticated" }),
}));

// The single server action behind BOTH lists (active `closed=none` + history `closed=exited`).
vi.mock("./portfolioPagedActions", () => ({
  loadPortfolioPageAction: (...args: unknown[]) => mocks.loadPortfolioPageAction(...args),
}));

// PP-CORE-LIB-048: the C1 /financials hook feeds Invested + Total yield. Configurable so the threading
// is assertable; null = unavailable (Invested / Total yield render "not available yet").
vi.mock("@/lib/financials/useWalletFinancials", () => ({
  useWalletFinancials: () => mocks.financials,
}));

vi.mock("@/lib/portfolio/useInvestorPortfolioSeries", () => ({
  useInvestorPortfolioSeries: () => [],
}));

vi.mock("./PortfolioView", () => ({
  PortfolioView: (props: PortfolioViewProps) => {
    lastViewProps = props;
    return <div data-testid="portfolio-view" />;
  },
}));

vi.mock("./components/PortfolioSkeleton", () => ({
  PortfolioSkeleton: () => <div data-testid="skeleton" />,
}));

import { PortfolioPagedLoader } from "./PortfolioPagedLoader";

/** Route-boundary stand-in for the error-bubbling assertion. */
class Boundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state: { message: string | null } = { message: null };
  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }
  render() {
    return this.state.message ? (
      <div data-testid="boundary">{this.state.message}</div>
    ) : (
      this.props.children
    );
  }
}

/** Serve the ACTIVE feed from `pages` (by page index) and the closed feed empty. */
function serveActivePages(pages: PortfolioViewPosition[][], aggregates: PortfolioAggregates = AGG) {
  mocks.loadPortfolioPageAction.mockImplementation(async (params: LoadPortfolioPageParams) => {
    if (params.closed === "exited") return { items: [], total: 0, aggregates };
    return { items: pages[params.page] ?? [], total: 13, aggregates };
  });
}

/** The calls that hit the ACTIVE feed (`closed=none`). */
function activeCalls(): LoadPortfolioPageParams[] {
  return (mocks.loadPortfolioPageAction.mock.calls as [LoadPortfolioPageParams][])
    .map(([params]) => params)
    .filter((params) => params.closed === "none");
}

describe("PortfolioPagedLoader (POO-829 — server-paged active list)", () => {
  beforeEach(() => {
    lastViewProps = null;
    mocks.isSignedIn = true;
    mocks.financials = null;
    mocks.loadPortfolioPageAction.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("shows the skeleton while the first active page is in flight", () => {
    mocks.loadPortfolioPageAction.mockReturnValue(new Promise(() => {})); // never settles
    render(<PortfolioPagedLoader locale="en" />);
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("portfolio-view")).toBeNull();
  });

  it("shows the skeleton (never a false empty state) while signed out — and reads nothing", async () => {
    mocks.isSignedIn = false;
    render(<PortfolioPagedLoader locale="en" />);
    await waitFor(() => expect(screen.getByTestId("skeleton")).toBeInTheDocument());
    expect(mocks.loadPortfolioPageAction).not.toHaveBeenCalled();
  });

  it("[R1][R2] reads ACTIVE page 0 with page size 5 and the default Yield-descending sort", async () => {
    serveActivePages([[activeEntry("a1")]]);
    render(<PortfolioPagedLoader locale="en" />);
    await waitFor(() => expect(screen.getByTestId("portfolio-view")).toBeInTheDocument());

    expect(activeCalls()[0]).toEqual({
      closed: "none",
      page: 0,
      limit: 5,
      sorting: { key: "yield", dir: "desc" },
    });
  });

  it("[R1] a full page enables the active Load more; onLoadMore appends page 1", async () => {
    const page0 = ["a1", "a2", "a3", "a4", "a5"].map((id) => activeEntry(id));
    const page1 = [activeEntry("a6"), activeEntry("a7")];
    serveActivePages([page0, page1]);
    render(<PortfolioPagedLoader locale="en" />);
    await waitFor(() => expect(lastViewProps?.positions).toHaveLength(5));

    // Full page (5 of 5) → another page may exist (short-page termination).
    expect(lastViewProps?.paged?.active.hasMore).toBe(true);
    await act(async () => lastViewProps?.paged?.active.onLoadMore());
    await waitFor(() => expect(lastViewProps?.positions).toHaveLength(7));

    expect(activeCalls()[1]).toEqual(expect.objectContaining({ page: 1, closed: "none" }));
    // Page 1 came back short (2 < 5) → the active list is complete.
    expect(lastViewProps?.paged?.active.hasMore).toBe(false);
  });

  it("[R1] a short first page disables the active Load more", async () => {
    serveActivePages([[activeEntry("a1"), activeEntry("a2")]]);
    render(<PortfolioPagedLoader locale="en" />);
    await waitFor(() => expect(lastViewProps?.positions).toHaveLength(2));
    expect(lastViewProps?.paged?.active.hasMore).toBe(false);
  });

  it("[R2] a sort change RESETS the pager to page 0 with the new sorting", async () => {
    const page0 = ["a1", "a2", "a3", "a4", "a5"].map((id) => activeEntry(id));
    const page1 = ["a6", "a7", "a8", "a9", "a10"].map((id) => activeEntry(id));
    serveActivePages([page0, page1]);
    render(<PortfolioPagedLoader locale="en" />);
    await waitFor(() => expect(lastViewProps?.positions).toHaveLength(5));
    await act(async () => lastViewProps?.paged?.active.onLoadMore());
    await waitFor(() => expect(lastViewProps?.positions).toHaveLength(10));

    // The user picks another column: the loader must re-read PAGE 0 with the new sort tuple,
    // REPLACING the accumulated pages (never appending onto the stale order).
    await act(async () =>
      lastViewProps?.paged?.active.onSortChange({ key: "invested", dir: "asc" }),
    );
    await waitFor(() => expect(lastViewProps?.positions).toHaveLength(5));

    const calls = activeCalls();
    expect(calls[calls.length - 1]).toEqual({
      closed: "none",
      page: 0,
      limit: 5,
      sorting: { key: "invested", dir: "asc" },
    });
  });

  it("[R4] avgApy + allocation KPIs read from the backend grand aggregates when present (POO-696)", async () => {
    serveActivePages([[activeEntry("a1", 1000, 2, 10)]], {
      ...AGG,
      avgApr: 12.3,
      allocation: [
        { level: 2, value: 3000 },
        { level: 4, value: 1532.5 },
      ],
    });
    render(<PortfolioPagedLoader locale="en" />);
    await waitFor(() => expect(screen.getByTestId("portfolio-view")).toBeInTheDocument());

    // Balance/fees from the grand aggregates (POO-668 R3), avgApy/allocation from POO-696.
    expect(lastViewProps?.totalValue).toBe(4532.5);
    expect(lastViewProps?.totalEarned).toBe(120.4);
    expect(lastViewProps?.avgApy).toBe(12.3);
    expect(lastViewProps?.allocation).toEqual([
      { level: 2, value: 3000 },
      { level: 4, value: 1532.5 },
    ]);
  });

  it("[R4] falls back to the client compute over the LOADED active rows when the aggregate is absent", async () => {
    // 1000 @ 10% + 3000 @ 6% = 7% weighted; allocation over bands 2 and 4.
    serveActivePages([[activeEntry("a1", 1000, 2, 10), activeEntry("a2", 3000, 4, 6)]]);
    render(<PortfolioPagedLoader locale="en" />);
    await waitFor(() => expect(lastViewProps?.positions).toHaveLength(2));

    expect(lastViewProps?.avgApy).toBeCloseTo(7, 10);
    expect(lastViewProps?.allocation).toEqual([
      { level: 2, value: 1000 },
      { level: 4, value: 3000 },
    ]);
  });

  it("[R2-closed] the closed history stays lazy until reveal, then reads closed=exited UNSORTED", async () => {
    serveActivePages([[activeEntry("a1")]]);
    render(<PortfolioPagedLoader locale="en" />);
    await waitFor(() => expect(screen.getByTestId("portfolio-view")).toBeInTheDocument());

    // No `closed=exited` read on the initial load.
    const closedCallsBefore = (
      mocks.loadPortfolioPageAction.mock.calls as [LoadPortfolioPageParams][]
    ).filter(([params]) => params.closed === "exited");
    expect(closedCallsBefore).toHaveLength(0);
    expect(lastViewProps?.paged?.closed.entries).toBeNull();

    await act(async () => lastViewProps?.paged?.closed.onReveal());
    await waitFor(() => expect(lastViewProps?.paged?.closed.entries).not.toBeNull());

    const closedCall = (
      mocks.loadPortfolioPageAction.mock.calls as [LoadPortfolioPageParams][]
    ).find(([params]) => params.closed === "exited")?.[0];
    // Backend order verbatim (closed-with-balance-first): the closed read never carries `sorting`.
    expect(closedCall).toEqual({ closed: "exited", page: 0, limit: 5 });
  });

  it("bubbles a real initial active error to the route boundary", async () => {
    mocks.loadPortfolioPageAction.mockRejectedValue(new Error("boom"));
    // React logs the boundary-caught error; silence the expected noise for this case only.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Boundary>
        <PortfolioPagedLoader locale="en" />
      </Boundary>,
    );
    await waitFor(() => expect(screen.getByTestId("boundary")).toHaveTextContent("boom"));
    errorSpy.mockRestore();
  });

  it("[R4-freshness] a focus refresh re-reads the loaded active pages in place", async () => {
    serveActivePages([[activeEntry("a1")]]);
    render(<PortfolioPagedLoader locale="en" />);
    await waitFor(() => expect(screen.getByTestId("portfolio-view")).toBeInTheDocument());
    const readsBefore = activeCalls().length;

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    // The refresh re-reads page 0..cursor in place (a refresh, not a reset — same params).
    await waitFor(() => expect(activeCalls().length).toBeGreaterThan(readsBefore));
    expect(activeCalls()[activeCalls().length - 1]).toEqual(
      expect.objectContaining({ page: 0, closed: "none" }),
    );
    expect(lastViewProps?.positions).toHaveLength(1);
  });

  // PP-CORE-LIB-048 (POO-990): Invested + Total yield read the C1 /financials payload EXCLUSIVELY.
  // The "unclaimed fees" pill (totalEarned) stays CLAIMABLE-ONLY (POO-898 R1) — the C1 claimableGross
  // preferred, the pp_api grand claimable aggregate as the non-legacy non-null fallback.
  it("[PP-CORE-LIB-048] Invested + Total yield come from the C1 /financials payload; the pill stays claimable", async () => {
    serveActivePages([[activeEntry("a1")]]);
    mocks.financials = {
      address: "0xabc",
      earnedToday: 5,
      feesEarned: { "24h": 5, "7d": 40, "30d": 100 },
      invested: 3000,
      totalYield: 654.32,
      portfolioValue: 4600,
      claimableGross: 88,
      coverage: 1,
      provisional: false,
      byStrategy: {},
      last_updated: {},
    };
    render(<PortfolioPagedLoader locale="en" />);
    await waitFor(() => expect(screen.getByTestId("portfolio-view")).toBeInTheDocument());

    expect(lastViewProps?.invested).toBe(3000); // financials.invested
    expect(lastViewProps?.totalYield).toBe(654.32); // financials.totalYield (the field Home reads)
    expect(lastViewProps?.totalEarned).toBe(88); // financials.claimableGross (the pill)
  });

  it("[PP-CORE-LIB-048] an UNAVAILABLE financials read renders Invested + Total yield null, pill/hero from pp_api", async () => {
    serveActivePages([[activeEntry("a1")]]);
    mocks.financials = null; // outage / not-signed-in
    render(<PortfolioPagedLoader locale="en" />);
    await waitFor(() => expect(screen.getByTestId("portfolio-view")).toBeInTheDocument());
    expect(lastViewProps?.invested).toBeNull(); // never a legacy figure
    expect(lastViewProps?.totalYield).toBeNull();
    // The non-nullable hero + pill still render off the pp_api grand aggregate (never blanked, never NaN).
    expect(lastViewProps?.totalEarned).toBe(120.4);
    expect(Number.isNaN(lastViewProps?.totalEarned)).toBe(false);
  });
});
