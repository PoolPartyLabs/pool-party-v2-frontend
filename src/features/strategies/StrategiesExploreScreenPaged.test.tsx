/**
 * @id PP-STR-SCR-001 (POO-667)
 * @name Strategies · Explore — server-paged mode tests
 * @implements-rules-version v1
 *
 * Real-mode "Load more" behavior of the Explore screen when a `paged` contract is supplied.
 * [R15] the count reflects the backend total (`paged.total`), NOT the loaded slice length.
 * [R16] a "Load more" button shows while `paged.hasMore`, and clicking it calls `paged.onLoadMore`.
 * [R17] the button is hidden once `paged.hasMore` is false (last page in).
 * [R18] real (paged) mode HIDES the type filter (no backend support); mock mode SHOWS it.
 * [R19] paged mode does NOT client-filter/sort — it renders the server-ordered `strategies` as-is.
 * [R20] a search / risk / sort change is forwarded to the paged callbacks (server round-trip).
 */
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/schemas";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../tests/utils/renderWithProviders";
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
  uniswapPoolTvlUsd: 5_000_000,
};

const strategies: Strategy[] = [
  { id: "s-a", name: "Alpha Fund", manager: "Aave Labs", riskLevel: 1, type: "yield", ...base },
  { id: "s-b", name: "Beta Fund", manager: "Pool Party", riskLevel: 3, type: "trading", ...base },
];

function pagedProps(
  overrides: Partial<Parameters<typeof StrategiesExploreScreen>[0]["paged"] & object> = {},
) {
  return {
    total: 177,
    hasMore: true,
    loading: false,
    onLoadMore: vi.fn(),
    onQueryChange: vi.fn(),
    onRiskChange: vi.fn(),
    onSortChange: vi.fn(),
    onCategoriesChange: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  window.dataLayer = [];
});

