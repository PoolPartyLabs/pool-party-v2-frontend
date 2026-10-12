/**
 * @id PP-MGR-LIB-096
 * @name layoutMetrics tests
 * @implements-rules-version v1 (POO-2345)
 * @analytics-events none, a pure measuring module: nothing here is rendered or tracked.
 *
 * Unit tests of the metric on small hand-built layouts, and the R8 test that records the numbers
 * of every layout fixture.
 */

import { describe, expect, it } from "vitest";
import { BUILD_CANVAS_FIXTURES, solanaTwoChainReturn } from "@/mocks/data/buildCanvasFixtures";
import type { EdgeKind, EdgeNode, GraphLayout, Point } from "./graphTypes";
import { layoutGraph } from "./layoutGraph";
import { findConflicts, type LayoutMetrics, measureLayout } from "./layoutMetrics";

const EN = { startHereWidth: 420 };

function layoutOf(edges: EdgeNode[]): GraphLayout {
  return {
    width: 0,
    height: 0,
    spineCentreX: 0,
    spine: [],
    blocks: [],
    bridges: [],
    groups: [],
    templates: [],
    ports: [],
    shareLabels: [],
    edges,
    emptyCaptions: null,
  };
}

function edge(id: string, kind: EdgeKind, from: [number, number], to: [number, number]): EdgeNode {
  const points: Point[] = [
    { x: from[0], y: from[1] },
    { x: to[0], y: to[1] },
  ];
  return { id, kind, points };
}

describe("measureLayout: crossings", () => {
  it("counts a plus shape as one crossing", () => {
    const layout = layoutOf([
      edge("a", "principal", [0, 50], [100, 50]),
      edge("b", "income", [50, 0], [50, 100]),
    ]);
    expect(measureLayout(layout).crossings).toBe(1);
    expect(findConflicts(layout).crossings).toEqual([["a", "b"]]);
  });

  it("does not count a join (an end on another segment)", () => {
    const layout = layoutOf([
      edge("a", "principal", [0, 50], [100, 50]),
      edge("b", "principal", [50, 50], [50, 100]),
    ]);
    expect(measureLayout(layout)).toMatchObject({ crossings: 0, overlaps: 0 });
  });

  it("does not count a corner that touches", () => {
    const layout = layoutOf([
      edge("a", "income", [0, 0], [100, 0]),
      edge("b", "income", [100, 0], [100, 100]),
    ]);
    expect(measureLayout(layout)).toMatchObject({ crossings: 0, overlaps: 0 });
  });

  it("does not count two segments of the same line", () => {
    const layout = layoutOf([
      edge("a", "principal", [0, 50], [100, 50]),
      edge("a:leg:1", "principal", [50, 0], [50, 100]),
    ]);
    expect(measureLayout(layout).crossings).toBe(0);
  });

  it("skips template edges", () => {
    const layout = layoutOf([
      edge("a", "template", [0, 50], [100, 50]),
      edge("b", "income", [50, 0], [50, 100]),
    ]);
    expect(measureLayout(layout)).toMatchObject({ crossings: 0, overlaps: 0 });
  });

  it("counts structural lines too", () => {
    const layout = layoutOf([
      edge("a", "structural", [0, 50], [100, 50]),
      edge("b", "income", [50, 0], [50, 100]),
    ]);
    expect(measureLayout(layout).crossings).toBe(1);
  });
});

describe("measureLayout: overlaps", () => {
  it("reports two collinear segments that share a length", () => {
    const layout = layoutOf([
      edge("a", "principal", [0, 50], [100, 50]),
      edge("b", "principal", [60, 50], [200, 50]),
    ]);
    expect(measureLayout(layout)).toMatchObject({ crossings: 0, overlaps: 1 });
    expect(findConflicts(layout).overlaps).toEqual([["a", "b"]]);
  });

  it("does not report collinear segments that only touch", () => {
    const layout = layoutOf([
      edge("a", "principal", [0, 50], [100, 50]),
      edge("b", "principal", [100, 50], [200, 50]),
    ]);
    expect(measureLayout(layout).overlaps).toBe(0);
  });

  it("does not report parallel segments on different rows", () => {
    const layout = layoutOf([
      edge("a", "principal", [0, 50], [100, 50]),
      edge("b", "principal", [0, 60], [100, 60]),
    ]);
    expect(measureLayout(layout).overlaps).toBe(0);
  });

  it("does not report a trunk: last segments of one kind that end at one point", () => {
    const layout = layoutOf([
      edge("a", "principal", [10, 0], [10, 100]),
      edge("b", "principal", [10, 40], [10, 100]),
    ]);
    expect(measureLayout(layout).overlaps).toBe(0);
  });

  it("reports a shared length that is not a trunk: the lines end at two points", () => {
    const layout = layoutOf([
      edge("a", "principal", [10, 0], [10, 100]),
      edge("b", "principal", [10, 40], [10, 140]),
    ]);
    expect(measureLayout(layout).overlaps).toBe(1);
  });

  it("reports a shared length of two kinds even when they end at one point", () => {
    const layout = layoutOf([
      edge("a", "principal", [10, 0], [10, 100]),
      edge("b", "income", [10, 40], [10, 100]),
    ]);
    expect(measureLayout(layout).overlaps).toBe(1);
  });

  it("reports a shared length when only one segment is the last of its line", () => {
    const layout = layoutOf([
      edge("a", "principal", [10, 0], [10, 100]),
      edge("b", "principal", [10, 40], [10, 100]),
      edge("b:leg:1", "principal", [10, 100], [60, 100]),
    ]);
    expect(measureLayout(layout).overlaps).toBe(1);
  });
});

