/**
 * @id PP-CORE-CMP-053 (POO-625)
 * @name VirtualTableBody
 * @implements-rules-version v1
 *
 * A drop-in `<tbody>` that windows long tables with Technique A (ADR-0001 rule 1): the off-screen
 * space between visible rows is reserved by in-flow spacer `<tr>`s whose single `<td colSpan>` carries
 * the pixel height, so `colgroup` widths, sticky `<thead>`, and border-collapse stay correct. Rows are
 * NEVER absolutely positioned inside a table (rule 2, the absolute-row ban).
 *
 * PP-NOTE (POO-626 hardening of the POO-625 primitive): the spacers are computed PER-GAP via
 * {@link techniqueASegments}, not as a single top/bottom pad. A top/bottom-only model assumes the
 * windowed `virtualItems` are CONTIGUOUS; the [R2] focus pin breaks that assumption by force-including
 * a far row (e.g. a pinned row 0 above the natural window at rows 490..519), making the window
 * non-contiguous. A single-pad model drops the ~27,900px gap between the pinned row and the visible
 * segment, collapsing the table under the user the moment a focused row scrolls out. Per-gap spacers
 * reserve EVERY gap. When the window IS contiguous (no pin, or the pin lands inside the window) the
 * helper emits exactly a `top` + `bottom` spacer — byte-identical DOM to the previous model — so the
 * other Wave B surfaces (627/628/629) whose windowed tests exercise only contiguous windows cannot
 * regress.
 *
 * It is a single source of correctness: it reads {@link useVirtualizeGate} and, whenever the gate is
 * false (flag off, `<= THRESHOLD` items, or no measurable layout), renders the plain `.map()`
 * baseline — every row, no spacers, byte-for-byte today's DOM ([R1]). The scroll container is
 * resolved automatically as the table's scrollable ancestor, so swapping `<tbody>` for this component
 * is the only change a consuming table makes.
 *
 * a11y: spacer rows are `aria-hidden` (pure layout); real rows carry `data-index` and keep the
 * caller's `<td>`s untouched. The focused row is force-pinned into the window ([R2]) so a keyboard
 * user's row is never unmounted.
 */
"use client";

import { type ReactNode, useCallback, useState } from "react";
import { techniqueASegments } from "@/lib/virtualization/rows";
import { useVirtualizedRows } from "@/lib/virtualization/useVirtualizedRows";
import { useVirtualizeGate } from "@/lib/virtualization/useVirtualizeGate";

/** Props for {@link VirtualTableBody}. Generic over the row shape `T`. */
export interface VirtualTableBodyProps<T> {
  /** The ordered rows (the same array a plain `<tbody>` would `.map()`). */
  items: readonly T[];
  /** Column count, for the spacer `<td colSpan>` so a spacer spans the full row width. */
  colSpan: number;
  /** Render the row's `<td>` cells (NOT the `<tr>` — this component owns the `<tr>`). */
  renderRow: (item: T, index: number) => ReactNode;
  /** Stable key per row. */
  getRowKey: (item: T, index: number) => string;
  /** Estimated row height in px (fixed-height table rows). Default 57. */
  estimateSize?: number;
  /** Overscan rows on each side of the window. Default 8. */
  overscan?: number;
  /** DOM index of the currently-focused row, force-pinned into the window ([R2]). */
  focusedIndex?: number | null;
  /** Optional class on each real `<tr>`. */
  rowClassName?: string;
}

/** Resolve the scrollable ancestor of the table so the gate + virtualizer measure the right box. */
function resolveScrollParent(tbody: HTMLTableSectionElement | null): HTMLElement | null {
  const table = tbody?.closest("table");
  // The overflow container the table lives in (Table.tsx wraps in `div.overflow-x-auto`).
  return (table?.parentElement as HTMLElement | null) ?? null;
}

/** A windowing `<tbody>`; see the file header for the Technique A contract. */
export function VirtualTableBody<T>({
  items,
  colSpan,
  renderRow,
  getRowKey,
  estimateSize = 57,
  overscan = 8,
  focusedIndex = null,
  rowClassName,
}: VirtualTableBodyProps<T>) {
  const gate = useVirtualizeGate(items.length);
  const rows = useVirtualizedRows<T>({
    items,
    mode: "element",
    estimateSize,
    overscan,
    focusedIndex,
  });

  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null);

  // One ref callback wires BOTH the gate (for hasLayout) and the virtualizer (for scroll math) to
  // the SAME resolved scroll box, so the two can never disagree about whether/where to window.
  const tbodyRef = useCallback(
    (node: HTMLTableSectionElement | null) => {
      const parent = resolveScrollParent(node);
      setScrollParent(parent);
      gate.containerRef(parent);
      rows.setScrollElement(parent);
    },
    [gate.containerRef, rows.setScrollElement],
  );

  // [R1] plain-map baseline: gate false → every row, no spacers, identical to today's DOM.
  if (!gate.enabled) {
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

  // Windowed: one Technique-A in-flow spacer per gap (top, bottom, AND every inter-segment gap the
  // [R2] focus pin opens by force-including a far row). Contiguous windows collapse to just top+bottom,
  // byte-identical to the previous single-pad model; see the file header PP-NOTE.
  const segments = techniqueASegments(rows.getVirtualItems(), rows.getTotalSize());

  return (
    <tbody ref={tbodyRef} data-virtualized={scrollParent ? "true" : undefined}>
      {segments.map((segment) => {
        if (segment.type === "spacer") {
          return (
            // PP-A11Y: a pure-layout Technique-A spacer, no content or interactivity, correctly hidden.
            // biome-ignore lint/a11y/noAriaHiddenOnFocusable: empty spacer row, not focusable
            <tr key={`spacer-${segment.key}`} aria-hidden="true" data-virtual-spacer={segment.key}>
              <td colSpan={colSpan} style={{ height: segment.height, padding: 0, border: 0 }} />
            </tr>
          );
        }
        const item = items[segment.index];
        // The virtualizer only yields in-range indexes, but guard for the type-narrowed edge.
        if (item === undefined) return null;
        return (
          <tr
            key={getRowKey(item, segment.index)}
            data-index={segment.index}
            ref={rows.virtualizer.measureElement}
            className={rowClassName}
          >
            {renderRow(item, segment.index)}
          </tr>
        );
      })}
    </tbody>
  );
}
