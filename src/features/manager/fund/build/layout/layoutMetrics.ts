/**
 * @id PP-MGR-LIB-096
 * @name layoutMetrics
 * @implements-rules-version v2 (POO-2345), rules v1 (POO-2348)
 * @analytics-events none, a pure measuring module: nothing here is rendered or tracked.
 *
 * Counts how well the lines of a {@link GraphLayout} are routed. It reads `layout.edges` and
 * `layout.bridges` (the Bridges tell which lines pass the same Bridge). Each edge is one straight,
 * orthogonal segment.
 *
 * - A LINE is one leg: the segments that share an edge id before the `:leg:<n>` suffix. A segment
 *   with no suffix is a line of its own (a stub, a bus, a link).
 * - A CROSSING is a place where the interiors of two segments of different lines meet. An end of
 *   one segment on another segment is a join. A join is not a crossing. Template edges are skipped.
 * - An OVERLAP is a length above 0 that two collinear segments share. The segments can belong to
 *   two lines or to one line that folds back on itself. It is reported apart from the crossings.
 *   One exception: the last verticals of two lines of the same kind that reach the same end point
 *   from the same side are one trunk (rule R7). A trunk is not an overlap.
 * - A BEND is a point where two consecutive segments of the same line meet and change direction.
 *   A turn of 90 degrees is one bend. A reversal on the same axis is a U-turn and counts as two.
 * - The MINIMUM GAP is the least distance between two parallel segments of different lines that
 *   overlap when projected on their axis. A trunk does not count. A shared length that is not a
 *   trunk is a gap of 0. The gap does not measure two segments that meet at a right angle (a
 *   near miss between a horizontal and a vertical), and it does not measure two collinear
 *   segments that end one after the other with a space between them.
 *
 * - A GROUP INTRUSION (rules v1, R3) is a segment that enters the box of a spoke group that is not
 *   its source or its target. The metric finds the owner network of a segment from its edge id and
 *   the blocks of the layout. A segment enters a box when it runs through the open inside of the
 *   box, with a length above 0. A segment that only touches the border is not inside. An edge
 *   with no owner network (a merge, an output, a spine edge) is not in any box, so each box is
 *   foreign to it. A hub chain has the hub as its owner, and the hub has no box.
 *
 * - A FORCED CROSSING (rules v2, R2 and R8) is a crossing of an income line and a principal line
 *   whose full paths start in one order and end in the opposite order. The principal leaves the
 *   last position on the side. The income leaves the fee swap at the centre. They end at Idle
 *   output and at Income. Return geometry R2 forces that inversion, so the crossing stays. Two
 *   lines that pass the same return Bridge are not forced: the Bridge swaps them where no line is
 *   drawn (rule R4).
 *
 * Same input, same output: no DOM, no React, no clock, no randomness.
 */

import type { EdgeKind, EdgeNode, GraphLayout, Point, Rect } from "./graphTypes";

export interface LayoutMetrics {
  crossings: number;
  overlaps: number;
  /** The sum of the bends of every line. */
  totalBends: number;
  /** The most bends in one visible line (one leg). */
  maxBendsPerLeg: number;
  /** The least distance between parallel segments of different lines, or Infinity if none. */
  minGap: number;
  /** The segments that enter the box of a group that is not their source or target (R3). */
  groupIntrusions: number;
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

/** The sign of the travel of a segment along its axis: 1 for up or right, -1 for the other. */
function direction(s: Segment): number {
  return Math.sign(s.horizontal ? s.b.x - s.a.x : s.b.y - s.a.y);
}

/**
 * True for the trunk of rule R7: the last segments of two lines of one kind. Both are verticals
 * that reach the same end point (the same port of the same node) from the same side.
 */
function sameTrunk(p: Segment, q: Segment): boolean {
  return (
    p.last &&
    q.last &&
    !p.horizontal &&
    !q.horizontal &&
    p.edge.kind === q.edge.kind &&
    near(p.b.x, q.b.x) &&
    near(p.b.y, q.b.y) &&
    direction(p) === direction(q)
  );
}

/** The bends between two consecutive segments: 1 for a turn, 2 for a reversal on one axis. */
function bendsBetween(p: Segment, q: Segment): number {
  if (p.horizontal !== q.horizontal) return 1;
  return direction(p) !== 0 && direction(q) !== 0 && direction(p) !== direction(q) ? 2 : 0;
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
      const before = ordered[i - 1];
      const after = ordered[i];
      if (before && after) count += bendsBetween(before, after);
    }
    bends.set(line, count);
  }
  return bends;
}

type Pair = [string, string];

