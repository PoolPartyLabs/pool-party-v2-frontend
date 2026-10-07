/**
 * @id PP-MGR-LIB-023
 * @name Build V2 return topology regressions
 * @implements-rules-version v2 (POO-2273)
 * @analytics-events none, pure graph verification
 */
import { describe, expect, it } from "vitest";
import { graphItems, pieceConnections, pieceEdges } from "../graph/graphModel";
import { resolvePortPoint, validateSemanticGraph } from "../graph/semanticGraph";
import type { GraphLayout, LayoutChain, LayoutInput } from "./graphTypes";
import { LAYOUT } from "./layoutConstants";
import { layoutGraph } from "./layoutGraph";
import { nodeRects } from "./layoutTestKit";

const chain = (id: string, fees = true): LayoutChain => ({
  id,
  sharePct: 25,
  steps: [
    { id: `${id}-pool`, family: "position", kind: "uniswapV4Pool", auto: false, configured: true },
    ...(fees
      ? [
          {
            id: `${id}-fees`,
            family: "flow" as const,
            kind: "collectFees",
            auto: false,
            configured: true,
          },
        ]
      : []),
  ],
});
const input = (): LayoutInput => ({
  hubNetwork: "arbitrum",
  hub: { chains: [chain("hub")] },
  spokes: [{ network: "robinhood", sharePct: 50, chains: [chain("rh-a"), chain("rh-b", false)] }],
});
const layout = (value = input()) => layoutGraph(value, { startHereWidth: 420 });
const semantic = (graph: GraphLayout) => {
  expect(graph.semantic).toBeDefined();
  if (!graph.semantic) throw new Error("Build must declare financial routes");
  return graph.semantic;
};

