/**
 * @name virtualization row helpers — tests
 *
 * The deterministic core of {@link useVirtualizedRows}, testable without a DOM:
 * - {@link chunk} — group a flat array into grid rows of N (ADR-0001 rule 3, [R3]).
 * - {@link pinFocusedIndex} — a rangeExtractor wrapper that force-includes the focused row so a
 *   keyboard user's focus is never unmounted ([R2]).
 * - {@link clampScrollIndex} — keep a scroll target inside `[0, count - 1]` ([R4] guard math).
 * - {@link techniqueASegments} — turn the windowed virtualItems into an ordered row/spacer segment
 *   list that reserves EVERY gap, including the gap the [R2] focus pin opens by making the window
 *   non-contiguous ([R4] Technique A, ADR-0001 rule 1).
 */

import type { Range, VirtualItem } from "@tanstack/react-virtual";
import { describe, expect, it } from "vitest";
import { chunk, clampScrollIndex, pinFocusedIndex, techniqueASegments } from "./rows";

/** Build a minimal VirtualItem for a fixed-height row layout (size = end - start). */
function vi(index: number, start: number, size: number): VirtualItem {
  // `lane` is required by @tanstack/react-virtual's VirtualItem (single-column table → lane 0).
  return { index, start, end: start + size, size, key: index, lane: 0 };
}

describe("chunk [R3]", () => {
  it("groups a flat array into rows of laneCount, last row short", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns one lane-1 row per item when laneCount is 1 (single column)", () => {
    expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  });

  it("is empty for an empty array", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("clamps a non-positive laneCount to 1 so it never divides by zero or drops items", () => {
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
    expect(chunk([1, 2], -4)).toEqual([[1], [2]]);
  });

  it("re-chunks to a different row shape when laneCount changes (breakpoint change)", () => {
    const items = [1, 2, 3, 4, 5, 6];
    expect(chunk(items, 3)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(chunk(items, 2)).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });
});

describe("pinFocusedIndex [R2]", () => {
  const range: Range = { startIndex: 10, endIndex: 14, overscan: 2, count: 600 };
  // A stand-in base extractor: the plain visible window 10..14.
  const base = (r: Range) => [10, 11, 12, 13, 14].filter((i) => i <= r.endIndex);

  it("force-includes a focused index that sits OUTSIDE the base window", () => {
    const out = pinFocusedIndex(range, 3, base);
    expect(out).toContain(3);
  });

  it("returns a sorted, de-duplicated ascending index list", () => {
    const out = pinFocusedIndex(range, 3, base);
    expect(out).toEqual([...out].sort((a, b) => a - b));
    expect(new Set(out).size).toBe(out.length);
  });

  it("[R2] does NOT alter the window when focus is null (pin dropped when focus moves away)", () => {
    const out = pinFocusedIndex(range, null, base);
    expect(out).toEqual(base(range));
  });

  it("[R2] is a no-op when the focused index is already inside the window", () => {
    const out = pinFocusedIndex(range, 12, base);
    expect(out).toEqual(base(range));
  });

  it("ignores an out-of-bounds focused index (>= count or < 0)", () => {
    expect(pinFocusedIndex(range, 999, base)).toEqual(base(range));
    expect(pinFocusedIndex(range, -1, base)).toEqual(base(range));
  });
});

describe("clampScrollIndex [R4]", () => {
  it("passes an in-range index through unchanged", () => {
    expect(clampScrollIndex(42, 600)).toBe(42);
  });

  it("clamps a negative index up to 0", () => {
    expect(clampScrollIndex(-5, 600)).toBe(0);
  });

  it("clamps an over-count index down to the last row", () => {
    expect(clampScrollIndex(1000, 600)).toBe(599);
  });

  it("returns 0 for an empty list rather than -1", () => {
    expect(clampScrollIndex(3, 0)).toBe(0);
  });
});

describe("techniqueASegments [R4] Technique A", () => {
  it("returns an empty list for no virtual items", () => {
    expect(techniqueASegments([], 0)).toEqual([]);
  });

  it("emits only rows when the window is the whole list (no spacers)", () => {
    // Contiguous window from 0 to the end: total exactly covered by rows.
    const items = [vi(0, 0, 57), vi(1, 57, 57), vi(2, 114, 57)];
    expect(techniqueASegments(items, 171)).toEqual([
      { type: "row", index: 0 },
      { type: "row", index: 1 },
      { type: "row", index: 2 },
    ]);
  });

  it("reserves a leading (top) gap before the first windowed row", () => {
    // Window starts at index 5 (start 285). The 285px above must be reserved.
    const items = [vi(5, 285, 57), vi(6, 342, 57)];
    expect(techniqueASegments(items, 570)).toEqual([
      { type: "spacer", key: "top", height: 285 },
      { type: "row", index: 5 },
      { type: "row", index: 6 },
      { type: "spacer", key: "bottom", height: 570 - 399 },
    ]);
  });

  it("reserves the INTER-SEGMENT gap when the focus pin makes the window non-contiguous", () => {
    // The [R2] pin force-includes row 0 while the natural window sits at rows 490..491. Without a
    // per-gap spacer the ~27,873px between row 0 (end 57) and row 490 (start 27,930) collapses.
    const items = [vi(0, 0, 57), vi(490, 27_930, 57), vi(491, 27_987, 57)];
    const total = 520 * 57; // 29,640
    expect(techniqueASegments(items, total)).toEqual([
      { type: "row", index: 0 },
      { type: "spacer", key: "gap-0", height: 27_930 - 57 },
      { type: "row", index: 490 },
      { type: "row", index: 491 },
      { type: "spacer", key: "bottom", height: total - (27_987 + 57) },
    ]);
  });

  it("reserves the sum of all gaps exactly (heights + rows == totalSize)", () => {
    const items = [vi(0, 0, 57), vi(300, 17_100, 57), vi(301, 17_157, 57)];
    const total = 520 * 57;
    const segments = techniqueASegments(items, total);
    const spacerPx = segments
      .filter((s): s is { type: "spacer"; key: string; height: number } => s.type === "spacer")
      .reduce((sum, s) => sum + s.height, 0);
    const rowPx = segments.filter((s) => s.type === "row").length * 57;
    expect(spacerPx + rowPx).toBe(total);
  });

  it("clamps every spacer height to >= 0 (no negative pad at a partial edge, [R4])", () => {
    // A last item whose end overshoots totalSize (measurement jitter) must not emit a negative bottom
    // spacer; it is dropped (height 0 → omitted).
    const items = [vi(0, 0, 57), vi(1, 57, 57)];
    const segments = techniqueASegments(items, 100); // last.end (114) > total (100)
    for (const s of segments) {
      if (s.type === "spacer") expect(s.height).toBeGreaterThan(0);
    }
    // No bottom spacer at all (its clamped height would be 0).
    expect(segments.some((s) => s.type === "spacer" && s.key === "bottom")).toBe(false);
  });
});
