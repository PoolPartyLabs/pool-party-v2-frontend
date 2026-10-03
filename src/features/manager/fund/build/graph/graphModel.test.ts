/**
 * @id PP-MGR-CMP-059
 * @name graphModel tests
 * @implements-rules-version v1 (POO-2156 rules v1)
 * @analytics-events none, pure helpers of the graph renderer: nothing here is rendered or tracked.
 *
 * What the renderer derives from a laid-out graph before it draws anything (handoff v1.2 [L7],
 * [I10], [C19], [BB8]): the items it places, their reading order, the layer each one paints in, the
 * key and target each one carries, the port tooltip per slot (D13), the tone of each line and the
 * share each card states in its name.
 */
import { describe, expect, it } from "vitest";
import {
  BUILD_CANVAS_FIXTURES,
  canvasA,
  canvasC,
  canvasD,
  newSpokeNoChain,
} from "@/mocks/data/buildCanvasFixtures";
import { type GraphLayout, targetKey } from "../layout/graphTypes";
import { layoutGraph } from "../layout/layoutGraph";
import {
  chainShares,
  formatShare,
  GRAPH_LAYER,
  type GraphItem,
  graphItems,
  itemLayer,
  itemTarget,
  pieceEdges,
  portTooltipKey,
  readingPoint,
  SPINE_ICON,
} from "./graphModel";

const EN = { startHereWidth: 420 };

function layoutOf(name: keyof typeof BUILD_CANVAS_FIXTURES): GraphLayout {
  return layoutGraph(BUILD_CANVAS_FIXTURES[name].input, EN);
}

function keys(items: GraphItem[]): string[] {
  return items.map((item) => item.key);
}

describe("graphItems", () => {
  it.each(
    Object.keys(BUILD_CANVAS_FIXTURES) as Array<keyof typeof BUILD_CANVAS_FIXTURES>,
  )("places every node of %s exactly once, under a unique key", (name) => {
    const layout = layoutOf(name);
    const items = graphItems(layout);
    const expected =
      layout.spine.length +
      layout.blocks.length +
      layout.bridges.length +
      layout.groups.length +
      layout.templates.length +
      layout.ports.length +
      layout.shareLabels.length +
      (layout.emptyCaptions ? 3 : 0);
    expect(items).toHaveLength(expected);
    expect(new Set(keys(items)).size).toBe(items.length);
  });

  // @rule I10
  it("[I10] lists canvas C in reading order: top to bottom, then left to right", () => {
    expect(keys(graphItems(layoutGraph(canvasC.input, EN)))).toEqual([
      "spine:deposit",
      "spine:idleInput",
      targetKey({
        kind: "shareLabel",
        chainId: "c-pool",
        network: "arbitrum",
        feedsBlockId: "c-pool-pool",
      }),
      targetKey({
        kind: "shareLabel",
        chainId: "c-supply",
        network: "arbitrum",
        feedsBlockId: "c-supply-supply",
      }),
      targetKey({ kind: "addNetwork" }),
      targetKey({ kind: "port", side: "before", blockId: "c-supply-supply" }),
      targetKey({ kind: "block", blockId: "c-pool-swap" }),
      targetKey({ kind: "block", blockId: "c-supply-supply" }),
      targetKey({ kind: "addProtocol", network: "arbitrum" }),
      targetKey({ kind: "block", blockId: "c-pool-pool" }),
      targetKey({ kind: "port", side: "after", blockId: "c-supply-supply" }),
      targetKey({ kind: "block", blockId: "c-pool-fees" }),
      "spine:idleOutput",
      "spine:income",
      "spine:withdraw",
    ]);
  });

  // @rule I10
  it("[I10] reads every item at its top edge and its horizontal centre", () => {
    const layout = layoutGraph(canvasC.input, EN);
    const byKey = new Map(graphItems(layout).map((item) => [item.key, item]));
    const supply = byKey.get(targetKey({ kind: "block", blockId: "c-supply-supply" }));
    const before = byKey.get(
      targetKey({ kind: "port", side: "before", blockId: "c-supply-supply" }),
    );
    const label = byKey.get(
      targetKey({
        kind: "shareLabel",
        chainId: "c-pool",
        network: "arbitrum",
        feedsBlockId: "c-pool-pool",
      }),
    );
    if (!supply || !before || !label) throw new Error("missing item");
    expect(readingPoint(supply)).toEqual({ top: 244, x: 320 });
    expect(readingPoint(before)).toEqual({ top: 236, x: 320 });
    expect(readingPoint(label)).toEqual({ top: 210, x: 112 });
  });

  // @rule I10
  it("[I10] reads a spoke group at its network chip, after the labels above it", () => {
    const layout = layoutGraph(newSpokeNoChain.input, EN);
    const items = graphItems(layout);
    const group = items.find((item) => item.type === "group");
    if (!group) throw new Error("no group");
    expect(readingPoint(group)).toEqual({ top: 228 - 10.5, x: layout.groups[0]?.chipAnchor.x });
    const order = keys(items);
    const spokeLabel = targetKey({
      kind: "shareLabel",
      chainId: null,
      network: "robinhood",
      feedsBlockId: null,
    });
    expect(order.indexOf(spokeLabel)).toBeLessThan(order.indexOf(group.key));
    expect(order.indexOf(group.key)).toBeLessThan(order.indexOf("bridge:robinhood"));
  });

  it("lists the empty canvas captions and the start-here sentence (L6)", () => {
    const items = graphItems(layoutGraph(canvasD.input, EN));
    expect(keys(items).filter((key) => key.startsWith("caption:"))).toEqual([
      "caption:addProtocol",
      "caption:addNetwork",
      "caption:startHere",
    ]);
  });
});

