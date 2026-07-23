/**
 * @id PP-STR-SCR-001 (POO-667)
 * @name ExplorePagedLoader tests
 * @implements-rules-version v1
 *
 * The real-mode client boundary that drives the server-paged Explore list.
 * [R23] loads page 0 on mount and renders the first slice with the backend total.
 * [R24] "Load more" appends the next server page.
 * [R25] a filter/sort/search change resets to page 0 (a new server read replaces the set).
 * [R26] the connected wallet's owned/invested badges still resolve over the paged rows.
 */
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDevOverridesForTests,
  clearOverrides,
  setOverride,
} from "@/lib/features/devOverrides";
import type { Strategy } from "@/lib/schemas";
import { renderWithProviders, screen, waitFor } from "../../../tests/utils/renderWithProviders";
import { ExplorePagedLoader } from "./ExplorePagedLoader";

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

// The positions hook feeds the owned/invested badges; default to a single managed position.
const positions = vi.fn();
vi.mock("@/lib/positions/usePositions", () => ({
  usePositions: () => positions(),
}));

// The server action is the paged data source; a stubbed 3-page backend of 12 rows.
const loadExplorePageAction = vi.fn();
vi.mock("./exploreActions", () => ({
  loadExplorePageAction: (...args: unknown[]) => loadExplorePageAction(...args),
}));

const base = {
  manager: "Pool Party",
  minInvestment: 100,
  tvl: 1_000_000,
  investors: 100,
  estReturn: 8,
  rateType: "APY" as const,
  status: "active" as const,
  uniswapPoolTvlUsd: 5_000_000,
  riskLevel: 3,
};

function rows(from: number, to: number): Strategy[] {
  return Array.from({ length: to - from }, (_, i) => ({
    id: `s-${from + i}`,
    name: `Strategy ${from + i}`,
    ...base,
  }));
}

beforeEach(() => {
  loadExplorePageAction.mockReset();
  positions.mockReturnValue({ positions: [] });
  window.dataLayer = [];
  localStorage.clear();
  __resetDevOverridesForTests();
  // Default backend: 12 rows in 5-row pages.
  loadExplorePageAction.mockImplementation(async ({ page }: { page: number }) => ({
    items: rows(page * 5, Math.min(page * 5 + 5, 12)),
    total: 12,
  }));
});

afterEach(() => {
  clearOverrides();
  __resetDevOverridesForTests();
});

