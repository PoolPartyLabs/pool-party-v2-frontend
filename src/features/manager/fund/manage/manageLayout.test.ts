/**
 * @id PP-MGR-LIB-052
 * @name manageLayout tests
 * @implements-rules-version v2 (POO-2270, POO-2271; extends POO-2226, POO-2232)
 * @analytics-events none, pure geometry tests.
 */
import { describe, expect, it } from "vitest";
import { mockFund } from "@/mocks/data/v2Funds";
import { validateSemanticGraph } from "../build/graph/semanticGraph";
import { layoutManageGraph } from "./manageLayout";
import { normalizeManageModel } from "./manageModel";

describe("POO-2270/2271 v2 routes", () => {
  it("keeps cash144x96, distinct Idle minima, position-origin principal and centered fee Swap", () => {
    const graph = layoutManageGraph(normalizeManageModel(mockFund));
    for (const cash of graph.nodes.filter((node) => node.kind === "cash")) {
      expect([cash.rect.w, cash.rect.h]).toEqual([144, 96]);
      const idle = graph.nodes.find((node) => node.id === `idle:${cash.chainId}`);
      if (!idle) throw new Error("idle missing");
      expect(cash.rect.y + cash.rect.h / 2).toBe(idle.rect.y + idle.rect.h / 2);
      expect(idle.rect.h).toBe(104);
    }
    const position = graph.nodes.find((node) => node.kind === "position" && node.chainId === 4663);
    const collect = graph.nodes.find((node) => node.kind === "flow" && node.flow === "collectFees");
    const swap = graph.nodes.find((node) => node.kind === "flow" && node.flow === "feeSwap");
    if (!position || !collect || !swap) throw new Error("flow missing");
    expect(centerX(swap)).toBe(centerX(collect));
    expect(swap.rect.y - collect.rect.y - collect.rect.h).toBe(24);
    const principal = graph.edges.find((edge) => edge.id.startsWith("principal:position:"));
    expect(principal?.points[0]?.x).toBe(position.rect.x);
    expect(graph.edges.filter((edge) => edge.id.startsWith("principal:collect:"))).toHaveLength(0);
    expect(graph.edges.find((edge) => edge.id === "withdraw:income")?.tone).toBe("muted");
  });
  it("declares one inbound/shared outbound Bridge, separated class ports and complete visible hover legs", () => {
    const graph = layoutManageGraph(normalizeManageModel(mockFund));
    expect(
      graph.nodes.filter((node) => node.kind === "flow" && node.flow === "bridge"),
    ).toHaveLength(2);
    expect(validateSemanticGraph(graph.semantic)).toEqual([]);
    const outbound = graph.nodes.find((node) => node.id === "bridge:4663:outbound");
    if (!outbound) throw new Error("outbound missing");
    const ports = graph.semantic.ports.filter((port) => port.nodeId === outbound.id);
    expect(new Set(ports.map((port) => port.class))).toEqual(new Set(["principal", "income"]));
    expect(graph.connections.length).toBeGreaterThan(0);
    expect(graph.hoverRoutes.some((route) => route.connectionIds.length > 1)).toBe(true);
    expect(graph.edges.some((edge) => edge.id.startsWith("transfer:"))).toBe(false);
    const collect = graph.nodes.find((node) => node.kind === "flow" && node.flow === "collectFees");
    if (!collect) throw new Error("collect missing");
    const outputs = graph.semantic.connections.filter(
      (connection) =>
        graph.semantic.ports.find((port) => port.id === connection.sourcePortId)?.nodeId ===
        collect.id,
    );
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.class).toBe("income");
  });
  it("updates final rects, ports and hulls from measured content without introducing a local Bridge", () => {
    const model = normalizeManageModel(mockFund);
    const local = {
      ...model,
      chains: model.chains.filter((chain) => chain.hub),
      positions: model.positions.filter((position) => position.chainId === model.hubChainId),
    };
    const graph = layoutManageGraph(local, {
      [`idle:${model.hubChainId}`]: { width: 236, height: 148 },
      withdrawal: { width: 236, height: 220 },
    });
    expect(graph.nodes.find((node) => node.id === `idle:${model.hubChainId}`)?.rect.h).toBe(148);
    expect(graph.nodes.find((node) => node.id === "withdrawal")?.rect.h).toBe(220);
    expect(graph.nodes.filter((node) => node.kind === "flow" && node.flow === "bridge")).toEqual(
      [],
    );
    expect(validateSemanticGraph(graph.semantic)).toEqual([]);
  });
  it("preserves route identities after unrelated insertion and recomputes grown position ports", () => {
    const model = normalizeManageModel(mockFund);
    const first = layoutManageGraph(model);
    const p = model.positions[1];
    if (!p) throw new Error("position missing");
    const extra = { ...p, id: `${p.id}:other`, positionKey: `0x${"8".repeat(64)}` };
    const expanded = layoutManageGraph(
      {
        ...model,
        positions: [...model.positions, extra],
        chains: model.chains.map((chain) =>
          chain.chainId === p.chainId
            ? { ...chain, positions: [...chain.positions, extra] }
            : chain,
        ),
      },
      { [`position:${p.id}`]: { width: 200, height: 300 } },
    );
    const originalIds = first.semantic.connections.map((connection) => connection.id);
    expect(expanded.semantic.connections.map((connection) => connection.id)).toEqual(
      expect.arrayContaining(originalIds),
    );
    const position = expanded.nodes.find((node) => node.id === `position:${p.id}`);
    const path = expanded.edges.find((edge) => edge.id === `principal:position:${p.id}`);
    expect(position?.rect.h).toBe(300);
    expect(path?.points[0]?.y).toBe((position?.rect.y ?? 0) + 150);
    expect(validateSemanticGraph(expanded.semantic)).toEqual([]);
  });
});