describe("measureLayout: bends", () => {
  it("counts the direction changes of one line", () => {
    const layout = layoutOf([
      edge("a", "principal", [0, 0], [50, 0]),
      edge("a:leg:1", "principal", [50, 0], [50, 80]),
      edge("a:leg:2", "principal", [50, 80], [120, 80]),
      edge("a:leg:3", "principal", [120, 80], [120, 140]),
    ]);
    expect(measureLayout(layout)).toMatchObject({ totalBends: 3, maxBendsPerLeg: 3 });
  });

  it("gives 0 bends to a straight line", () => {
    const layout = layoutOf([edge("a", "income", [30, 0], [30, 120])]);
    expect(measureLayout(layout)).toMatchObject({ totalBends: 0, maxBendsPerLeg: 0 });
  });

  it("sums the bends of every line and keeps the largest of one line", () => {
    const layout = layoutOf([
      edge("a", "principal", [0, 0], [0, 30]),
      edge("a:leg:1", "principal", [0, 30], [40, 30]),
      edge("a:leg:2", "principal", [40, 30], [40, 90]),
      edge("b", "income", [200, 0], [200, 30]),
      edge("b:leg:1", "income", [200, 30], [240, 30]),
    ]);
    expect(measureLayout(layout)).toMatchObject({ totalBends: 3, maxBendsPerLeg: 2 });
  });

  it("does not count a bend where a line only continues in a straight direction", () => {
    const layout = layoutOf([
      edge("a", "income", [0, 0], [0, 30]),
      edge("a:leg:1", "income", [0, 30], [0, 90]),
    ]);
    expect(measureLayout(layout).totalBends).toBe(0);
  });
});

describe("measureLayout: input checks", () => {
  it("throws on a segment that is not orthogonal", () => {
    const layout = layoutOf([edge("a", "income", [0, 0], [10, 10])]);
    expect(() => measureLayout(layout)).toThrow("not orthogonal");
  });

  it("throws on an edge with more than two points", () => {
    const bad: EdgeNode = {
      id: "a",
      kind: "income",
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 10 },
      ],
    };
    expect(() => measureLayout(layoutOf([bad]))).toThrow("not one segment");
  });

  it("is a pure function: same layout, same numbers", () => {
    const layout = layoutGraph(solanaTwoChainReturn.input, EN);
    expect(measureLayout(layout)).toEqual(measureLayout(layout));
  });
});

/**
 * @rule R8
 * The numbers of every layout fixture. They are the BASELINE on the base branch (POO-2342, head
 * d69cd06): the routing has not changed yet. A later commit replaces them with the final numbers.
 */
const FIXTURES = { ...BUILD_CANVAS_FIXTURES, solanaTwoChainReturn } as const;

const BASELINE: Record<keyof typeof FIXTURES, LayoutMetrics> = {
  canvasA: { crossings: 29, overlaps: 22, totalBends: 54, maxBendsPerLeg: 3 },
  canvasB: { crossings: 0, overlaps: 3, totalBends: 16, maxBendsPerLeg: 3 },
  canvasC: { crossings: 2, overlaps: 1, totalBends: 8, maxBendsPerLeg: 3 },
  canvasD: { crossings: 0, overlaps: 0, totalBends: 0, maxBendsPerLeg: 0 },
  workedExample2: { crossings: 5, overlaps: 1, totalBends: 19, maxBendsPerLeg: 3 },
  buildState3: { crossings: 0, overlaps: 0, totalBends: 3, maxBendsPerLeg: 3 },
  buildState5: { crossings: 1, overlaps: 0, totalBends: 5, maxBendsPerLeg: 3 },
  newSpokeNoChain: { crossings: 0, overlaps: 0, totalBends: 3, maxBendsPerLeg: 3 },
  hubEmptyWithSpoke: { crossings: 0, overlaps: 0, totalBends: 5, maxBendsPerLeg: 3 },
  solanaTwoChainReturn: { crossings: 5, overlaps: 1, totalBends: 19, maxBendsPerLeg: 3 },
};

describe("R8: the numbers of each layout fixture", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(`${name} records its baseline numbers`, () => {
      const layout = layoutGraph(fixture.input, EN);
      expect(measureLayout(layout)).toEqual(BASELINE[name as keyof typeof FIXTURES]);
    });
  }
});
