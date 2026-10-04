/**
 * @id PP-MGR-LIB-023
 * @name layoutTestKit
 * @implements-rules-version v1 (POO-2153 rules v1)
 * @analytics-events none, test support: it reads layouts and emits nothing.
 *
 * TEST SUPPORT for the layout tests (and for the Figma parity checks of S8): it reads a
 * {@link GraphLayout} back in the units the handoff and the Figma frames use, so an oracle row can be
 * copied from either source without arithmetic. Nothing in the app imports this file.
 *
 * Conventions (handoff v1.2, rule L10): a vertical line is 1.5 wide and centred on its x; a
 * horizontal line's y is its TOP edge. `EdgeNode.points` are the stroke's centre line, so the
 * horizontal run drawn at handoff y has points at y + 0.75. Figma draws every segment as a 1.5 px
 * rectangle: {@link edgeAsFigmaRect} turns a layout segment into that rectangle.
 */
import type { EdgeKind, EdgeNode, GraphLayout, Point, Rect, ShareLabelNode } from "./graphTypes";
import { targetKey } from "./graphTypes";
import { LAYOUT } from "./layoutConstants";

const HALF = LAYOUT.LINE_W / 2;

/** A segment as Figma draws it: [kind, x, y, w, h] of its 1.5 px rectangle. */
export type FigmaEdge = [kind: EdgeKind, x: number, y: number, w: number, h: number];

/** One-letter kinds for compact oracle tables. */
export const K = { S: "structural", T: "template", P: "principal", I: "income" } as const;

/** The two ends of a segment, or a throw when the edge is not one orthogonal segment. */
function ends(edge: EdgeNode): [Point, Point] {
  const [a, b, ...rest] = edge.points;
  if (!a || !b || rest.length > 0) throw new Error(`${edge.id} is not a single segment`);
  if (a.x !== b.x && a.y !== b.y) throw new Error(`${edge.id} is not orthogonal`);
  return [a, b];
}

/** A layout segment as the 1.5 px rectangle Figma draws for it. */
export function edgeAsFigmaRect(edge: EdgeNode): FigmaEdge {
  const [a, b] = ends(edge);
  if (a.x === b.x) {
    const top = Math.min(a.y, b.y);
    return [edge.kind, a.x - HALF, top, LAYOUT.LINE_W, Math.abs(b.y - a.y)];
  }
  const left = Math.min(a.x, b.x);
  return [edge.kind, left, a.y - HALF, Math.abs(b.x - a.x), LAYOUT.LINE_W];
}

/** Every edge of a layout as Figma rectangles, sorted, for a multiset comparison. */
export function figmaEdges(layout: GraphLayout): FigmaEdge[] {
  return sortEdges(layout.edges.map(edgeAsFigmaRect));
}

export function sortEdges(edges: FigmaEdge[]): FigmaEdge[] {
  return [...edges].sort((p, q) => {
    for (let i = 0; i < p.length; i += 1) {
      const a = p[i] as string | number;
      const b = q[i] as string | number;
      if (a < b) return -1;
      if (a > b) return 1;
    }
    return 0;
  });
}

/** Every box of a layout by a readable key: spine role, block id, "bridge:<network>",
 *  "group:<network>", or the template's {@link targetKey}. */
export function nodeRects(layout: GraphLayout): Record<string, Rect> {
  const out: Record<string, Rect> = {};
  const put = (key: string, rect: Rect) => {
    if (key in out) throw new Error(`duplicate node key ${key}`);
    out[key] = rect;
  };
  for (const n of layout.spine) put(n.role, n.rect);
  for (const n of layout.blocks) put(n.id, n.rect);
  for (const n of layout.bridges) put(`bridge:${n.network}`, n.rect);
  for (const n of layout.groups) put(`group:${n.network}`, n.rect);
  for (const n of layout.templates) put(targetKey(n.target), n.rect);
  return out;
}

/** A share label by a readable key: its chain id, or "spoke:<network>" for a spoke's label. */
export function labelKey(label: ShareLabelNode): string {
  return label.target.chainId ?? `spoke:${label.target.network}`;
}

/** The merged horizontal runs of one kind drawn at handoff y (top edge), left to right. */
export function horizontalRuns(
  layout: GraphLayout,
  kind: EdgeKind,
  handoffY: number,
): Array<[number, number]> {
  const runs = layout.edges
    .filter((e) => e.kind === kind)
    .map(ends)
    .filter(([a, b]) => a.y === b.y && a.y === handoffY + HALF)
    .map(([a, b]): [number, number] => [Math.min(a.x, b.x), Math.max(a.x, b.x)])
    .sort((p, q) => p[0] - q[0]);
  const merged: Array<[number, number]> = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && run[0] <= last[1]) last[1] = Math.max(last[1], run[1]);
    else merged.push([run[0], run[1]]);
  }
  return merged;
}

/** The vertical segments of one kind at x, as [top, bottom]. */
export function verticalsAt(
  layout: GraphLayout,
  kind: EdgeKind,
  x: number,
): Array<[number, number]> {
  return layout.edges
    .filter((e) => e.kind === kind)
    .map(ends)
    .filter(([a, b]) => a.x === b.x && a.x === x)
    .map(([a, b]): [number, number] => [Math.min(a.y, b.y), Math.max(a.y, b.y)])
    .sort((p, q) => p[0] - q[0]);
}

/** The x of every vertical segment of one kind, sorted and unique. */
export function verticalXs(layout: GraphLayout, kind: EdgeKind): number[] {
  const xs = layout.edges
    .filter((e) => e.kind === kind)
    .map(ends)
    .filter(([a, b]) => a.x === b.x)
    .map(([a]) => a.x);
  return [...new Set(xs)].sort((p, q) => p - q);
}

/** A rect as [x, y, w, h], for compact oracle tables. */
export function box(rect: Rect | undefined): [number, number, number, number] | undefined {
  return rect ? [rect.x, rect.y, rect.w, rect.h] : undefined;
}
