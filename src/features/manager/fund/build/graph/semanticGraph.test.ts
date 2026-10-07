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
  semanticJunctionId,
  semanticNodeId,
  semanticSegmentId,
  validateSemanticGraph,
} from "./semanticGraph";

function localGraph(originId = "position:a", suffix = ""): SemanticGraph {
  const source = semanticNodeId("block", originId);
  const target = semanticNodeId("spine", `idleOutput${suffix}`);
  const sourcePortId = financialPortId(source, "principal-out");
  const targetPortId = financialPortId(target, "principal-in");
  const id = semanticConnectionId(sourcePortId, targetPortId, "principal", originId);
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
        originId,
        side: "bottom",
        offset: 0.5,
      },
      {
        id: targetPortId,
        nodeId: target,
        direction: "in",
        class: "principal",
        network: "arbitrum",
        originId,
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
        originId,
        sourcePortId,
        targetPortId,
        segmentIds: [`${id}:segment:direct`],
      },
    ],
  };
}

/** Cross-network transfer stays explicit even when both classes share one visual Bridge. */
function bridgeGraph(network = "solana"): SemanticGraph {
  const nodeId = semanticNodeId("bridge", network, "outbound");
  const classes = ["principal", "income"] as const;
  const ports = classes.flatMap((flowClass, index) => [
    {
      id: financialPortId(nodeId, `${flowClass}-source`),
      nodeId,
      direction: "out" as const,
      class: flowClass,
      network,
      originId: "position:a",
      side: "right" as const,
      offset: 0.25 + index * 0.5,
    },
    {
      id: financialPortId(nodeId, `${flowClass}-target`),
      nodeId,
      direction: "in" as const,
      class: flowClass,
      network: "arbitrum",
      originId: "position:a",
      side: "left" as const,
      offset: 0.25 + index * 0.5,
    },
  ]);
  const connections = classes.map((flowClass) => {
    const sourcePortId = financialPortId(nodeId, `${flowClass}-source`);
    const targetPortId = financialPortId(nodeId, `${flowClass}-target`);
    const id = semanticConnectionId(sourcePortId, targetPortId, flowClass, "position:a");
    return {
      id,
      class: flowClass,
      originId: "position:a",
      sourcePortId,
      targetPortId,
      segmentIds: [`${id}:transfer`],
    };
  });
  return {
    nodes: [
      {
        id: nodeId,
        kind: "bridge",
        network,
        bridge: { fromNetwork: network, toNetwork: "arbitrum", direction: "outbound" },
        rect: { x: 10, y: 20, w: 176, h: 26 },
      },
    ],
    ports,
    junctions: [],
    connections,
    segments: connections.map((connection) => ({
      id: `${connection.id}:transfer`,
      connectionId: connection.id,
      from: { kind: "port", id: connection.sourcePortId },
      to: { kind: "port", id: connection.targetPortId },
    })),
  };
}
function combineGraphs(first: SemanticGraph, second: SemanticGraph): SemanticGraph {
  return {
    nodes: [...first.nodes, ...second.nodes],
    ports: [...first.ports, ...second.ports],
    junctions: [...first.junctions, ...second.junctions],
    segments: [...first.segments, ...second.segments],
    connections: [...first.connections, ...second.connections],
  };
}
const codes = (graph: SemanticGraph) => validateSemanticGraph(graph).map((issue) => issue.code);

