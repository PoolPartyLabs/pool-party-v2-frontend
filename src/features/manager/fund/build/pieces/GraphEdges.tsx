/**
 * @id PP-MGR-CMP-054
 * @name GraphEdges
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a presentational piece; a hover is reported through `onEdgeHoverChange`
 *   and the Build screen (PP-MGR-SCR-002, S7) owns every event
 *
 * Every line of the Build canvas in one SVG of the graph's size (handoff v1.2 [BB8], [C9], [C10]):
 * principal, structural and template lines in `muted-foreground`, income lines in `success`, all at
 * 1.5 px and full opacity. Lines are orthogonal polylines; where two cross they simply cross, with
 * no junction dot. The highlighted edge (its share label or itself is hovered) is 2 px `primary`,
 * drawn last so nothing covers it.
 *
 * The points are the CENTRE line of the stroke (plan section 3.3): the layout (S3) already turned
 * the handoff's top-edge y of a horizontal run into its centre (y + 0.75), so this piece draws the
 * stroke along the points with no offset of its own.
 *
 * Tone (review F9a): a renderer maps the layout's `EdgeNode.kind` to `PieceEdge.tone` as
 * `income` to `"income"` and everything else (`principal`, `structural`, `template`) to `"muted"`.
 *
 * Corners and ends (review F9b). Inside one polyline a corner is a mitred join, so it is square.
 * Where two SEPARATE lines meet (a bus end and the stub that turns down from it, an L), butt caps
 * leave a notch of half the stroke on the outer corner: each line stops at the shared centre point
 * and covers only its own side. Square caps would close it, but they also push every free end
 * 0.75 past where the layout ends it, and the Add protocol circle has no fill, so a stub's end
 * would show inside it. So the caps stay butt and an end is lengthened by half the stroke (0.75)
 * only where it touches another line: at an L that fills the corner exactly, and at a T (a drop
 * that ends on a bus) it reaches the far edge of the bus and stays inside it. An end that touches
 * no other line ends at a node and is drawn exactly where the layout ends it.
 *
 * Decorative: the SVG is `aria-hidden` (I10, lines are hidden from assistive technology) and it is
 * canvas BACKGROUND (no `data-canvas-interactive`): a press on a line pans the canvas.
 *
 * Hover ([BB8]): a 1.5 px line is too thin to point at, so when the renderer passes
 * `onEdgeHoverChange` each edge gets an 8 px transparent hit line on top, which reports the hovered
 * edge and `null` when the pointer leaves. (An addition to plan section 3.4: without it the renderer
 * could not light an edge on hover, and S6 may not edit this folder.)
 */
"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils/cn";
import type { PieceEdge, PiecePoint } from "./pieceTypes";

/** Public props for {@link GraphEdges}. */
export interface GraphEdgesProps {
  /** The graph's size, from the layout (S3). */
  width: number;
  height: number;
  edges: ReadonlyArray<PieceEdge>;
  /** The edge drawn 2 px `primary`, or none. */
  highlightedId: string | null;
  /** Reports the edge under the pointer (its id) and `null` when it leaves. */
  onEdgeHoverChange?(edgeId: string | null): void;
}

/** The SVG `points` attribute of a polyline. */
function pointsOf(points: ReadonlyArray<PiecePoint>): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

const HIT_WIDTH = 8;
/** Half the resting stroke: how far an end that meets another line is lengthened (F9b). */
const HALF_STROKE = 0.75;
/** Coordinates closer than this are the same point (the layout works in quarter pixels). */
const EPSILON = 0.01;

/** Whether point `p` lies on the segment from `a` to `b` (the canvas draws orthogonal runs). */
function onSegment(p: PiecePoint, a: PiecePoint, b: PiecePoint): boolean {
  const withinX = p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON;
  const withinY = p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON;
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  return (
    withinX && withinY && Math.abs(cross) <= EPSILON * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
  );
}

/** Whether `p` lies on any line other than `self`. */
function touchesAnotherLine(p: PiecePoint, self: PieceEdge, edges: ReadonlyArray<PieceEdge>) {
  return edges.some(
    (edge) =>
      edge !== self &&
      edge.points.some((point, index) => {
        const next = edge.points[index + 1];
        return next !== undefined && onSegment(p, point, next);
      }),
  );
}

/** `end` moved HALF_STROKE further along the direction from `inner` to `end`. */
function lengthen(end: PiecePoint, inner: PiecePoint): PiecePoint {
  const dx = end.x - inner.x;
  const dy = end.y - inner.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return end;
  return { x: end.x + (dx / length) * HALF_STROKE, y: end.y + (dy / length) * HALF_STROKE };
}

/** The points to draw for `edge`: its ends lengthened where they meet another line (F9b). */
function drawnPoints(edge: PieceEdge, edges: ReadonlyArray<PieceEdge>): PiecePoint[] {
  const points = [...edge.points];
  const first = points[0];
  const second = points[1];
  const last = points[points.length - 1];
  const beforeLast = points[points.length - 2];
  if (!first || !second || !last || !beforeLast) return points;
  if (touchesAnotherLine(first, edge, edges)) points[0] = lengthen(first, second);
  if (touchesAnotherLine(last, edge, edges)) points[points.length - 1] = lengthen(last, beforeLast);
  return points;
}

/** The lines of the graph. */
export function GraphEdges({
  width,
  height,
  edges,
  highlightedId,
  onEdgeHoverChange,
}: GraphEdgesProps) {
  // The ends that meet another line, closed once per set of edges (not on every hover).
  const drawn = useMemo(
    () => new Map(edges.map((edge) => [edge.id, pointsOf(drawnPoints(edge, edges))])),
    [edges],
  );
  // The highlighted edge last, so it is drawn on top; the others keep their order.
  const ordered = [...edges].sort(
    (a, b) => Number(a.id === highlightedId) - Number(b.id === highlightedId),
  );

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-graph-edges=""
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="pointer-events-none block overflow-visible"
    >
      {ordered.map((edge) => {
        const highlighted = edge.id === highlightedId;
        return (
          <polyline
            key={edge.id}
            data-edge-id={edge.id}
            data-edge-tone={edge.tone}
            data-highlighted={highlighted ? "" : undefined}
            points={drawn.get(edge.id)}
            fill="none"
            stroke="currentColor"
            strokeWidth={highlighted ? 2 : 1.5}
            strokeLinejoin="miter"
            strokeLinecap="butt"
            className={cn(
              "transition-colors motion-reduce:transition-none",
              highlighted
                ? "text-primary"
                : edge.tone === "income"
                  ? "text-success"
                  : "text-muted-foreground",
            )}
          />
        );
      })}
      {onEdgeHoverChange
        ? edges.map((edge) => (
            <polyline
              key={`hit:${edge.id}`}
              data-edge-hit={edge.id}
              points={drawn.get(edge.id)}
              fill="none"
              stroke="transparent"
              strokeWidth={HIT_WIDTH}
              style={{ pointerEvents: "stroke" }}
              onPointerEnter={() => onEdgeHoverChange(edge.id)}
              onPointerLeave={() => onEdgeHoverChange(null)}
            />
          ))
        : null}
    </svg>
  );
}
