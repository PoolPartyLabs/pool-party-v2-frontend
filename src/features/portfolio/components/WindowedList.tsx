/**
 * @id PP-PORT-CMP-004 (POO-629)
 * @name Portfolio windowed lists (document-scroll)
 * @implements-rules-version v1
 *
 * The document-scroll (`useWindowVirtualizer`) counterparts to the element-scroll POO-625 primitives
 * (`@/components/virtualized`). The Portfolio positions and closed history are NOT their own scroll
 * boxes: the whole page scrolls, and the hero + aside above them must stay in the same document flow
 * so browser back-nav scroll restoration lands where the user left. Nesting an `overflow:auto` box
 * (what VirtualTableBody / VirtualCardList do) would break that, so this surface drives the lower-level
 * `useVirtualizedRows({ mode: "window" })` while keeping every ADR-0001 contract:
 *
 * - {@link useVirtualizeGate} is the SINGLE gate (flag on + count > THRESHOLD + hasLayout). Any leg
 *   false -> the plain `.map()` baseline, byte-for-byte today's DOM ([R1]).
 * - {@link WindowedTableBody} uses Technique A (ADR-0001 rule 1): two in-flow spacer <tr>s reserve the
 *   off-screen pixels; rows stay in table flow (the absolute-row ban, rule 2). Rows are keyed by the
 *   caller's stable key, so a same-identity refetch (new array, same ids, changed values) is a refresh,
 *   not a reset — the window keeps its offset ([R1]/[R2]/[R3], the DO-NOT-RESET half of ADR-0001 rule 5).
 * - {@link WindowedCardList} is a non-table list, so cards are absolutely positioned with translateY
 *   (allowed outside tables, rule 2), the inner container sized to the full list height so back-nav
 *   restoration has a tall document ([R4]).
 *
 * `mode` is fixed to `"window"` per mount (never toggles), satisfying the primitive's constant-mode
 * contract.
 *
 * Document-scroll offset (POO-629): `useWindowVirtualizer` observes the RAW `window.scrollY`, so a
 * list below the fold (every Portfolio list sits under the hero/aside/KPI sections) must anchor its
 * measurements at its own `offsetTop` via `scrollMargin` — otherwise the visible range is shifted by
 * that offset once it exceeds the overscan band ({@link useDocumentScrollMargin} measures it). Item
 * starts then carry the margin, so spacer heights / translateY subtract `virtualizer.options.scrollMargin`
 * to place rows LOCAL to the list; `getTotalSize()` already removes it, so the reserved height is the
 * pure list height.
 */
"use client";

import { type CSSProperties, type ReactNode, useCallback, useLayoutEffect, useState } from "react";
import { useVirtualizedRows } from "@/lib/virtualization/useVirtualizedRows";
import { useVirtualizeGate } from "@/lib/virtualization/useVirtualizeGate";

/**
 * Measure a document-scroll list's offset from the top of the document, to feed as `scrollMargin`.
 *
 * `useWindowVirtualizer` observes the RAW `window.scrollY` as its scroll offset, so a list that sits
 * below the hero/aside/KPI sections (every Portfolio list does) must anchor its item measurements at
 * its own `offsetTop`; otherwise the computed visible range is shifted by that offset once it exceeds
 * the overscan band, and users see a blank spacer band and the wrong rows (POO-629). The offset is
 * `rect.top + window.scrollY` (the element's distance from document top, scroll-position-independent).
 * Measured in a layout effect (before paint) and on window resize, so a reflow that moves the list
 * (font load, responsive breakpoint) keeps the anchor honest. Returns the node setter to attach to the
 * list container and the measured margin (0 under SSR / bare jsdom, where `getBoundingClientRect` is
 * absent or zero — the same graceful degradation as the plain-map fallback).
 */
function useDocumentScrollMargin(): {
  setMarginNode: (node: HTMLElement | null) => void;
  scrollMargin: number;
} {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    if (!node) return;
    const measure = () => setScrollMargin(node.getBoundingClientRect().top + window.scrollY);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [node]);

  return { setMarginNode: setNode, scrollMargin };
}

