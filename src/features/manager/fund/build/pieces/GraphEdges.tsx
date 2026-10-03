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
 * stroke along the points with no offset of its own. Butt caps and mitred joins: a line ends where
 * the layout ends it, and a corner is square, as the drawings' rectangles are.
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

/** The lines of the graph. */
export function GraphEdges({
  width,
  height,
  edges,
  highlightedId,
  onEdgeHoverChange,
}: GraphEdgesProps) {
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
            points={pointsOf(edge.points)}
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
              points={pointsOf(edge.points)}
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