describe("Build V2 financial returns (POO-2273 v2)", () => {
  it("[R1,R4] preserves a trailing manual conversion before a local or cross-chain principal return", () => {
    const value = input();
    for (const entry of [value.hub.chains[0], value.spokes[0]?.chains[0]]) {
      if (!entry) throw new Error("Missing chain");
      entry.steps = [
        {
          id: `${entry.id}-supply`,
          family: "position",
          kind: "aaveSupply",
          auto: false,
          configured: true,
        },
        { id: `${entry.id}-convert`, family: "flow", kind: "swap", auto: false, configured: true },
      ];
    }
    const graph = layout(value);
    const model = semantic(graph);
    expect(validateSemanticGraph(model)).toEqual([]);
    for (const id of ["hub", "rh-a"]) {
      const conversion = model.connections.find(
        (connection) => connection.id === `principal:conversion:${id}-convert`,
      );
      expect(conversion?.class).toBe("principal");
      expect(conversion?.originId).toBe(`${id}-supply`);
      expect(model.ports.find((port) => port.id === conversion?.sourcePortId)?.nodeId).toBe(
        `block:${id}-supply`,
      );
      expect(model.ports.find((port) => port.id === conversion?.targetPortId)?.nodeId).toBe(
        `block:${id}-convert`,
      );
      const returned = model.connections.find(
        (connection) => connection.id === `principal:chain:${id}`,
      );
      expect(model.ports.find((port) => port.id === returned?.sourcePortId)?.nodeId).toBe(
        `block:${id}-convert`,
      );
      expect(
        graph.hoverRoutes?.find((route) => route.id === `principal:chain:${id}`)?.connectionIds[0],
      ).toBe(conversion?.id);
    }
  });
  it("[R1] principal starts laterally at the position, while Collect has one centered green exit", () => {
    const graph = layout();
    const model = semantic(graph);
    for (const position of graph.blocks.filter((node) => node.family === "position")) {
      const connection = model.connections.find(
        (entry) => entry.id === `principal:chain:${position.chainId}`,
      );
      const port = model.ports.find((entry) => entry.id === connection?.sourcePortId);
      expect(port?.nodeId).toBe(`block:${position.id}`);
      expect(["left", "right"]).toContain(port?.side);
    }
    for (const fee of graph.blocks.filter((node) => node.kind === "collectFees")) {
      const exits = model.connections.filter(
        (entry) =>
          model.ports.find((port) => port.id === entry.sourcePortId)?.nodeId === `block:${fee.id}`,
      );
      expect(exits).toHaveLength(1);
      expect(exits[0]?.class).toBe("income");
      const path = pieceConnections(graph).find((entry) => entry.id === `income:block:${fee.id}`);
      const swap = graph.feeSwaps?.find((entry) => entry.sourceBlockId === fee.id);
      expect(path?.points).toEqual([
        { x: fee.rect.x + fee.rect.w / 2, y: fee.rect.y + fee.rect.h },
        { x: fee.rect.x + fee.rect.w / 2, y: swap?.rect.y },
      ]);
      const intoCollect = model.connections.find(
        (entry) =>
          model.ports.find((port) => port.id === entry.targetPortId)?.nodeId === `block:${fee.id}`,
      );
      expect(intoCollect?.class).toBe("income");
    }
    expect(graph.edges.find((edge) => edge.id === "output:income")?.kind).toBe("structural");
  });

  it("[R2,R3] one shared return Bridge has separate class and origin ports inside the spoke hull", () => {
    const graph = layout();
    const model = semantic(graph);
    expect(validateSemanticGraph(model)).toEqual([]);
    expect(graph.bridges.filter((node) => node.network === "robinhood")).toHaveLength(2);
    expect(graph.bridges.some((node) => node.network === "arbitrum")).toBe(false);
    const bridge = graph.bridges.find((node) => node.direction === "outbound");
    const group = graph.groups[0];
    expect(bridge).toBeDefined();
    if (!bridge || !group) throw new Error("Missing return Bridge");
    expect(bridge.rect.y).toBeGreaterThan(
      Math.max(
        ...graph.blocks
          .filter((node) => node.network === "robinhood")
          .map((node) => node.rect.y + node.rect.h),
        ...(graph.feeSwaps ?? [])
          .filter((node) => node.network === "robinhood")
          .map((node) => node.rect.y + node.rect.h),
      ),
    );
    expect(bridge.rect.y + bridge.rect.h + LAYOUT.GROUP_PAD).toBe(group.rect.y + group.rect.h);
    const ports = model.ports.filter((port) => port.nodeId === "bridge:robinhood:outbound");
    expect(new Set(ports.map((port) => port.id)).size).toBe(ports.length);
    expect(new Set(ports.map((port) => `${port.class}:${port.originId}`))).toEqual(
      new Set(["principal:rh-a-pool", "principal:rh-b-pool", "income:rh-a-pool"]),
    );
    expect(Object.keys(nodeRects(graph))).toContain("bridge:robinhood:outbound");
    const items = graphItems(graph);
    expect(items.findIndex((item) => item.key === "bridge:robinhood:outbound")).toBeGreaterThan(
      items.findIndex((item) => item.key === "block:rh-b-pool"),
    );
    for (const edge of pieceEdges(graph)) {
      const [from, to] = edge.points;
      if (!from || !to) continue;
      expect(from.y === bridge.rect.y && to.y === bridge.rect.y + bridge.rect.h).toBe(false);
    }
    expect(
      graph.connections?.some((connection) => connection.id.startsWith("bridge-transfer:")),
    ).toBe(false);
  });

  it("[R3,R8] unrelated insertion preserves route identities and hover reaches each declared output", () => {
    const graph = layout();
    const changed = input();
    changed.hub.chains.push(chain("unrelated", false));
    const next = layout(changed);
    const model = semantic(graph);
    const after = semantic(next);
    const owned = (value: typeof model) =>
      value.connections
        .filter((entry) => entry.originId === "rh-a-pool")
        .map((entry) => [entry.id, entry.segmentIds]);
    expect(owned(after)).toEqual(owned(model));
    for (const [id, output] of [
      ["principal:chain:rh-a", "idleOutput"],
      ["income:converted:rh-a-fees", "income"],
    ] as const) {
      const route = graph.hoverRoutes?.find((entry) => entry.id === id);
      const legs =
        route?.connectionIds.flatMap((legId) =>
          pieceConnections(graph).filter((entry) => entry.id === legId),
        ) ?? [];
      const path = { points: legs.flatMap((leg) => leg.points) };
      const target = graph.spine.find((entry) => entry.role === output);
      expect(path?.points.at(-1)).toEqual({
        x: (target?.rect.x ?? 0) + LAYOUT.SPINE_W / 2,
        y: target?.rect.y,
      });
      const first = model.connections.find((entry) => entry.id === route?.connectionIds[0]);
      const sourcePort = model.ports.find((entry) => entry.id === first?.sourcePortId);
      const source = model.nodes.find((entry) => entry.id === sourcePort?.nodeId);
      if (!source || !sourcePort) throw new Error("Missing source");
      expect(path?.points[0]).toEqual(resolvePortPoint(source, sourcePort));
    }
  });
});
