/**
 * @id PP-CORE-LIB-028 (POO-625)
 * @name virtualization row helpers
 * @implements-rules-version v1
 *
 * The deterministic, DOM-free core of {@link useVirtualizedRows}: grid-row chunking ([R3]), the
 * focus-pin rangeExtractor ([R2]), and scroll-index clamping ([R4] guard math). Kept pure so the
 * business rules are unit-tested without a virtualizer or a layout engine; the hook wires these into
 * @tanstack/react-virtual.
 */
import type { Range, VirtualItem } from "@tanstack/react-virtual";

/**
 * Group a flat item array into grid rows of `laneCount` columns ([R3], ADR-0001 rule 3: chunk, don't
 * lane). The last row may be short. `laneCount` is clamped to `>= 1` so a bad/zero column count never
 * divides by zero or silently drops items. Column-count changes (matchMedia breakpoint) recompute the
 * chunking by calling this again with the new count.
 */
export function chunk<T>(items: readonly T[], laneCount: number): T[][] {
  const cols = Math.max(1, Math.floor(laneCount) || 1);
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += cols) {
    rows.push(items.slice(i, i + cols));
  }
  return rows;
}

/**
 * A rangeExtractor wrapper that force-includes the currently-focused row index in the window so a
 * keyboard user's focused element is never unmounted from under them ([R2], ADR-0001). Delegates to
 * `base` (react-virtual's `defaultRangeExtractor` in production) for the visible window, then unions
 * in `focusedIndex` when it is a valid in-bounds index outside that window. Returns a sorted,
 * de-duplicated ascending list (react-virtual requires ascending indexes). When `focusedIndex` is
 * `null` the pin is dropped and the base window passes through unchanged.
 */
export function pinFocusedIndex(
  range: Range,
  focusedIndex: number | null,
  base: (range: Range) => number[],
): number[] {
  const window = base(range);
  if (
    focusedIndex === null ||
    focusedIndex < 0 ||
    focusedIndex >= range.count ||
    window.includes(focusedIndex)
  ) {
    return window;
  }
  const merged = new Set(window);
  merged.add(focusedIndex);
  return [...merged].sort((a, b) => a - b);
}

/**
 * Clamp a scroll target index into `[0, count - 1]` ([R4] guard). An empty list clamps to 0 (not -1),
 * so `scrollToIndex` on an empty/edge list is always a safe no-op rather than an out-of-range call.
 */
export function clampScrollIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(0, index), count - 1);
}

/** One in-flow entry of a Technique-A `<tbody>`: a real row, or a pure-layout spacer of `height` px. */
export type TechniqueASegment =
  | { type: "row"; index: number }
  | { type: "spacer"; key: string; height: number };

/**
 * Turn the windowed `virtualItems` into an ordered list of row + spacer segments that reserves EVERY
 * off-screen gap (ADR-0001 rule 1, Technique A; [R4]). Unlike a top-pad/bottom-pad-only model, this
 * emits an in-flow spacer for each gap between consecutive windowed items — the case the [R2] focus
 * pin creates by force-including a far row, which makes `virtualItems` NON-CONTIGUOUS (e.g. the pinned
 * row 0 followed by the natural window at rows 490..519). Without a per-gap spacer the ~27,900px
 * between the pinned row and the visible segment is never reserved and the table collapses under the
 * user the moment a focused row scrolls out.
 *
 * `virtualItems` MUST be ascending by `start` (react-virtual, with our `pinFocusedIndex` extractor,
 * always yields ascending indexes → ascending starts for a fixed layout). Each spacer height is
 * clamped to `> 0`; a zero/negative gap (contiguous rows, or a last item overshooting `totalSize`
 * from measurement jitter) emits no spacer, so the DOM is byte-identical to the two-spacer model
 * whenever the window is contiguous.
 */
export function techniqueASegments(
  virtualItems: readonly VirtualItem[],
  totalSize: number,
): TechniqueASegment[] {
  const segments: TechniqueASegment[] = [];
  let cursor = 0; // px already reserved from the top of the list.
  virtualItems.forEach((item, i) => {
    const gap = item.start - cursor;
    if (gap > 0) {
      // Leading gap = "top" spacer; any later gap is an inter-segment pin gap.
      segments.push({ type: "spacer", key: i === 0 ? "top" : `gap-${i - 1}`, height: gap });
    }
    segments.push({ type: "row", index: item.index });
    cursor = item.end;
  });
  const bottom = totalSize - cursor;
  if (bottom > 0) segments.push({ type: "spacer", key: "bottom", height: bottom });
  return segments;
}