/** The length two parallel segments share when projected on their axis, or 0. */
function projectedLength(p: Segment, q: Segment): number {
  if (p.horizontal !== q.horizontal) return 0;
  const [p0, p1] = span(p);
  const [q0, q1] = span(q);
  return Math.max(0, Math.min(p1, q1) - Math.max(p0, q0));
}

interface Conflicts {
  crossings: Pair[];
  overlaps: Pair[];
  /** The least gap between parallel segments of different lines, or Infinity. */
  minGap: number;
}

/** The pairs of segments that cross, the pairs that overlap and the least parallel gap. */
function conflicts(segments: Segment[]): Conflicts {
  const crossings: Pair[] = [];
  const overlaps: Pair[] = [];
  let minGap = Number.POSITIVE_INFINITY;
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const p = segments[i];
      const q = segments[j];
      if (!p || !q) continue;
      if (p.line === q.line) {
        // A line that shares a length with itself folds back on itself: it is an overlap.
        if (sharedLength(p, q) > EPSILON) overlaps.push([p.edge.id, q.edge.id]);
        continue;
      }
      if (p.horizontal !== q.horizontal) {
        if (cross(p.horizontal ? p : q, p.horizontal ? q : p))
          crossings.push([p.edge.id, q.edge.id]);
      } else if (projectedLength(p, q) > EPSILON && !sameTrunk(p, q)) {
        minGap = Math.min(minGap, Math.abs(fixed(p) - fixed(q)));
        if (sharedLength(p, q) > EPSILON) overlaps.push([p.edge.id, q.edge.id]);
      }
    }
  }
  return { crossings, overlaps, minGap };
}

/** The pairs of edge ids behind the counts, for a test message that names the segments. */
export function findConflicts(layout: GraphLayout): { crossings: Pair[]; overlaps: Pair[] } {
  const { crossings, overlaps } = conflicts(segmentsOf(layout));
  return { crossings, overlaps };
}

const CHAIN_OWNED = /^(?:principal:(?:chain|returned|conversion)|stub:chain):(.+)$/;
const BLOCK_OWNED = /^(?:income:(?:block|converted|returned)|link):(.+)$/;
const NETWORK_OWNED = /^(?:stub:spoke|bus:spoke|idle:spoke|template:addProtocol|bridge):(.+)$/;

/** The network that owns an edge (its source group), or null when no spoke group owns it. */
function ownerNetwork(layout: GraphLayout, id: string): string | null {
  const base = lineOf(id).line;
  const chain = CHAIN_OWNED.exec(base)?.[1];
  if (chain !== undefined)
    return layout.blocks.find((b) => b.chainId === chain || b.id === chain)?.network ?? null;
  const block = BLOCK_OWNED.exec(base)?.[1];
  if (block !== undefined)
    return layout.blocks.find((b) => b.id === block || b.chainId === block)?.network ?? null;
  return NETWORK_OWNED.exec(base)?.[1] ?? null;
}

/** True when a segment runs through the open inside of a box, over a length above 0. */
function entersBox(s: Segment, box: Rect): boolean {
  const left = box.x + EPSILON;
  const right = box.x + box.w - EPSILON;
  const top = box.y + EPSILON;
  const bottom = box.y + box.h - EPSILON;
  const [from, to] = span(s);
  const at = fixed(s);
  return s.horizontal
    ? at > top && at < bottom && Math.min(to, right) - Math.max(from, left) > EPSILON
    : at > left && at < right && Math.min(to, bottom) - Math.max(from, top) > EPSILON;
}

/** The ids of the segments that enter a group box that is not their source or target (R3). */
export function findGroupIntrusions(layout: GraphLayout): string[] {
  const found: string[] = [];
  for (const s of segmentsOf(layout)) {
    const owner = ownerNetwork(layout, s.edge.id);
    if (layout.groups.some((g) => g.network !== owner && entersBox(s, g.rect)))
      found.push(s.edge.id);
  }
  return found;
}

/** Crossings, overlaps, bends, the least parallel gap and the group intrusions of a layout. */
export function measureLayout(layout: GraphLayout): LayoutMetrics {
  const segments = segmentsOf(layout);
  const found = conflicts(segments);
  const bends = [...bendsByLine(segments).values()];
  return {
    crossings: found.crossings.length,
    overlaps: found.overlaps.length,
    totalBends: bends.reduce((sum, n) => sum + n, 0),
    maxBendsPerLeg: bends.reduce((max, n) => Math.max(max, n), 0),
    minGap: found.minGap,
    groupIntrusions: findGroupIntrusions(layout).length,
  };
}

/** A family is every route of one chain and one class: its parts join at a Bridge or a swap. */
interface Family {
  kind: EdgeKind;
  /** Where the family starts, and where it ends, over every route of the family. */
  start: Point;
  end: Point;
  /** The index of the Bridge that the family passes, or -1 when it passes none. */
  bridge: number;
}