describe("Manage geometry", () => {
  it("[R4,R5] cash per chain is 144x96 and every node remains inside graph bounds", () => {
    const model = normalizeManageModel(mockFund);
    const graph = layoutManageGraph(model);
    const cash = graph.nodes.filter((n) => n.kind === "cash");
    expect(cash).toHaveLength(model.chains.length);
    expect(graph.nodes.find((n) => n.kind === "group")?.rect.w).toBe(376);
    expect(cash.every((n) => n.rect.w === 144 && n.rect.h === 96)).toBe(true);
    expect(
      graph.nodes.every(
        (n) =>
          n.rect.x >= 0 &&
          n.rect.y >= 0 &&
          n.rect.x + n.rect.w <= graph.width &&
          n.rect.y + n.rect.h <= graph.height,
      ),
    ).toBe(true);
  });
  it("[R4] puts a derived fee Swap after Collect with separate principal and income edges", () => {
    const graph = layoutManageGraph(normalizeManageModel(mockFund));
    const collect = graph.nodes.find((n) => n.kind === "flow" && n.flow === "collectFees");
    const conversion = graph.nodes.find((n) => n.kind === "flow" && n.flow === "feeSwap");
    if (!collect || !conversion) throw new Error("missing flow");
    expect(conversion.rect.y).toBe(collect.rect.y + collect.rect.h + 24);
    expect(graph.edges.some((e) => e.tone === "income")).toBe(true);
    expect(graph.edges.some((e) => e.id.startsWith("principal:"))).toBe(true);
    expect(
      graph.nodes.some((n) => "flow" in n && n.flow === "collectFees" && n.chainId === 42161),
    ).toBe(false);
  });
  it("[R2,R5] preserves independent cash for multiple spoke chains and multiple same-pool positions", () => {
    const p = mockFund.positionsSummary?.positions[1];
    if (!p) throw new Error("fixture");
    const model = normalizeManageModel({
      ...mockFund,
      positionsSummary: {
        protocolVersion: "v2",
        positions: [p, { ...p, positionKey: `0x${"5".repeat(64)}` }, { ...p, chainId: "8453" }],
      },
    });
    const graph = layoutManageGraph(model);
    expect(graph.nodes.filter((n) => n.kind === "position")).toHaveLength(3);
    expect(graph.nodes.filter((n) => n.kind === "cash")).toHaveLength(3);
    expect(graph.nodes.filter((n) => n.kind === "group")).toHaveLength(2);
  });
});

function centerX(node: { rect: { x: number; w: number } }): number {
  return node.rect.x + node.rect.w / 2;
}
function horizontalRuns(edge: { points: ReadonlyArray<{ x: number; y: number }> }) {
  return edge.points.slice(1).flatMap((point, index) => {
    const previous = edge.points[index];
    return previous && previous.y === point.y && previous.x !== point.x
      ? [{ y: point.y, left: Math.min(previous.x, point.x), right: Math.max(previous.x, point.x) }]
      : [];
  });
}
function orthogonalRuns(edge: { points: ReadonlyArray<{ x: number; y: number }> }) {
  return edge.points.slice(1).flatMap((point, index) => {
    const previous = edge.points[index];
    if (!previous) return [];
    if (previous.y === point.y && previous.x !== point.x)
      return [
        {
          axis: "horizontal",
          fixed: point.y,
          start: Math.min(previous.x, point.x),
          end: Math.max(previous.x, point.x),
        },
      ];
    if (previous.x === point.x && previous.y !== point.y)
      return [
        {
          axis: "vertical",
          fixed: point.x,
          start: Math.min(previous.y, point.y),
          end: Math.max(previous.y, point.y),
        },
      ];
    return [];
  });
}

