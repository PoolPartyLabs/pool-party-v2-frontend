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
import { type GraphLayout, type LayoutInput, targetKey } from "../layout/graphTypes";
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
  shareNumber,
} from "./graphModel";

const EN = { startHereWidth: 420 };

function layoutOf(name: keyof typeof BUILD_CANVAS_FIXTURES): GraphLayout {
  return layoutGraph(BUILD_CANVAS_FIXTURES[name].input, EN);
}

function keys(items: GraphItem[]): string[] {
  return items.map((item) => item.key);
}

const block = (blockId: string) => targetKey({ kind: "block", blockId });
const port = (side: "before" | "after", blockId: string) =>
  targetKey({ kind: "port", side, blockId });
const label = (chainId: string | null, network: string, feedsBlockId: string | null) =>
  targetKey({ kind: "shareLabel", chainId, network, feedsBlockId });
const addProtocol = (network: string) => targetKey({ kind: "addProtocol", network });
const ADD_NETWORK = targetKey({ kind: "addNetwork" });

/** A plan the invariants refuse (INV1 duplicate_network): one network on two spokes. */
const TWIN_SPOKES: LayoutInput = {
  hubNetwork: "arbitrum",
  hub: { chains: [] },
  spokes: ["tw-1", "tw-2"].map((id) => ({
    network: "robinhood",
    sharePct: 20,
    chains: [
      {
        id,
        sharePct: 20,
        steps: [
          { id: `${id}-swap`, family: "flow", kind: "swap", auto: true, configured: true },
          {
            id: `${id}-pool`,
            family: "position",
            kind: "uniswapV4Pool",
            auto: false,
            configured: true,
          },
        ],
      },
    ],
  })),
};

describe("graphItems", () => {
  it.each(
    Object.keys(BUILD_CANVAS_FIXTURES) as Array<keyof typeof BUILD_CANVAS_FIXTURES>,
  )("places every node of %s exactly once, under a unique key", (name) => {
    const layout = layoutOf(name);
    const items = graphItems(layout);
    const expected =
      layout.spine.length +
      layout.blocks.length +
      (layout.feeSwaps?.length ?? 0) +
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
  it("[I10] lists canvas C chain by chain: label, ports and blocks top to bottom, then the templates", () => {
    expect(keys(graphItems(layoutGraph(canvasC.input, EN)))).toEqual([
      "spine:deposit",
      "spine:idleInput",
      label("c-pool", "arbitrum", "c-pool-pool"),
      block("c-pool-swap"),
      block("c-pool-pool"),
      block("c-pool-fees"),
      "fee-swap:c-pool-fees",
      label("c-supply", "arbitrum", "c-supply-supply"),
      port("before", "c-supply-supply"),
      block("c-supply-supply"),
      port("after", "c-supply-supply"),
      addProtocol("arbitrum"),
      ADD_NETWORK,
      "spine:idleOutput",
      "spine:income",
      "spine:withdraw",
    ]);
  });

  // @rule I10
  it("[I10] lists the empty canvas: the hub circle and its caption, Add network and its caption, the sentence", () => {
    expect(keys(graphItems(layoutGraph(canvasD.input, EN)))).toEqual([
      "spine:deposit",
      "spine:idleInput",
      addProtocol("arbitrum"),
      "caption:addProtocol",
      ADD_NETWORK,
      "caption:addNetwork",
      "caption:startHere",
      "spine:idleOutput",
      "spine:withdraw",
    ]);
  });

  // @rule I10
  it("[I10] lists a spoke as a whole: chip, share label, Bridge, its chains, its Add protocol", () => {
    expect(keys(graphItems(layoutGraph(newSpokeNoChain.input, EN)))).toEqual([
      "spine:deposit",
      "spine:idleInput",
      label("nsp-hub", "arbitrum", "nsp-hub-pool"),
      block("nsp-hub-swap"),
      block("nsp-hub-pool"),
      port("after", "nsp-hub-pool"),
      addProtocol("arbitrum"),
      "group:robinhood",
      label(null, "robinhood", null),
      "bridge:robinhood",
      addProtocol("robinhood"),
      ADD_NETWORK,
      "spine:idleOutput",
      "spine:withdraw",
    ]);
  });

  // @rule I10
  it("[I10] keeps a chain's blocks in order whatever the chains around it", () => {
    const layout = layoutGraph(canvasA.input, EN);
    const order = keys(graphItems(layout));
    for (const chain of canvasA.input.hub.chains) {
      const positions = chain.steps.map((step) => order.indexOf(block(step.id)));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      const first = positions[0] ?? -1;
      const last = positions[positions.length - 1] ?? -1;
      // Only the chain's own ports may sit between its blocks, never another chain's items.
      expect(last - first).toBeLessThan(chain.steps.length + 2);
    }
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

  // @rule F6
  it("[F6] a plan with one network on two spokes keeps both, under unique keys, nothing dropped", () => {
    const layout = layoutGraph(TWIN_SPOKES, EN);
    const items = graphItems(layout);
    expect(new Set(keys(items)).size).toBe(items.length);
    expect(items.filter((item) => item.type === "group")).toHaveLength(2);
    expect(items.filter((item) => item.type === "bridge")).toHaveLength(2);
    expect(items.filter((item) => item.type === "template")).toHaveLength(4);
    // Every node of the layout is an item: nothing silently dropped.
    expect(items).toHaveLength(
      layout.spine.length +
        layout.blocks.length +
        layout.bridges.length +
        layout.groups.length +
        layout.templates.length +
        layout.ports.length +
        layout.shareLabels.length,
    );
    // The second spoke reads after the first, each with its own chain.
    const order = keys(items);
    expect(order.indexOf(block("tw-1-pool"))).toBeLessThan(order.indexOf("group:robinhood#2"));
    expect(order.indexOf("group:robinhood#2")).toBeLessThan(order.indexOf(block("tw-2-pool")));
  });

  // @rule F6
  it("[F6] gives each twin spoke's label its own stub, and every line a unique id", () => {
    const layout = layoutGraph(TWIN_SPOKES, EN);
    const edges = pieceEdges(layout);
    expect(new Set(edges.map((edge) => edge.id)).size).toBe(edges.length);
    expect(edges).toHaveLength(layout.edges.length);
    const spokeLabels = graphItems(layout).filter(
      (item): item is Extract<GraphItem, { type: "label" }> =>
        item.type === "label" && item.node.target.chainId === null,
    );
    expect(spokeLabels.map((item) => item.edgeId)).toEqual([
      "stub:spoke:robinhood",
      "stub:spoke:robinhood#2",
    ]);
    for (const item of spokeLabels) {
      expect(edges.some((edge) => edge.id === item.edgeId)).toBe(true);
    }
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

  // @rule F3
  it("[F3] rounds a share once: 100 / 3 is 33.3 in every message and 33.3% on its label", () => {
    expect(shareNumber(100 / 3)).toBe("33.3");
    expect(formatShare(100 / 3)).toBe("33.3%");
    expect(shareNumber(60)).toBe("60");
    expect(formatShare(100 / 3)).toBe(`${shareNumber(100 / 3)}%`);
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
