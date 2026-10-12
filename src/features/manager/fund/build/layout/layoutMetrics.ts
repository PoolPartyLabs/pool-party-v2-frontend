/**
 * @id PP-MGR-LIB-096
 * @name layoutMetrics
 * @implements-rules-version v1 (POO-2345)
 * @analytics-events none, a pure measuring module: nothing here is rendered or tracked.
 *
 * Counts how well the lines of a {@link GraphLayout} are routed. It reads only `layout.edges`.
 * Each edge is one straight, orthogonal segment.
 *
 * - A LINE is one leg: the segments that share an edge id before the `:leg:<n>` suffix. A segment
 *   with no suffix is a line of its own (a stub, a bus, a link).
 * - A CROSSING is a place where the interiors of two segments of different lines meet. An end of
 *   one segment on another segment is a join. A join is not a crossing. Template edges are skipped.
 * - An OVERLAP is a length above 0 that two collinear segments of different lines share. It is
 *   reported apart from the crossings. One exception: the last segments of two lines of the same
 *   kind that end at the same point are one trunk (rule R7). A trunk is not an overlap.
 * - A BEND is a point where two consecutive segments of the same line meet and change direction.
 *
 * Same input, same output: no DOM, no React, no clock, no randomness.
 */

import type { EdgeNode, GraphLayout, Point } from "./graphTypes";

export interface LayoutMetrics {
  crossings: number;
  overlaps: number;
  /** The sum of the bends of every line. */
  totalBends: number;
  /** The most bends in one visible line (one leg). */
  maxBendsPerLeg: number;
}

/** A segment with its line, in a shape that is easy to compare. */
interface Segment {
  edge: EdgeNode;
  line: string;
  /** Position of the segment inside its line (0 for the first). */
  order: number;
  a: Point;
  b: Point;
  horizontal: boolean;
  /** True when this segment is the last of its line. */
  last: boolean;
}

const LEG = /^(.*):leg:(\d+)$/;
const EPSILON = 1e-6;

function near(p: number, q: number): boolean {
  return Math.abs(p - q) < EPSILON;
}

function lineOf(id: string): { line: string; order: number } {
  const match = LEG.exec(id);
  return match ? { line: match[1] ?? id, order: Number(match[2]) } : { line: id, order: 0 };
}

/** The segments of a layout, template edges left out, each tagged with its line. */
function segmentsOf(layout: GraphLayout): Segment[] {
  const out: Segment[] = [];
  for (const edge of layout.edges) {
    if (edge.kind === "template") continue;
    const [a, b] = edge.points;
    if (!a || !b || edge.points.length !== 2) throw new Error(`${edge.id} is not one segment`);
    const horizontal = near(a.y, b.y);
    if (!horizontal && !near(a.x, b.x)) throw new Error(`${edge.id} is not orthogonal`);
    if (horizontal && near(a.x, b.x)) continue;
    const { line, order } = lineOf(edge.id);
    out.push({ edge, line, order, a, b, horizontal, last: false });
  }
  const lastOrder = new Map<string, number>();
  for (const s of out) lastOrder.set(s.line, Math.max(lastOrder.get(s.line) ?? -1, s.order));
  for (const s of out) s.last = s.order === lastOrder.get(s.line);
  return out;
}

function span(s: Segment): [number, number] {
  return s.horizontal
    ? [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)]
    : [Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y)];
}

/** The fixed coordinate of a segment: y of a horizontal one, x of a vertical one. */
function fixed(s: Segment): number {
  return s.horizontal ? s.a.y : s.a.x;
}

/** True when the interiors of a horizontal and a vertical segment meet. */
function cross(h: Segment, v: Segment): boolean {
  const [x0, x1] = span(h);
  const [y0, y1] = span(v);
  const x = fixed(v);
  const y = fixed(h);
  return x > x0 + EPSILON && x < x1 - EPSILON && y > y0 + EPSILON && y < y1 - EPSILON;
}

/** The length two collinear segments share, or 0. */
function sharedLength(p: Segment, q: Segment): number {
  if (p.horizontal !== q.horizontal || !near(fixed(p), fixed(q))) return 0;
  const [p0, p1] = span(p);
  const [q0, q1] = span(q);
  return Math.max(0, Math.min(p1, q1) - Math.max(p0, q0));
}

function endOf(s: Segment): Point {
  // The end of the last segment is the end that is farther along the line. The line goes from the
  // first point to the second point of each edge, so the end is `b`.
  return s.b;
}

/** Two last segments of the same kind that end at one point are a trunk (rule R7). */
function sameTrunk(p: Segment, q: Segment): boolean {
  return (
    p.last &&
    q.last &&
    p.edge.kind === q.edge.kind &&
    near(endOf(p).x, endOf(q).x) &&
    near(endOf(p).y, endOf(q).y)
  );
}

/** The bends of every line: the direction changes between consecutive segments of one line. */
function bendsByLine(segments: Segment[]): Map<string, number> {
  const lines = new Map<string, Segment[]>();
  for (const s of segments) lines.set(s.line, [...(lines.get(s.line) ?? []), s]);
  const bends = new Map<string, number>();
  for (const [line, list] of lines) {
    const ordered = [...list].sort((p, q) => p.order - q.order);
    let count = 0;
    for (let i = 1; i < ordered.length; i += 1) {
      if (ordered[i - 1]?.horizontal !== ordered[i]?.horizontal) count += 1;
    }
    bends.set(line, count);
  }
  return bends;
}

type Pair = [string, string];

/** The pairs of segments that cross, and the pairs that overlap. */
function conflicts(segments: Segment[]): { crossings: Pair[]; overlaps: Pair[] } {
  const crossings: Pair[] = [];
  const overlaps: Pair[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const p = segments[i];
      const q = segments[j];
      if (!p || !q || p.line === q.line) continue;
      if (p.horizontal !== q.horizontal) {
        if (cross(p.horizontal ? p : q, p.horizontal ? q : p))
          crossings.push([p.edge.id, q.edge.id]);
      } else if (sharedLength(p, q) > EPSILON && !sameTrunk(p, q)) {
        overlaps.push([p.edge.id, q.edge.id]);
      }
    }
  }
  return { crossings, overlaps };
}

/** The pairs of edge ids behind the counts, for a test message that names the segments. */
export function findConflicts(layout: GraphLayout): { crossings: Pair[]; overlaps: Pair[] } {
  return conflicts(segmentsOf(layout));
}

/** Crossings, overlaps and bends of a layout. */
export function measureLayout(layout: GraphLayout): LayoutMetrics {
  const segments = segmentsOf(layout);
  const found = conflicts(segments);
  const bends = [...bendsByLine(segments).values()];
  return {
    crossings: found.crossings.length,
    overlaps: found.overlaps.length,
    totalBends: bends.reduce((sum, n) => sum + n, 0),
    maxBendsPerLeg: bends.reduce((max, n) => Math.max(max, n), 0),
  };
}
