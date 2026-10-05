/**
 * @id PP-MGR-CMP-054
 * @name GraphEdges tests
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a presentational piece; the Build screen (PP-MGR-SCR-002, S7) owns every
 *   event
 *
 * The lines of the Build canvas (handoff v1.2 [BB8], [C9], [C10]): principal, income, a crossing and
 * a highlighted edge. One SVG, hidden from assistive technology, canvas background. The points are
 * the centre line of the stroke and are drawn exactly as given (S3 does the 0.75 conversion).
 */
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CANVAS_INTERACTIVE_ATTR, isCanvasBackground } from "../canvas/useCanvasViewport";
import { GraphEdges } from "./GraphEdges";
import type { PieceEdge } from "./pieceTypes";

/** Worked example 1 (canvas C): the pool chain's principal drop and its income drop. */
const PRINCIPAL: PieceEdge = {
  id: "principal:pool",
  tone: "muted",
  points: [
    { x: 100, y: 406 },
    { x: 100, y: 430.75 },
    { x: 170, y: 430.75 },
    { x: 170, y: 478 },
  ],
};
const INCOME: PieceEdge = {
  id: "income:pool",
  tone: "income",
  points: [
    { x: 124, y: 406 },
    { x: 124, y: 454.75 },
    { x: 438, y: 454.75 },
    { x: 438, y: 478 },
  ],
};
/** The Aave chain's principal: crosses the income line at x 320. */
const CROSSING: PieceEdge = {
  id: "principal:supply",
  tone: "muted",
  points: [
    { x: 320, y: 306 },
    { x: 320, y: 430.75 },
    { x: 170, y: 430.75 },
  ],
};

function lineOf(container: HTMLElement, id: string): SVGPolylineElement {
  const line = container.querySelector<SVGPolylineElement>(`polyline[data-edge-id="${id}"]`);
  if (!line) throw new Error(`no edge ${id}`);
  return line;
}

