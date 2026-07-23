/**
 * @name VirtualCardList — tests
 *
 * A windowed card list (non-table, so absolute-<li> positioning is allowed — ADR-0001 rule 2). For
 * responsive grids it chunks the flat array into grid rows per breakpoint and virtualizes the ROWS
 * (rule 3), but every card is still its own `<li>` with `aria-setsize`/`aria-posinset`.
 *
 * - Gate OFF / below threshold → plain `.map()`: every card, no absolute positioning ([R1]).
 * - Gate ON + 600 + layout shim → windowed: fewer cards than items, list semantics + setsize/posinset
 *   intact, focused card stays mounted when scrolled out ([R2]).
 * - [R3] responsive: a matchMedia breakpoint change re-chunks the grid (lane count changes).
 */
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDevOverridesForTests,
  clearOverrides,
  setOverride,
} from "@/lib/features/devOverrides";
import { setupVirtualizationLayout } from "../../../tests/virtualizationLayout";
import { VirtualCardList } from "./VirtualCardList";

const CARD_HEIGHT = 132;

interface Card {
  id: string;
  name: string;
}
function makeCards(n: number): Card[] {
  return Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `Card ${i}` }));
}

/** The first rendered card, asserting at least one exists (narrows away `undefined`). */
function firstCard(): HTMLElement {
  const el = screen.getAllByRole("listitem")[0];
  if (!el) throw new Error("expected at least one card");
  return el;
}

function installMatchMedia(initialActive: string) {
  let active = initialActive;
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    "matchMedia",
    (query: string): MediaQueryList =>
      ({
        matches: query === active,
        media: query,
        onchange: null,
        addEventListener: (_: string, cb: () => void) => listeners.add(cb),
        removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
        addListener: (cb: () => void) => listeners.add(cb),
        removeListener: (cb: () => void) => listeners.delete(cb),
        dispatchEvent: () => true,
      }) as unknown as MediaQueryList,
  );
  return (next: string) => {
    active = next;
    act(() => {
      for (const cb of listeners) cb();
    });
  };
}

function renderList(
  cards: Card[],
  opts: {
    focusedIndex?: number | null;
    laneBreakpoints?: { query: string; lanes: number }[];
    listClassName?: string;
  } = {},
) {
  return render(
    <VirtualCardList
      items={cards}
      estimateSize={CARD_HEIGHT}
      getItemKey={(c) => c.id}
      ariaLabel="Cards"
      focusedIndex={opts.focusedIndex ?? null}
      laneBreakpoints={opts.laneBreakpoints}
      listClassName={opts.listClassName}
      renderItem={(c) => <div>{c.name}</div>}
    />,
  );
}

