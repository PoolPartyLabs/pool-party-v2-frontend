/**
 * @id PP-CORE-HOK-020 (POO-625)
 * @name useVirtualizedRows
 * @implements-rules-version v1
 *
 * The one wrapper around @tanstack/react-virtual (v3) that carries the POO-625 rules so no consuming
 * surface re-derives them:
 * - [R2] focus pin: a `rangeExtractor` force-includes the currently-focused row index in every
 *   window (see {@link pinFocusedIndex}), so a keyboard user's focused element is never unmounted;
 *   the pin drops the moment `focusedIndex` goes back to null.
 * - [R3] responsive grids: a matchMedia-driven `laneCount` chunks the flat item array into grid rows
 *   ({@link chunk}); a breakpoint change re-derives the count and re-chunks (v3 has no lanes).
 * - [R4] `getTotalSize()` reserves the full scroll height on first paint so back-nav scroll
 *   restoration has a tall document; `scrollToIndex` clamps into range ({@link clampScrollIndex}).
 *
 * `mode: "element"` uses {@link useVirtualizer} against a caller-provided scroll element (attach via
 * `setScrollElement`); `mode: "window"` uses {@link useWindowVirtualizer} for a page-scrolled list.
 * The virtualizer instance is returned raw for `scrollToIndex`/`measureElement` wiring by the
 * VirtualTableBody / VirtualCardList components.
 */
"use client";

import {
  defaultRangeExtractor,
  type Range,
  useVirtualizer,
  useWindowVirtualizer,
  type Virtualizer,
} from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useState } from "react";
import { chunk, clampScrollIndex, pinFocusedIndex } from "./rows";

/** One responsive breakpoint → column count. Evaluated in order; the first match wins ([R3]). */
export interface LaneBreakpoint {
  /** A CSS media query, e.g. `"(min-width: 1024px)"`. */
  query: string;
  /** Column count to use while this query matches. */
  lanes: number;
}

/** Options for {@link useVirtualizedRows}. */
export interface UseVirtualizedRowsOptions<T> {
  /** The flat, ordered item array (the same array the plain `.map()` baseline renders). */
  items: readonly T[];
  /**
   * `"element"` (a scrolling container) or `"window"` (page scroll). Default `"element"`.
   * MUST be constant for the lifetime of the mount: it selects which virtualizer hook runs,
   * so changing it after mount would violate the Rules-of-Hooks call order. Surface wiring
   * (PR2-PR5) picks one mode per surface and never toggles it.
   */
  mode?: "element" | "window";
  /** Estimated row height in px (fixed rows: table ~57; measured lists pass their estimate). */
  estimateSize?: number;
  /** Rows to render beyond the visible window on each side. Default 8. */
  overscan?: number;
  /**
   * Window mode only: the list's offset from the top of the document (its `offsetTop`). Default 0.
   * `useWindowVirtualizer` observes the RAW `window.scrollY` as its scroll offset, so a list that
   * sits below the document top must anchor its item measurements at that offset — otherwise the
   * computed visible range is shifted by `offsetTop`. @tanstack/virtual-core adds `scrollMargin` to
   * every `item.start`/`item.end` and subtracts it back out of `getTotalSize()`, so the consumer
   * places rows locally as `item.start - scrollMargin` while the reserved height stays the pure list
   * height. Element mode leaves this at 0 (the scroll container's own top is the origin).
   */
  scrollMargin?: number;
  /** Responsive column breakpoints for grids. Omit for a single-column list. */
  laneBreakpoints?: LaneBreakpoint[];
  /** Column count when no breakpoint matches (and the single-column default). Default 1. */
  fallbackLanes?: number;
  /**
   * The FLAT DOM index of the currently-focused item, or null. Force-pinned into the window ([R2]).
   * In grid mode it is translated to its containing row (`floor(index / laneCount)`) before pinning,
   * since the grid virtualizer indexes chunked rows, not flat items.
   */
  focusedIndex?: number | null;
  /**
   * Whether the virtualizer is LIVE. Default `true`. Pass the surface's windowing gate
   * (`useVirtualizeGate().enabled`) so that when the surface renders the plain-map baseline (flag off,
   * below THRESHOLD, or no layout) the virtualizer is fully inert: react-virtual attaches NO scroll
   * listeners and never calls `scrollTo` on its scroll element (`window` in `mode: "window"`). Without
   * this, a window-mode virtualizer hijacks the page to the document top on mount/measure even when
   * the surface is not windowing — breaking the ADR-0001 rule 4 "flag-off = today's baseline" contract
   * and reload/back-nav scroll restoration. The virtualizer re-attaches when this flips true (react-
   * virtual's own `enabled` transition handling), so a surface can start disabled and enable once its
   * `hasLayout` resolves.
   */
  enabled?: boolean;
}

/** What {@link useVirtualizedRows} returns. */
export interface VirtualizedRows<T> {
  /** The raw virtualizer instance (for `measureElement`, `getTotalSize`, direct wiring). */
  virtualizer: Virtualizer<Element, Element> | Virtualizer<Window, Element>;
  /** Attach the scroll container (element mode). No-op in window mode. */
  setScrollElement: (node: Element | null) => void;
  /** The current windowed items (react-virtual's `getVirtualItems`). */
  getVirtualItems: () => ReturnType<Virtualizer<Element, Element>["getVirtualItems"]>;
  /** Total reserved scroll size in px ([R4] bottom-spacer height source). */
  getTotalSize: () => number;
  /** Scroll to a row, clamped into `[0, count - 1]` ([R4] guard). */
  scrollToIndex: (index: number) => void;
  /** The active responsive column count ([R3]). */
  laneCount: number;
  /** The flat array chunked into grid rows of `laneCount` ([R3]). */
  rows: T[][];
}