describe("GraphEdges", () => {
  // @rule BB8
  it("[BB8] one SVG of the graph's size, hidden from assistive technology", () => {
    const { container } = render(
      <GraphEdges width={608} height={674} edges={[PRINCIPAL]} highlightedId={null} />,
    );

    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "608");
    expect(svg).toHaveAttribute("height", "674");
    expect(svg).toHaveAttribute("viewBox", "0 0 608 674");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
  });

  // @rule BB8
  it("[BB8] a principal line: 1.5 px in muted-foreground along exactly the points given", () => {
    const { container } = render(
      <GraphEdges width={608} height={674} edges={[PRINCIPAL]} highlightedId={null} />,
    );

    const line = lineOf(container, "principal:pool");
    expect(line).toHaveAttribute("points", "100,406 100,430.75 170,430.75 170,478");
    expect(line).toHaveAttribute("stroke-width", "1.5");
    expect(line).toHaveAttribute("stroke", "currentColor");
    expect(line).toHaveAttribute("fill", "none");
    expect(line).toHaveAttribute("stroke-linejoin", "miter");
    expect(line).toHaveAttribute("stroke-linecap", "butt");
    expect(line.getAttribute("class")).toContain("text-muted-foreground");
  });

  // @rule BB8
  it("[BB8, C10] an income line: 1.5 px in success", () => {
    const { container } = render(
      <GraphEdges width={608} height={674} edges={[INCOME]} highlightedId={null} />,
    );

    const line = lineOf(container, "income:pool");
    expect(line).toHaveAttribute("stroke-width", "1.5");
    expect(line.getAttribute("class")).toContain("text-success");
    expect(line).toHaveAttribute("data-edge-tone", "income");
  });

  // @rule BB8
  it("[BB8] lines that cross simply cross: no junction dot, nothing but the lines", () => {
    const { container } = render(
      <GraphEdges
        width={608}
        height={674}
        edges={[PRINCIPAL, INCOME, CROSSING]}
        highlightedId={null}
      />,
    );

    expect(container.querySelectorAll("polyline")).toHaveLength(3);
    expect(container.querySelectorAll("circle, ellipse, rect, path")).toHaveLength(0);
  });

  // @rule BB8
  it("[BB8] the highlighted edge is 2 px in primary, drawn on top of the others", () => {
    const { container } = render(
      <GraphEdges
        width={608}
        height={674}
        edges={[PRINCIPAL, INCOME, CROSSING]}
        highlightedId="principal:pool"
      />,
    );

    const line = lineOf(container, "principal:pool");
    expect(line).toHaveAttribute("stroke-width", "2");
    expect(line.getAttribute("class")).toContain("text-primary");
    expect(line).toHaveAttribute("data-highlighted", "");
    const lines = container.querySelectorAll("polyline");
    expect(lines[lines.length - 1]).toBe(line);
    expect(lineOf(container, "income:pool")).toHaveAttribute("stroke-width", "1.5");
  });

  // @rule BB8
  it("[BB8] a highlighted income line also turns primary", () => {
    const { container } = render(
      <GraphEdges width={608} height={674} edges={[INCOME]} highlightedId="income:pool" />,
    );

    expect(lineOf(container, "income:pool").getAttribute("class")).toContain("text-primary");
  });

  // @rule BB8
  it("[BB8, F9] an L corner of two lines is closed: both ends at the corner reach half a stroke past it", () => {
    const bus: PieceEdge = {
      id: "bus",
      tone: "muted",
      points: [
        { x: 112, y: 196.75 },
        { x: 552, y: 196.75 },
      ],
    };
    const stub: PieceEdge = {
      id: "stub",
      tone: "muted",
      points: [
        { x: 112, y: 196.75 },
        { x: 112, y: 244 },
      ],
    };
    const { container } = render(
      <GraphEdges width={608} height={674} edges={[bus, stub]} highlightedId={null} />,
    );

    // The corner end moves 0.75 outward along its own segment; the free ends stay where they are.
    expect(lineOf(container, "bus")).toHaveAttribute("points", "111.25,196.75 552,196.75");
    expect(lineOf(container, "stub")).toHaveAttribute("points", "112,196 112,244");
    expect(lineOf(container, "bus")).toHaveAttribute("stroke-linecap", "butt");
  });

  // @rule BB8
  it("[BB8, F9] a line ending on another line's run reaches its far edge, inside that line", () => {
    const run: PieceEdge = {
      id: "run",
      tone: "muted",
      points: [
        { x: 100, y: 430.75 },
        { x: 400, y: 430.75 },
      ],
    };
    const drop: PieceEdge = {
      id: "drop",
      tone: "muted",
      points: [
        { x: 320, y: 306 },
        { x: 320, y: 430.75 },
      ],
    };
    const { container } = render(
      <GraphEdges width={608} height={674} edges={[run, drop]} highlightedId={null} />,
    );

    expect(lineOf(container, "drop")).toHaveAttribute("points", "320,306 320,431.5");
    expect(lineOf(container, "run")).toHaveAttribute("points", "100,430.75 400,430.75");
  });

  // @rule BB8
  it("[BB8, F9] an end at a node touches no other line: it stays put and never pokes past the node", () => {
    const { container } = render(
      <GraphEdges width={608} height={674} edges={[PRINCIPAL, INCOME]} highlightedId={null} />,
    );

    expect(lineOf(container, "principal:pool")).toHaveAttribute(
      "points",
      "100,406 100,430.75 170,430.75 170,478",
    );
    expect(lineOf(container, "income:pool")).toHaveAttribute(
      "points",
      "124,406 124,454.75 438,454.75 438,478",
    );
  });

  // @rule I9
  it("[I9] colour changes respect reduced motion", () => {
    const { container } = render(
      <GraphEdges width={608} height={674} edges={[PRINCIPAL]} highlightedId={null} />,
    );

    expect(lineOf(container, "principal:pool").getAttribute("class")).toContain(
      "motion-reduce:transition-none",
    );
  });

  // @rule Interactive elements
  it("[Interactive elements] the SVG of lines is canvas background: a press on a line pans", () => {
    const { container } = render(
      <div data-canvas-layer="">
        <GraphEdges width={608} height={674} edges={[PRINCIPAL]} highlightedId={null} />
      </div>,
    );

    const svg = container.querySelector("svg");
    expect(svg).not.toHaveAttribute(CANVAS_INTERACTIVE_ATTR);
    expect(isCanvasBackground(lineOf(container, "principal:pool"), container)).toBe(true);
    expect(svg?.getAttribute("class")).toContain("pointer-events-none");
  });

  // @rule BB8
  it("[BB8] reports the hovered edge through wide invisible hit lines, when asked", () => {
    const onEdgeHoverChange = vi.fn();
    const { container } = render(
      <GraphEdges
        width={608}
        height={674}
        edges={[PRINCIPAL, INCOME]}
        highlightedId={null}
        onEdgeHoverChange={onEdgeHoverChange}
      />,
    );

    const hit = container.querySelector<SVGPolylineElement>('[data-edge-hit="income:pool"]');
    expect(hit).not.toBeNull();
    expect(hit).toHaveAttribute("points", "124,406 124,454.75 438,454.75 438,478");
    expect(hit).toHaveAttribute("stroke", "transparent");
    expect(hit?.style.pointerEvents).toBe("stroke");
    if (!hit) return;
    fireEvent.pointerEnter(hit);
    fireEvent.pointerLeave(hit);

    expect(onEdgeHoverChange.mock.calls).toEqual([["income:pool"], [null]]);
  });

  // @rule BB8
  it("[BB8] without a hover handler there are no hit lines", () => {
    const { container } = render(
      <GraphEdges width={608} height={674} edges={[PRINCIPAL]} highlightedId={null} />,
    );

    expect(container.querySelector("[data-edge-hit]")).toBeNull();
  });

  // @rule Presentational
  it("[Presentational] renders no string", () => {
    const { container } = render(
      <GraphEdges width={608} height={674} edges={[PRINCIPAL, INCOME]} highlightedId={null} />,
    );

    expect(container.textContent).toBe("");
  });
});

it("highlights the complete clipped connection while retaining neutral resting branches (POO-2235)", () => {
  const resting: PieceEdge[] = [
    {
      id: "bus",
      tone: "muted",
      points: [
        { x: 0, y: 20 },
        { x: 100, y: 20 },
      ],
    },
  ];
  const connection: PieceEdge = {
    id: "branch",
    tone: "muted",
    points: [
      { x: 50, y: 0 },
      { x: 50, y: 20 },
      { x: 0, y: 20 },
      { x: 0, y: 40 },
    ],
  };
  const { container } = render(
    <GraphEdges
      width={100}
      height={40}
      edges={resting}
      connections={[connection]}
      highlightedId="branch"
    />,
  );
  expect(container.querySelector("[data-connection-id=branch]")).toHaveAttribute(
    "points",
    "50,0 50,20 0,20 0,40",
  );
  expect(lineOf(container, "bus")).not.toHaveAttribute("data-highlighted");
});
