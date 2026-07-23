/**
 * @id PP-STR-SCR-002 (POO-300)
 * @name Strategy detail data loader tests
 * @implements-rules-version v2
 *
 * Skeleton until position + balance resolve; finds the position by id, passes the real
 * balance; a fetch error bubbles. v2 (POO-557 R3/R5): with no real series the loader passes an
 * EMPTY series (explicit no-history state downstream), never the synthetic mock builder.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { networkToChainId } from "@/lib/chains/config";
import type { Position, Strategy } from "@/lib/schemas";

const mocks = vi.hoisted(() => ({
  positions: { positions: null as Position[] | null, error: null as unknown },
  getUsdcBalance: vi.fn(),
  replace: vi.fn(),
  // PP-CORE-LIB-048: the C1 /financials payload (byStrategy keyed by position id). null = unavailable.
  financials: null as unknown,
  // POO-847 R1/R2: the measured lg split (null = unmeasured); desktop by default so the
  // pre-existing redirect tests keep their behavior.
  isDesktop: true as boolean | null,
}));

vi.mock("@/lib/positions/usePositions", () => ({ usePositions: () => mocks.positions }));
vi.mock("@/lib/account/useAccountService", () => ({
  useAccountService: () => ({ getUsdcBalance: mocks.getUsdcBalance }),
}));
// PP-CORE-LIB-048: the share card sources feesEarned from the C1 /financials byStrategy block.
vi.mock("@/lib/financials/useWalletFinancials", () => ({
  useWalletFinancials: () => mocks.financials,
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/hooks/useIsDesktop", () => ({ useIsDesktop: () => mocks.isDesktop }));
vi.mock("./components/StrategyDetailSkeleton", () => ({
  StrategyDetailSkeleton: () => <div data-testid="skeleton" />,
}));
vi.mock("./StrategyDetailScreen", () => ({
  StrategyDetailScreen: ({
    position,
    balance,
    chartData,
    earnings,
  }: {
    position: Position | null;
    balance: number;
    chartData: { value: number }[];
    earnings?: { "24h": number; "7d": number; "30d": number } | null;
  }) => (
    <div
      data-testid="screen"
      data-position={position?.id ?? "none"}
      data-balance={balance}
      data-chart-len={chartData.length}
      data-chart-first={chartData[0]?.value}
      data-earnings={earnings ? `${earnings["24h"]}/${earnings["7d"]}/${earnings["30d"]}` : "none"}
    />
  ),
}));

import type { ChartPoint } from "@/components/data-display/PerformanceChart";
import { StrategyDetailDataLoader } from "./StrategyDetailDataLoader";

const strategy = { id: "s1", estReturn: 10 } as Strategy;

describe("StrategyDetailDataLoader", () => {
  beforeEach(() => {
    mocks.positions = { positions: null, error: null };
    mocks.getUsdcBalance.mockReset();
    mocks.replace.mockReset();
    mocks.financials = null;
    mocks.isDesktop = true;
  });

  it("shows the skeleton until both position and balance resolve", () => {
    mocks.getUsdcBalance.mockReturnValue(new Promise(() => {})); // never resolves
    render(<StrategyDetailDataLoader strategy={strategy} />);
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
  });

  it("finds the position by strategy id and passes the real balance", async () => {
    mocks.positions = {
      positions: [{ id: "p1", strategyId: "s1" } as Position],
      error: null,
    };
    mocks.getUsdcBalance.mockResolvedValue(43.31);

    render(<StrategyDetailDataLoader strategy={strategy} />);

    await waitFor(() => expect(screen.getByTestId("screen")).toBeInTheDocument());
    expect(screen.getByTestId("screen")).toHaveAttribute("data-position", "p1");
    expect(screen.getByTestId("screen")).toHaveAttribute("data-balance", "43.31");
  });

  /** A C1 financials payload carrying one position's per-strategy block (the SOLE share-card source). */
  function financialsFor(
    positionId: string,
    feesEarned: { "24h": number | null; "7d": number | null; "30d": number | null },
  ) {
    return {
      address: "0xabc",
      earnedToday: 0,
      feesEarned: { "24h": 0, "7d": 0, "30d": 0 },
      invested: 0,
      totalYield: 0,
      portfolioValue: 0,
      claimableGross: 0,
      coverage: 1,
      provisional: false,
      byStrategy: {
        [positionId]: {
          invested: 0,
          currentValue: 0,
          available: 0,
          totalYield: 0,
          collectedFees: { "24h": 0, "7d": 0, "30d": 0, all: 0 },
          feesEarned,
          provisional: false,
        },
      },
      last_updated: {},
    };
  }

  // PP-CORE-LIB-048: the share-card figures come from the C1 byStrategy[id].feesEarned block DIRECTLY
  // (the serving layer already floors these >= 0, so there is no FE re-clamp and no legacy fallback).
  it("[PP-CORE-LIB-048] threads the C1 feesEarned windows into the share-card earnings", async () => {
    mocks.positions = {
      positions: [{ id: "p1", strategyId: "s1" } as Position],
      error: null,
    };
    mocks.getUsdcBalance.mockResolvedValue(10);
    mocks.financials = financialsFor("p1", { "24h": 1.75, "7d": 9.5, "30d": 42 });

    render(<StrategyDetailDataLoader strategy={strategy} />);

    await waitFor(() => expect(screen.getByTestId("screen")).toBeInTheDocument());
    expect(screen.getByTestId("screen")).toHaveAttribute("data-earnings", "1.75/9.5/42");
  });

  // A served-NULL window is honest-absent → the whole share card stays hidden (never a fabricated 0,
  // never a legacy figure).
  it("[PP-CORE-LIB-048] a served-NULL window hides the share card (no earnings)", async () => {
    mocks.positions = {
      positions: [{ id: "p1", strategyId: "s1" } as Position],
      error: null,
    };
    mocks.getUsdcBalance.mockResolvedValue(10);
    mocks.financials = financialsFor("p1", { "24h": null, "7d": 3.4, "30d": 12.9 });

    render(<StrategyDetailDataLoader strategy={strategy} />);

    await waitFor(() => expect(screen.getByTestId("screen")).toBeInTheDocument());
    expect(screen.getByTestId("screen")).toHaveAttribute("data-earnings", "none");
  });

  it("[PP-CORE-LIB-048] passes no earnings (share card hidden) when financials are unavailable", async () => {
    mocks.positions = {
      positions: [{ id: "p1", strategyId: "s1" } as Position],
      error: null,
    };
    mocks.getUsdcBalance.mockResolvedValue(10);
    mocks.financials = null; // outage / not-signed-in — never a legacy figure

    render(<StrategyDetailDataLoader strategy={strategy} />);

    await waitFor(() => expect(screen.getByTestId("screen")).toBeInTheDocument());
    expect(screen.getByTestId("screen")).toHaveAttribute("data-earnings", "none");
  });

  it("[PP-CORE-LIB-048] passes no earnings when this position is uncovered by financials", async () => {
    mocks.positions = {
      positions: [{ id: "p1", strategyId: "s1" } as Position],
      error: null,
    };
    mocks.getUsdcBalance.mockResolvedValue(10);
    // Financials present but byStrategy does not carry this position id → uncovered → no earnings.
    mocks.financials = financialsFor("other-pos", { "24h": 1, "7d": 2, "30d": 3 });

    render(<StrategyDetailDataLoader strategy={strategy} />);

    await waitFor(() => expect(screen.getByTestId("screen")).toBeInTheDocument());
    expect(screen.getByTestId("screen")).toHaveAttribute("data-earnings", "none");
  });

  it("reads the spendable balance on the strategy's network (per-network, POO-303)", async () => {
    mocks.positions = { positions: [], error: null };
    mocks.getUsdcBalance.mockResolvedValue(38.005424);
    const arbStrategy = { id: "s1", estReturn: 10, network: "arbitrum" } as Strategy;

    render(<StrategyDetailDataLoader strategy={arbStrategy} />);

    await waitFor(() => expect(screen.getByTestId("screen")).toBeInTheDocument());
    expect(mocks.getUsdcBalance).toHaveBeenCalledWith(networkToChainId("arbitrum"));
    expect(screen.getByTestId("screen")).toHaveAttribute("data-balance", "38.005424");
  });

  it("keeps the screen mounted across a chainChanged-style re-render (no skeleton flash; POO-350)", async () => {
    mocks.positions = { positions: [], error: null };
    mocks.getUsdcBalance.mockResolvedValue(12.5);

    const { rerender } = render(<StrategyDetailDataLoader strategy={strategy} />);
    await waitFor(() => expect(screen.getByTestId("screen")).toBeInTheDocument());
    const callsAfterLoad = mocks.getUsdcBalance.mock.calls.length;

    // A chainChanged event (e.g. invest's switchChain to a non-default chain) churns the
    // account-service identity. The balance read is keyed on the stable getUsdcBalance callback,
    // not the churning account object, so a re-render does NOT re-fire it or collapse the screen
    // back to the skeleton — which would unmount an in-flight transaction modal (POO-350).
    rerender(<StrategyDetailDataLoader strategy={strategy} />);
    rerender(<StrategyDetailDataLoader strategy={strategy} />);

    expect(mocks.getUsdcBalance.mock.calls.length).toBe(callsAfterLoad);
    expect(screen.getByTestId("screen")).toBeInTheDocument();
    expect(screen.queryByTestId("skeleton")).toBeNull();
  });

  it("renders the discovery state when the wallet owns no matching position", async () => {
    mocks.positions = { positions: [], error: null };
    mocks.getUsdcBalance.mockResolvedValue(0);

    render(<StrategyDetailDataLoader strategy={strategy} />);

    await waitFor(() => expect(screen.getByTestId("screen")).toBeInTheDocument());
    expect(screen.getByTestId("screen")).toHaveAttribute("data-position", "none");
  });

  it("redirects a manager to the manage view when they manage the strategy (desktop)", async () => {
    mocks.positions = {
      positions: [{ id: "p1", strategyId: "s1", isPoolManager: true } as Position],
      error: null,
    };
    mocks.getUsdcBalance.mockResolvedValue(10);

    render(<StrategyDetailDataLoader strategy={strategy} />);

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/manager?manage=s1"));
    // The investor detail never renders; the skeleton holds while redirecting.
    expect(screen.queryByTestId("screen")).toBeNull();
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
  });

  // @rule POO-847 R1/R2 (Murilo 2026-07-11): the managed surface is desktop-only — below lg an
  // owned position renders the INVESTOR detail (Owned state) instead of redirecting.
  it("[POO-847 R1/R2] below lg an owned position renders the investor detail, no redirect", async () => {
    mocks.isDesktop = false;
    mocks.positions = {
      positions: [{ id: "p1", strategyId: "s1", isPoolManager: true } as Position],
      error: null,
    };
    mocks.getUsdcBalance.mockResolvedValue(10);

    render(<StrategyDetailDataLoader strategy={strategy} />);

    await waitFor(() => expect(screen.getByTestId("screen")).toBeInTheDocument());
    expect(screen.getByTestId("screen")).toHaveAttribute("data-position", "p1");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  // @rule POO-847 R2: while the viewport is UNMEASURED the skeleton holds (never a desktop flash
  // of the investor detail before the redirect, never a premature redirect).
  it("[POO-847 R2] an unmeasured viewport holds the skeleton for an owned position", async () => {
    mocks.isDesktop = null;
    mocks.positions = {
      positions: [{ id: "p1", strategyId: "s1", isPoolManager: true } as Position],
      error: null,
    };
    mocks.getUsdcBalance.mockResolvedValue(10);

    render(<StrategyDetailDataLoader strategy={strategy} />);

    await waitFor(() => expect(screen.getByTestId("skeleton")).toBeInTheDocument());
    expect(screen.queryByTestId("screen")).toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("uses the server-fetched real series for the chart when provided (POO-366)", async () => {
    mocks.positions = { positions: [], error: null };
    mocks.getUsdcBalance.mockResolvedValue(0);
    const realSeries: ChartPoint[] = [
      { value: 1000, label: "Jun 1" },
      { value: 1100, label: "Jun 2" },
    ];

    render(<StrategyDetailDataLoader strategy={strategy} chartData={realSeries} />);

    await waitFor(() => expect(screen.getByTestId("screen")).toBeInTheDocument());
    expect(screen.getByTestId("screen")).toHaveAttribute("data-chart-len", "2");
    expect(screen.getByTestId("screen")).toHaveAttribute("data-chart-first", "1000");
  });

  // @rule R3/R5 (POO-557): real mode never plots the synthetic builder as if real. No (or a short)
  // server series → an EMPTY series reaches the screen, which renders the explicit no-history
  // state. The analytics fetch already degraded gracefully upstream (fetchPoolTimeseries → []),
  // so this path renders without throwing.
  it("passes an empty series (no synthetic fallback) when no real chartData is provided", async () => {
    mocks.positions = { positions: [], error: null };
    mocks.getUsdcBalance.mockResolvedValue(0);

    render(<StrategyDetailDataLoader strategy={strategy} />);

    await waitFor(() => expect(screen.getByTestId("screen")).toBeInTheDocument());
    expect(screen.getByTestId("screen")).toHaveAttribute("data-chart-len", "0");
  });

  it("bubbles a positions fetch error", () => {
    mocks.positions = { positions: null, error: new Error("boom") };
    mocks.getUsdcBalance.mockResolvedValue(10);
    expect(() => render(<StrategyDetailDataLoader strategy={strategy} />)).toThrow("boom");
  });
});