describe("ExplorePagedLoader", () => {
  // @rule R23
  it("[R23] loads page 0 and shows the backend total", async () => {
    renderWithProviders(<ExplorePagedLoader />);
    await waitFor(() => expect(screen.getAllByText("Strategy 0").length).toBeGreaterThanOrEqual(1));
    expect(loadExplorePageAction).toHaveBeenCalledWith(
      expect.objectContaining({ page: 0, limit: 5 }),
    );
    expect(screen.getByText("12 strategies")).toBeInTheDocument();
    // Only the first page is present.
    expect(screen.queryByText("Strategy 5")).toBeNull();
  });

  // @rule R24
  it("[R24] Load more appends the next page", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExplorePagedLoader />);
    await waitFor(() => expect(screen.getAllByText("Strategy 0").length).toBeGreaterThanOrEqual(1));

    await user.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(screen.getAllByText("Strategy 5").length).toBeGreaterThanOrEqual(1));
    // The first page is still present (accumulated, not replaced).
    expect(screen.getAllByText("Strategy 0").length).toBeGreaterThanOrEqual(1);
    expect(loadExplorePageAction).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));
  });

  // @rule R25
  it("[R25] a search change resets to page 0 with the new query", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExplorePagedLoader />);
    await waitFor(() => expect(screen.getAllByText("Strategy 0").length).toBeGreaterThanOrEqual(1));

    await user.type(screen.getByRole("searchbox"), "eth");

    await waitFor(() =>
      expect(loadExplorePageAction).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 0, search: "eth" }),
      ),
    );
  });

  // @rule POO-725 R3: a search is relevance-ranked by the backend UNTIL the user picks an explicit sort.
  it("[POO-725 R3] omits sorting while searching (relevance) until an explicit column sort", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExplorePagedLoader />);
    await waitFor(() => expect(screen.getAllByText("Strategy 0").length).toBeGreaterThanOrEqual(1));
    const lastArg = () =>
      loadExplorePageAction.mock.lastCall?.[0] as { sort?: unknown; search?: string };

    // No search yet: the default sort is sent.
    expect(lastArg().sort).toEqual({ key: "tvl", dir: "desc" });

    // Search with no explicit sort → relevance: no `sorting` sent so the backend ranks the matches.
    await user.type(screen.getByRole("searchbox"), "eth");
    await waitFor(() => expect(lastArg().search).toBe("eth"));
    expect(lastArg().sort).toBeUndefined();

    // An explicit column sort (a header click) wins even during a search.
    await user.click(screen.getByRole("button", { name: "Est. return" }));
    await waitFor(() => expect(lastArg().sort).toEqual({ key: "return", dir: "desc" }));
    expect(lastArg().search).toBe("eth");
  });

  // @rule POO-725 R3: the sortExplicit latch PERSISTS across Clear filters (confirmed keep-current
  // product decision). Once the user has picked an explicit column sort, clearing filters and typing a
  // NEW search must still forward that sort, never fall back to backend relevance (omitted `sorting`).
  it("[POO-725 R3] keeps the explicit sort after Clear filters, so a new search stays explicitly sorted", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExplorePagedLoader />);
    await waitFor(() => expect(screen.getAllByText("Strategy 0").length).toBeGreaterThanOrEqual(1));
    const lastArg = () =>
      loadExplorePageAction.mock.lastCall?.[0] as { sort?: unknown; search?: string };

    // Pick an explicit column sort (Est. return → {key:"return"}, distinct from the tvl default) so the
    // sortExplicit latch is set.
    await user.click(screen.getByRole("button", { name: "Est. return" }));
    await waitFor(() => expect(lastArg().sort).toEqual({ key: "return", dir: "desc" }));

    // Search once: the latched explicit sort rides the request (already covered above, restated to set
    // up the clear).
    await user.type(screen.getByRole("searchbox"), "usd");
    await waitFor(() => expect(lastArg().search).toBe("usd"));
    expect(lastArg().sort).toEqual({ key: "return", dir: "desc" });

    // Clear filters (keep-current): resets the query but must NOT reset the sort latch.
    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    // A NEW search must STILL carry the explicit column sort, not the omitted-`sorting` relevance path.
    // If someone resets the latch on clear, `lastArg().sort` would be undefined here and this fails.
    await user.type(screen.getByRole("searchbox"), "eth");
    await waitFor(() => expect(lastArg().search).toBe("eth"));
    expect(lastArg().sort).toEqual({ key: "return", dir: "desc" });
  });

  // @rule POO-894 R1/R6: a category selection is a SERVER round-trip that resets to page 0, exactly
  // like search/risk - never a client-side narrowing of the loaded pages.
  it("[POO-894 R1] a category selection round-trips to the server and resets to page 0", async () => {
    setOverride("strategyCategoryFilter", true);
    const user = userEvent.setup();
    renderWithProviders(<ExplorePagedLoader />);
    await waitFor(() => expect(screen.getAllByText("Strategy 0").length).toBeGreaterThanOrEqual(1));

    // Load page 1 first so the page-0 reset is observable.
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() =>
      expect(loadExplorePageAction).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 })),
    );

    await user.click(screen.getByRole("button", { name: "Browse by category" }));
    await user.click(screen.getByRole("option", { name: "Bitcoin" }));

    await waitFor(() =>
      expect(loadExplorePageAction).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 0, categories: ["bitcoin"] }),
      ),
    );

    // Deselecting the last category drops the param entirely (no empty categories noise).
    await user.click(screen.getByRole("option", { name: "Bitcoin" }));
    await waitFor(() => {
      const lastArg = loadExplorePageAction.mock.lastCall?.[0] as { categories?: unknown };
      expect(lastArg.categories).toBeUndefined();
    });
  });

  // @rule R26
  it("[R26] resolves the connected wallet's Managed badge over the paged rows", async () => {
    positions.mockReturnValue({
      positions: [{ strategyId: "s-1", isPoolManager: true }],
    });
    renderWithProviders(<ExplorePagedLoader />);
    await waitFor(() => expect(screen.getAllByText("Strategy 1").length).toBeGreaterThanOrEqual(1));
    expect(screen.getAllByText("Managed").length).toBeGreaterThanOrEqual(1);
  });
});
