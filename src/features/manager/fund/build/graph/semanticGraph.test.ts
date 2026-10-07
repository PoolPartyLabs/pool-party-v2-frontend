/**
 * @id PP-MGR-LIB-062
 * @name semanticGraph tests
 * @implements-rules-version v1 (POO-2288)
 * @analytics-events none, pure contract regressions.
 */
import { describe, expect, it } from "vitest";
import { layoutGraph } from "../layout/layoutGraph";
import { graphItems, itemTarget, pieceConnections, pieceEdges } from "./graphModel";
import {
  financialPortId,
  resolvePortPoint,
  resolveSemanticGraph,
  type SemanticGraph,
  semanticConnectionId,
  semanticNodeId,
  validateSemanticGraph,
} from "./semanticGraph";

function localGraph(): SemanticGraph {
  const source = semanticNodeId("block", "position:a");
  const target = semanticNodeId("spine", "idleOutput");
  const sourcePortId = financialPortId(source, "principal-out");
  const targetPortId = financialPortId(target, "principal-in");
  const id = semanticConnectionId(sourcePortId, targetPortId, "principal", "position:a");
  return {
    nodes: [
      { id: source, kind: "position", network: "arbitrum", rect: { x: 10, y: 20, w: 120, h: 80 } },
      {
        id: target,
        kind: "structural",
        network: "arbitrum",
        rect: { x: 10, y: 180, w: 120, h: 60 },
      },
    ],
    ports: [
      {
        id: sourcePortId,
        nodeId: source,
        direction: "out",
        class: "principal",
        network: "arbitrum",
        originId: "position:a",
        side: "bottom",
        offset: 0.5,
      },
      {
        id: targetPortId,
        nodeId: target,
        direction: "in",
        class: "principal",
        network: "arbitrum",
        originId: "position:a",
        side: "top",
        offset: 0.5,
      },
    ],
    junctions: [],
    segments: [
      {
        id: `${id}:segment:direct`,
        connectionId: id,
        from: { kind: "port", id: sourcePortId },
        to: { kind: "port", id: targetPortId },
      },
    ],
    connections: [
      {
        id,
        class: "principal",
        originId: "position:a",
        sourcePortId,
        targetPortId,
        segmentIds: [`${id}:segment:direct`],
      },
    ],
  };
}
const codes = (graph: SemanticGraph) => validateSemanticGraph(graph).map((issue) => issue.code);