describe("itemLayer", () => {
  // @rule L7
  it("[L7] paints group boxes, lines, nodes, ports, then labels and chips, back to front", () => {
    expect(GRAPH_LAYER).toEqual({ groups: 0, lines: 1, nodes: 2, ports: 3, labels: 4 });
    const items = graphItems(layoutGraph(canvasA.input, EN));
    const layerOf = (type: GraphItem["type"]) =>
      new Set(items.filter((item) => item.type === type).map(itemLayer));
    expect(layerOf("group")).toEqual(new Set([GRAPH_LAYER.groups]));
    for (const type of ["spine", "block", "bridge", "template"] as const) {
      expect(layerOf(type)).toEqual(new Set([GRAPH_LAYER.nodes]));
    }
    expect(layerOf("port")).toEqual(new Set([GRAPH_LAYER.ports]));
    expect(layerOf("label")).toEqual(new Set([GRAPH_LAYER.labels]));
  });
});

describe("itemTarget", () => {
  it("gives templates, ports, cards and share labels their target; nothing else has one", () => {
    const layout = layoutGraph(canvasA.input, EN);
    for (const item of graphItems(layout)) {
      const target = itemTarget(item);
      if (item.type === "template" || item.type === "port" || item.type === "label") {
        expect(target).toEqual(item.node.target);
      } else if (item.type === "block" && item.node.family === "position") {
        expect(target).toEqual({ kind: "block", blockId: item.node.id });
      } else {
        expect(target).toBeNull();
      }
      if (target) expect(item.key).toBe(targetKey(target));
    }
  });
});

describe("portTooltipKey", () => {
  // @rule C19
  it("[C19, D13] names what the slot's menu offers: before any card, after a pool, a supply, a borrow", () => {
    expect(portTooltipKey("before", "uniswapV4Pool")).toBe("portBefore");
    expect(portTooltipKey("before", "aaveSupply")).toBe("portBefore");
    expect(portTooltipKey("after", "uniswapV4Pool")).toBe("portAfterPool");
    expect(portTooltipKey("after", "uniswapV3Pool")).toBe("portAfterPool");
    expect(portTooltipKey("after", "aaveSupply")).toBe("portAfterSupply");
    expect(portTooltipKey("after", "aaveBorrow")).toBe("portAfterBorrow");
  });
});

describe("pieceEdges", () => {
  // @rule BB8
  it("[BB8] maps income lines to the income tone and every other kind to muted, keeping ids and points", () => {
    const layout = layoutGraph(canvasC.input, EN);
    const edges = pieceEdges(layout);
    expect(edges).toHaveLength(layout.edges.length);
    for (const [index, edge] of layout.edges.entries()) {
      expect(edges[index]).toEqual({
        id: edge.id,
        tone: edge.kind === "income" ? "income" : "muted",
        points: edge.points,
      });
    }
    expect(edges.some((edge) => edge.tone === "income")).toBe(true);
  });
});

describe("chainShares and formatShare", () => {
  it("reads each chain's share from its label (C8), spokes excluded", () => {
    const shares = chainShares(layoutGraph(canvasA.input, EN));
    expect(shares.get("a-hub-1")).toBe(15);
    expect(shares.get("a-base-3")).toBe(10);
    // Three hub chains, three on Base, two on Robinhood Chain.
    expect(shares.size).toBe(8);
  });

  it("prints a share as a percent, whole numbers without decimals", () => {
    expect(formatShare(60)).toBe("60%");
    expect(formatShare(0)).toBe("0%");
    expect(formatShare(12.5)).toBe("12.5%");
  });
});

describe("SPINE_ICON", () => {
  it("[BB2] draws Deposit, Idle input, Idle output, Income (fees) and Withdraw with their icons", () => {
    expect(SPINE_ICON).toEqual({
      deposit: "depositIn",
      idleInput: "hourglass",
      idleOutput: "hourglass",
      income: "coins",
      withdraw: "withdrawOut",
    });
  });
});