describe("explicit semantic financial graph", () => {
  // @rule R4/R5: class-specific Bridge ports cannot merge by style or visible node identity.
  it("keeps principal and income separate on one outbound Bridge and rejects mixed endpoints", () => {
    const graph = bridgeGraph();
    expect(validateSemanticGraph(graph)).toEqual([]);
    const paths = resolveSemanticGraph(graph).connections;
    expect(paths.map((path) => path.class)).toEqual(["principal", "income"]);
    expect(paths[0]?.points).not.toEqual(paths[1]?.points);
    const principal = graph.connections[0];
    const income = graph.connections[1];
    const segment = graph.segments[0];
    if (!principal || !income || !segment) throw new Error("fixture missing");
    const mixed = {
      ...graph,
      connections: [{ ...principal, targetPortId: income.targetPortId }, income],
      segments: [
        { ...segment, to: { kind: "port" as const, id: income.targetPortId } },
        ...graph.segments.slice(1),
      ],
    };
    expect(codes(mixed)).toContain("type_conflict");
  });

  // @rule R8: representative semantics, not 48 screenshots or financial reachability certification.
  it.each([
    "local",
    "cross-chain",
    "multi-position",
    "debt",
    "holding",
    "solana",
  ])("validates the representative %s contract", (variant) => {
    const local = localGraph();
    const graph =
      variant === "cross-chain" || variant === "solana"
        ? bridgeGraph(variant === "solana" ? "solana" : "base")
        : variant === "multi-position"
          ? combineGraphs(local, localGraph("position:b", "B"))
          : variant === "holding"
            ? {
                ...local,
                nodes: local.nodes.map((node, index) =>
                  index === 0 ? { ...node, kind: "holding" as const } : node,
                ),
              }
            : variant === "debt"
              ? {
                  ...local,
                  ports: local.ports.map((port) => ({ ...port, class: "repayment" as const })),
                  connections: local.connections.map((connection) => ({
                    ...connection,
                    class: "repayment" as const,
                  })),
                }
              : local;
    expect(validateSemanticGraph(graph)).toEqual([]);
    expect(resolveSemanticGraph(graph).connections).toHaveLength(
      variant === "multi-position" || variant === "cross-chain" || variant === "solana" ? 2 : 1,
    );
  });
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
    const expanded = combineGraphs(moved, localGraph("position:b", "unrelated"));
    expect(resolveSemanticGraph(expanded).connections[0]?.id).toBe(before[0]);
    expect(resolveSemanticGraph(moved).connections.map((connection) => connection.id)).toEqual(
      before,
    );
    expect(semanticNodeId("bridge", "solana", "inbound")).not.toBe(
      semanticNodeId("bridge", "solana", "outbound"),
    );
    expect(semanticConnectionId("a:b", "c", "income", "~")).not.toBe(
      semanticConnectionId("a", "b:c", "income", null),
    );
    expect(semanticJunctionId("return", "solana", "principal", null)).not.toBe(
      semanticJunctionId("return", "solana", "income", null),
    );
    expect(semanticSegmentId("route:a", "leg:b")).not.toBe(semanticSegmentId("route", "a:leg:b"));
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

  // @rule R2/R5/R7: ports terminate connections; only explicit junctions may join internal legs.
  it("rejects an undeclared intermediate port and non-orthogonal route", () => {
    const graph = localGraph();
    const connection = graph.connections[0];
    const source = graph.ports[0];
    if (!connection || !source) throw new Error("fixture missing");
    const intermediate = { ...source, id: "intermediate", offset: 0.25 };
    const broken: SemanticGraph = {
      ...graph,
      ports: [...graph.ports, intermediate],
      connections: [{ ...connection, segmentIds: ["first", "second"] }],
      segments: [
        {
          id: "first",
          connectionId: connection.id,
          from: { kind: "port", id: source.id },
          to: { kind: "port", id: intermediate.id },
        },
        {
          id: "second",
          connectionId: connection.id,
          from: { kind: "port", id: intermediate.id },
          to: { kind: "port", id: connection.targetPortId },
        },
      ],
    };
    expect(codes(broken)).toContain("route_break");
    const diagonal = {
      ...graph,
      nodes: graph.nodes.map((node, index) =>
        index === 1 ? { ...node, rect: { ...node.rect, x: 50 } } : node,
      ),
    };
    expect(codes(diagonal)).toContain("route_break");
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

  // @rule R7: a conversion self-loop is neither an external input nor an onward route.
  it("rejects an isolated conversion whose own ports form its only connection", () => {
    const base = localGraph();
    const owner = base.nodes[0];
    if (!owner) throw new Error("fixture missing");
    const conversion: SemanticGraph = {
      ...base,
      nodes: [{ ...owner, kind: "conversion" }],
      ports: base.ports.map((port) => ({ ...port, nodeId: owner.id, class: "income" as const })),
      connections: base.connections.map((connection) => ({
        ...connection,
        class: "income" as const,
      })),
    };
    expect(validateSemanticGraph(conversion)).toContainEqual({
      code: "orphan_conversion",
      id: owner.id,
    });
    expect(codes(conversion)).toContain("route_break");
    expect(validateSemanticGraph(bridgeGraph())).toEqual([]);
  });

  // @rule R5/R7: geometric crossings remain independent routes without a declared junction.
  it("accepts crossing principal/income lines without creating a join", () => {
    const principal = localGraph();
    const other = localGraph("position:b", "B");
    const income: SemanticGraph = {
      ...other,
      nodes: other.nodes.map((node, index) => ({
        ...node,
        rect: { x: index === 0 ? 0 : 100, y: 100, w: 20, h: 20 },
      })),
      ports: other.ports.map((port, index) => ({
        ...port,
        class: "income",
        side: index === 0 ? "right" : "left",
      })),
      connections: other.connections.map((connection) => ({ ...connection, class: "income" })),
    };
    const graph = combineGraphs(principal, income);
    expect(validateSemanticGraph(graph)).toEqual([]);
    expect(graph.junctions).toEqual([]);
    expect(resolveSemanticGraph(graph).connections.map((connection) => connection.class)).toEqual([
      "principal",
      "income",
    ]);
  });

  // @rule R7: a conversion preserves class/origin on both sides and must connect onward.
  it("accepts a connected fee conversion and reports an extra route with a different origin", () => {
    const before = localGraph();
    const after = localGraph("position:a", "after");
    const conversionId = "fee-conversion:a";
    const firstSource = before.nodes[0];
    const lastTarget = after.nodes[1];
    if (!firstSource || !lastTarget) throw new Error("fixture missing");
    const graph: SemanticGraph = {
      nodes: [
        firstSource,
        {
          id: conversionId,
          kind: "conversion",
          network: "arbitrum",
          rect: { x: 10, y: 120, w: 120, h: 20 },
        },
        lastTarget,
      ],
      ports: [
        ...before.ports.map((port, index) => ({
          ...port,
          class: "income" as const,
          ...(index === 1 ? { nodeId: conversionId, side: "top" as const } : {}),
        })),
        ...after.ports.map((port, index) => ({
          ...port,
          class: "income" as const,
          ...(index === 0 ? { id: "converted-out", nodeId: conversionId } : {}),
        })),
      ],
      junctions: [],
      segments: [
        ...before.segments,
        ...after.segments.map((segment) => ({
          ...segment,
          from: { kind: "port" as const, id: "converted-out" },
        })),
      ],
      connections: [
        ...before.connections.map((connection) => ({ ...connection, class: "income" as const })),
        ...after.connections.map((connection) => ({
          ...connection,
          class: "income" as const,
          sourcePortId: "converted-out",
        })),
      ],
    };
    expect(validateSemanticGraph(graph)).toEqual([]);
    const incompatible = {
      ...graph,
      connections: graph.connections.map((connection, index) =>
        index === 1 ? { ...connection, originId: "different" } : connection,
      ),
    };
    expect(codes(incompatible)).toContain("type_conflict");
    const extra = localGraph("position:b", "extra");
    const extraOutput = "converted-out-b";
    const extraRoute: SemanticGraph = {
      ...extra,
      nodes: extra.nodes.slice(1),
      ports: extra.ports.map((port, index) => ({
        ...port,
        class: "income" as const,
        ...(index === 0 ? { id: extraOutput, nodeId: conversionId } : {}),
      })),
      segments: extra.segments.map((segment) => ({
        ...segment,
        from: { kind: "port" as const, id: extraOutput },
      })),
      connections: extra.connections.map((connection) => ({
        ...connection,
        class: "income" as const,
        sourcePortId: extraOutput,
      })),
    };
    expect(codes(combineGraphs(graph, extraRoute))).toContain("type_conflict");
  });

  // @rule R7: invalid endpoints, route order and segment ownership cannot hide in a valid drawing.
  it("reports dangling junctions, wrong segment owners and non-finite rects/anchors", () => {
    const graph = localGraph();
    const segment = graph.segments[0];
    if (!segment) throw new Error("fixture missing");
    expect(
      codes({
        ...graph,
        segments: [{ ...segment, to: { kind: "junction", id: "missing-junction" } }],
      }),
    ).toContain("dangling_endpoint");
    expect(
      codes({ ...graph, segments: [{ ...segment, connectionId: "another-connection" }] }),
    ).toContain("dangling_segment");
    expect(
      codes({
        ...graph,
        nodes: graph.nodes.map((node) => ({ ...node, rect: { ...node.rect, w: 0 } })),
      }),
    ).toContain("inconsistent_port");
    expect(
      codes({ ...graph, ports: graph.ports.map((port) => ({ ...port, offset: Number.NaN })) }),
    ).toContain("inconsistent_port");
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