/** Props for {@link WindowedTableBody}. Generic over the row shape `T`. */
export interface WindowedTableBodyProps<T> {
  /** The ordered rows (the same array a plain `<tbody>` would `.map()`). */
  items: readonly T[];
  /** Column count, for the spacer `<td colSpan>` so a spacer spans the full row width. */
  colSpan: number;
  /** Render the row's `<td>` cells (NOT the `<tr>` — this component owns the `<tr>`). */
  renderRow: (item: T, index: number) => ReactNode;
  /** Stable key per row (keep it identity-stable so a refetch is a refresh, not a reset). */
  getRowKey: (item: T, index: number) => string;
  /** Estimated row height in px (fixed-height table rows). Default 57. */
  estimateSize?: number;
  /** Optional class on each real `<tr>`. */
  rowClassName?: string;
  /**
   * Force the plain-map baseline regardless of the gate (POO-668 R5): the server-paged Portfolio lists
   * accumulate a small slice and render plainly, so the windowing is superseded. Default false.
   */
  disabled?: boolean;
}

/** A document-scroll windowing `<tbody>`; see the file header for the Technique A contract. */
export function WindowedTableBody<T>({
  items,
  colSpan,
  renderRow,
  getRowKey,
  estimateSize = 57,
  rowClassName,
  disabled = false,
}: WindowedTableBodyProps<T>) {
  const gate = useVirtualizeGate(items.length);
  const { setMarginNode, scrollMargin } = useDocumentScrollMargin();
  const rows = useVirtualizedRows<T>({ items, mode: "window", estimateSize, scrollMargin });

  // The gate needs a measurable box for hasLayout AND we measure this same <tbody>'s document offset
  // for scrollMargin; the window virtualizer scrolls the document, so the <tbody> itself is the box.
  const tbodyRef = useCallback(
    (node: HTMLTableSectionElement | null) => {
      gate.containerRef(node);
      setMarginNode(node);
    },
    [gate.containerRef, setMarginNode],
  );

  // [R1] plain-map baseline: gate false OR disabled (POO-668 R5) -> every row, no spacers, today's DOM.
  if (disabled || !gate.enabled) {
    return (
      <tbody ref={tbodyRef}>
        {items.map((item, index) => (
          <tr key={getRowKey(item, index)} className={rowClassName}>
            {renderRow(item, index)}
          </tr>
        ))}
      </tbody>
    );
  }

  const virtualItems = rows.getVirtualItems();
  const totalSize = rows.getTotalSize();
  const first = virtualItems[0];
  const last = virtualItems[virtualItems.length - 1];
  // item.start/end carry the document offset (scrollMargin); getTotalSize() already removed it. Place
  // spacers LOCAL to the list by subtracting the margin, so a list below the fold reserves the right
  // pixels instead of over-padding by its offsetTop (POO-629). Clamp both to >= 0 so a partial
  // first/last window never emits a negative height ([R4]).
  const margin = rows.virtualizer.options.scrollMargin;
  const topPad = first ? Math.max(0, first.start - margin) : 0;
  const bottomPad = last ? Math.max(0, totalSize - (last.end - margin)) : 0;

  return (
    <tbody ref={tbodyRef} data-virtualized="true">
      {topPad > 0 ? (
        // PP-A11Y: a pure-layout Technique-A spacer, no content or interactivity, correctly hidden.
        // biome-ignore lint/a11y/noAriaHiddenOnFocusable: empty spacer row, not focusable
        <tr aria-hidden="true" data-virtual-spacer="top">
          <td colSpan={colSpan} style={{ height: topPad, padding: 0, border: 0 }} />
        </tr>
      ) : null}
      {virtualItems.map((virtualRow) => {
        const item = items[virtualRow.index];
        if (item === undefined) return null;
        return (
          <tr
            key={getRowKey(item, virtualRow.index)}
            data-index={virtualRow.index}
            ref={rows.virtualizer.measureElement}
            className={rowClassName}
          >
            {renderRow(item, virtualRow.index)}
          </tr>
        );
      })}
      {bottomPad > 0 ? (
        // PP-A11Y: a pure-layout Technique-A spacer, no content or interactivity, correctly hidden.
        // biome-ignore lint/a11y/noAriaHiddenOnFocusable: empty spacer row, not focusable
        <tr aria-hidden="true" data-virtual-spacer="bottom">
          <td colSpan={colSpan} style={{ height: bottomPad, padding: 0, border: 0 }} />
        </tr>
      ) : null}
    </tbody>
  );
}

