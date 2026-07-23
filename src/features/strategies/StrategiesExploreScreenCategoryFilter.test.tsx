/**
 * @id PP-STR-SCR-001
 * @name Strategies · Explore — asset-category filter tests (POO-830 PR2, rules-v1)
 *
 * The investor asset-category filter (R6) behind the `strategyCategoryFilter` dark-launch flag (R8).
 * BOTH flag states are covered:
 * - Flag OFF → the control is invisible and the screen behaves exactly as today (every strategy shows).
 * - Flag ON, mock mode → the multi-select control renders; picking categories filters CLIENT-SIDE with
 *   OR semantics (a strategy matches if its `assetTags` includes ANY selected category), a no-match
 *   selection shows the recoverable no-results state, and Clear filters resets it (POO-894 [R7]).
 * - Flag ON, server-paged mode (POO-894 rules-v1) → the selection round-trips to the server via
 *   `paged.onCategoriesChange` ([R1]); the screen does NOT client-narrow the server-filtered rows, the
 *   count stays the backend total ([R4]), and Load more stays mounted while `hasMore` ([R5]).
 */
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDevOverridesForTests,
  clearOverrides,
  setOverride,
} from "@/lib/features/devOverrides";
import type { AssetTag, Strategy } from "@/lib/schemas";
import { renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import {
  type StrategiesExplorePagedContract,
  StrategiesExploreScreen,
} from "./StrategiesExploreScreen";

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
  manager: "Aave Labs",
  minInvestment: 100,
  tvl: 1_000_000,
  investors: 100,
  estReturn: 8,
  rateType: "APY" as const,
  status: "active" as const,
  uniswapPoolTvlUsd: 5_000_000,
};

function strat(
  id: string,
  name: string,
  riskLevel: 1 | 2 | 3 | 4 | 5,
  assetTags: AssetTag[],
): Strategy {
  return { id, name, riskLevel, assetTags, ...base };
}

const btc = strat("s-btc", "Orange Vault", 3, ["bitcoin"]);
const eth = strat("s-eth", "Ether Engine", 3, ["ethereum"]);
const stable = strat("s-stable", "Dollar Desk", 1, ["stablecoins"]);
const meme = strat("s-meme", "Doge Rocket", 5, ["meme"]);
// A two-sided non-stable pair carries BOTH tags, so it matches either bitcoin OR ethereum.
const btcEth = strat("s-duo", "Blue Chip Duo", 4, ["bitcoin", "ethereum"]);

const all = [btc, eth, stable, meme, btcEth];

/** True when at least one visible node renders `name` (mobile card and/or desktop row). */
function shown(name: string): boolean {
  return screen.queryAllByText(name).length > 0;
}

beforeEach(() => {
  localStorage.clear();
  window.dataLayer = [];
  __resetDevOverridesForTests();
});
afterEach(() => {
  clearOverrides();
  __resetDevOverridesForTests();
  vi.restoreAllMocks();
});

