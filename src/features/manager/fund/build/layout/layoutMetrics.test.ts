/**
 * @id PP-MGR-LIB-096
 * @name layoutMetrics tests
 * @implements-rules-version v1 (POO-2345), v2 (POO-2345)
 * @analytics-events none, a pure measuring module: nothing here is rendered or tracked.
 *
 * Unit tests of the metric on small hand-built layouts, and the R8 test that records the numbers
 * of every layout fixture.
 */

import { describe, expect, it } from "vitest";
import { BUILD_CANVAS_FIXTURES, solanaTwoChainReturn } from "@/mocks/data/buildCanvasFixtures";
import type { EdgeKind, EdgeNode, GraphLayout, Point } from "./graphTypes";
import { layoutGraph } from "./layoutGraph";
import {
  classifyCrossings,
  findConflicts,
  isForcedCrossing,
  type LayoutMetrics,
  measureLayout,
} from "./layoutMetrics";

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

describe("isForcedCrossing (R2 and R8)", () => {
  const RETURN = ["income:converted:f:leg:1", "principal:chain:p"] as [string, string];

  it("forces a crossing when the income starts left and ends right of the principal", () => {
    // Income: 10 -> 90. Principal: 60 -> 30. The order of the starts is the opposite of the ends.
    const inverted = layoutOf([
      edge("income:converted:f", "income", [10, 0], [10, 40]),
      edge("income:converted:f:leg:1", "income", [10, 40], [90, 40]),
      edge("principal:chain:p", "principal", [60, 0], [60, 80]),
      edge("principal:chain:p:leg:1", "principal", [60, 80], [30, 80]),
    ]);
    expect(isForcedCrossing(inverted, RETURN)).toBe(true);
    expect(isForcedCrossing(inverted, [RETURN[1], RETURN[0]])).toBe(true);
  });

  it("splits the crossings of a layout into forced and unforced", () => {
    const layout = layoutOf([
      edge("income:converted:f", "income", [10, 0], [10, 40]),
      edge("income:converted:f:leg:1", "income", [10, 40], [90, 40]),
      edge("principal:chain:p", "principal", [60, 0], [60, 80]),
      edge("principal:chain:p:leg:1", "principal", [60, 80], [30, 80]),
      edge("income:converted:g", "income", [70, 0], [70, 50]),
    ]);
    expect(classifyCrossings(layout)).toEqual({
      forced: [["income:converted:f:leg:1", "principal:chain:p"]],
      unforced: [["income:converted:f:leg:1", "income:converted:g"]],
    });
  });

  it("does not force a crossing when both lines keep their order", () => {
    // Income: 10 -> 30. Principal: 20 -> 60. The income stays left of the principal.
    const keeps = layoutOf([
      edge("income:converted:f", "income", [10, 0], [10, 40]),
      edge("income:converted:f:leg:1", "income", [10, 40], [30, 40]),
      edge("principal:chain:p", "principal", [20, 0], [20, 80]),
      edge("principal:chain:p:leg:1", "principal", [20, 80], [60, 80]),
    ]);
    expect(isForcedCrossing(keeps, RETURN)).toBe(false);
  });

  it("does not force two lines of the same class", () => {
    const same = layoutOf([
      edge("principal:chain:a", "principal", [10, 0], [10, 40]),
      edge("principal:chain:a:leg:1", "principal", [10, 40], [90, 40]),
      edge("principal:chain:b", "principal", [60, 0], [60, 80]),
      edge("principal:chain:b:leg:1", "principal", [60, 80], [30, 80]),
    ]);
    expect(isForcedCrossing(same, ["principal:chain:a:leg:1", "principal:chain:b"])).toBe(false);
  });

  it("does not force an edge that is not a return route", () => {
    const link = layoutOf([
      edge("link:x", "income", [10, 0], [10, 50]),
      edge("principal:chain:p", "principal", [0, 25], [20, 25]),
    ]);
    expect(isForcedCrossing(link, ["link:x", "principal:chain:p"])).toBe(false);
  });

  /** An income of chain a and a principal of chain b, each through a Bridge (rects at y=10). */
  function throughBridges(principalX: number): GraphLayout {
    const layout = layoutOf([
      edge("income:converted:a", "income", [10, 0], [10, 10]),
      edge("income:returned:a", "income", [100, 20], [100, 60]),
      edge("principal:chain:b", "principal", [principalX, 0], [principalX, 10]),
      edge("principal:returned:b", "principal", [principalX, 20], [principalX, 40]),
      edge("principal:returned:b:leg:1", "principal", [principalX, 40], [30, 40]),
    ]);
    layout.bridges = [
      { network: "n", rect: { x: 0, y: 10, w: 120, h: 10 } },
      { network: "m", rect: { x: 200, y: 10, w: 40, h: 10 } },
    ];
    return layout;
  }

  it("does not force two lines that pass the same Bridge", () => {
    const layout = throughBridges(60);
    expect(isForcedCrossing(layout, ["income:returned:a", "principal:returned:b:leg:1"])).toBe(
      false,
    );
  });

  it("forces the same two lines when they pass two Bridges", () => {
    const layout = throughBridges(210);
    expect(isForcedCrossing(layout, ["income:returned:a", "principal:returned:b:leg:1"])).toBe(
      true,
    );
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
  // Interim form while rules R3 to R7 land one by one: crossings and bends are no worse than the
  // baseline. The lane commit (R5) adds the overlap check, and the last commit the final numbers.
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(`${name} is no worse than its baseline`, () => {
      const layout = layoutGraph(fixture.input, EN);
      const base = BASELINE[name as keyof typeof FIXTURES];
      const now = measureLayout(layout);
      expect(now.crossings).toBeLessThanOrEqual(base.crossings);
      expect(now.totalBends).toBeLessThanOrEqual(base.totalBends);
      expect(now.maxBendsPerLeg).toBeLessThanOrEqual(base.maxBendsPerLeg);
    });
  }
});