describe("POO-2232 corrected geometry", () => {
  it("[R1,R2] single-spoke Bridge, Idle, input Swap, position and Collect share one straight axis", () => {
    const graph = layoutManageGraph(normalizeManageModel(mockFund));
    const sequence = graph.nodes.filter(
      (node) =>
        node.chainId === 4663 &&
        (node.kind === "idle" ||
          node.kind === "position" ||
          (node.kind === "flow" && node.flow !== "feeSwap")),
    );
    expect(new Set(sequence.map(centerX)).size).toBe(1);
    expect(sequence.every((node) => centerX(node) === 424)).toBe(true);
    const connector = graph.edges.find((edge) => edge.id === "bridge:idle:4663");
    expect(connector?.points).toHaveLength(2);
  });
  it("[R2,R3] centers entry/exit anchors symmetrically around hub, independent of lateral cash", () => {
    const graph = layoutManageGraph(normalizeManageModel(mockFund));
    const hub = graph.nodes.find((node) => node.kind === "deposit");
    const aave = graph.nodes.find((node) => node.kind === "position" && node.chainId === 42161);
    const bridge = graph.nodes.find((node) => node.kind === "flow" && node.flow === "bridge");
    const output = graph.nodes.find((node) => node.kind === "withdrawal");
    const income = graph.nodes.find((node) => node.kind === "income");
    if (!hub || !aave || !bridge || !output || !income) throw new Error("fixture nodes");
    expect(centerX(hub)).toBe(312);
    expect(centerX(aave)).toBe(200);
    expect(centerX(bridge)).toBe(424);
    expect(centerX(hub) - centerX(aave)).toBe(centerX(bridge) - centerX(hub));
    expect(centerX(output)).toBe(178);
    expect(centerX(income)).toBe(446);
    expect(centerX(hub) - centerX(output)).toBe(centerX(income) - centerX(hub));
  });
  it("[R3,R4] keeps cash lateral with a 24px connection and liquidity cards 176x232", () => {
    const graph = layoutManageGraph(normalizeManageModel(mockFund));
    for (const cash of graph.nodes.filter((node) => node.kind === "cash")) {
      const idle = graph.nodes.find(
        (node) => node.kind === "idle" && node.chainId === cash.chainId,
      );
      if (!idle) throw new Error("cash without idle");
      expect(cash.rect.x - idle.rect.x - idle.rect.w).toBe(24);
      expect(cash.rect.y + cash.rect.h / 2).toBe(idle.rect.y + idle.rect.h / 2);
      expect([cash.rect.w, cash.rect.h]).toEqual([144, 96]);
    }
    const position = graph.nodes.find((node) => node.kind === "position" && node.chainId === 4663);
    expect([position?.rect.w, position?.rect.h]).toEqual([176, 232]);
  });
  it("[R5,R6] routes principal and converted income on a shared bend height outside node interiors", () => {
    const graph = layoutManageGraph(normalizeManageModel(mockFund));
    const principal = graph.edges.find((edge) => edge.id.startsWith("principal:return:"));
    const income = graph.edges.find((edge) => edge.id.startsWith("income:return:"));
    if (!principal || !income) throw new Error("missing returns");
    const gray = horizontalRuns(principal).at(-1);
    const green = horizontalRuns(income).at(-1);
    expect(gray?.y).toBe(green?.y);
    if (!gray || !green) throw new Error("missing return bends");
    expect(green.left - gray.right).toBeGreaterThanOrEqual(24);
    for (const edge of graph.edges) {
      for (const [index, point] of edge.points.entries()) {
        const previous = edge.points[index - 1];
        if (!previous || previous.x !== point.x || previous.y === point.y) continue;
        const top = Math.min(previous.y, point.y);
        const bottom = Math.max(previous.y, point.y);
        for (const node of graph.nodes.filter((node) => node.kind !== "group")) {
          const crosses =
            point.x > node.rect.x &&
            point.x < node.rect.x + node.rect.w &&
            bottom > node.rect.y &&
            top < node.rect.y + node.rect.h;
          expect(crosses, `${edge.id} crosses ${node.id} vertically`).toBe(false);
        }
      }
      for (const run of horizontalRuns(edge)) {
        for (const node of graph.nodes.filter((node) => node.kind !== "group")) {
          const crosses =
            run.y > node.rect.y &&
            run.y < node.rect.y + node.rect.h &&
            run.right > node.rect.x &&
            run.left < node.rect.x + node.rect.w;
          expect(crosses, `${edge.id} crosses ${node.id}`).toBe(false);
        }
      }
    }
  });
  it("[R2,R3,R6] grows multi-spoke/multi-position bounds without overlapping cards or cash", () => {
    const source = mockFund.positionsSummary?.positions[1];
    if (!source) throw new Error("fixture");
    const model = normalizeManageModel({
      ...mockFund,
      positionsSummary: {
        protocolVersion: "v2",
        positions: [
          source,
          { ...source, positionKey: `0x${"5".repeat(64)}` },
          { ...source, chainId: "8453" },
          { ...source, chainId: "10", positionKey: `0x${"6".repeat(64)}` },
        ],
      },
    });
    const graph = layoutManageGraph(model);
    const nodes = graph.nodes.filter((node) => node.kind !== "group");
    for (let i = 0; i < nodes.length; i++)
      for (const b of nodes.slice(i + 1)) {
        const a = nodes[i];
        if (!a) continue;
        expect(
          a.rect.x < b.rect.x + b.rect.w &&
            b.rect.x < a.rect.x + a.rect.w &&
            a.rect.y < b.rect.y + b.rect.h &&
            b.rect.y < a.rect.y + a.rect.h,
          `${a.id} overlaps ${b.id}`,
        ).toBe(false);
      }
    expect(
      nodes.every((node) => node.rect.x >= 24 && node.rect.x + node.rect.w <= graph.width - 24),
    ).toBe(true);
    const bridges = graph.nodes.filter((node) => node.kind === "flow" && node.flow === "bridge");
    const hub = graph.nodes.find((node) => node.kind === "deposit");
    if (!hub) throw new Error("hub");
    expect((Math.min(...bridges.map(centerX)) + Math.max(...bridges.map(centerX))) / 2).toBe(
      centerX(hub),
    );
  });
  it("[R5,R6] keeps multi-position principal and fee returns distinct without collinear fusion or card crossings", () => {
    const source = mockFund.positionsSummary?.positions[1];
    if (!source) throw new Error("fixture");
    const graph = layoutManageGraph(
      normalizeManageModel({
        ...mockFund,
        positionsSummary: {
          protocolVersion: "v2",
          positions: [
            source,
            { ...source, positionKey: `0x${"5".repeat(64)}` },
            { ...source, chainId: "8453" },
            { ...source, chainId: "10", positionKey: `0x${"6".repeat(64)}` },
          ],
        },
      }),
    );
    const principal = graph.edges.filter((edge) => edge.id.startsWith("principal:"));
    const income = graph.edges.filter((edge) => edge.id.startsWith("income:"));
    expect(principal.length).toBeGreaterThan(1);
    expect(income.length).toBeGreaterThan(1);
    const outputNode = graph.nodes.find((node) => node.kind === "withdrawal");
    const incomeNode = graph.nodes.find((node) => node.kind === "income");
    if (!outputNode || !incomeNode) throw new Error("output nodes");
    expect(outputNode.rect.y).toBe(incomeNode.rect.y);
    const reaches = (
      edges: typeof principal,
      node: { rect: { x: number; y: number; w: number } },
    ) =>
      edges.filter((edge) => {
        const end = edge.points.at(-1);
        return end?.x === centerX(node) && end.y === node.rect.y;
      });
    const finalGray = reaches(principal, outputNode).flatMap((edge) =>
      horizontalRuns(edge).slice(-1),
    );
    const finalGreen = reaches(income, incomeNode).flatMap((edge) =>
      horizontalRuns(edge).slice(-1),
    );
    expect(finalGray.length).toBeGreaterThan(0);
    expect(finalGreen.length).toBeGreaterThan(0);
    for (const gray of finalGray)
      for (const green of finalGreen) {
        expect(gray.y).toBe(green.y);
        expect(green.left - gray.right).toBeGreaterThanOrEqual(24);
      }
    for (const gray of principal)
      for (const green of income) {
        for (const a of orthogonalRuns(gray))
          for (const b of orthogonalRuns(green)) {
            const overlap =
              a.axis === b.axis && a.fixed === b.fixed && a.start < b.end && b.start < a.end;
            expect(overlap, `${gray.id} fuses with ${green.id} ${a.axis}`).toBe(false);
          }
      }
    for (const edge of [...principal, ...income])
      for (const run of orthogonalRuns(edge)) {
        for (const node of graph.nodes.filter((node) => node.kind !== "group")) {
          const rect = node.rect;
          const crosses =
            run.axis === "horizontal"
              ? run.fixed > rect.y &&
                run.fixed < rect.y + rect.h &&
                run.end > rect.x &&
                run.start < rect.x + rect.w
              : run.fixed > rect.x &&
                run.fixed < rect.x + rect.w &&
                run.end > rect.y &&
                run.start < rect.y + rect.h;
          expect(crosses, `${edge.id} crosses ${node.id} ${run.axis}`).toBe(false);
        }
      }
  });
});