describe("StrategiesExploreScreen (server-paged mode)", () => {
  // @rule R15
  it("[R15] shows the backend total, not the loaded slice length", () => {
    renderWithProviders(
      <StrategiesExploreScreen
        strategies={strategies}
        ownedIds={[]}
        investedIds={[]}
        paged={pagedProps({ total: 177 })}
      />,
    );
    // 2 rows loaded but the count reads the server grand total.
    expect(screen.getByText("177 strategies")).toBeInTheDocument();
    expect(screen.queryByText("2 strategies")).toBeNull();
  });

  // @rule R16
  it("[R16] renders a Load more button and calls onLoadMore when clicked", async () => {
    const user = userEvent.setup();
    const paged = pagedProps({ hasMore: true });
    renderWithProviders(
      <StrategiesExploreScreen
        strategies={strategies}
        ownedIds={[]}
        investedIds={[]}
        paged={paged}
      />,
    );
    const button = screen.getByRole("button", { name: "Load more" });
    await user.click(button);
    expect(paged.onLoadMore).toHaveBeenCalledTimes(1);
  });

  // @rule R17
  it("[R17] hides the Load more button when there is no more to load", () => {
    renderWithProviders(
      <StrategiesExploreScreen
        strategies={strategies}
        ownedIds={[]}
        investedIds={[]}
        paged={pagedProps({ hasMore: false })}
      />,
    );
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  // @rule R18
  it("[R18] hides the type filter in paged (real) mode", () => {
    renderWithProviders(
      <StrategiesExploreScreen
        strategies={strategies}
        ownedIds={[]}
        investedIds={[]}
        paged={pagedProps()}
      />,
    );
    // The risk filter stays; the type filter is gone (no backend `type` support).
    expect(screen.getByRole("button", { name: /Browse by risk/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Browse by type/ })).toBeNull();
  });

  // @rule R18
  it("[R18] keeps the type filter in mock (non-paged) mode", () => {
    renderWithProviders(
      <StrategiesExploreScreen strategies={strategies} ownedIds={[]} investedIds={[]} />,
    );
    expect(screen.getByRole("button", { name: /Browse by type/ })).toBeInTheDocument();
  });

  // @rule R19
  it("[R19] renders the server-ordered rows as-is (no client filter on search)", async () => {
    const user = userEvent.setup();
    const paged = pagedProps();
    renderWithProviders(
      <StrategiesExploreScreen
        strategies={strategies}
        ownedIds={[]}
        investedIds={[]}
        paged={paged}
      />,
    );
    // Typing a query that would client-filter out Beta must NOT remove it: the server owns filtering.
    await user.type(screen.getByRole("searchbox"), "alpha");
    expect(screen.getAllByText("Alpha Fund").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Beta Fund").length).toBeGreaterThanOrEqual(1);
  });

  // @rule R20
  it("[R20] forwards a search change to onQueryChange", async () => {
    const user = userEvent.setup();
    const paged = pagedProps();
    renderWithProviders(
      <StrategiesExploreScreen
        strategies={strategies}
        ownedIds={[]}
        investedIds={[]}
        paged={paged}
      />,
    );
    await user.type(screen.getByRole("searchbox"), "eth");
    // POO-725 R1: the server round-trip is debounced (~300ms), so wait for the single trailing call.
    await waitFor(() => expect(paged.onQueryChange).toHaveBeenLastCalledWith("eth"));
  });

  // @rule R20
  it("[R20] forwards a sort change to onSortChange", async () => {
    const user = userEvent.setup();
    const paged = pagedProps();
    renderWithProviders(
      <StrategiesExploreScreen
        strategies={strategies}
        ownedIds={[]}
        investedIds={[]}
        paged={paged}
      />,
    );
    // Clicking a fresh column defaults to desc (the active TVL column would toggle desc→asc instead).
    await user.click(screen.getByRole("button", { name: "Est. return" }));
    expect(paged.onSortChange).toHaveBeenCalledWith({ key: "return", dir: "desc" });
  });

  // @rule R20
  it("[R20] forwards a risk change to onRiskChange", async () => {
    const user = userEvent.setup();
    const paged = pagedProps();
    renderWithProviders(
      <StrategiesExploreScreen
        strategies={strategies}
        ownedIds={[]}
        investedIds={[]}
        paged={paged}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Browse by risk: All" }));
    await user.click(screen.getByRole("option", { name: "Conservative" }));
    // Conservative is risk band 2 in the labels; forwarded verbatim to the loader.
    expect(paged.onRiskChange).toHaveBeenCalledWith(2);
  });
});

/**
 * POO-723 (rules v3): a real-mode search/filter that matches nothing must stay RECOVERABLE — the
 * search field + filter dropdowns stay mounted, a persistent "Clear filters" action sits beside the
 * dropdowns whenever a filter is active, and the terminal "No strategies yet" shows ONLY for a
 * genuinely empty catalog with no active filter (the initial page load shows a loading affordance).
 */
describe("StrategiesExploreScreen (server-paged empty recovery + clear filters, POO-723)", () => {
  // @rule R1
  it("[R1] shows the terminal empty state for a genuinely empty catalog (no filter, not loading)", () => {
    renderWithProviders(
      <StrategiesExploreScreen
        strategies={[]}
        ownedIds={[]}
        investedIds={[]}
        paged={pagedProps({ total: 0, hasMore: false, loading: false })}
      />,
    );
    expect(screen.getByText("No strategies yet")).toBeInTheDocument();
  });

  // @rule R4
  it("[R4] shows a loading affordance (not the terminal empty) during the initial page load", () => {
    renderWithProviders(
      <StrategiesExploreScreen
        strategies={[]}
        ownedIds={[]}
        investedIds={[]}
        paged={pagedProps({ total: 0, hasMore: false, loading: true })}
      />,
    );
    expect(screen.queryByText("No strategies yet")).toBeNull();
    expect(screen.queryByText("No strategies match your search.")).toBeNull();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  // @rule R1
  // @rule R2
  it("[R1][R2] a real-mode search that matches nothing keeps the controls and shows no-results, not the terminal empty", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(
      <StrategiesExploreScreen
        strategies={strategies}
        ownedIds={[]}
        investedIds={[]}
        paged={pagedProps()}
      />,
    );
    await user.type(screen.getByRole("searchbox"), "zzz");
    // The server returns an empty page for that query.
    rerender(
      <StrategiesExploreScreen
        strategies={[]}
        ownedIds={[]}
        investedIds={[]}
        paged={pagedProps({ total: 0, hasMore: false })}
      />,
    );
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.queryByText("No strategies yet")).toBeNull();
    expect(screen.getByText("No strategies match your search.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  // @rule R3
  it("[R3] the persistent Clear filters resets the query and forwards the reset to the loader", async () => {
    const user = userEvent.setup();
    const paged = pagedProps();
    const { rerender } = renderWithProviders(
      <StrategiesExploreScreen
        strategies={strategies}
        ownedIds={[]}
        investedIds={[]}
        paged={paged}
      />,
    );
    await user.type(screen.getByRole("searchbox"), "zzz");
    rerender(
      <StrategiesExploreScreen strategies={[]} ownedIds={[]} investedIds={[]} paged={paged} />,
    );
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(paged.onQueryChange).toHaveBeenLastCalledWith("");
    expect(paged.onRiskChange).toHaveBeenLastCalledWith(null);
  });

  // @rule R3
  it("[R3] shows no Clear filters button when no search/filter is active", () => {
    renderWithProviders(
      <StrategiesExploreScreen
        strategies={strategies}
        ownedIds={[]}
        investedIds={[]}
        paged={pagedProps()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  // @rule R3
  it("[R3] a risk-only filter that returns nothing keeps the controls and a persistent Clear filters that resets the risk", async () => {
    const user = userEvent.setup();
    const paged = pagedProps();
    const { rerender } = renderWithProviders(
      <StrategiesExploreScreen
        strategies={strategies}
        ownedIds={[]}
        investedIds={[]}
        paged={paged}
      />,
    );
    // Set a risk band with the search query left empty (Conservative = risk band 2, forwarded verbatim).
    await user.click(screen.getByRole("button", { name: "Browse by risk: All" }));
    await user.click(screen.getByRole("option", { name: "Conservative" }));
    expect(paged.onRiskChange).toHaveBeenLastCalledWith(2);
    // The server returns an empty page for that risk band.
    rerender(
      <StrategiesExploreScreen strategies={[]} ownedIds={[]} investedIds={[]} paged={paged} />,
    );
    // The filter controls stay mounted (no collapse to the terminal empty) even with an empty query.
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Browse by risk/ })).toBeInTheDocument();
    expect(screen.queryByText("No strategies yet")).toBeNull();
    // The persistent Clear filters is present and, when clicked, resets the risk filter to all.
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(paged.onRiskChange).toHaveBeenLastCalledWith(null);
    expect(paged.onQueryChange).toHaveBeenLastCalledWith("");
  });
});

/**
 * POO-734: in real (paged) mode a column is sortable only if the backend exposes its sort field
 * (fetchStrategiesPage SORT_FIELD_BY_KEY). Phase 2 (POO-726 shipped `riskLevel` + `totalInvestors`)
 * makes Risk + Investors sortable alongside TVL + Est. return; only Min stays plain (the identical
 * platform floor has no server field). Mock mode sorts every column client-side and is unchanged.
 */
describe("StrategiesExploreScreen (POO-734: server-sortable headers in real mode)", () => {
  it("[R2] renders Risk / Investors as sortable buttons; Min stays plain in paged mode", () => {
    renderWithProviders(
      <StrategiesExploreScreen
        strategies={strategies}
        ownedIds={[]}
        investedIds={[]}
        paged={pagedProps()}
      />,
    );
    // POO-726 shipped riskLevel + totalInvestors → these headers are now interactive sort buttons.
    expect(screen.getByRole("button", { name: "Risk" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Investors" })).toBeInTheDocument();
    // Min has no backend sort field → plain columnheader, not a button.
    expect(screen.queryByRole("button", { name: "Min." })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Min." })).toBeInTheDocument();
  });

  it("[R2] keeps TVL and Est. return sortable in paged mode", () => {
    renderWithProviders(
      <StrategiesExploreScreen
        strategies={strategies}
        ownedIds={[]}
        investedIds={[]}
        paged={pagedProps()}
      />,
    );
    expect(screen.getByRole("button", { name: "TVL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Est. return" })).toBeInTheDocument();
  });

  it("[R2] forwards a Risk header click to onSortChange (server sort → riskLevel)", async () => {
    const user = userEvent.setup();
    const paged = pagedProps();
    renderWithProviders(
      <StrategiesExploreScreen
        strategies={strategies}
        ownedIds={[]}
        investedIds={[]}
        paged={paged}
      />,
    );
    // A fresh column defaults to desc; the loader maps `risk` → `riskLevel` server-side.
    await user.click(screen.getByRole("button", { name: "Risk" }));
    expect(paged.onSortChange).toHaveBeenCalledWith({ key: "risk", dir: "desc" });
  });

  it("[R1] keeps Risk / Investors sortable in mock (non-paged) mode", () => {
    renderWithProviders(
      <StrategiesExploreScreen strategies={strategies} ownedIds={[]} investedIds={[]} />,
    );
    expect(screen.getByRole("button", { name: "Risk" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Investors" })).toBeInTheDocument();
  });
});

/**
 * POO-725: search UX in real (paged) mode - the server round-trip is debounced so typing does not spam
 * the backend + reset to page 0 per keystroke, and the placeholder reflects the broadened backend
 * coverage (name / manager / token / address, POO-733). Relevance ordering lives in the loader.
 */
describe("StrategiesExploreScreen (POO-725: search UX)", () => {
  it("[R1] debounces the search server round-trip (one call after the delay)", () => {
    vi.useFakeTimers();
    try {
      const paged = pagedProps();
      renderWithProviders(
        <StrategiesExploreScreen
          strategies={strategies}
          ownedIds={[]}
          investedIds={[]}
          paged={paged}
        />,
      );
      const input = screen.getByRole("searchbox");
      fireEvent.change(input, { target: { value: "us" } });
      fireEvent.change(input, { target: { value: "usd" } });
      fireEvent.change(input, { target: { value: "usdc" } });
      // Debounced: no server round-trip yet after a burst of keystrokes.
      expect(paged.onQueryChange).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      // Exactly one call, with the final value only.
      expect(paged.onQueryChange).toHaveBeenCalledTimes(1);
      expect(paged.onQueryChange).toHaveBeenCalledWith("usdc");
    } finally {
      vi.useRealTimers();
    }
  });

  it("[R2] broadens the search placeholder to reflect the backend coverage", () => {
    renderWithProviders(
      <StrategiesExploreScreen
        strategies={strategies}
        ownedIds={[]}
        investedIds={[]}
        paged={pagedProps()}
      />,
    );
    expect(screen.getByRole("searchbox")).toHaveAttribute(
      "placeholder",
      "Search by name, manager, token or address",
    );
  });
});