/** Props for {@link WindowedCardList}. Generic over the card shape `T`. */
export interface WindowedCardListProps<T> {
  /** The ordered cards (the same array a plain list would `.map()`). */
  items: readonly T[];
  /** Render a single card's inner content (NOT the `<li>` — this component owns the `<li>`). */
  renderItem: (item: T, index: number) => ReactNode;
  /** Stable key per card (identity-stable so a refetch is a refresh, not a reset). */
  getItemKey: (item: T, index: number) => string;
  /** Accessible name for the `<ul>` (already translated by the caller). */
  ariaLabel?: string;
  /** Optional id on the `<ul>` (e.g. an aria-controls target). */
  id?: string;
  /** Estimated card height in px. Default 132. */
  estimateSize?: number;
  /** Class on the plain-map `<ul>` (baseline flow layout). Ignored on the windowed inner container. */
  className?: string;
  /**
   * Force the plain-map baseline regardless of the gate (POO-668 R5): the server-paged Portfolio lists
   * accumulate a small slice and render plainly, so the windowing is superseded. Default false.
   */
  disabled?: boolean;
}

/** A document-scroll windowing card list (non-table); see the file header for the contract. */
export function WindowedCardList<T>({
  items,
  renderItem,
  getItemKey,
  ariaLabel,
  id,
  estimateSize = 132,
  className,
  disabled = false,
}: WindowedCardListProps<T>) {
  const gate = useVirtualizeGate(items.length);
  const { setMarginNode, scrollMargin } = useDocumentScrollMargin();
  const rows = useVirtualizedRows<T>({ items, mode: "window", estimateSize, scrollMargin });
  const total = items.length;

  // Measure the <ul> for hasLayout AND its document offset for scrollMargin (window virtualizer
  // scrolls the document, so there is no inner box — the <ul> is the box).
  const ulRef = useCallback(
    (node: HTMLUListElement | null) => {
      gate.containerRef(node);
      setMarginNode(node);
    },
    [gate.containerRef, setMarginNode],
  );

  // [R1] plain-map baseline: gate false OR disabled (POO-668 R5) -> every card, static flow, today's DOM.
  if (disabled || !gate.enabled) {
    return (
      <ul ref={ulRef} id={id} aria-label={ariaLabel} className={className}>
        {items.map((item, index) => (
          <li key={getItemKey(item, index)} aria-setsize={total} aria-posinset={index + 1}>
            {renderItem(item, index)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    // Inner container sized to the full list height reserves the scroll range ([R4]).
    <ul
      ref={ulRef}
      id={id}
      aria-label={ariaLabel}
      style={{ position: "relative", height: rows.getTotalSize(), margin: 0, padding: 0 }}
    >
      {rows.getVirtualItems().map((virtualRow) => {
        const index = virtualRow.index;
        const item = items[index];
        if (item === undefined) return null;
        return (
          <li
            key={getItemKey(item, index)}
            data-index={index}
            ref={rows.virtualizer.measureElement}
            aria-setsize={total}
            aria-posinset={index + 1}
            // virtualRow.start carries the document offset (scrollMargin); subtract it so the card is
            // placed LOCAL to the <ul> rather than pushed down by the list's offsetTop (POO-629).
            style={cardStyle(virtualRow.start - rows.virtualizer.options.scrollMargin)}
          >
            {renderItem(item, index)}
          </li>
        );
      })}
    </ul>
  );
}

/** Absolute placement for a single-column card at vertical offset `top` (allowed outside tables). */
function cardStyle(top: number): CSSProperties {
  return {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    transform: `translateY(${Math.max(0, top)}px)`,
  };
}