/**
 * Resolve the active column count from `laneBreakpoints` via matchMedia, re-deriving on breakpoint
 * change (the [R3] responsive recompute). SSR-safe: returns `fallback` until mounted, and no-ops when
 * `window.matchMedia` is unavailable (jsdom without a shim) — matches the {@link Sheet} precedent.
 */
function useLaneCount(breakpoints: LaneBreakpoint[] | undefined, fallback: number): number {
  const resolve = useCallback((): number => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return fallback;
    for (const bp of breakpoints ?? []) {
      if (window.matchMedia(bp.query).matches) return bp.lanes;
    }
    return fallback;
  }, [breakpoints, fallback]);

  const [lanes, setLanes] = useState(fallback);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const update = () => setLanes(resolve());
    update();
    const mqls = (breakpoints ?? []).map((bp) => window.matchMedia(bp.query));
    for (const mql of mqls) mql.addEventListener("change", update);
    return () => {
      for (const mql of mqls) mql.removeEventListener("change", update);
    };
  }, [breakpoints, resolve]);

  return lanes;
}

/** Wrap @tanstack/react-virtual with the POO-625 focus-pin, responsive-chunk, and clamp rules. */
export function useVirtualizedRows<T>({
  items,
  mode = "element",
  estimateSize = 57,
  overscan = 8,
  laneBreakpoints,
  fallbackLanes = 1,
  focusedIndex = null,
  enabled = true,
  scrollMargin = 0,
}: UseVirtualizedRowsOptions<T>): VirtualizedRows<T> {
  const laneCount = useLaneCount(laneBreakpoints, fallbackLanes);
  const rows = useMemo(() => chunk(items, laneCount), [items, laneCount]);

  // Grids virtualize the CHUNKED rows (v3 has no lanes); a flat list virtualizes the items directly.
  const isGrid = Boolean(laneBreakpoints);
  const count = isGrid ? rows.length : items.length;

  // [R2] The virtualizer's index space is the flat items for a list, but the chunked ROWS for a grid.
  // `focusedIndex` is always a FLAT card index (the DOM index a keyboard user is on), so in grid mode
  // translate it to its containing row before pinning — otherwise the bounds check drops any flat
  // index >= rows.length and pins the wrong (or no) row. `null` stays `null` (pin off).
  const pinIndex =
    focusedIndex === null || !isGrid ? focusedIndex : Math.floor(focusedIndex / laneCount);

  // Force the focused row into the window. Recreated when the resolved pin index changes so the pin
  // engages and drops reactively; react-virtual re-runs the extractor on the new function identity.
  const rangeExtractor = useCallback(
    (range: Range) => pinFocusedIndex(range, pinIndex, defaultRangeExtractor),
    [pinIndex],
  );

  // Element mode holds the scroll node in state so `getScrollElement` can close over the latest node
  // and re-observe once the caller attaches it (callback ref semantics without a useRef read-after).
  const [scrollElement, setScrollElement] = useState<Element | null>(null);

  // `mode` is a mount-time constant for any given surface (a table is always element-scrolled, a
  // page list always window-scrolled) — it never toggles at runtime, so branching the hook call is
  // rules-of-hooks-safe here and avoids instantiating an unused second virtualizer (and its jsdom
  // scrollTo noise) on every surface. The two branches share identical shared options below.
  //
  // [R4] In grid mode the virtualizer measures ROWS, so the measuring element must expose its ROW
  // index to `virtualizer.measureElement`. @tanstack/virtual-core reads the virtual index from the
  // `indexAttribute` and applies the measured size to THAT index; the default `data-index` on the
  // measuring card is its FLAT index, which would attribute a row's height to the wrong row (or drop
  // it once flat >= rows.length). Point the virtualizer at `data-row-index` so measurement lands on
  // the correct row; the flat `data-index` stays for aria/posinset. A flat list keeps the default.
  const shared = {
    count,
    estimateSize: () => estimateSize,
    overscan,
    rangeExtractor,
    // Inert when the surface is not windowing: no scroll listeners, no `scrollTo` on mount/measure.
    enabled,
    // Window mode anchors item.start at the list's document offset so the raw window.scrollY the
    // window virtualizer observes lines up with the correct row (see the `scrollMargin` option doc).
    // Element mode's origin is the scroll container's own top, so it stays 0.
    scrollMargin: mode === "window" ? scrollMargin : 0,
    ...(isGrid ? { indexAttribute: "data-row-index" } : {}),
  };
  const virtualizer =
    mode === "window"
      ? // biome-ignore lint/correctness/useHookAtTopLevel: mode is fixed per mount (see note above)
        useWindowVirtualizer(shared)
      : // biome-ignore lint/correctness/useHookAtTopLevel: mode is fixed per mount (see note above)
        useVirtualizer({ ...shared, getScrollElement: () => scrollElement });

  const scrollToIndex = useCallback(
    (index: number) => virtualizer.scrollToIndex(clampScrollIndex(index, count)),
    [virtualizer, count],
  );

  return {
    virtualizer: virtualizer as VirtualizedRows<T>["virtualizer"],
    setScrollElement,
    getVirtualItems: () => virtualizer.getVirtualItems(),
    getTotalSize: () => virtualizer.getTotalSize(),
    scrollToIndex,
    laneCount,
    rows,
  };
}
