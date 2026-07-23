/**
 * @id PP-DASH-SCR-001 (POO-299, POO-453, POO-990)
 * @name Home data loader tests
 * @implements-rules-version v3
 *
 * [R5] skeleton until positions resolve, then the view. [R6] a non-retryable error bubbles; while a
 * transient failure is being retried the skeleton shows a subtle note instead of the error boundary.
 * [R7] once positions are on screen, a retried background refresh shows a compact "updating" note; it
 * is absent when not retrying and when there are no positions.
 *
 * PP-CORE-LIB-048 (POO-990): the legacy `/metrics` read (useWalletMetrics) is gone — the money KPIs
 * thread from the C1 `/financials` payload (useWalletFinancials) EXCLUSIVELY. A null financials read
 * renders the money KPIs as null ("not available yet"), never a legacy number.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletFinancials } from "@/lib/financials/financialsSchema";
import type { Position } from "@/lib/schemas";
import type { HomeViewProps } from "./HomeView";

/** Captured props the (mocked) HomeView last rendered with (PP-CORE-LIB-048 KPI threading). */
let lastViewProps: HomeViewProps | null = null;

const mocks = vi.hoisted(() => ({
  result: {
    positions: null as Position[] | null,
    error: null as unknown,
    isRetrying: false,
  },
  // PP-CORE-LIB-048: the C1 /financials payload — the SOLE money source. Null = unavailable.
  financials: null as unknown,
}));

vi.mock("@/lib/positions/usePositions", () => ({ usePositions: () => mocks.result }));
// POO-367: the real per-investor series is a separate wallet-scoped hook; the loader only threads it
// into the view model. Stub it here so this suite stays focused on the positions/loading behavior.
vi.mock("@/lib/portfolio/useInvestorPortfolioSeries", () => ({
  useInvestorPortfolioSeries: () => [],
}));
// PP-CORE-LIB-048: the C1 financials hook — configurable so the money-KPI threading is assertable.
vi.mock("@/lib/financials/useWalletFinancials", () => ({
  useWalletFinancials: () => mocks.financials,
}));
vi.mock("./HomeView", () => ({
  HomeView: (props: HomeViewProps) => {
    lastViewProps = props;
    return <div data-testid="home-view" />;
  },
}));
vi.mock("./components/HomeSkeleton", () => ({
  HomeSkeleton: () => <div data-testid="skeleton" />,
}));
vi.mock("@/components/feedback/StillLoadingNote", () => ({
  StillLoadingNote: ({ variant }: { variant?: string }) => (
    <div data-testid="still-loading-note" data-variant={variant ?? "block"} />
  ),
}));

import { HomeDataLoader } from "./HomeDataLoader";

const onePosition = [{ id: "p1" }] as unknown as Position[];

/** A minimal C1 investor financials payload with the given money fields (the rest are 0/empty). */
function financials(overrides: Partial<WalletFinancials> = {}): WalletFinancials {
  return {
    address: "0xwallet",
    earnedToday: 0,
    feesEarned: { "24h": 0, "7d": 0, "30d": 0 },
    invested: 0,
    totalYield: 0,
    portfolioValue: 0,
    claimableGross: 0,
    coverage: 1,
    provisional: false,
    byStrategy: {},
    last_updated: {},
    ...overrides,
  } as WalletFinancials;
}