describe("explicit semantic financial graph", () => {
  // @rule R1/R3: identity derives from role/context, never array order or coordinates.
  it("preserves identities when inputs reorder, another branch changes, or rects move", () => {
    const graph = localGraph();
    const before = graph.connections.map((connection) => connection.id);
    const moved = {
      ...graph,
      nodes: [...graph.nodes].reverse().map((node) => ({ ...node, rect: { ...node.rect, x: 40 } })),
      ports: [...graph.ports].reverse(),
    };
    expect(resolveSemanticGraph(moved).connections.map((connection) => connection.id)).toEqual(
      before,
    );
    expect(semanticNodeId("bridge", "solana", "inbound")).not.toBe(
      semanticNodeId("bridge", "solana", "outbound"),
    );
    expect(semanticConnectionId("a:b", "c", "income", "~")).not.toBe(
      semanticConnectionId("a", "b:c", "income", null),
    );
  });

  // @rule R2/R6: each side uses current outer bounds and an explicit fractional anchor.
  it("resolves all four borders after content changes the node size", () => {
    const graph = localGraph();
    const node = graph.nodes[0];
    const port = graph.ports[0];
    if (!node || !port) throw new Error("fixture missing");
    expect(resolvePortPoint(node, port)).toEqual({ x: 70, y: 100 });
    expect(resolvePortPoint(node, { ...port, side: "top", offset: 0.25 })).toEqual({
      x: 40,
      y: 20,
    });
    expect(resolvePortPoint(node, { ...port, side: "left", offset: 0.75 })).toEqual({
      x: 10,
      y: 80,
    });
    expect(resolvePortPoint(node, { ...port, side: "right", offset: 0 })).toEqual({
      x: 130,
      y: 20,
    });
    const changed = {
      ...graph,
      nodes: graph.nodes.map((entry, index) =>
        index === 0 ? { ...entry, rect: { ...entry.rect, h: 100 } } : entry,
      ),
    };
    expect(resolveSemanticGraph(changed).connections[0]?.points).toEqual([
      { x: 70, y: 120 },
      { x: 70, y: 180 },
    ]);
    expect(graph.nodes[0]?.rect.h).toBe(80);
  });

  // @rule R5: a route turns/joins only through declared endpoint identities.
  it("resolves owned segments through explicit junctions in order", () => {
    const graph = localGraph();
    const connection = graph.connections[0];
    if (!connection) throw new Error("fixture missing");
    const junction = {
      id: "principal:merge:a",
      class: "principal" as const,
      network: "arbitrum",
      originId: null,
      point: { x: 70, y: 140 },
    };
    const routed: SemanticGraph = {
      ...graph,
      junctions: [junction],
      segments: [
        {
          id: "in-a",
          connectionId: connection.id,
          from: { kind: "port", id: connection.sourcePortId },
          to: { kind: "junction", id: junction.id },
        },
        {
          id: "out-a",
          connectionId: connection.id,
          from: { kind: "junction", id: junction.id },
          to: { kind: "port", id: connection.targetPortId },
        },
      ],
      connections: [{ ...connection, segmentIds: ["in-a", "out-a"] }],
    };
    expect(validateSemanticGraph(routed)).toEqual([]);
    expect(resolveSemanticGraph(routed).connections[0]?.points).toEqual([
      { x: 70, y: 100 },
      { x: 70, y: 140 },
      { x: 70, y: 180 },
    ]);
    expect(resolveSemanticGraph(routed).segments.map((segment) => segment.id)).toEqual([
      "in-a",
      "out-a",
    ]);
  });

  // @rule R5/R7: coincident coordinates never repair distinct undeclared joins.
  it("reports a route break when adjacent segments name different coincident junctions", () => {
    const graph = localGraph();
    const connection = graph.connections[0];
    if (!connection) throw new Error("fixture missing");
    const junctions = ["first", "second"].map((id) => ({
      id,
      class: "principal" as const,
      network: "arbitrum",
      originId: null,
      point: { x: 70, y: 140 },
    }));
    const broken: SemanticGraph = {
      ...graph,
      junctions,
      segments: [
        {
          id: "first-leg",
          connectionId: connection.id,
          from: { kind: "port", id: connection.sourcePortId },
          to: { kind: "junction", id: "first" },
        },
        {
          id: "second-leg",
          connectionId: connection.id,
          from: { kind: "junction", id: "second" },
          to: { kind: "port", id: connection.targetPortId },
        },
      ],
      connections: [{ ...connection, segmentIds: ["first-leg", "second-leg"] }],
    };
    expect(codes(broken)).toContain("route_break");
  });

  // @rule R7: malformed graph declarations return diagnostic codes, not guessed endpoints.
  it("reports duplicate IDs, missing nodes, dangling segments and unused owned segments", () => {
    const graph = localGraph();
    const port = graph.ports[0];
    const segment = graph.segments[0];
    const node = graph.nodes[0];
    if (!port || !segment || !node) throw new Error("fixture missing");
    expect(codes({ ...graph, nodes: [...graph.nodes, node] })).toContain("duplicate_id");
    expect(
      codes({ ...graph, ports: [{ ...port, nodeId: "missing" }, ...graph.ports.slice(1)] }),
    ).toContain("dangling_endpoint");
    expect(codes({ ...graph, segments: [] })).toContain("dangling_segment");
    expect(
      codes({ ...graph, segments: [...graph.segments, { ...segment, id: "unowned" }] }),
    ).toContain("dangling_segment");
    expect(() => resolveSemanticGraph({ ...graph, segments: [] })).toThrow(/dangling_segment/);
  });

  // @rule R2/R4/R7: an income port cannot be substituted for principal even on one visual node.
  it("rejects class, origin, direction, network and fractional-anchor conflicts", () => {
    const graph = localGraph();
    const port = graph.ports[1];
    const source = graph.ports[0];
    if (!port || !source) throw new Error("fixture missing");
    const changed = (value: Partial<typeof port>) => ({
      ...graph,
      ports: [source, { ...port, ...value }],
    });
    expect(codes(changed({ class: "income" }))).toContain("type_conflict");
    expect(codes(changed({ originId: "another-position" }))).toContain("origin_conflict");
    expect(codes(changed({ direction: "out" }))).toContain("inconsistent_port");
    expect(codes(changed({ network: "solana" }))).toContain("inconsistent_port");
    expect(codes(changed({ offset: 1.01 }))).toContain("inconsistent_port");
  });

  // @rule R4/R7: Bridges require an actual network boundary, conversions require both route legs.
  it("reports a local Arbitrum Bridge and an orphan conversion", () => {
    const graph = localGraph();
    expect(
      codes({
        ...graph,
        nodes: [
          ...graph.nodes,
          {
            id: "local-bridge",
            kind: "bridge",
            network: "arbitrum",
            rect: { x: 0, y: 0, w: 50, h: 20 },
            bridge: { fromNetwork: "arbitrum", toNetwork: "arbitrum", direction: "outbound" },
          },
        ],
      }),
    ).toContain("same_chain_bridge");
    expect(
      codes({
        ...graph,
        nodes: [
          ...graph.nodes,
          {
            id: "orphan-swap",
            kind: "conversion",
            network: "arbitrum",
            rect: { x: 0, y: 0, w: 50, h: 20 },
          },
        ],
      }),
    ).toContain("orphan_conversion");
  });

  // @rule R7: an empty contract is valid and introduces no data/transaction behavior.
  it("accepts an empty graph without inserting a financial route", () => {
    const graph = { nodes: [], ports: [], junctions: [], segments: [], connections: [] };
    expect(validateSemanticGraph(graph)).toEqual([]);
    expect(resolveSemanticGraph(graph)).toEqual({ segments: [], connections: [] });
  });
});

describe("backwards-compatible graphModel hookup", () => {
  // @rule R1/R2/R3/R6: Add/drop keys and legacy styling/geometry remain unchanged.
  it("uses declared segments and complete connections while preserving insertion targets", () => {
    const layout = layoutGraph(
      { hubNetwork: "arbitrum", hub: { chains: [] }, spokes: [] },
      { startHereWidth: 420 },
    );
    const originalItems = graphItems(layout);
    const semantic = localGraph();
    const upgraded = { ...layout, semantic };
    expect(graphItems(upgraded)).toEqual(originalItems);
    expect(graphItems(upgraded).map(itemTarget)).toEqual(originalItems.map(itemTarget));
    expect(pieceConnections(upgraded)).toEqual([
      {
        id: semantic.connections[0]?.id,
        tone: "muted",
        points: [
          { x: 70, y: 100 },
          { x: 70, y: 180 },
        ],
      },
    ]);
    expect(pieceEdges(upgraded)[0]?.id).toBe(semantic.segments[0]?.id);
    expect(pieceEdges(layout)).toHaveLength(layout.edges.length);
  });
});