describe("VirtualCardList", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetDevOverridesForTests();
    installMatchMedia("(min-width: 1024px)");
  });
  afterEach(() => {
    localStorage.clear();
    __resetDevOverridesForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("[R1] plain-map fallback", () => {
    it("renders every card with a real list and NO absolute positioning when the flag is off", () => {
      renderList(makeCards(20));
      expect(screen.getAllByRole("listitem")).toHaveLength(20);
      for (const li of screen.getAllByRole("listitem")) {
        expect(li.style.position).not.toBe("absolute");
      }
    });

    it("renders every card with the flag ON but below THRESHOLD (identical DOM)", () => {
      setOverride("virtualize", true);
      renderList(makeCards(20));
      expect(screen.getAllByRole("listitem")).toHaveLength(20);
      clearOverrides();
    });

    it("falls back to plain map at 600 cards when there is NO layout (hasLayout false)", () => {
      setOverride("virtualize", true);
      renderList(makeCards(600));
      expect(screen.getByText("Card 0")).toBeInTheDocument();
      expect(screen.getByText("Card 599")).toBeInTheDocument();
      expect(screen.getAllByRole("listitem")).toHaveLength(600);
      clearOverrides();
    });

    it("[R1] carries listClassName on the fallback <ul> so a grid consumer keeps its columns", () => {
      // The default (production) state renders the fallback <ul>. A grid consumer passes its responsive
      // grid classes via listClassName; dropping them collapses the moderation grid 3 → 1 column with
      // no other visible symptom, the exact default-state regression [R1] forbids.
      renderList(makeCards(20), { listClassName: "grid gap-4 sm:grid-cols-2 lg:grid-cols-3" });
      expect(screen.getByRole("list", { name: "Cards" })).toHaveClass(
        "grid",
        "sm:grid-cols-2",
        "lg:grid-cols-3",
      );
    });
  });

  describe("windowed (gate on, 600 cards, layout shim)", () => {
    beforeEach(() => {
      setupVirtualizationLayout();
      setOverride("virtualize", true);
    });
    afterEach(() => {
      clearOverrides();
    });

    it("renders FEWER cards than items", () => {
      renderList(makeCards(600));
      const items = screen.getAllByRole("listitem");
      expect(items.length).toBeGreaterThan(0);
      expect(items.length).toBeLessThan(600);
    });

    it("keeps list semantics + aria-setsize/aria-posinset on every windowed card", () => {
      renderList(makeCards(600));
      expect(screen.getByRole("list", { name: "Cards" })).toBeInTheDocument();
      const first = firstCard();
      expect(first).toHaveAttribute("aria-setsize", "600");
      // posinset is 1-based and matches the card's flat index.
      const idx = Number(first.dataset.index);
      expect(first).toHaveAttribute("aria-posinset", String(idx + 1));
    });

    it("absolutely positions the windowed cards with translateY (allowed for non-table lists)", () => {
      renderList(makeCards(600));
      const first = firstCard();
      expect(first.style.position).toBe("absolute");
      expect(first.style.transform).toMatch(/translateY\(/);
    });

    it("[R4] reserves the full scroll height via a sized inner container (translateY math syncs)", () => {
      renderList(makeCards(600));
      const first = firstCard();
      const idx = Number(first.dataset.index);
      // The first card's translateY equals its index * cardHeight (spacer-equivalent sync, >= 0).
      const ty = Number.parseFloat(first.style.transform.replace(/[^0-9.-]/g, ""));
      expect(ty).toBe(idx * CARD_HEIGHT);
      expect(ty).toBeGreaterThanOrEqual(0);
    });

    it("[R2] the focused card stays mounted when scrolled out of the window", () => {
      renderList(makeCards(600), { focusedIndex: 590 });
      const focused = document.querySelector("li[data-index='590']");
      expect(focused).not.toBeNull();
      expect(within(focused as HTMLElement).getByText("Card 590")).toBeInTheDocument();
    });

    it("ignores listClassName on the windowed <ul> (a CSS grid would fight absolute placement)", () => {
      renderList(makeCards(600), {
        listClassName: "grid gap-4 sm:grid-cols-2 lg:grid-cols-3",
        laneBreakpoints: [{ query: "(min-width: 1024px)", lanes: 3 }],
      });
      const list = screen.getByRole("list", { name: "Cards" });
      // Windowed: cards are placed by absolute left/width, so the grid classes must NOT be applied.
      expect(list).not.toHaveClass("grid");
      expect(list).not.toHaveClass("lg:grid-cols-3");
    });
  });

  describe("[R3] responsive grid (chunk-then-virtualize-rows)", () => {
    beforeEach(() => {
      setupVirtualizationLayout();
      setOverride("virtualize", true);
    });
    afterEach(() => {
      clearOverrides();
    });

    it("re-chunks when a matchMedia breakpoint change flips the lane count", () => {
      const setActive = installMatchMedia("(min-width: 1024px)");
      const breakpoints = [
        { query: "(min-width: 1024px)", lanes: 3 },
        { query: "(min-width: 640px)", lanes: 2 },
      ];
      renderList(makeCards(600), { laneBreakpoints: breakpoints });
      // 3 lanes: the first row holds cards at flat index 0,1,2 → card 0 and card 2 share a row (same
      // translateY), and their horizontal offset differs.
      const cardAt = (i: number) => document.querySelector(`li[data-index='${i}']`) as HTMLElement;
      const tyOf = (el: HTMLElement) =>
        Number.parseFloat(el.style.transform.match(/translateY\(([-0-9.]+)/)?.[1] ?? "NaN");
      expect(tyOf(cardAt(0))).toBe(tyOf(cardAt(2)));

      // Drop to 2 lanes: card 2 moves to the SECOND grid row, so its translateY now exceeds card 0's.
      setActive("(min-width: 640px)");
      expect(tyOf(cardAt(2))).toBeGreaterThan(tyOf(cardAt(0)));
    });

    it("[R2] pins the focused card in grid mode even though focusedIndex is a FLAT index", () => {
      // Regression: the virtualizer's index space in grid mode is chunked ROWS (count = rows.length),
      // but focusedIndex is documented/passed as the FLAT card index. Without a flat→row translation
      // the pin's bounds check drops any flat index >= rows.length (here 590 >= 200) and the focused
      // card is unmounted. It must stay mounted for a keyboard user in the responsive explore grid.
      installMatchMedia("(min-width: 1024px)");
      renderList(makeCards(600), {
        focusedIndex: 590,
        laneBreakpoints: [{ query: "(min-width: 1024px)", lanes: 3 }],
      });
      const focused = document.querySelector("li[data-index='590']");
      expect(focused).not.toBeNull();
      expect(within(focused as HTMLElement).getByText("Card 590")).toBeInTheDocument();
    });

    it("carries the ROW index on data-row-index (the attribute the grid virtualizer measures by)", () => {
      // DOM contract feeding the [R4] measurement fix: the col-0 measuring <li> must expose its ROW
      // index on data-row-index (the virtualizer's indexAttribute in grid mode) while data-index keeps
      // the FLAT index for aria/posinset. The behavioral guarantee that the measured size then lands on
      // the correct row is proven at the hook level in useVirtualizedRows.test.tsx.
      installMatchMedia("(min-width: 1024px)");
      renderList(makeCards(600), {
        laneBreakpoints: [{ query: "(min-width: 1024px)", lanes: 3 }],
      });
      const measuring = Array.from(document.querySelectorAll("li[data-row-index]")).filter(
        (li) => (li as HTMLElement).style.left === "0%" || (li as HTMLElement).style.left === "0px",
      ) as HTMLElement[];
      expect(measuring.length).toBeGreaterThan(0);
      for (const li of measuring) {
        const flat = Number(li.dataset.index);
        const row = Number(li.dataset.rowIndex);
        // The measuring element carries BOTH: flat index for aria, row index for the virtualizer.
        expect(row).toBe(Math.floor(flat / 3));
      }
    });
  });
});
