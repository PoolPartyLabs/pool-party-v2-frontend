/**
 * @id PP-STR-SCR-001
 * @name Strategies · Explore — virtualization tests (POO-626, rules-v1)
 *
 * Windowed-rendering behavior of the Explore screen under the `virtualize` gate (ADR-0001, the
 * POO-623 epic). Consumes the PR1 primitive (useVirtualizedRows `mode: "window"` + useVirtualizeGate).
 *
 * BOTH flag states are covered:
 * - Gate OFF / below THRESHOLD (500) → plain `.map()`, identical DOM to today: every table row and
 *   every mobile card present, NO Technique-A spacer rows. (The existing hard-count / per-name
 *   assertions in StrategiesExploreScreen.test.tsx stay green BY CONSTRUCTION: those fixtures are 3
 *   strategies « 500, so they never window.)
 * - Gate ON + a >500-row fixture + the OPT-IN setupVirtualizationLayout() shim → windowed path, on
 *   which the behavioral rules are asserted:
 *   - [R1] RESET → scrollToIndex(0): a filter / sort / search / clear change scrolls the window
 *     origin back to row 0 in the same tick (a genuinely different list must not leave the window in
 *     the middle of the previous list). We assert on window.scrollTo({ top: 0 }) — the window
 *     virtualizer's scrollToIndex(0) resolves to that call (offset 0), a deterministic seam in jsdom
 *     where window.scrollY does not move on scrollTo.
 *   - [R2] explore.count stays over visible.length (the full filtered set), unchanged by windowing.
 *   - [R3] focus pin: a focused Invest link/row scrolled out of the window stays mounted.
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
import { act, renderWithProviders, screen, within } from "../../../tests/utils/renderWithProviders";
import { setupVirtualizationLayout } from "../../../tests/virtualizationLayout";
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

// These fixtures verify row counts, sorting, focus and scroll preservation. Keep the real
// cards/table/link structure without hundreds of unrelated Radix tooltip state machines.
// AprTooltip.test.tsx separately exercises hover, focus and touch behavior.
vi.mock("@/components/ui/AprTooltip", () => ({
  AprTooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
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

/**
 * A fixture of `n` strategies whose DOMINANT bucket is risk level 2 ("Conservative") + type "trading",
 * with a small `TAIL` of other risk levels/types for variety. The dominant bucket is deliberately kept
 * > THRESHOLD so that the "Conservative" risk filter and the "Trading" type filter each leave a subset
 * that STILL windows: the RESET tests must exercise a genuine windowed → windowed reset. A below-
 * THRESHOLD filtered subset renders the plain-map baseline (no virtualizer window), so [R1]'s
 * scroll-window reset simply does not apply there — the reset is correctly gated on the windowing gate
 * now (F1 fix), which is exactly why those buckets must stay above THRESHOLD to test the reset.
 */
const TAIL = 20;
function makeStrategies(n: number): Strategy[] {
  const tailTypes = ["yield", "index", "market-neutral"] as const;
  return Array.from({ length: n }, (_, i) => {
    // The last `TAIL` rows spread across other risk levels/types; everything else is level 2 + trading.
    const isTail = i >= n - TAIL;
    const riskLevel = (isTail ? ((i % 4) + 1 === 2 ? 3 : (i % 4) + 1) : 2) as 1 | 2 | 3 | 4 | 5;
    const type = isTail ? tailTypes[i % tailTypes.length] : "trading";
    return {
      id: `s-${i}`,
      name: `Strategy ${i}`,
      manager: `Manager ${i}`,
      riskLevel,
      type,
      ...base,
    };
  });
}

/** All real (non-spacer) desktop table rows currently mounted. */
function tableDataRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll("table tr[data-index]")) as HTMLElement[];
}

// 540 total, of which the dominant risk-2 + trading bucket is 540 - TAIL = 520 (> THRESHOLD 500). So
// the full set windows AND the "Conservative"/"Trading" filtered subsets still window, exercising a
// real windowed → windowed reset. Each rich row (StrategyCard + RiskMeter + AprTooltip + links) is
// expensive in jsdom; the count is kept as small as the > THRESHOLD dominant-bucket constraint allows.
const LARGE = 540;
// The heavy full plain-map renders and the filter-interaction RESET tests (each keystroke re-filters
// the whole set) are legitimately slow in jsdom, and the machine runs several suites in parallel
// (Wave B). Give these cases generous headroom over the 5s default rather than trimming coverage.
const HEAVY_TIMEOUT_MS = 30_000;

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