describe("HomeDataLoader", () => {
  beforeEach(() => {
    lastViewProps = null;
    mocks.result = { positions: null, error: null, isRetrying: false };
    mocks.financials = null;
  });

  it("[R5] shows the skeleton while positions are loading (no note yet)", () => {
    render(<HomeDataLoader strategies={[]} locale="en" />);
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("home-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("still-loading-note")).not.toBeInTheDocument();
  });

  it("[R6] shows the skeleton + a subtle note while a transient failure is retried", () => {
    mocks.result = { positions: null, error: null, isRetrying: true };
    render(<HomeDataLoader strategies={[]} locale="en" />);
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("still-loading-note")).toBeInTheDocument();
  });

  it("[R5] renders the view once positions resolve", () => {
    mocks.result = { positions: [], error: null, isRetrying: false };
    render(<HomeDataLoader strategies={[]} locale="en" />);
    expect(screen.getByTestId("home-view")).toBeInTheDocument();
  });

  it("[R7] shows the inline 'updating' note when populated AND a background refresh is retrying", () => {
    mocks.result = { positions: onePosition, error: null, isRetrying: true };
    render(<HomeDataLoader strategies={[]} locale="en" />);
    expect(screen.getByTestId("home-view")).toBeInTheDocument();
    const note = screen.getByTestId("still-loading-note");
    expect(note).toBeInTheDocument();
    expect(note).toHaveAttribute("data-variant", "inline");
  });

  it("[R7] hides the updating note on a populated view when NOT retrying", () => {
    mocks.result = { positions: onePosition, error: null, isRetrying: false };
    render(<HomeDataLoader strategies={[]} locale="en" />);
    expect(screen.getByTestId("home-view")).toBeInTheDocument();
    expect(screen.queryByTestId("still-loading-note")).not.toBeInTheDocument();
  });

  it("[R7] hides the updating note when retrying but there are no positions", () => {
    mocks.result = { positions: [], error: null, isRetrying: true };
    render(<HomeDataLoader strategies={[]} locale="en" />);
    expect(screen.getByTestId("home-view")).toBeInTheDocument();
    expect(screen.queryByTestId("still-loading-note")).not.toBeInTheDocument();
  });

  it("[R6] bubbles a non-retryable fetch error", () => {
    mocks.result = { positions: null, error: new Error("boom"), isRetrying: false };
    expect(() => render(<HomeDataLoader strategies={[]} locale="en" />)).toThrow("boom");
  });

  // PP-CORE-LIB-048: the money KPIs thread from the C1 /financials payload EXCLUSIVELY.
  describe("[PP-CORE-LIB-048] money KPIs read the C1 /financials payload", () => {
    it("threads earnedToday / thisMonth / invested / totalYield from financials", () => {
      mocks.result = { positions: [], error: null, isRetrying: false };
      mocks.financials = financials({
        earnedToday: 4.2,
        feesEarned: { "24h": 4.2, "7d": 9.9, "30d": 61.4 },
        invested: 500,
        totalYield: 73,
      });
      render(<HomeDataLoader strategies={[]} locale="en" />);
      expect(lastViewProps?.earnedToday).toBe(4.2);
      expect(lastViewProps?.thisMonth).toBe(61.4);
      expect(lastViewProps?.invested).toBe(500);
      expect(lastViewProps?.totalYield).toBe(73);
    });

    it("a served-NULL field threads through as null (the tile renders 'not available yet')", () => {
      mocks.result = { positions: [], error: null, isRetrying: false };
      mocks.financials = financials({
        earnedToday: null,
        invested: null,
        totalYield: null,
        feesEarned: { "24h": null, "7d": null, "30d": null },
      });
      render(<HomeDataLoader strategies={[]} locale="en" />);
      expect(lastViewProps?.earnedToday).toBeNull();
      expect(lastViewProps?.invested).toBeNull();
      expect(lastViewProps?.totalYield).toBeNull();
      expect(lastViewProps?.thisMonth).toBeNull();
    });

    it("an UNAVAILABLE financials read (null payload) renders the money KPIs as null, never a legacy figure", () => {
      mocks.result = { positions: onePosition, error: null, isRetrying: false };
      mocks.financials = null; // outage / not-signed-in
      render(<HomeDataLoader strategies={[]} locale="en" />);
      // The positions view still renders; the money KPIs are honest-absent (never fabricated / legacy).
      expect(screen.getByTestId("home-view")).toBeInTheDocument();
      expect(lastViewProps?.earnedToday).toBeNull();
      expect(lastViewProps?.invested).toBeNull();
      expect(lastViewProps?.totalYield).toBeNull();
      expect(lastViewProps?.thisMonth).toBeNull();
    });
  });
});
