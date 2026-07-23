/**
 * @id PP-CORE-CMP-054 (POO-625)
 * @name VirtualCardList
 * @implements-rules-version v1
 *
 * A windowed card list for non-table surfaces (strategy explore grid, portfolio positions). Because
 * there is no table layout to preserve, cards are absolutely positioned with `translateY` (the
 * technique ADR-0001 rule 2 permits OUTSIDE tables). Each card is its own `<li>` carrying
 * `aria-setsize`/`aria-posinset`, so list semantics and screen-reader position survive windowing.
 *
 * Responsive grids follow rule 3 (chunk, don't lane): the flat array is chunked into rows of
 * `laneCount` (the active matchMedia breakpoint), the ROWS are virtualized, and each card in a
 * visible row is placed by its column via `left`/`width`. A breakpoint change re-chunks ([R3]).
 *
 * Like {@link VirtualTableBody} it reads {@link useVirtualizeGate} as the single source of truth:
 * gate false (flag off, `<= THRESHOLD`, or no layout) → the plain `.map()` baseline, every card, no
 * absolute positioning, identical to today ([R1]). The focused card is force-pinned into the window
 * ([R2]) so a keyboard user's card is never unmounted. The inner container is sized to the full list
 * height so back-nav scroll restoration lands on a tall document ([R4]).
 */
"use client";

import { type CSSProperties, type ReactNode, useCallback } from "react";
import { type LaneBreakpoint, useVirtualizedRows } from "@/lib/virtualization/useVirtualizedRows";
import { useVirtualizeGate } from "@/lib/virtualization/useVirtualizeGate";

/** Props for {@link VirtualCardList}. Generic over the card shape `T`. */
export interface VirtualCardListProps<T> {
  /** The ordered cards (the same array a plain list would `.map()`). */
  items: readonly T[];
  /** Render a single card's inner content (NOT the `<li>` — this component owns the `<li>`). */
  renderItem: (item: T, index: number) => ReactNode;
  /** Stable key per card. */
  getItemKey: (item: T, index: number) => string;
  /** Accessible name for the `<ul>` (already translated by the caller). */
  ariaLabel: string;
  /** Estimated card height in px. Default 132. */
  estimateSize?: number;
  /** Overscan cards/rows on each side of the window. Default 6. */
  overscan?: number;
  /** DOM index of the currently-focused card, force-pinned into the window ([R2]). */
  focusedIndex?: number | null;
  /** Responsive column breakpoints for a grid. Omit for a single-column list. */
  laneBreakpoints?: LaneBreakpoint[];
  /** Column count when no breakpoint matches. Default 1. */
  fallbackLanes?: number;
  /** Optional class on the outer scroll container. */
  className?: string;
  /**
   * Optional class on the FALLBACK `<ul>` only (gate off / below THRESHOLD / no layout). A responsive
   * grid consumer passes its grid classes here so the plain-`.map()` baseline keeps rendering the grid
   * a user sees today ([R1]); the windowed path lays cards out by absolute `left`/`width` and
   * deliberately ignores it, since a CSS grid would fight the absolute placement (ADR-0001 rule 3,
   * chunk-then-virtualize). Omit for a single-column list.
   */
  listClassName?: string;
}

/** A windowing card list / responsive grid; see the file header for the contract. */
export function VirtualCardList<T>({
  items,
  renderItem,
  getItemKey,
  ariaLabel,
  estimateSize = 132,
  overscan = 6,
  focusedIndex = null,
  laneBreakpoints,
  fallbackLanes = 1,
  className,
  listClassName,
}: VirtualCardListProps<T>) {
  const gate = useVirtualizeGate(items.length);
  const rows = useVirtualizedRows<T>({
    items,
    mode: "element",
    estimateSize,
    overscan,
    focusedIndex,
    laneBreakpoints,
    fallbackLanes,
  });

  // Wire the SAME scroll box to both the gate (hasLayout) and the virtualizer (scroll math).
  const scrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      gate.containerRef(node);
      rows.setScrollElement(node);
    },
    [gate.containerRef, rows.setScrollElement],
  );

  const total = items.length;

  // [R1] plain-map baseline: gate false → every card, static flow, identical to today's DOM. A grid
  // consumer's responsive grid classes live on the <ul> so the fallback keeps its columns.
  if (!gate.enabled) {
    return (
      <div ref={scrollRef} className={className}>
        <ul aria-label={ariaLabel} className={listClassName}>
          {items.map((item, index) => (
            <li
              key={getItemKey(item, index)}
              aria-setsize={total}
              aria-posinset={index + 1}
              data-index={index}
            >
              {renderItem(item, index)}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const virtualItems = rows.getVirtualItems();
  const laneCount = rows.laneCount;
  const isGrid = Boolean(laneBreakpoints);

  return (
    <div ref={scrollRef} className={className} style={{ overflow: "auto" }}>
      {/* Inner container sized to the full list height reserves the scroll range ([R4]). */}
      <ul
        aria-label={ariaLabel}
        style={{ position: "relative", height: rows.getTotalSize(), margin: 0, padding: 0 }}
      >
        {virtualItems.flatMap((virtualRow) => {
          if (!isGrid) {
            // Single column: the virtualized unit is the card itself.
            const index = virtualRow.index;
            const item = items[index];
            if (item === undefined) return [];
            return [
              <li
                key={getItemKey(item, index)}
                data-index={index}
                ref={rows.virtualizer.measureElement}
                aria-setsize={total}
                aria-posinset={index + 1}
                style={cardStyle(virtualRow.start)}
              >
                {renderItem(item, index)}
              </li>,
            ];
          }
          // Grid: the virtualized unit is a ROW; render each card in that row by its column.
          const rowIndex = virtualRow.index;
          const rowItems = rows.rows[rowIndex] ?? [];
          return rowItems.map((item, col) => {
            const index = rowIndex * laneCount + col;
            return (
              <li
                key={getItemKey(item, index)}
                data-index={index}
                // Only the row's first card measures the row height (they share a row).
                ref={col === 0 ? rows.virtualizer.measureElement : undefined}
                data-row-index={rowIndex}
                aria-setsize={total}
                aria-posinset={index + 1}
                style={gridCardStyle(virtualRow.start, col, laneCount)}
              >
                {renderItem(item, index)}
              </li>
            );
          });
        })}
      </ul>
    </div>
  );
}

/** Absolute placement for a single-column card at vertical offset `top`. */
function cardStyle(top: number): CSSProperties {
  return {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    transform: `translateY(${Math.max(0, top)}px)`,
  };
}

/** Absolute placement for a grid card: vertical `top` from the row, horizontal from the column. */
function gridCardStyle(top: number, col: number, lanes: number): CSSProperties {
  return {
    position: "absolute",
    top: 0,
    left: `${(col * 100) / lanes}%`,
    width: `${100 / lanes}%`,
    transform: `translateY(${Math.max(0, top)}px)`,
  };
}