describe("StrategiesExploreScreen — virtualization gate (both flag states)", () => {
  describe("[R1] gate OFF / below threshold → plain map (identical DOM to today)", () => {
    it(
      "renders EVERY row and NO spacer rows when the flag is off, even at a large count",
      () => {
        renderWithProviders(
          <StrategiesExploreScreen
            strategies={makeStrategies(LARGE)}
            ownedIds={[]}
            investedIds={[]}
          />,
        );
        // The full set is rendered plainly; first and last strategies both present.
        expect(screen.getAllByText("Strategy 0").length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText(`Strategy ${LARGE - 1}`).length).toBeGreaterThanOrEqual(1);
        // No Technique-A spacers in the plain-map baseline.
        expect(document.querySelectorAll("tr[data-virtual-spacer]")).toHaveLength(0);
      },
      HEAVY_TIMEOUT_MS,
    );

    it("renders every row with the flag ON but below THRESHOLD (no windowing)", () => {
      setOverride("virtualize", true);
      setupVirtualizationLayout();
      renderWithProviders(
        <StrategiesExploreScreen strategies={makeStrategies(20)} ownedIds={[]} investedIds={[]} />,
      );
      expect(screen.getAllByText("Strategy 0").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Strategy 19").length).toBeGreaterThanOrEqual(1);
      expect(document.querySelectorAll("tr[data-virtual-spacer]")).toHaveLength(0);
    });

    it(
      "falls back to plain map at a large count when the flag is on but there is NO layout",
      () => {
        // No layout shim → hasLayout false → plain map even past THRESHOLD ([R1] correctness guarantee:
        // virtualization must never be the reason content is missing).
        setOverride("virtualize", true);
        renderWithProviders(
          <StrategiesExploreScreen
            strategies={makeStrategies(LARGE)}
            ownedIds={[]}
            investedIds={[]}
          />,
        );
        expect(screen.getAllByText("Strategy 0").length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText(`Strategy ${LARGE - 1}`).length).toBeGreaterThanOrEqual(1);
        expect(document.querySelectorAll("tr[data-virtual-spacer]")).toHaveLength(0);
      },
      HEAVY_TIMEOUT_MS,
    );

    it(
      "[R1] flag OFF never calls window.scrollTo — no scroll hijack on mount OR filter/sort/search/clear",
      async () => {
        // Regression for the reset firing UNCONDITIONALLY: with the `virtualize` flag off the surface
        // is the plain-map baseline, and the window virtualizer's scrollToIndex(0) resolves to
        // window.scrollTo({ top: 0 }). Firing it on mount / every interaction jumps the page to the
        // document top and clobbers reload/back-nav scroll restoration (ADR-0001 rule 4: flag-off =
        // today's baseline). The reset MUST be gated on the windowing gate, so with the flag off no
        // scrollTo is ever emitted. (LARGE > THRESHOLD, but the flag is off → plain map, no windowing.)
        const user = userEvent.setup();
        const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
        renderWithProviders(
          <StrategiesExploreScreen
            strategies={makeStrategies(LARGE)}
            ownedIds={[]}
            investedIds={[]}
          />,
        );
        // Mount alone must not scroll.
        expect(scrollTo).not.toHaveBeenCalled();
        // Sort, then a risk filter, then a type filter, then a search: none may scroll the page.
        // POO-658: the risk/type filters are collapsed into dropdowns; open each (trigger name is
        // "section: current selection", unfiltered → the neutral "All") before picking an option.
        await user.click(screen.getByRole("button", { name: "Investors" }));
        await user.click(screen.getByRole("button", { name: "Browse by risk: All" }));
        await user.click(screen.getByRole("option", { name: "Conservative" }));
        await user.click(screen.getByRole("button", { name: "Browse by type: All" }));
        await user.click(screen.getByRole("option", { name: "Trading" }));
        await user.type(screen.getByRole("searchbox"), "S");
        expect(scrollTo).not.toHaveBeenCalled();
      },
      HEAVY_TIMEOUT_MS,
    );
  });

  describe("windowed (gate on, 540 rows, layout shim)", () => {
    beforeEach(() => {
      setupVirtualizationLayout();
      setOverride("virtualize", true);
      // Reset the leaked window scroll offset between tests: several cases drive `window.scrollY` to a
      // deep offset via defineProperty, and jsdom does not clear it on unmount. A stale offset makes
      // the NEXT test's window virtualizer start mid-list, so `tableDataRows()[0]` is no longer row 0.
      Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
      // jsdom does not implement window.scrollTo; the window virtualizer calls it during scroll and
      // reset. Stub it to a no-op (the RESET tests re-spy on top to assert the top:0 call).
      vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    });

    it(
      "windows to FEWER real table rows than the full filtered set",
      () => {
        renderWithProviders(
          <StrategiesExploreScreen
            strategies={makeStrategies(LARGE)}
            ownedIds={[]}
            investedIds={[]}
          />,
        );
        const rows = tableDataRows();
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.length).toBeLessThan(LARGE);
        // Technique-A spacer(s) reserve the off-screen space (rule 1).
        expect(document.querySelector("tr[data-virtual-spacer='bottom']")).not.toBeNull();
        // Absolute-row ban (rule 2): no windowed row is absolutely positioned.
        for (const row of rows) {
          expect(row.style.position).not.toBe("absolute");
        }
      },
      HEAVY_TIMEOUT_MS,
    );

    it(
      "[R2] explore.count stays over the FULL filtered set, not the windowed slice",
      () => {
        renderWithProviders(
          <StrategiesExploreScreen
            strategies={makeStrategies(LARGE)}
            ownedIds={[]}
            investedIds={[]}
          />,
        );
        // The count line reflects ALL filtered strategies (locale-grouped) even though only a window is
        // mounted — the count is over `visible.length`, not the windowed slice.
        expect(screen.getByText(new RegExp(`${LARGE} strategies`))).toBeInTheDocument();
        expect(tableDataRows().length).toBeLessThan(LARGE);
      },
      HEAVY_TIMEOUT_MS,
    );

    it(
      "[R1] RESET → scrollToIndex(0) on a SORT change (window origin back to row 0)",
      async () => {
        const user = userEvent.setup();
        renderWithProviders(
          <StrategiesExploreScreen
            strategies={makeStrategies(LARGE)}
            ownedIds={[]}
            investedIds={[]}
          />,
        );
        // Drive the window into the middle of the list so a RESET has visible work to do.
        act(() => {
          Object.defineProperty(window, "scrollY", { value: 300 * 57, configurable: true });
          window.dispatchEvent(new Event("scroll"));
        });
        // Clear the render-time calls so only the interaction's reset is asserted.
        const scrollTo = vi.spyOn(window, "scrollTo").mockClear();
        await user.click(screen.getByRole("button", { name: "Investors" }));
        // scrollToIndex(0) → window.scrollTo({ top: 0 }).
        expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
      },
      HEAVY_TIMEOUT_MS,
    );

    it(
      "[R1] RESET → scrollToIndex(0) on a SEARCH change",
      async () => {
        const user = userEvent.setup();
        renderWithProviders(
          <StrategiesExploreScreen
            strategies={makeStrategies(LARGE)}
            ownedIds={[]}
            investedIds={[]}
          />,
        );
        // Drive the window off row 0 so the reset's scrollToIndex(0) is a GENUINE move: react-virtual
        // no-ops scrollToOffset when the target already equals the current offset, so a reset asserted
        // from scroll-top would spuriously pass/fail on offset dedupe rather than on the reset firing.
        act(() => {
          Object.defineProperty(window, "scrollY", { value: 300 * 57, configurable: true });
          window.dispatchEvent(new Event("scroll"));
        });
        // Clear the render-time calls so only the interaction's reset is asserted.
        const scrollTo = vi.spyOn(window, "scrollTo").mockClear();
        // One keystroke suffices: any query change flips the resetKey → one reset. (Each keystroke
        // re-filters the whole set, so a single char keeps the interaction cheap.)
        await user.type(screen.getByRole("searchbox"), "S");
        expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
      },
      HEAVY_TIMEOUT_MS,
    );

    it(
      "[R1] RESET → scrollToIndex(0) on a RISK filter change",
      async () => {
        const user = userEvent.setup();
        renderWithProviders(
          <StrategiesExploreScreen
            strategies={makeStrategies(LARGE)}
            ownedIds={[]}
            investedIds={[]}
          />,
        );
        // Drive the window off row 0 so the reset's scrollToIndex(0) is a genuine move (see SEARCH).
        act(() => {
          Object.defineProperty(window, "scrollY", { value: 300 * 57, configurable: true });
          window.dispatchEvent(new Event("scroll"));
        });
        // Clear the render-time calls so only the interaction's reset is asserted. Opening the
        // dropdown is local state only (no filter change), so it emits no scrollTo after the clear.
        const scrollTo = vi.spyOn(window, "scrollTo").mockClear();
        // POO-658: the risk filter is a dropdown now — open it (unfiltered trigger name → "…: All"),
        // then pick "Conservative" (risk level 2, the dominant bucket > THRESHOLD, so the filtered
        // list still windows and the reset fires; a below-THRESHOLD subset would render plain map).
        await user.click(screen.getByRole("button", { name: "Browse by risk: All" }));
        await user.click(screen.getByRole("option", { name: "Conservative" }));
        expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
      },
      HEAVY_TIMEOUT_MS,
    );

    it(
      "[R1] RESET → scrollToIndex(0) on a TYPE filter change",
      async () => {
        const user = userEvent.setup();
        renderWithProviders(
          <StrategiesExploreScreen
            strategies={makeStrategies(LARGE)}
            ownedIds={[]}
            investedIds={[]}
          />,
        );
        // Drive the window off row 0 so the reset's scrollToIndex(0) is a genuine move (see SEARCH).
        act(() => {
          Object.defineProperty(window, "scrollY", { value: 300 * 57, configurable: true });
          window.dispatchEvent(new Event("scroll"));
        });
        // Clear the render-time calls so only the interaction's reset is asserted. Opening the
        // dropdown is local state only (no filter change), so it emits no scrollTo after the clear.
        const scrollTo = vi.spyOn(window, "scrollTo").mockClear();
        // POO-658: the type filter is a dropdown now — open it (unfiltered trigger name → "…: All"),
        // then pick "Trading" (the dominant type bucket > THRESHOLD, so the filtered list still
        // windows and the reset fires; a below-THRESHOLD subset would render plain map — no reset).
        await user.click(screen.getByRole("button", { name: "Browse by type: All" }));
        await user.click(screen.getByRole("option", { name: "Trading" }));
        expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
      },
      HEAVY_TIMEOUT_MS,
    );

    it(
      "[R1] RESET → scrollToIndex(0) on Clear filters",
      async () => {
        const user = userEvent.setup();
        renderWithProviders(
          <StrategiesExploreScreen
            strategies={makeStrategies(LARGE)}
            ownedIds={[]}
            investedIds={[]}
          />,
        );
        // Search to no-results so the Clear-filters button appears (one non-matching char is enough:
        // "q" appears in neither "strategy N" nor "manager N").
        await user.type(screen.getByRole("searchbox"), "q");
        expect(screen.getByText("No strategies match your search.")).toBeInTheDocument();
        // Clear the render-time calls so only the interaction's reset is asserted.
        const scrollTo = vi.spyOn(window, "scrollTo").mockClear();
        await user.click(screen.getByRole("button", { name: "Clear filters" }));
        expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
      },
      HEAVY_TIMEOUT_MS,
    );

    it(
      "[R3] a focused Invest row stays mounted AND keeps focus when scrolled genuinely out (focus pin)",
      () => {
        // NON-VACUOUS by construction: the layout shim reports every measured <tr> as its fake 10000px
        // viewport, so scroll math would be corrupt and the window would never leave index 0 — the
        // "scrolled out" premise would never occur and the pin could regress undetected (the earlier
        // version of this test passed even with the pin reverted). Pin the measured <tr> height to the
        // 57px estimate so the scroll math is HONEST and the window genuinely moves off row 0, then
        // assert both the pin (row still mounted) and focus retention (activeElement unchanged).
        const origOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
          configurable: true,
          get(this: HTMLElement) {
            return this.tagName === "TR" ? 57 : 10000;
          },
        });
        try {
          renderWithProviders(
            <StrategiesExploreScreen
              strategies={makeStrategies(LARGE)}
              ownedIds={[]}
              investedIds={[]}
            />,
          );
          // Focus the Invest link of row 0 (in the initial scroll-top window): this wires the screen's
          // focusedIndex to flat index 0 ([R3]).
          const firstRow = tableDataRows()[0] as HTMLElement;
          const invest = within(firstRow).getByRole("link", { name: /Invest/ });
          const focusedIndex = Number(firstRow.dataset.index);
          expect(focusedIndex).toBe(0);
          act(() => {
            invest.focus();
          });
          expect(document.activeElement).toBe(invest);

          // Scroll far down in HONEST 57px-row coordinates so the natural window is nowhere near row 0.
          act(() => {
            Object.defineProperty(window, "scrollY", {
              value: (LARGE - 20) * 57,
              configurable: true,
            });
            window.dispatchEvent(new Event("scroll"));
          });

          // PREMISE CHECK: the natural (non-pinned) window has genuinely left row 0 — the LOWEST
          // non-pinned mounted index is far below the top, so row 0 is only present via the pin. This is
          // exactly the assertion the vacuous version could never make (row 0 stayed in-window there).
          const mounted = tableDataRows().map((r) => Number(r.dataset.index));
          const naturalMin = Math.min(...mounted.filter((i) => i !== focusedIndex));
          expect(naturalMin).toBeGreaterThan(50);

          // PIN: row 0's <tr> is still mounted despite being far outside the visible window.
          const pinnedRow = document.querySelector(`table tr[data-index='${focusedIndex}']`);
          expect(pinnedRow).not.toBeNull();
          expect(mounted).toContain(focusedIndex);
          // FOCUS RETENTION: the same Invest link is still in the DOM AND still the active element —
          // the keyboard user's focus was never yanked out from under them.
          expect(within(pinnedRow as HTMLElement).getByRole("link", { name: /Invest/ })).toBe(
            invest,
          );
          expect(document.activeElement).toBe(invest);
        } finally {
          if (origOffset) Object.defineProperty(HTMLElement.prototype, "offsetHeight", origOffset);
        }
      },
      HEAVY_TIMEOUT_MS,
    );

    it(
      "[R4] reserves the inter-segment gap so a pinned row does NOT collapse the table height",
      () => {
        // Regression for the Technique-A gap bug: with the [R2] pin the windowed rows are NON-
        // contiguous (pinned row 0 + the far natural window). A top/bottom-pad-only model reserves
        // topPad = first.start = 0 and drops the ~29,000px between row 0 and the visible segment,
        // collapsing the <tbody> from full height to ~a few rows. `techniqueASegments` must emit an
        // in-flow spacer for that gap so the reserved height still equals the full list.
        const origOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
          configurable: true,
          get(this: HTMLElement) {
            return this.tagName === "TR" ? 57 : 10000;
          },
        });
        try {
          renderWithProviders(
            <StrategiesExploreScreen
              strategies={makeStrategies(LARGE)}
              ownedIds={[]}
              investedIds={[]}
            />,
          );
          // Pin row 0.
          const firstRow = tableDataRows()[0] as HTMLElement;
          act(() => {
            within(firstRow)
              .getByRole("link", { name: /Invest/ })
              .focus();
          });
          // Scroll far down so row 0 is pinned above a far natural window (non-contiguous virtualItems).
          act(() => {
            Object.defineProperty(window, "scrollY", {
              value: (LARGE - 20) * 57,
              configurable: true,
            });
            window.dispatchEvent(new Event("scroll"));
          });

          const mounted = tableDataRows();
          // Non-contiguity confirmed: row 0 pinned, natural window far below.
          expect(mounted.map((r) => Number(r.dataset.index))).toContain(0);
          expect(
            Math.min(...mounted.map((r) => Number(r.dataset.index)).filter((i) => i !== 0)),
          ).toBeGreaterThan(50);

          // Reserved height = every spacer <td> height + every mounted 57px row. Must equal the full
          // list height (LARGE * 57). A collapsed table (missing the inter-segment gap) would be far
          // short of this.
          const spacerPx = Array.from(
            document.querySelectorAll("tr[data-virtual-spacer] td"),
          ).reduce(
            (sum, td) => sum + Number.parseFloat((td as HTMLElement).style.height || "0"),
            0,
          );
          const reserved = spacerPx + mounted.length * 57;
          expect(reserved).toBe(LARGE * 57);
        } finally {
          if (origOffset) Object.defineProperty(HTMLElement.prototype, "offsetHeight", origOffset);
        }
      },
      HEAVY_TIMEOUT_MS,
    );
  });
});
