/** @id PP-MGR-LIB-074 (POO-2302) @implements-rules-version v1 @analytics-events none, pure projection tests */
import { Position } from "@xyflow/react";
import { expect, it } from "vitest";
import { mockFund } from "@/mocks/data/v2Funds";
import { layoutManageGraph } from "../../manage/manageLayout";
import { normalizeManageModel } from "../../manage/manageModel";
import { measuredFinancialPoints, projectReactFlowGraph } from "./reactFlowProjection";

// @rule R1/R2: source/target handles are explicit financial identities, never coordinate proximity.
it("projects declared ports and visible connections without exposing Bridge transfers", () => {
  const layout = layoutManageGraph(normalizeManageModel(mockFund));
  const result = projectReactFlowGraph({
    semantic: layout.semantic,
    paths: layout.connections,
    surfaces: new Map(layout.semantic.nodes.map((node) => [node.id, node.id])),
  });
  expect(result.nodes).toHaveLength(layout.semantic.nodes.length);
  expect(result.edges).toHaveLength(layout.connections.length);
  for (const edge of result.edges) {
    const declared = layout.semantic.connections.find((connection) => connection.id === edge.id);
    expect(edge.sourceHandle).toBe(declared?.sourcePortId);
    expect(edge.targetHandle).toBe(declared?.targetPortId);
    expect(edge.reconnectable).toBe(false);
  }
  expect(result.edges.some((edge) => edge.id.startsWith("transfer:"))).toBe(false);
  expect(result.edges.find((edge) => edge.id === "withdraw:income")?.data?.tone).toBe("muted");
  expect(result.edges.some((edge) => edge.data?.tone === "income")).toBe(true);
});

// @rule R2/R5: engine mutation and invisible origin fallback are unavailable.
it("keeps nodes fixed and refuses a path with no declared financial connection", () => {
  const layout = layoutManageGraph(normalizeManageModel(mockFund));
  const result = projectReactFlowGraph({
    semantic: layout.semantic,
    paths: [...layout.connections, { id: "invented", tone: "income", points: [{ x: 0, y: 0 }] }],
    surfaces: new Map(layout.semantic.nodes.map((node) => [node.id, node.id])),
  });
  expect(result.edges.some((edge) => edge.id === "invented")).toBe(false);
  expect(result.nodes.length).toBeGreaterThan(0);
  for (const node of result.nodes) {
    expect(node.draggable).toBe(false);
    expect(node.connectable).toBe(false);
    expect(node.focusable).toBe(false);
  }
});

// @rule R1: measured borders replace stale ends without diagonals or new financial links.
it("keeps changed card endpoints attached with only orthogonal joins", () => {
  const points = measuredFinancialPoints(
    [
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 300, y: 200 },
      { x: 300, y: 300 },
    ],
    { x: 110, y: 120 },
    { x: 320, y: 330 },
    Position.Bottom,
    Position.Top,
  );
  expect(points[0]).toEqual({ x: 110, y: 120 });
  expect(points.at(-1)).toEqual({ x: 320, y: 330 });
  expect(points).toContainEqual({ x: 110, y: 200 });
  // The retained horizontal corridor still passes through the old interior bend.
  expect(
    points
      .slice(1)
      .some(
        (point, index) =>
          point.y === 200 &&
          points[index]?.y === 200 &&
          Math.min(point.x, points[index]?.x ?? 0) <= 300 &&
          Math.max(point.x, points[index]?.x ?? 0) >= 300,
      ),
  ).toBe(true);
  expect(
    points
      .slice(1)
      .every((point, index) => point.x === points[index]?.x || point.y === points[index]?.y),
  ).toBe(true);
});

// @rule POO-2302 R6: a single measured elbow combines both endpoints without a reversal.
it.each([
  {
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ],
    source: { x: 20, y: 0 },
    target: { x: 100, y: 120 },
    sourceSide: Position.Bottom,
    targetSide: Position.Left,
    bend: { x: 20, y: 120 },
  },
  {
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ],
    source: { x: 0, y: 20 },
    target: { x: 120, y: 100 },
    sourceSide: Position.Right,
    targetSide: Position.Top,
    bend: { x: 120, y: 20 },
  },
])("keeps one bend when both painted endpoints move ($sourceSide to $targetSide)", ({
  points,
  source,
  target,
  sourceSide,
  targetSide,
  bend,
}) => {
  expect(measuredFinancialPoints(points, source, target, sourceSide, targetSide)).toEqual([
    source,
    bend,
    target,
  ]);
});

// @rule R2/R4: decoration order preserves keyboard reading order and never adds financial ports.
it("preserves declared reading order while refusing orphan financial endpoints", () => {
  const layout = layoutManageGraph(normalizeManageModel(mockFund));
  const first = layout.semantic.nodes[0];
  if (!first) throw new Error("fixture has no nodes");
  const result = projectReactFlowGraph({
    semantic: layout.semantic,
    paths: layout.connections,
    surfaces: new Map([[first.id, "card"]]),
    decorations: [{ id: "label", surface: "label", position: { x: 0, y: 0 } }],
    readingOrder: ["label", first.id],
  });
  expect(result.nodes.map((node) => node.id)).toEqual(["label", first.id]);
  expect(result.nodes[0]?.data.ports).toEqual([]);
  expect(result.edges).toEqual([]);
});

// @rule R2/R5: invalid engine geometry never creates a fallback line to the origin.
it("rejects nonfinite financial paths and out-of-bounds handles", () => {
  const layout = layoutManageGraph(normalizeManageModel(mockFund));
  const first = layout.connections[0];
  if (!first) throw new Error("fixture has no connection");
  const paths = layout.connections.map((path) =>
    path.id === first.id
      ? {
          ...path,
          points: [
            { x: NaN, y: 1 },
            { x: 2, y: 2 },
          ],
        }
      : path,
  );
  const projected = projectReactFlowGraph({
    semantic: layout.semantic,
    paths,
    surfaces: new Map(layout.semantic.nodes.map((node) => [node.id, node.id])),
  });
  expect(projected.edges.some((edge) => edge.id === first.id)).toBe(false);
});

// @rule I9/POO-2302 R4: positioned financial nodes animate only after first paint and respect reduced motion.
it("applies movement to engine node transforms only when motion is enabled", () => {
  const layout = layoutManageGraph(normalizeManageModel(mockFund));
  const input = {
    semantic: layout.semantic,
    paths: layout.connections,
    surfaces: new Map(layout.semantic.nodes.map((node) => [node.id, node.id])),
  };
  expect(projectReactFlowGraph({ ...input, motion: true }).nodes[0]?.style?.transition).toBe(
    "transform 150ms ease-out",
  );
  expect(
    projectReactFlowGraph({ ...input, motion: false }).nodes[0]?.style?.transition,
  ).toBeUndefined();
});
