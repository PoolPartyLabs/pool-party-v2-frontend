/**
 * @id PP-MGR-LIB-023
 * @name layoutReturnRules tests
 * @implements-rules-version v2 (POO-2345)
 * @analytics-events none, a pure geometry module: nothing here is rendered or tracked.
 *
 * One test per rule R3 to R7 of POO-2345 v2. Each reads the visible lines of every layout
 * fixture (`layout.connections`, full paths) and checks one property of the return lines.
 */

import { describe, expect, it } from "vitest";
import { BUILD_CANVAS_FIXTURES, solanaTwoChainReturn } from "@/mocks/data/buildCanvasFixtures";
import type { BridgeNode, EdgeNode, GraphLayout, LayoutInput, Point } from "./graphTypes";
import { layoutGraph } from "./layoutGraph";

const EN = { startHereWidth: 420 };
const FIXTURES = { ...BUILD_CANVAS_FIXTURES, solanaTwoChainReturn };

const CASES = Object.entries(FIXTURES).map(
  ([name, fixture]) => [name, fixture.input, layoutGraph(fixture.input, EN)] as const,
);

/** The x of the first vertical stretch of a line. */
function firstVerticalX(points: readonly Point[]): number {
  for (let index = 0; index + 1 < points.length; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (a && b && a.x === b.x && a.y !== b.y) return a.x;
  }
  throw new Error("a line with no vertical stretch");
}

function lastPoint(edge: EdgeNode): Point {
  return edge.points[edge.points.length - 1] as Point;
}

function outboundBridges(layout: GraphLayout): BridgeNode[] {
  return layout.bridges.filter((bridge) => bridge.direction === "outbound");
}

/** The lines that end on the top edge of a Bridge, with the x of the port they end at. */
function entering(layout: GraphLayout, bridge: BridgeNode): { edge: EdgeNode; x: number }[] {
  return (layout.connections ?? [])
    .filter((edge) => edge.kind === "principal" || edge.kind === "income")
    .filter((edge) => {
      const end = lastPoint(edge);
      return (
        end.y === bridge.rect.y && end.x >= bridge.rect.x && end.x <= bridge.rect.x + bridge.rect.w
      );
    })
    .map((edge) => ({ edge, x: lastPoint(edge).x }));
}

/** The lines that start on the bottom edge of a Bridge, with the x of the port they leave. */
function leaving(layout: GraphLayout, bridge: BridgeNode): { edge: EdgeNode; x: number }[] {
  const bottom = bridge.rect.y + bridge.rect.h;
  return (layout.connections ?? [])
    .filter((edge) => edge.kind === "principal" || edge.kind === "income")
    .filter((edge) => {
      const start = edge.points[0] as Point;
      return (
        start.y === bottom && start.x >= bridge.rect.x && start.x <= bridge.rect.x + bridge.rect.w
      );
    })
    .map((edge) => ({ edge, x: (edge.points[0] as Point).x }));
}

/** The chain id of a visible return line: `principal:chain:<id>` or `income:converted:<feeId>`. */
function chainOf(input: LayoutInput, edgeId: string): string {
  const feeId = edgeId.startsWith("income:converted:")
    ? edgeId.slice("income:converted:".length)
    : null;
  const chains = [...input.hub.chains, ...input.spokes.flatMap((spoke) => spoke.chains)];
  const chain = feeId
    ? chains.find((entry) => entry.steps.some((step) => step.id === feeId))
    : chains.find((entry) => edgeId === `principal:chain:${entry.id}`);
  if (!chain) throw new Error(`no chain for ${edgeId}`);
  return chain.id;
}

describe("R3: the input ports of a return Bridge follow the lines", () => {
  // @rule R3
  it("[R3] orders the top ports like the x where their lines start, in every fixture", () => {
    let bridges = 0;
    for (const [name, , layout] of CASES) {
      for (const bridge of outboundBridges(layout)) {
        bridges += 1;
        const row = entering(layout, bridge).sort((a, b) => a.x - b.x);
        const sources = row.map((entry) => firstVerticalX(entry.edge.points));
        expect(sources, `${name} ${bridge.rect.x}`).toEqual([...sources].sort((a, b) => a - b));
        expect(new Set(row.map((entry) => entry.x)).size, name).toBe(row.length);
      }
    }
    expect(bridges).toBeGreaterThan(0);
  });

  // @rule R3
  it("[R3] puts the income port of a chain left of its principal port", () => {
    let pairs = 0;
    for (const [name, input, layout] of CASES) {
      for (const bridge of outboundBridges(layout)) {
        const row = entering(layout, bridge);
        for (const principal of row.filter((entry) => entry.edge.kind === "principal")) {
          const chain = chainOf(input, principal.edge.id);
          for (const income of row.filter((entry) => entry.edge.kind === "income")) {
            if (chainOf(input, income.edge.id) !== chain) continue;
            pairs += 1;
            expect(income.x, `${name} ${chain}`).toBeLessThan(principal.x);
          }
        }
      }
    }
    expect(pairs).toBeGreaterThan(0);
  });
});

describe("R4: the output ports of a return Bridge are grouped by class", () => {
  // @rule R4
  it("[R4] puts the principal ports left of the income ports", () => {
    let bridges = 0;
    for (const [name, , layout] of CASES) {
      for (const bridge of outboundBridges(layout)) {
        bridges += 1;
        const row = leaving(layout, bridge).sort((a, b) => a.x - b.x);
        const kinds = row.map((entry) => entry.edge.kind);
        const firstIncome = kinds.indexOf("income");
        expect(kinds.slice(firstIncome < 0 ? kinds.length : firstIncome), name).not.toContain(
          "principal",
        );
        expect(new Set(row.map((entry) => entry.x)).size, name).toBe(row.length);
      }
    }
    expect(bridges).toBeGreaterThan(0);
  });

  // @rule R4
  it("[R4] sends the principal ports to Idle output and the income ports to Income", () => {
    let lines = 0;
    for (const [name, , layout] of CASES) {
      const output = layout.spine.find((node) => node.role === "idleOutput");
      const income = layout.spine.find((node) => node.role === "income");
      for (const bridge of outboundBridges(layout)) {
        for (const { edge } of leaving(layout, bridge)) {
          lines += 1;
          const target = edge.kind === "principal" ? output : income;
          expect(lastPoint(edge).x, `${name} ${edge.id}`).toBe(
            (target?.rect.x ?? Number.NaN) + (target?.rect.w ?? 0) / 2,
          );
        }
      }
    }
    expect(lines).toBeGreaterThan(0);
  });

  // @rule R4
  it("[R4] keeps the transfer inside a Bridge out of the visible lines", () => {
    for (const [name, , layout] of CASES) {
      const ids = [...(layout.connections ?? []), ...layout.edges].map((edge) => edge.id);
      expect(
        ids.filter((id) => id.startsWith("bridge-transfer:")),
        name,
      ).toEqual([]);
    }
  });
});
