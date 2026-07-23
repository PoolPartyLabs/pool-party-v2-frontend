/**
 * @id PP-STR-SCR-001
 * @name Strategies · Explore — tests
 * Behavior: renders the list, filters by search and by risk band, badges owned (managed) and
 * invested strategies (Managed wins when both), shows a no-results state with a clear action, and
 * renders the empty state when there are no strategies.
 */

import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/schemas";
import { renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { StrategiesExploreScreen } from "./StrategiesExploreScreen";

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

const base = {
  minInvestment: 100,
  tvl: 1_000_000,
  investors: 100,
  estReturn: 8,
  rateType: "APY" as const,
  status: "active" as const,
};

const strategies: Strategy[] = [
  {
    id: "s-treasury",
    name: "Treasury Plus",
    manager: "Aave Labs",
    riskLevel: 1,
    type: "yield",
    // Investor-facing pool TVL, distinct from and larger than the managed value (base.tvl = $1M).
    uniswapPoolTvlUsd: 5_000_000,
    ...base,
  },
  {
    id: "s-stable",
    name: "Stable Yield",
    manager: "Pool Party Labs",
    riskLevel: 2,
    type: "yield",
    uniswapPoolTvlUsd: 30_000_000,
    ...base,
  },
  {
    id: "s-degen",
    name: "Degen Rotations",
    manager: "Apex Quant",
    riskLevel: 4,
    type: "trading",
    // No pool TVL → the column must render a dash, never the managed value.
    ...base,
  },
];

// Filters are session-only (plain useState, reset on reload); clear storage between tests anyway
// for isolation against anything else that might persist.
beforeEach(() => {
  localStorage.clear();
  window.dataLayer = [];
});

describe("StrategiesExploreScreen", () => {
  // @rule R7: the verified badge renders inline in the text-only attribution cell when the manager is
  // verified (embedded managerVerified), and is absent otherwise.
  const verifiedRow: Strategy = {
    id: "s-verified",
    name: "Verified Strat",
    manager: "Aave Labs",
    riskLevel: 1,
    type: "yield",
    managerVerified: true,
    ...base,
  };
  const unverifiedRow: Strategy = {
    id: "s-unverified",
    name: "Unverified Strat",
    manager: "Apex Quant",
    riskLevel: 4,
    type: "trading",
    managerVerified: false,
    ...base,
  };

  it("[R7] renders the inline verified badge in the attribution cell only for verified managers", () => {
    renderWithProviders(
      <StrategiesExploreScreen
        strategies={[verifiedRow, unverifiedRow]}
        ownedIds={[]}
        investedIds={[]}
      />,
    );
    // The verified manager's cell shows at least one badge; the unverified manager's does not add one.
    expect(screen.queryAllByLabelText("Verified manager").length).toBeGreaterThan(0);
  });

  it("[R7] renders no verified badge when no manager is verified", () => {
    renderWithProviders(
      <StrategiesExploreScreen
        strategies={[unverifiedRow, { ...unverifiedRow, id: "s-lean", managerVerified: undefined }]}
        ownedIds={[]}
        investedIds={[]}
      />,
    );
    expect(screen.queryAllByLabelText("Verified manager")).toHaveLength(0);
  });

  it("renders the heading and every strategy", () => {
    renderWithProviders(
      <StrategiesExploreScreen strategies={strategies} ownedIds={[]} investedIds={[]} />,
    );
    expect(screen.getByRole("heading", { name: "Strategies" })).toBeInTheDocument();
    for (const name of ["Treasury Plus", "Stable Yield", "Degen Rotations"]) {
      expect(screen.getAllByText(name).length).toBeGreaterThanOrEqual(1);
    }
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_list_viewed" }),
    );
  });

  it("badges owned (managed) strategies", () => {
    renderWithProviders(
      <StrategiesExploreScreen strategies={strategies} ownedIds={["s-stable"]} investedIds={[]} />,
    );
    // One badge per surface (mobile card + desktop row).
    expect(screen.getAllByText("Managed").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Invested")).toBeNull();
  });

  it("badges invested (non-manager) strategies", () => {
    renderWithProviders(
      <StrategiesExploreScreen strategies={strategies} ownedIds={[]} investedIds={["s-degen"]} />,
    );
    expect(screen.getAllByText("Invested").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Managed")).toBeNull();
  });

  it("prefers Managed over Invested when a strategy is in both sets", () => {
    renderWithProviders(
      <StrategiesExploreScreen
        strategies={strategies}
        ownedIds={["s-stable"]}
        investedIds={["s-stable"]}
      />,
    );
    expect(screen.getAllByText("Managed").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Invested")).toBeNull();
  });

  it("filters by search query", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <StrategiesExploreScreen strategies={strategies} ownedIds={[]} investedIds={[]} />,
    );
    await user.type(screen.getByRole("searchbox"), "degen");
    expect(screen.getAllByText("Degen Rotations").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Treasury Plus")).toBeNull();
  });

  it("filters by risk band", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <StrategiesExploreScreen strategies={strategies} ownedIds={[]} investedIds={[]} />,
    );
    // POO-658: the risk filter is collapsed — open the dropdown, then pick the band option. The
    // trigger's accessible name is "section: current selection" (unfiltered → the neutral "All").
    await user.click(screen.getByRole("button", { name: "Browse by risk: All" }));
    await user.click(screen.getByRole("option", { name: "Conservative" }));
    expect(screen.getAllByText("Stable Yield").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Treasury Plus")).toBeNull();
    expect(screen.queryByText("Degen Rotations")).toBeNull();
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_filter_applied", risk_level: 2 }),
    );
  });

  it("filters by strategy type", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <StrategiesExploreScreen strategies={strategies} ownedIds={[]} investedIds={[]} />,
    );
    // POO-658: the type filter is collapsed — open the dropdown, then pick the type option. The
    // trigger's accessible name is "section: current selection" (unfiltered → the neutral "All").
    // POO-659: assert against Degen Rotations (a Trading strategy that survives the catalog change);
    // the retired High Conviction entry was removed with the persona.
    await user.click(screen.getByRole("button", { name: "Browse by type: All" }));
    await user.click(screen.getByRole("option", { name: "Trading" }));
    expect(screen.getAllByText("Degen Rotations").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Treasury Plus")).toBeNull();
    expect(screen.queryByText("Stable Yield")).toBeNull();
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_filter_applied" }),
    );
  });

  it("[POO-390 R2/R5] shows the Uniswap pool TVL in the TVL column, dashing a missing value", () => {
    renderWithProviders(
      <StrategiesExploreScreen strategies={strategies} ownedIds={[]} investedIds={[]} />,
    );
    // The column renders each strategy's pool TVL (uniswapPoolTvlUsd), not its managed value.
    expect(screen.getAllByText("$30M").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("$5M").length).toBeGreaterThanOrEqual(1);
    // The managed value ($1M) must NOT surface on the investor list anymore.
    expect(screen.queryByText("$1M")).toBeNull();
    // A strategy with no pool TVL shows a dash, never $0 or the managed value.
    expect(screen.getAllByText("-").length).toBeGreaterThanOrEqual(1);
  });

  it("tracks strategy_sort_changed when a sort header is clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <StrategiesExploreScreen strategies={strategies} ownedIds={[]} investedIds={[]} />,
    );
    await user.click(screen.getByRole("button", { name: "TVL" }));
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_sort_changed" }),
    );
  });

  // @rule R2: the mobile card list has a Sort-by control (dropdown + direction toggle), defaulting to
  // the same TVL-descending sort the desktop headers start on.
  it("[R2] renders a mobile Sort-by control defaulting to the current sort", () => {
    renderWithProviders(
      <StrategiesExploreScreen strategies={strategies} ownedIds={[]} investedIds={[]} />,
    );
    expect(screen.getByRole("button", { name: "Sort by: TVL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort by: Descending" })).toBeInTheDocument();
  });

  // @rule R2: picking a metric on the MOBILE dropdown drives the SAME sort state the desktop headers
  // read — the desktop Investors header becomes the active (highlighted) column.
  it("[R2] the mobile sort dropdown drives the same sort as the desktop headers", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <StrategiesExploreScreen strategies={strategies} ownedIds={[]} investedIds={[]} />,
    );
    await user.click(screen.getByRole("button", { name: "Sort by: TVL" }));
    await user.click(screen.getByRole("option", { name: "Investors" }));
    // The mobile trigger now reads the picked metric, and the desktop header for it is active.
    expect(screen.getByRole("button", { name: "Sort by: Investors" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Investors" })).toHaveClass("text-primary");
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_sort_changed" }),
    );
  });

  // @rule R2: the desktop header and the mobile direction toggle share the same `sort.dir` — flipping
  // one is reflected in the other (proof they are not two independent sorts).
  it("[R2] the desktop header and the mobile direction toggle share the sort direction", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <StrategiesExploreScreen strategies={strategies} ownedIds={[]} investedIds={[]} />,
    );
    // Default TVL desc → the mobile toggle reads Descending. Clicking the active desktop TVL header
    // flips the direction; the mobile toggle must now read Ascending.
    expect(screen.getByRole("button", { name: "Sort by: Descending" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "TVL" }));
    expect(screen.getByRole("button", { name: "Sort by: Ascending" })).toBeInTheDocument();
  });

  // @rule R2: in real (paged) mode the mobile dropdown offers only the backend-sortable metrics (no
  // `Min.`) and forwards the change to the server via onSortChange — the same wiring the headers use.
  it("[R2] paged mode: mobile sort offers only server-sortable metrics and forwards onSortChange", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    const paged = {
      total: strategies.length,
      hasMore: false,
      loading: false,
      onLoadMore: vi.fn(),
      onQueryChange: vi.fn(),
      onRiskChange: vi.fn(),
      onSortChange,
      onCategoriesChange: vi.fn(),
    };
    renderWithProviders(
      <StrategiesExploreScreen
        strategies={strategies}
        ownedIds={[]}
        investedIds={[]}
        paged={paged}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Sort by: TVL" }));
    // `min` is not a server sort field, so it is absent; the backend-sortable metrics are present.
    expect(screen.queryByRole("option", { name: "Min." })).toBeNull();
    expect(screen.getByRole("option", { name: "Investors" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Investors" }));
    expect(onSortChange).toHaveBeenCalledWith({ key: "investors", dir: "desc" });
  });

  it("shows a no-results state and can clear filters", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <StrategiesExploreScreen strategies={strategies} ownedIds={[]} investedIds={[]} />,
    );
    await user.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByText("No strategies match your search.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByText("Treasury Plus").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the empty state when there are no strategies", () => {
    renderWithProviders(<StrategiesExploreScreen strategies={[]} ownedIds={[]} investedIds={[]} />);
    expect(screen.getByText("No strategies yet")).toBeInTheDocument();
  });

  it("[POO-724] renders the strategy logo in the desktop table row", () => {
    const withLogo: Strategy = {
      ...base,
      id: "s-logo",
      name: "Logo Fund",
      manager: "Aave Labs",
      riskLevel: 1,
      logoUrl: "https://cdn.example.com/logo.png",
    };
    const { container } = renderWithProviders(
      <StrategiesExploreScreen strategies={[withLogo]} ownedIds={[]} investedIds={[]} />,
    );
    const table = container.querySelector("table");
    expect(table?.querySelector('img[src="https://cdn.example.com/logo.png"]')).toBeTruthy();
  });
});
