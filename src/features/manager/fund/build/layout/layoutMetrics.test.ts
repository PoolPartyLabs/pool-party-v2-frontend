/**
 * @id PP-MGR-LIB-096
 * @name layoutMetrics tests
 * @implements-rules-version v2 (POO-2345)
 * @analytics-events none, a pure measuring module: nothing here is rendered or tracked.
 *
 * Unit tests of the metric on small hand-built layouts, and the R8 test that records the numbers
 * of every layout fixture and checks them against the bound that the metric derives.
 */

import { describe, expect, it } from "vitest";
import { BUILD_CANVAS_FIXTURES, solanaTwoChainReturn } from "@/mocks/data/buildCanvasFixtures";
import type { EdgeKind, EdgeNode, GraphLayout, Point } from "./graphTypes";
import { LAYOUT } from "./layoutConstants";
import { layoutGraph } from "./layoutGraph";
import {
  classifyCrossings,
  crossingLowerBound,
  findConflicts,
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

describe("measureLayout: trunk (R7) and self overlap", () => {
  it("does not report a trunk of two last verticals that reach one point from one side", () => {
    const layout = layoutOf([
      edge("a", "principal", [10, 0], [10, 100]),
      edge("b", "principal", [10, 40], [10, 100]),
    ]);
    expect(findConflicts(layout).overlaps).toEqual([]);
  });

  it("reports two last horizontals that end at one point: only a vertical can be a trunk", () => {
    const layout = layoutOf([
      edge("a", "principal", [0, 50], [100, 50]),
      edge("b", "principal", [40, 50], [100, 50]),
    ]);
    expect(findConflicts(layout).overlaps).toEqual([["a", "b"]]);
  });

  it("reports last verticals of one kind that come from opposite sides of one point", () => {
    // They share no length: one is above the end point and one is below it. No overlap exists.
    const layout = layoutOf([
      edge("a", "principal", [10, 0], [10, 100]),
      edge("b", "principal", [10, 200], [10, 100]),
    ]);
    expect(findConflicts(layout).overlaps).toEqual([]);
  });

  it("reports two verticals of one kind that end at different points, though one is last", () => {
    const layout = layoutOf([
      edge("a", "principal", [10, 0], [10, 100]),
      edge("b", "principal", [10, 40], [10, 90]),
    ]);
    expect(findConflicts(layout).overlaps).toEqual([["a", "b"]]);
  });

  it("reports a line that overlaps itself", () => {
    // The line runs right, loops under its own start and runs right again over the first run.
    const layout = layoutOf([
      edge("a", "income", [0, 0], [100, 0]),
      edge("a:leg:1", "income", [100, 0], [100, 20]),
      edge("a:leg:2", "income", [100, 20], [60, 20]),
      edge("a:leg:3", "income", [60, 20], [60, 0]),
      edge("a:leg:4", "income", [60, 0], [160, 0]),
    ]);
    expect(findConflicts(layout).overlaps).toEqual([["a", "a:leg:4"]]);
    expect(measureLayout(layout).overlaps).toBe(1);
  });

  it("does not report two segments of one line that only meet at a corner", () => {
    const layout = layoutOf([
      edge("a", "income", [0, 0], [100, 0]),
      edge("a:leg:1", "income", [100, 0], [100, 20]),
    ]);
    expect(measureLayout(layout).overlaps).toBe(0);
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

  it("counts a reversal on one axis as two bends, a vertical one and a horizontal one", () => {
    const vertical = layoutOf([
      edge("a", "income", [0, 0], [0, 50]),
      edge("a:leg:1", "income", [0, 50], [0, 20]),
    ]);
    expect(measureLayout(vertical)).toMatchObject({ totalBends: 2, maxBendsPerLeg: 2 });
    const horizontal = layoutOf([
      edge("a", "income", [0, 0], [50, 0]),
      edge("a:leg:1", "income", [50, 0], [20, 0]),
    ]);
    expect(measureLayout(horizontal)).toMatchObject({ totalBends: 2, maxBendsPerLeg: 2 });
  });

  it("counts a turn as one bend and a continuation as none, on the same line", () => {
    const layout = layoutOf([
      edge("a", "income", [0, 0], [0, 50]),
      edge("a:leg:1", "income", [0, 50], [0, 90]),
      edge("a:leg:2", "income", [0, 90], [40, 90]),
      edge("a:leg:3", "income", [40, 90], [90, 90]),
    ]);
    expect(measureLayout(layout).totalBends).toBe(1);
  });
});

describe("measureLayout: minimum gap", () => {
  it("is the distance of two parallel segments of different lines that overlap in projection", () => {
    const layout = layoutOf([
      edge("a", "principal", [0, 50], [100, 50]),
      edge("b", "income", [60, 56], [200, 56]),
      edge("c", "income", [0, 80], [100, 80]),
    ]);
    expect(measureLayout(layout).minGap).toBe(6);
  });

  it("is the distance of two verticals too", () => {
    const layout = layoutOf([
      edge("a", "principal", [10, 0], [10, 100]),
      edge("b", "income", [14.5, 50], [14.5, 200]),
    ]);
    expect(measureLayout(layout).minGap).toBe(4.5);
  });

  it("ignores segments that do not overlap in projection, and perpendicular segments", () => {
    const layout = layoutOf([
      edge("a", "principal", [0, 50], [100, 50]),
      edge("b", "income", [100, 52], [200, 52]),
      edge("c", "income", [50, 0], [50, 40]),
    ]);
    expect(measureLayout(layout).minGap).toBe(Number.POSITIVE_INFINITY);
  });

  it("ignores two segments of one line and a trunk", () => {
    const layout = layoutOf([
      edge("a", "principal", [0, 50], [100, 50]),
      edge("a:leg:1", "principal", [100, 50], [100, 90]),
      edge("a:leg:2", "principal", [100, 90], [20, 90]),
      edge("b", "principal", [200, 200], [200, 300]),
      edge("c", "principal", [200, 240], [200, 300]),
    ]);
    expect(measureLayout(layout).minGap).toBe(Number.POSITIVE_INFINITY);
  });

  it("is 0 for a shared length that is not a trunk", () => {
    const layout = layoutOf([
      edge("a", "principal", [0, 50], [100, 50]),
      edge("b", "income", [60, 50], [200, 50]),
    ]);
    expect(measureLayout(layout).minGap).toBe(0);
  });
});

describe("crossingLowerBound (R2 and R8)", () => {
  const inverted = layoutOf([
    edge("income:converted:f", "income", [10, 0], [10, 40]),
    edge("income:converted:f:leg:1", "income", [10, 40], [90, 40]),
    edge("principal:chain:p", "principal", [60, 0], [60, 80]),
    edge("principal:chain:p:leg:1", "principal", [60, 80], [30, 80]),
  ]);

  it("is 1 for one income and one principal that start and end in opposite orders", () => {
    expect(crossingLowerBound(inverted)).toBe(1);
    expect(measureLayout(inverted).crossings).toBe(1);
  });

  it("is 0 when the lines keep their order, and for two lines of one class", () => {
    const keeps = layoutOf([
      edge("income:converted:f", "income", [10, 0], [10, 40]),
      edge("income:converted:f:leg:1", "income", [10, 40], [30, 40]),
      edge("principal:chain:p", "principal", [20, 0], [20, 80]),
      edge("principal:chain:p:leg:1", "principal", [20, 80], [60, 80]),
    ]);
    expect(crossingLowerBound(keeps)).toBe(0);
    const same = layoutOf([
      edge("principal:chain:a", "principal", [10, 0], [10, 40]),
      edge("principal:chain:a:leg:1", "principal", [10, 40], [90, 40]),
      edge("principal:chain:b", "principal", [60, 0], [60, 80]),
      edge("principal:chain:b:leg:1", "principal", [60, 80], [30, 80]),
    ]);
    expect(crossingLowerBound(same)).toBe(0);
  });

  it("counts each pair of families once, not each crossing of their segments", () => {
    // Two incomes (f at 10 and g at 20) both start left of the principal and end right of it.
    const two = layoutOf([
      ...inverted.edges,
      edge("income:converted:g", "income", [20, 0], [20, 45]),
      edge("income:converted:g:leg:1", "income", [20, 45], [95, 45]),
    ]);
    expect(crossingLowerBound(two)).toBe(2);
  });

  it("is 0 for two lines that pass one Bridge and 1 for two Bridges", () => {
    const through = (principalX: number, bridges: number): GraphLayout => {
      const layout = layoutOf([
        edge("income:converted:a", "income", [10, 0], [10, 10]),
        edge("income:returned:a", "income", [100, 20], [100, 60]),
        edge("principal:chain:b", "principal", [principalX, 0], [principalX, 10]),
        edge("principal:returned:b", "principal", [principalX, 20], [principalX, 40]),
        edge("principal:returned:b:leg:1", "principal", [principalX, 40], [30, 40]),
      ]);
      layout.bridges =
        bridges === 1
          ? [{ network: "n", rect: { x: 0, y: 10, w: 300, h: 10 } }]
          : [
              { network: "n", rect: { x: 0, y: 10, w: 120, h: 10 } },
              { network: "m", rect: { x: 200, y: 10, w: 40, h: 10 } },
            ];
      return layout;
    };
    expect(crossingLowerBound(through(210, 1))).toBe(0);
    expect(crossingLowerBound(through(210, 2))).toBe(1);
  });
});

describe("classifyCrossings (R2 and R8)", () => {
  /** The pairs of crossing edges that R2 forces, and the bound of the layout. */
  const forcedOf = (layout: GraphLayout) => classifyCrossings(layout).forced;

  it("forces a crossing when the income starts left and ends right of the principal", () => {
    // Income: 10 -> 90. Principal: 60 -> 30. The order of the starts is the opposite of the ends.
    const inverted = layoutOf([
      edge("income:converted:f", "income", [10, 0], [10, 40]),
      edge("income:converted:f:leg:1", "income", [10, 40], [90, 40]),
      edge("principal:chain:p", "principal", [60, 0], [60, 80]),
      edge("principal:chain:p:leg:1", "principal", [60, 80], [30, 80]),
    ]);
    expect(forcedOf(inverted)).toEqual([["income:converted:f:leg:1", "principal:chain:p"]]);
    expect(classifyCrossings(inverted).unforced).toEqual([]);
    expect(crossingLowerBound(inverted)).toBe(1);
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
    // The income horizontal (y 40, x 10 to 30) meets the principal vertical (x 20): one crossing.
    expect(measureLayout(keeps).crossings).toBe(1);
    expect(forcedOf(keeps)).toEqual([]);
    expect(crossingLowerBound(keeps)).toBe(0);
  });

  it("does not force two lines of the same class", () => {
    const same = layoutOf([
      edge("principal:chain:a", "principal", [10, 0], [10, 40]),
      edge("principal:chain:a:leg:1", "principal", [10, 40], [90, 40]),
      edge("principal:chain:b", "principal", [60, 0], [60, 80]),
      edge("principal:chain:b:leg:1", "principal", [60, 80], [30, 80]),
    ]);
    expect(measureLayout(same).crossings).toBe(1);
    expect(forcedOf(same)).toEqual([]);
    expect(crossingLowerBound(same)).toBe(0);
  });

  it("does not force an edge that is not a return route", () => {
    const link = layoutOf([
      edge("link:x", "income", [10, 0], [10, 50]),
      edge("principal:chain:p", "principal", [0, 25], [20, 25]),
    ]);
    expect(measureLayout(link).crossings).toBe(1);
    expect(forcedOf(link)).toEqual([]);
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
    // The two lines start and end in opposite orders, but the Bridge swaps them: no forced pair.
    const layout = throughBridges(60);
    expect(forcedOf(layout)).toEqual([]);
    expect(crossingLowerBound(layout)).toBe(0);
  });

  it("forces the same two lines when they pass two Bridges", () => {
    const layout = throughBridges(210);
    expect(measureLayout(layout).crossings).toBe(1);
    expect(forcedOf(layout)).toEqual([["income:returned:a", "principal:returned:b:leg:1"]]);
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
 * The numbers of every layout fixture. BASELINE is the routing of the base branch (POO-2342, head
 * d69cd06), measured with this metric. FINAL is the routing of POO-2345 v2. FORCED is a record of
 * the least number of crossings that R2 forces. A test derives it from the layout with
 * `crossingLowerBound` and checks the record against it, so the record cannot drift from the rule.
 */
const FIXTURES = { ...BUILD_CANVAS_FIXTURES, solanaTwoChainReturn } as const;
type Name = keyof typeof FIXTURES;

const NO_GAP = Number.POSITIVE_INFINITY;

const BASELINE: Record<Name, LayoutMetrics> = {
  canvasA: { crossings: 29, overlaps: 22, totalBends: 54, maxBendsPerLeg: 3, minGap: 0 },
  canvasB: { crossings: 0, overlaps: 3, totalBends: 16, maxBendsPerLeg: 3, minGap: 0 },
  canvasC: { crossings: 2, overlaps: 1, totalBends: 8, maxBendsPerLeg: 3, minGap: 0 },
  canvasD: { crossings: 0, overlaps: 0, totalBends: 0, maxBendsPerLeg: 0, minGap: NO_GAP },
  workedExample2: { crossings: 5, overlaps: 1, totalBends: 19, maxBendsPerLeg: 3, minGap: 0 },
  buildState3: { crossings: 0, overlaps: 0, totalBends: 3, maxBendsPerLeg: 3, minGap: 128.25 },
  buildState5: { crossings: 1, overlaps: 0, totalBends: 5, maxBendsPerLeg: 3, minGap: 24 },
  newSpokeNoChain: { crossings: 0, overlaps: 0, totalBends: 3, maxBendsPerLeg: 3, minGap: 128.25 },
  hubEmptyWithSpoke: { crossings: 0, overlaps: 0, totalBends: 5, maxBendsPerLeg: 3, minGap: 98 },
  solanaTwoChainReturn: { crossings: 5, overlaps: 1, totalBends: 19, maxBendsPerLeg: 3, minGap: 0 },
};

const FORCED: Record<Name, number> = {
  canvasA: 19,
  canvasB: 0,
  canvasC: 2,
  canvasD: 0,
  workedExample2: 3,
  buildState3: 0,
  buildState5: 1,
  newSpokeNoChain: 0,
  hubEmptyWithSpoke: 0,
  solanaTwoChainReturn: 3,
};

const FINAL: Record<Name, LayoutMetrics> = {
  canvasA: { crossings: 19, overlaps: 0, totalBends: 48, maxBendsPerLeg: 3, minGap: 4.5 },
  canvasB: { crossings: 0, overlaps: 0, totalBends: 10, maxBendsPerLeg: 3, minGap: 18 },
  canvasC: { crossings: 2, overlaps: 0, totalBends: 8, maxBendsPerLeg: 3, minGap: 21 },
  canvasD: { crossings: 0, overlaps: 0, totalBends: 0, maxBendsPerLeg: 0, minGap: NO_GAP },
  workedExample2: { crossings: 3, overlaps: 0, totalBends: 15, maxBendsPerLeg: 3, minGap: 12 },
  buildState3: { crossings: 0, overlaps: 0, totalBends: 3, maxBendsPerLeg: 3, minGap: 128.25 },
  buildState5: { crossings: 1, overlaps: 0, totalBends: 5, maxBendsPerLeg: 3, minGap: 24 },
  newSpokeNoChain: { crossings: 0, overlaps: 0, totalBends: 3, maxBendsPerLeg: 3, minGap: 128.25 },
  hubEmptyWithSpoke: { crossings: 0, overlaps: 0, totalBends: 1, maxBendsPerLeg: 1, minGap: 98 },
  solanaTwoChainReturn: {
    crossings: 3,
    overlaps: 0,
    totalBends: 15,
    maxBendsPerLeg: 3,
    minGap: 12,
  },
};

/**
 * Decision (POO-2345, finding 2, stop 2c). The band above Idle output of canvas A is 42 px tall
 * after the margin. Its 10 lanes need 54 px at LANE_PITCH, so the band is 12 px short. The nodes
 * stay at the Figma positions. So canvas A uses a pitch of 4.5 px. This is above LANE_PITCH_MIN.
 */
const BAND_SHORT: ReadonlySet<Name> = new Set<Name>(["canvasA"]);

describe("R8: the numbers of each layout fixture", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    const key = name as Name;
    describe(name, () => {
      const layout = layoutGraph(fixture.input, EN);
      const now = measureLayout(layout);

      it("has no overlap", () => {
        expect(now.overlaps).toBe(0);
        expect(findConflicts(layout).overlaps).toEqual([]);
      });

      it("keeps only the crossings that R2 forces", () => {
        expect(classifyCrossings(layout).unforced).toEqual([]);
      });

      it("has exactly as many crossings as the bound derived from its own layout", () => {
        const bound = crossingLowerBound(layout);
        expect(now.crossings).toBe(bound);
        expect(FORCED[key]).toBe(bound);
      });

      it("has no more bends than the baseline, and at most 3 in a visible leg", () => {
        expect(now.totalBends).toBeLessThanOrEqual(BASELINE[key].totalBends);
        expect(now.maxBendsPerLeg).toBeLessThanOrEqual(3);
      });

      // @rule R5
      it("keeps at least LANE_PITCH_MIN between parallel lines of different lines", () => {
        expect(now.minGap).toBeGreaterThanOrEqual(LAYOUT.LANE_PITCH_MIN);
      });

      // @rule R5
      if (BAND_SHORT.has(key))
        it("uses a pitch of 4.5 px, above LANE_PITCH_MIN, because the band is 12 px short", () => {
          expect(now.minGap).toBe(4.5);
          expect(now.minGap).toBeLessThan(LAYOUT.LANE_PITCH);
          expect(now.minGap).toBeGreaterThanOrEqual(LAYOUT.LANE_PITCH_MIN);
        });
      else
        it("keeps at least LANE_PITCH between parallel lines of different lines", () => {
          expect(now.minGap).toBeGreaterThanOrEqual(LAYOUT.LANE_PITCH);
        });

      it("records the numbers", () => {
        expect(now).toEqual(FINAL[key]);
      });
    });
  }
});