const STAGES = ["block", "chain", "converted", "returned"] as const;
const STAGE_ORDER: Record<(typeof STAGES)[number], number> = {
  block: 0,
  chain: 0,
  converted: 1,
  returned: 2,
};

/** `principal:chain:x` has the family `principal:x` and the stage `chain`; other ids have none. */
function familyOf(line: string): { key: string; stage: (typeof STAGES)[number] } | null {
  const [kind, stage, ...rest] = line.split(":");
  if ((kind !== "principal" && kind !== "income") || rest.length === 0) return null;
  const known = STAGES.find((name) => name === stage);
  return known ? { key: `${kind}:${rest.join(":")}`, stage: known } : null;
}

function isInside(p: Point, rect: Rect): boolean {
  return p.x >= rect.x - EPSILON && p.x <= rect.x + rect.w + EPSILON && near(p.y, rect.y);
}

/** The families of a layout, by key. A family has the full path of the chain and its class. */
function familiesOf(layout: GraphLayout, segments: Segment[]): Map<string, Family> {
  const staged = new Map<string, Map<number, Segment[]>>();
  for (const s of segments) {
    const family = familyOf(s.line);
    if (!family) continue;
    const stages = staged.get(family.key) ?? new Map<number, Segment[]>();
    const rank = STAGE_ORDER[family.stage];
    stages.set(rank, [...(stages.get(rank) ?? []), s]);
    staged.set(family.key, stages);
  }
  const families = new Map<string, Family>();
  for (const [key, stages] of staged) {
    const ranks = [...stages.keys()].sort((p, q) => p - q);
    const first = (stages.get(ranks[0] ?? 0) ?? []).find((s) => s.order === 0);
    const lastParts = stages.get(ranks[ranks.length - 1] ?? 0) ?? [];
    const last = lastParts.find((s) => s.last);
    if (!first || !last) continue;
    const returned = stages.get(2);
    const entry = (stages.get(1) ?? stages.get(0) ?? []).find((s) => s.last);
    const bridgeEntry = returned && entry ? entry.b : null;
    families.set(key, {
      kind: first.edge.kind,
      start: first.a,
      end: last.b,
      bridge: bridgeEntry
        ? layout.bridges.findIndex((bridge) => isInside(bridgeEntry, bridge.rect))
        : -1,
    });
  }
  return families;
}

/** The family key of an edge id, or null when the edge is not a return route. */
function familyKeyOf(id: string): string | null {
  return familyOf(lineOf(id).line)?.key ?? null;
}

/**
 * True when two families must cross by rule R2: one is income, the other is principal, their full
 * paths start in one order and end in the opposite order, and they do not pass the same Bridge.
 */
function forcedBetween(a: Family, b: Family): boolean {
  if (a.kind === b.kind) return false;
  if (a.bridge >= 0 && a.bridge === b.bridge) return false;
  const income = a.kind === "income" ? a : b;
  const principal = a.kind === "income" ? b : a;
  const began = Math.sign(income.start.x - principal.start.x);
  const ended = Math.sign(income.end.x - principal.end.x);
  return began !== 0 && ended !== 0 && began !== ended;
}

function forcedPair(families: Map<string, Family>, pair: Pair): boolean {
  const first = familyKeyOf(pair[0]);
  const second = familyKeyOf(pair[1]);
  const a = first ? families.get(first) : undefined;
  const b = second ? families.get(second) : undefined;
  return a !== undefined && b !== undefined && forcedBetween(a, b);
}

/**
 * The least number of crossings of a layout. Each pair of an income family and a principal family
 * that start in one order, end in the opposite order and pass no common Bridge must cross at
 * least once, whatever the lanes are. The bound reads the start and end of each family only. It
 * does not read the lanes, so a routing cannot raise it.
 */
export function crossingLowerBound(layout: GraphLayout): number {
  const families = [...familiesOf(layout, segmentsOf(layout)).values()];
  let bound = 0;
  for (let i = 0; i < families.length; i += 1)
    for (let j = i + 1; j < families.length; j += 1) {
      const a = families[i];
      const b = families[j];
      if (a && b && forcedBetween(a, b)) bound += 1;
    }
  return bound;
}

/** The crossings of a layout, apart: the ones that R2 forces, and the rest. */
export function classifyCrossings(layout: GraphLayout): { forced: Pair[]; unforced: Pair[] } {
  const segments = segmentsOf(layout);
  const families = familiesOf(layout, segments);
  const forced: Pair[] = [];
  const unforced: Pair[] = [];
  for (const pair of conflicts(segments).crossings)
    (forcedPair(families, pair) ? forced : unforced).push(pair);
  return { forced, unforced };
}
