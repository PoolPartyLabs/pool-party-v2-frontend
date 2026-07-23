/**
 * @id PP-PORT-SCR-001 (POO-668)
 * @name PortfolioView — server-paged Load-more (active + closed)
 * @implements-rules-version v1
 *
 * When the `paged` prop is supplied (real mode), the Portfolio positions + closed-history are
 * SERVER-paged:
 * - [R1] the active "Your positions" list renders the accumulated pages PLAINLY (windowing superseded,
 *   R5) with its own "Load more" that calls paged.active.onLoadMore; the button hides when !hasMore.
 * - [R2] the "Show closed strategies" reveal drives paged.closed (its own Load-more), rendering the
 *   backend order VERBATIM (no client re-sort). A funded-closed row precedes a zero-balance one when
 *   the backend returns them so.
 * - [R3] the KPIs render straight from the scalar props (the aggregates the loader mapped in) —
 *   asserted by the sibling PortfolioView.test.tsx which drives the same scalar props.
 *
 * The `paged`-ABSENT path (mock mode) keeps the one-shot closed toggle + windowing, covered by
 * PortfolioView.test.tsx and PortfolioView.virtualize.test.tsx.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Position, Strategy } from "@/lib/schemas";
import {
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../tests/utils/renderWithProviders";
import {
  type PortfolioPagedControls,
  PortfolioView,
  type PortfolioViewPosition,
  type PortfolioViewProps,
} from "./PortfolioView";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// The paged path must NOT call the one-shot getClosedStrategiesAction; if it does, the mock throws.
vi.mock("./actions", () => ({
  getClosedStrategiesAction: vi.fn(() => {
    throw new Error("paged path must not call getClosedStrategiesAction");
  }),
}));

const STRATEGY: Strategy = {
  id: "s1",
  name: "Stable Yield",
  manager: "Pool Party Labs",
  riskLevel: 2,
  minInvestment: 100,
  tvl: 1_250_000,
  investors: 312,
  estReturn: 7.4,
  rateType: "APY",
  status: "active",
};

function pos(id: string, over: Partial<Position> = {}): PortfolioViewPosition {
  return {
    position: {
      id,
      strategyId: id,
      invested: 1000,
      currentValue: 1000,
      totalYield: 10,
      available: 1000,
      reinvestment: "manual-payout",
      status: "active",
      ...over,
    },
    strategy: { ...STRATEGY, id, name: `Strategy ${id}` },
  };
}

const baseProps = (
  positions: PortfolioViewPosition[],
  paged: PortfolioPagedControls,
): PortfolioViewProps => ({
  totalValue: 4532.5,
  totalEarned: 120.4,
  invested: 4532.5,
  currentValue: 4532.5,
  totalYield: 612.5,
  avgApy: 0,
  chartData: [],
  allocation: [],
  positions,
  paged,
});

function makePaged(over: Partial<PortfolioPagedControls> = {}): PortfolioPagedControls {
  return {
    active: { hasMore: false, loading: false, onLoadMore: vi.fn(), onSortChange: vi.fn() },
    closed: {
      entries: null,
      loading: false,
      hasMore: false,
      onReveal: vi.fn(),
      onLoadMore: vi.fn(),
      ...over.closed,
    },
    ...(over.active ? { active: over.active } : {}),
  };
}

describe("PortfolioView — paged active list (POO-668 R1)", () => {
  it("[R1] renders the accumulated active pages plainly (no windowing spacers)", () => {
    const positions = [pos("a1"), pos("a2"), pos("a3")];
    renderWithProviders(<PortfolioView {...baseProps(positions, makePaged())} />);
    // Every accumulated row renders; no windowing spacer rows in the paged path.
    const table = screen.getByRole("table");
    expect(within(table).getByText("Strategy a1")).toBeInTheDocument();
    expect(within(table).getByText("Strategy a3")).toBeInTheDocument();
    expect(document.querySelectorAll("tr[data-virtual-spacer]")).toHaveLength(0);
    expect(document.querySelector("tbody[data-virtualized]")).toBeNull();
  });

  it("[R1] shows a 'Load more' for the active list only while hasMore, and calls onLoadMore", async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    const paged = makePaged();
    paged.active = { hasMore: true, loading: false, onLoadMore, onSortChange: vi.fn() };
    renderWithProviders(<PortfolioView {...baseProps([pos("a1")], paged)} />);

    const button = screen.getByRole("button", { name: "Load more" });
    await user.click(button);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("[R1] hides the active 'Load more' when there is nothing more", () => {
    const paged = makePaged();
    paged.active = { hasMore: false, loading: false, onLoadMore: vi.fn(), onSortChange: vi.fn() };
    renderWithProviders(<PortfolioView {...baseProps([pos("a1")], paged)} />);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("[R1] disables the active 'Load more' while a page load is in flight", () => {
    const paged = makePaged();
    paged.active = { hasMore: true, loading: true, onLoadMore: vi.fn(), onSortChange: vi.fn() };
    renderWithProviders(<PortfolioView {...baseProps([pos("a1")], paged)} />);
    expect(screen.getByRole("button", { name: "Loading" })).toBeDisabled();
  });
});

// @rule POO-829 R2/R3/R8 (rules v2): in real (paged) mode the desktop headers with a backend sort
// field (Invested / Current Value / Yield / Rate) are interactive and forward the change to
// paged.active.onSortChange (server round-trip, page-0 reset). Risk has NO backend sort field
// (POO-828 defers riskLevel), so its header renders as plain text (POO-734-style dead header). The
// rows render in SERVER order verbatim — the view never re-sorts a paged list client-side.
describe("PortfolioView — paged sortable headers (POO-829 R3)", () => {
  it("[R3] the four backend-sortable headers are buttons; Risk renders as plain text", () => {
    renderWithProviders(<PortfolioView {...baseProps([pos("a1")], makePaged())} />);
    for (const name of ["Invested", "Current Value", "Yield", "Rate"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    // Risk is not server-sortable → no silent no-op button; the label still renders (plain <span>).
    expect(screen.queryByRole("button", { name: "Risk" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Risk" })).toBeInTheDocument();
    // Strategy was never a sort column.
    expect(screen.queryByRole("button", { name: "Strategy" })).toBeNull();
  });

  it("[R2] clicking the default Yield column flips its direction and forwards onSortChange", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    const paged = makePaged();
    paged.active = { hasMore: false, loading: false, onLoadMore: vi.fn(), onSortChange };
    renderWithProviders(<PortfolioView {...baseProps([pos("a1")], paged)} />);

    // Yield is the default active column (desc) — a click flips to asc, server-side.
    await user.click(screen.getByRole("button", { name: "Yield" }));
    expect(onSortChange).toHaveBeenCalledWith({ key: "yield", dir: "asc" });
  });

  it("[R3] clicking another sortable column sorts it DESCENDING first via onSortChange", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    const paged = makePaged();
    paged.active = { hasMore: false, loading: false, onLoadMore: vi.fn(), onSortChange };
    renderWithProviders(<PortfolioView {...baseProps([pos("a1")], paged)} />);

    await user.click(screen.getByRole("button", { name: "Invested" }));
    expect(onSortChange).toHaveBeenCalledWith({ key: "invested", dir: "desc" });
  });

  it("[R2] renders the paged rows in SERVER order verbatim (no client re-sort)", () => {
    // Input order contradicts the default yield-desc sort on purpose: low yield first.
    const low = pos("a-low", { totalYield: 1 });
    low.strategy = { ...STRATEGY, id: "a-low", name: "Low Yield" };
    const high = pos("a-high", { totalYield: 99 });
    high.strategy = { ...STRATEGY, id: "a-high", name: "High Yield" };
    renderWithProviders(<PortfolioView {...baseProps([low, high], makePaged())} />);

    const text = screen.getByRole("table").textContent ?? "";
    // Server order preserved: Low Yield stays BEFORE High Yield despite the yield-desc default.
    expect(text.indexOf("Low Yield")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Low Yield")).toBeLessThan(text.indexOf("High Yield"));
  });

  it("[R8] the paged mobile dropdown offers only the server-sortable metrics and forwards the change", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    const paged = makePaged();
    paged.active = { hasMore: false, loading: false, onLoadMore: vi.fn(), onSortChange };
    renderWithProviders(<PortfolioView {...baseProps([pos("a1")], paged)} />);

    await user.click(screen.getByRole("button", { name: "Sort by: Yield" }));
    // Risk has no server sort field, so the paged dropdown must not offer it.
    expect(screen.queryByRole("option", { name: "Risk" })).toBeNull();
    await user.click(screen.getByRole("option", { name: "Rate" }));
    expect(onSortChange).toHaveBeenCalledWith({ key: "rate", dir: "desc" });
  });
});

describe("PortfolioView — paged closed list (POO-668 R2)", () => {
  it("[R2] reveals via paged.closed.onReveal (not the one-shot action)", async () => {
    const user = userEvent.setup();
    const onReveal = vi.fn();
    const paged = makePaged();
    paged.closed = { entries: null, loading: false, hasMore: false, onReveal, onLoadMore: vi.fn() };
    renderWithProviders(<PortfolioView {...baseProps([pos("a1")], paged)} />);

    await user.click(screen.getByRole("button", { name: /Closed strategies/i }));
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it("[R2] renders the backend closed order VERBATIM: funded-closed before zero-balance", async () => {
    const user = userEvent.setup();
    const funded = pos("c-funded", { status: "closed", currentValue: 500, totalYield: 5 });
    funded.strategy = { ...STRATEGY, id: "c-funded", name: "Funded Closed" };
    const zero = pos("c-zero", { status: "closed", currentValue: 0, totalYield: 0 });
    zero.strategy = { ...STRATEGY, id: "c-zero", name: "Zero Closed" };
    // Backend order: funded first, zero after.
    const paged = makePaged();
    paged.closed = {
      entries: [funded, zero],
      loading: false,
      hasMore: false,
      onReveal: vi.fn(),
      onLoadMore: vi.fn(),
    };
    renderWithProviders(<PortfolioView {...baseProps([pos("a1")], paged)} />);

    await user.click(screen.getByRole("button", { name: /Closed strategies/i }));
    const region = document.getElementById("portfolio-closed-strategies");
    if (!region) throw new Error("expected the revealed closed region");
    const text = region.textContent ?? "";
    // The funded-closed name appears BEFORE the zero-balance one — verbatim backend order, no re-sort.
    expect(text.indexOf("Funded Closed")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Funded Closed")).toBeLessThan(text.indexOf("Zero Closed"));
  });

  it("[R2] shows the closed 'Load more' only while paged.closed.hasMore and calls onLoadMore", async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    const closedEntry = pos("c1", { status: "closed" });
    closedEntry.strategy = { ...STRATEGY, id: "c1", name: "ETH Momentum" };
    const paged = makePaged();
    paged.closed = {
      entries: [closedEntry],
      loading: false,
      hasMore: true,
      onReveal: vi.fn(),
      onLoadMore,
    };
    renderWithProviders(<PortfolioView {...baseProps([pos("a1")], paged)} />);

    await user.click(screen.getByRole("button", { name: /Closed strategies/i }));
    const region = document.getElementById("portfolio-closed-strategies");
    if (!region) throw new Error("expected the revealed closed region");
    const loadMore = within(region).getByRole("button", { name: "Load more" });
    await user.click(loadMore);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("[R2] shows the closed empty state when the revealed closed feed is empty", async () => {
    const user = userEvent.setup();
    const paged = makePaged();
    paged.closed = {
      entries: [],
      loading: false,
      hasMore: false,
      onReveal: vi.fn(),
      onLoadMore: vi.fn(),
    };
    renderWithProviders(<PortfolioView {...baseProps([pos("a1")], paged)} />);

    await user.click(screen.getByRole("button", { name: /Closed strategies/i }));
    expect(await screen.findByText("No closed strategies yet")).toBeInTheDocument();
  });
});
