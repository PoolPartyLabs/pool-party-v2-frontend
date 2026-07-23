/**
 * @name useVirtualizedRows — tests
 *
 * Wraps @tanstack/react-virtual and layers the POO-625 rules on top:
 * - [R3] responsive column count from matchMedia breakpoints, re-chunking the flat array on change.
 * - [R2] the focused index is force-pinned into the window via the rangeExtractor.
 * - [R4] the total scroll height is reserved synchronously on first paint (getTotalSize > 0), and
 *   the spacer offsets clamp non-negative (first item start === firstVisible * rowHeight).
 * - scrollToIndex clamps into range.
 *
 * Windowed cases use the OPT-IN {@link setupVirtualizationLayout} shim (never global).
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupVirtualizationLayout } from "../../../tests/virtualizationLayout";
import { useVirtualizedRows } from "./useVirtualizedRows";

const ROW_HEIGHT = 57;

/**
 * Install a controllable `window.matchMedia`. `active` is the query string currently matching; the
 * returned setter flips the match and fires the registered `change` listeners so the hook re-derives
 * its lane count (the responsive breakpoint change of [R3]).
 */
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

function makeItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `row-${i}`, i }));
}

describe("useVirtualizedRows", () => {
  beforeEach(() => {
    installMatchMedia("(min-width: 1024px)");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("[R3] responsive lane count", () => {
    it("picks the lane count of the first matching breakpoint (widest wins)", () => {
      const { result } = renderHook(() =>
        useVirtualizedRows({
          items: makeItems(12),
          laneBreakpoints: [
            { query: "(min-width: 1024px)", lanes: 3 },
            { query: "(min-width: 640px)", lanes: 2 },
          ],
          fallbackLanes: 1,
        }),
      );
      expect(result.current.laneCount).toBe(3);
      // 12 items / 3 lanes = 4 grid rows.
      expect(result.current.rows).toHaveLength(4);
    });

    it("re-chunks when a matchMedia breakpoint change flips the lane count", () => {
      const setActive = installMatchMedia("(min-width: 1024px)");
      const { result } = renderHook(() =>
        useVirtualizedRows({
          items: makeItems(12),
          laneBreakpoints: [
            { query: "(min-width: 1024px)", lanes: 3 },
            { query: "(min-width: 640px)", lanes: 2 },
          ],
          fallbackLanes: 1,
        }),
      );
      expect(result.current.laneCount).toBe(3);
      expect(result.current.rows).toHaveLength(4);

      setActive("(min-width: 640px)");
      expect(result.current.laneCount).toBe(2);
      // 12 / 2 = 6 grid rows after re-chunk.
      expect(result.current.rows).toHaveLength(6);
    });

    it("falls back to fallbackLanes when no breakpoint matches", () => {
      installMatchMedia("(min-width: 99999px)");
      const { result } = renderHook(() =>
        useVirtualizedRows({
          items: makeItems(5),
          laneBreakpoints: [{ query: "(min-width: 1024px)", lanes: 3 }],
          fallbackLanes: 1,
        }),
      );
      expect(result.current.laneCount).toBe(1);
      expect(result.current.rows).toHaveLength(5);
    });
  });

  describe("windowed math (element mode, layout shim)", () => {
    beforeEach(() => {
      setupVirtualizationLayout();
    });

    it("[R4] reserves the full scroll height synchronously (totalSize ~ count * rowHeight)", () => {
      const scrollEl = document.createElement("div");
      const { result } = renderHook(() =>
        useVirtualizedRows({
          items: makeItems(600),
          mode: "element",
          estimateSize: ROW_HEIGHT,
          overscan: 8,
        }),
      );
      act(() => result.current.setScrollElement(scrollEl));
      expect(result.current.getTotalSize()).toBe(600 * ROW_HEIGHT);
    });

    it("windows to fewer items than the full list, and the first spacer offset is synced", () => {
      const scrollEl = document.createElement("div");
      const { result } = renderHook(() =>
        useVirtualizedRows({
          items: makeItems(600),
          mode: "element",
          estimateSize: ROW_HEIGHT,
          overscan: 8,
        }),
      );
      act(() => result.current.setScrollElement(scrollEl));
      const items = result.current.getVirtualItems();
      expect(items.length).toBeGreaterThan(0);
      expect(items.length).toBeLessThan(600);
      const firstItem = items[0];
      if (!firstItem) throw new Error("expected a windowed item");
      // [R4] spacer sync: the first windowed item's start === its index * rowHeight, and non-negative.
      expect(firstItem.start).toBe(firstItem.index * ROW_HEIGHT);
      expect(firstItem.start).toBeGreaterThanOrEqual(0);
    });

    it("[window] offsets item.start by scrollMargin but keeps getTotalSize the pure list height", () => {
      // Regression (POO-629): a window-mode list that sits below the document top must pass its
      // offsetTop as `scrollMargin`. @tanstack/virtual-core then anchors item.start at scrollMargin
      // (so the raw window.scrollY the window virtualizer observes lines up with the correct row),
      // while getTotalSize() subtracts it back out so the reserved spacer height is the pure list
      // height. Without the option the range is shifted by offsetTop in a real browser (jsdom's
      // offsetTop is 0, so this asserts the plumbing directly rather than relying on layout).
      const MARGIN = 800;
      const { result } = renderHook(() =>
        useVirtualizedRows({
          items: makeItems(600),
          mode: "window",
          estimateSize: ROW_HEIGHT,
          overscan: 8,
          scrollMargin: MARGIN,
        }),
      );
      // The reserved scroll height is the list's own height, margin removed.
      expect(result.current.getTotalSize()).toBe(600 * ROW_HEIGHT);
      const first = result.current.getVirtualItems()[0];
      if (!first) throw new Error("expected a windowed item");
      // item.start carries the margin; the caller subtracts options.scrollMargin to place locally.
      expect(first.start).toBe(first.index * ROW_HEIGHT + MARGIN);
      expect(result.current.virtualizer.options.scrollMargin).toBe(MARGIN);
    });

    it("[window] defaults scrollMargin to 0 (a list at the document top is unshifted)", () => {
      const { result } = renderHook(() =>
        useVirtualizedRows({
          items: makeItems(600),
          mode: "window",
          estimateSize: ROW_HEIGHT,
          overscan: 8,
        }),
      );
      const first = result.current.getVirtualItems()[0];
      if (!first) throw new Error("expected a windowed item");
      expect(first.start).toBe(first.index * ROW_HEIGHT);
      expect(result.current.virtualizer.options.scrollMargin).toBe(0);
    });

    it("scrollToIndex clamps an over-range target instead of throwing", () => {
      const scrollEl = document.createElement("div");
      const spy = { calls: [] as number[] };
      const { result } = renderHook(() =>
        useVirtualizedRows({
          items: makeItems(600),
          mode: "element",
          estimateSize: ROW_HEIGHT,
          overscan: 8,
        }),
      );
      act(() => result.current.setScrollElement(scrollEl));
      vi.spyOn(result.current.virtualizer, "scrollToIndex").mockImplementation(((i: number) => {
        spy.calls.push(i);
      }) as never);
      act(() => result.current.scrollToIndex(99999));
      expect(spy.calls[0]).toBe(599);
      act(() => result.current.scrollToIndex(-3));
      expect(spy.calls[1]).toBe(0);
    });
  });

  describe("[R2] focus pin", () => {
    beforeEach(() => {
      setupVirtualizationLayout();
    });

    it("force-includes the focused index in the window when it is scrolled out of view", () => {
      const scrollEl = document.createElement("div");
      const { result, rerender } = renderHook(
        ({ focused }: { focused: number | null }) =>
          useVirtualizedRows({
            items: makeItems(600),
            mode: "element",
            estimateSize: ROW_HEIGHT,
            overscan: 8,
            focusedIndex: focused,
          }),
        { initialProps: { focused: null as number | null } },
      );
      act(() => result.current.setScrollElement(scrollEl));

      const baseWindow = result.current.getVirtualItems().map((v) => v.index);
      const farAway = 590;
      expect(baseWindow).not.toContain(farAway);

      rerender({ focused: farAway });
      const pinnedWindow = result.current.getVirtualItems().map((v) => v.index);
      expect(pinnedWindow).toContain(farAway);

      // [R2] pin dropped when focus moves away (back to null) → far row no longer forced in.
      rerender({ focused: null });
      expect(result.current.getVirtualItems().map((v) => v.index)).not.toContain(farAway);
    });

    it("measures the ROW the element belongs to in grid mode (indexAttribute = data-row-index)", () => {
      // Regression [R4]: the grid virtualizer measures ROWS. @tanstack/virtual-core resolves the
      // virtual index from the element's `indexAttribute` and applies the measured size to THAT index.
      // The measuring card's default `data-index` is its FLAT index, so a resize keyed off it would
      // land on the wrong row (or be dropped once flat >= rows.length). The hook must set
      // `indexAttribute` to `data-row-index` so `measureElement` attributes the size to the right row.
      const scrollEl = document.createElement("div");
      const { result } = renderHook(() =>
        useVirtualizedRows({
          items: makeItems(600),
          mode: "element",
          estimateSize: ROW_HEIGHT,
          overscan: 8,
          laneBreakpoints: [{ query: "(min-width: 1024px)", lanes: 3 }],
          fallbackLanes: 3,
        }),
      );
      act(() => result.current.setScrollElement(scrollEl));

      const rowIndex = 2; // flat card 6..8 → row 2. Its measuring card's data-index would be 6.
      const measuredHeight = 321; // distinct from the 57px estimate.
      const el = document.createElement("div");
      // Mimic the component: flat index on data-index, ROW index on data-row-index. If the virtualizer
      // read data-index it would apply the size to virtual index 6 (flat), not row 2.
      el.setAttribute("data-index", String(rowIndex * 3)); // flat = 6
      el.setAttribute("data-row-index", String(rowIndex));
      Object.defineProperty(el, "offsetHeight", { configurable: true, get: () => measuredHeight });

      act(() => {
        result.current.virtualizer.measureElement(el);
      });

      // `itemSizeCache` is keyed by item key (default key extractor = the virtual index). The measured
      // size landed on ROW 2, NOT on flat index 6 (which was never measured, so it stays unset).
      const sizes = result.current.virtualizer.itemSizeCache;
      expect(sizes.get(rowIndex)).toBe(measuredHeight);
      expect(sizes.get(rowIndex * 3)).toBeUndefined();
    });

    it("translates a FLAT focusedIndex to its ROW index before pinning in grid mode", () => {
      // Regression: in grid mode the virtualizer indexes chunked rows (count = rows.length), but the
      // caller passes focusedIndex as a FLAT card index. The pin must force the CONTAINING row into
      // the window; a raw flat index would be out of bounds (590 >= 200 rows) and silently dropped.
      const scrollEl = document.createElement("div");
      const { result } = renderHook(() =>
        useVirtualizedRows({
          items: makeItems(600),
          mode: "element",
          estimateSize: ROW_HEIGHT,
          overscan: 8,
          laneBreakpoints: [{ query: "(min-width: 1024px)", lanes: 3 }],
          fallbackLanes: 3,
          focusedIndex: 590, // flat card index → row 196 (Math.floor(590 / 3)).
        }),
      );
      act(() => result.current.setScrollElement(scrollEl));
      // 600 items / 3 lanes = 200 rows; the pinned virtualizer index is the ROW, not the flat index.
      expect(result.current.rows).toHaveLength(200);
      const windowRows = result.current.getVirtualItems().map((v) => v.index);
      expect(windowRows).toContain(Math.floor(590 / 3));
      // The out-of-bounds flat index is NOT present as a virtualizer (row) index.
      expect(windowRows).not.toContain(590);
    });
  });
});