describe("StrategiesExploreScreen — asset-category filter (POO-830)", () => {
  describe("flag OFF (dark-launched) — invisible + inert", () => {
    it("does not render the category control and shows every strategy (today's behavior)", () => {
      renderWithProviders(
        <StrategiesExploreScreen strategies={all} ownedIds={[]} investedIds={[]} />,
      );
      // The control is absent entirely.
      expect(screen.queryByRole("button", { name: /Browse by category/ })).toBeNull();
      // Every strategy still renders (the category filter is inert).
      for (const s of all) {
        expect(shown(s.name)).toBe(true);
      }
      // The risk filter is untouched (regression guard on the existing controls).
      expect(screen.getByRole("button", { name: "Browse by risk: All" })).toBeInTheDocument();
    });
  });

  describe("flag ON", () => {
    beforeEach(() => {
      setOverride("strategyCategoryFilter", true);
    });

    it("renders the control and filters to a single selected category", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <StrategiesExploreScreen strategies={all} ownedIds={[]} investedIds={[]} />,
      );
      await user.click(screen.getByRole("button", { name: "Browse by category" }));
      await user.click(screen.getByRole("option", { name: "Bitcoin" }));

      // Only the strategies whose assetTags include bitcoin survive (btc + the btc/eth duo).
      expect(shown("Orange Vault")).toBe(true);
      expect(shown("Blue Chip Duo")).toBe(true);
      expect(shown("Ether Engine")).toBe(false);
      expect(shown("Dollar Desk")).toBe(false);
      expect(shown("Doge Rocket")).toBe(false);
      // The count reflects the narrowed client-side set (2), not the full catalog.
      expect(screen.getByText("2 strategies")).toBeInTheDocument();
      // Analytics: a filter-applied event fires on the category change.
      expect(window.dataLayer).toContainEqual(
        expect.objectContaining({ event: "strategy_filter_applied" }),
      );
    });

    it("[R6] unions matches across multiple categories (OR semantics)", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <StrategiesExploreScreen strategies={all} ownedIds={[]} investedIds={[]} />,
      );
      await user.click(screen.getByRole("button", { name: "Browse by category" }));
      // Multi-select: the menu stays open, so both picks land without reopening.
      await user.click(screen.getByRole("option", { name: "Bitcoin" }));
      await user.click(screen.getByRole("option", { name: "Meme coins" }));

      // bitcoin OR meme → btc, the duo (has bitcoin), and meme; ethereum-only + stable are out.
      expect(shown("Orange Vault")).toBe(true);
      expect(shown("Blue Chip Duo")).toBe(true);
      expect(shown("Doge Rocket")).toBe(true);
      expect(shown("Ether Engine")).toBe(false);
      expect(shown("Dollar Desk")).toBe(false);
      expect(screen.getByText("3 strategies")).toBeInTheDocument();
    });

    it("shows the recoverable no-results state for a category that matches nothing, then clears", async () => {
      const user = userEvent.setup();
      // No bitcoin strategies in this set.
      renderWithProviders(
        <StrategiesExploreScreen strategies={[eth, stable]} ownedIds={[]} investedIds={[]} />,
      );
      await user.click(screen.getByRole("button", { name: "Browse by category" }));
      await user.click(screen.getByRole("option", { name: "Bitcoin" }));

      expect(screen.getByText("No strategies match your search.")).toBeInTheDocument();
      // The screen stays recoverable (never the terminal empty state) — Clear filters is present.
      await user.click(screen.getByRole("button", { name: "Clear filters" }));
      expect(shown("Ether Engine")).toBe(true);
      expect(shown("Dollar Desk")).toBe(true);
    });

    /** A fresh paged contract with every callback stubbed (POO-894: incl. onCategoriesChange). */
    function pagedContract(
      overrides: Partial<StrategiesExplorePagedContract> = {},
    ): StrategiesExplorePagedContract {
      return {
        total: 5,
        hasMore: false,
        loading: false,
        onLoadMore: vi.fn(),
        onQueryChange: vi.fn(),
        onRiskChange: vi.fn(),
        onSortChange: vi.fn(),
        onCategoriesChange: vi.fn(),
        ...overrides,
      };
    }

    // @rule POO-894 R1/R4: paged mode = SERVER filter. The pre-POO-894 behavior (narrow the loaded
    // rows client-side + override the count) was the documented KNOWN-EDGE dead end.
    it("[POO-894 R1][R4] paged mode forwards the selection to the server and keeps the backend total", async () => {
      const user = userEvent.setup();
      const paged = pagedContract();
      renderWithProviders(
        <StrategiesExploreScreen
          strategies={[btc, eth, stable]}
          ownedIds={[]}
          investedIds={[]}
          paged={paged}
        />,
      );
      // Before filtering, paged mode shows the backend grand total.
      expect(screen.getByText("5 strategies")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Browse by category" }));
      await user.click(screen.getByRole("option", { name: "Ethereum" }));

      // The selection round-trips to the server ([R1]); the loader re-reads page 0 with the filter.
      expect(paged.onCategoriesChange).toHaveBeenCalledWith(["ethereum"]);
      // NO client narrowing: the server owns the filter, so the (server-filtered) rows render
      // verbatim - here the stub rows all stay because the test backend never re-filters them.
      expect(shown("Ether Engine")).toBe(true);
      expect(shown("Orange Vault")).toBe(true);
      expect(shown("Dollar Desk")).toBe(true);
      // The count stays the backend total ([R4]) - never a loaded-pages-only count.
      expect(screen.getByText("5 strategies")).toBeInTheDocument();
    });

    // @rule POO-894 R5: no dead end - rows + Load more stay mounted under an active category filter.
    it("[POO-894 R5] keeps Load more mounted under an active category filter while hasMore", async () => {
      const user = userEvent.setup();
      const paged = pagedContract({ hasMore: true });
      // No ethereum match on the loaded page: pre-POO-894 this collapsed to no-results and
      // unmounted Load more (the reported dead end). Now the rows render verbatim and paging works.
      renderWithProviders(
        <StrategiesExploreScreen
          strategies={[btc, stable]}
          ownedIds={[]}
          investedIds={[]}
          paged={paged}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Browse by category" }));
      await user.click(screen.getByRole("option", { name: "Ethereum" }));

      expect(screen.queryByText("No strategies match your search.")).toBeNull();
      const loadMore = screen.getByRole("button", { name: "Load more" });
      await user.click(loadMore);
      expect(paged.onLoadMore).toHaveBeenCalledTimes(1);
    });

    // @rule POO-894 R6: Clear filters resets the server-side category filter too (page-0 round-trip).
    it("[POO-894] Clear filters resets the server category selection", async () => {
      const user = userEvent.setup();
      const paged = pagedContract();
      renderWithProviders(
        <StrategiesExploreScreen
          strategies={[btc, eth, stable]}
          ownedIds={[]}
          investedIds={[]}
          paged={paged}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Browse by category" }));
      await user.click(screen.getByRole("option", { name: "Ethereum" }));
      expect(paged.onCategoriesChange).toHaveBeenLastCalledWith(["ethereum"]);

      await user.click(screen.getByRole("button", { name: "Clear filters" }));
      expect(paged.onCategoriesChange).toHaveBeenLastCalledWith([]);
    });
  });
});
