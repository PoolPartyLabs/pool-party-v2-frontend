/**
 * @id PP-MGR-CMP-059
 * @name graphModel
 * @implements-rules-version v1 (POO-2156 rules v1); POO-2213 rules v1; POO-2235 rules v1; POO-2237 rules v1
 * @analytics-events none, pure helpers of the graph renderer: activations leave the renderer through
 *   `onTarget` and the Build screen (PP-MGR-SCR-002, S7) owns every event.
 *
 * What {@link BuildGraph} derives from a laid-out graph before it draws anything. Pure: same layout,
 * same answer; no DOM, no React, no strings (copy is the renderer's, through next-intl).
 *
 * 1. **Items in reading order ([I10], coordinator decision on the review of PR #35).** Every node the
 *    layout returns becomes one item with a stable key, and the items are read CHAIN BY CHAIN, the
 *    way the money flows: Deposit and Idle input; each hub chain left to right (its share label,
 *    then its ports and blocks top to bottom, so a before-port precedes its card and an after-port
 *    follows it); the hub's Add protocol; each spoke as a whole (its chip, its share label, its
 *    Bridge, its chains in the same order, its Add protocol); Add network; then Idle output, Income
 *    (fees) and Withdraw. The DOM follows this order, so the tab order is the reading order and
 *    nothing needs a positive `tabIndex`. On the empty canvas each caption follows its template and
 *    the start-here sentence follows them. Where an item sits (hub or which spoke) is read from the
 *    geometry (a spoke owns what lies within its box's width), so a malformed plan still places
 *    every item; anything left over is read by position before the bottom of the spine.
 * 2. **Keys.** A key is the {@link targetKey} of the item's target, or its kind and network; a key
 *    met again (a plan that names one network on two spokes, which the invariants refuse) takes the
 *    suffix `#2`, `#3`, so React never sees a duplicate and nothing is dropped. Line ids get the same
 *    treatment, and a share label points at its own occurrence of its stub.
 * 3. **Layers ([L7]).** Back to front: group boxes, lines, cards, pills and templates (and the spine
 *    cards and the empty-canvas copy), insert ports, share labels and network chips. Because the DOM
 *    is in reading order, not in layer order, the renderer paints the layers with `z-index`.
 * 4. **Port tooltips (D13).** A port names what its menu offers: before any card "Swap"; after a
 *    pool "Collect fees"; after a supply "Borrow, Swap"; after a borrow "Swap" (the I4 list).
 * 5. **Line tones.** `income` lines are green, every other kind is muted (the `GraphEdges` contract).
 * 6. **Shares.** A share is rounded once ({@link shareNumber}) and the same text goes on the label,
 *    in its tooltip and in the card's name, so 100 / 3 reads 33.3 everywhere.
 */
import { formatPercent } from "@/lib/utils/format";
import type {
  BlockNode,
  BridgeNode,
  EdgeKind,
  FeeSwapNode,
  GraphLayout,
  GraphTarget,
  GroupNode,
  Point,
  PortNode,
  Rect,
  ShareLabelNode,
  SpineNode,
  SpineRole,
  TemplateNode,
} from "../layout/graphTypes";
import { targetKey } from "../layout/graphTypes";
import { LAYOUT } from "../layout/layoutConstants";
import type { BlockIcon, PieceEdge } from "../pieces/pieceTypes";

/** One thing the renderer places. `key` is unique within a layout and stable across re-flows. */
export type GraphItem =
  | { type: "spine"; key: string; node: SpineNode }
  | { type: "block"; key: string; node: BlockNode }
  | { type: "bridge"; key: string; node: BridgeNode }
  | { type: "feeSwap"; key: string; node: FeeSwapNode }
  | { type: "group"; key: string; node: GroupNode }
  | { type: "template"; key: string; node: TemplateNode }
  | { type: "port"; key: string; node: PortNode }
  | { type: "label"; key: string; node: ShareLabelNode; edgeId: string }
  | { type: "caption"; key: string; caption: "addProtocol" | "addNetwork"; at: Point }
  | { type: "sentence"; key: string; rect: Rect };

/** The paint layers of [L7], back to front. Tooltips and menus are portalled overlays above them. */
export const GRAPH_LAYER = { groups: 0, lines: 1, nodes: 2, ports: 3, labels: 4 } as const;

/** The network chip is 21 high, centred on the group's top border ([BB5]). */
const CHIP_H = 21;

/** The icon of each spine card ([BB2]). */
export const SPINE_ICON: Readonly<Record<SpineRole, BlockIcon>> = {
  deposit: "depositIn",
  idleInput: "hourglass",
  idleOutput: "hourglass",
  income: "coins",
  withdraw: "withdrawOut",
};

/** A key part that cannot collide with a separator: percent-encoded, as `targetKey` does. */
function part(value: string): string {
  return encodeURIComponent(value);
}

/** A namer that returns `id` the first time, then `id#2`, `id#3` for each repeat. */
function occurrences(): (id: string) => string {
  const seen = new Map<string, number>();
  return (id) => {
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    return count === 1 ? id : `${id}#${count}`;
  };
}

/**
 * Every node of a layout, one item each, in the layout's own order. Keys are not yet unique; a
 * label's `edgeId` already names its own occurrence of its stub (the n-th label on a stub id gets
 * the n-th line with that id, as {@link pieceEdges} names them).
 */
function collect(layout: GraphLayout): GraphItem[] {
  const labelEdge = occurrences();
  const items: GraphItem[] = [];
  for (const node of layout.spine) items.push({ type: "spine", key: `spine:${node.role}`, node });
  for (const node of layout.blocks) {
    items.push({ type: "block", key: targetKey({ kind: "block", blockId: node.id }), node });
  }
  for (const node of layout.feeSwaps ?? []) {
    items.push({ type: "feeSwap", key: `fee-swap:${part(node.sourceBlockId)}`, node });
  }
  for (const node of layout.bridges) {
    items.push({ type: "bridge", key: `bridge:${part(node.network)}`, node });
  }
  for (const node of layout.groups) {
    items.push({ type: "group", key: `group:${part(node.network)}`, node });
  }
  for (const node of layout.templates) {
    items.push({ type: "template", key: targetKey(node.target), node });
  }
  for (const node of layout.ports) items.push({ type: "port", key: targetKey(node.target), node });
  for (const node of layout.shareLabels) {
    items.push({
      type: "label",
      key: targetKey(node.target),
      node,
      edgeId: labelEdge(node.edgeId),
    });
  }
  const captions = layout.emptyCaptions;
  if (captions) {
    items.push(
      {
        type: "caption",
        key: "caption:addProtocol",
        caption: "addProtocol",
        at: captions.addProtocol,
      },
      {
        type: "caption",
        key: "caption:addNetwork",
        caption: "addNetwork",
        at: captions.addNetwork,
      },
      { type: "sentence", key: "caption:startHere", rect: captions.startHere },
    );
  }
  return items;
}

/**
 * Where an item is read ([I10]): the top edge of what is drawn and its horizontal centre. A group is
 * read at its chip (the chip's left edge: its width follows the network name).
 */
export function readingPoint(item: GraphItem): { top: number; x: number } {
  switch (item.type) {
    case "spine":
    case "block":
    case "bridge":
    case "feeSwap":
    case "template": {
      const { rect } = item.node;
      return { top: rect.y, x: rect.x + rect.w / 2 };
    }
    case "group":
      return { top: item.node.chipAnchor.y - CHIP_H / 2, x: item.node.chipAnchor.x };
    case "port":
      return { top: item.node.center.y - LAYOUT.PORT / 2, x: item.node.center.x };
    case "label":
      return { top: item.node.center.y - LAYOUT.SHARE_LABEL_H / 2, x: item.node.center.x };
    case "caption":
      return { top: item.at.y, x: item.at.x };
    case "sentence":
      return { top: item.rect.y, x: item.rect.x + item.rect.w / 2 };
  }
}

/** Inside one chain, at the same top: the label, a before-port, the block, an after-port. */
function chainRank(item: GraphItem): number {
  if (item.type === "label") return 0;
  if (item.type === "port") return item.node.target.side === "before" ? 1 : 3;
  return 2;
}

/** Items sorted by where they are read: top edge, then horizontal centre. Stable. */
function byPosition(items: GraphItem[]): GraphItem[] {
  return items
    .map((item) => ({ item, at: readingPoint(item) }))
    .sort((a, b) => a.at.top - b.at.top || a.at.x - b.at.x)
    .map(({ item }) => item);
}

interface SpokeSlot {
  group: GraphItem[];
  labels: GraphItem[];
  bridges: GraphItem[];
  chains: string[];
  tail: GraphItem[];
}

/**
 * Every node of a layout as an item, in reading order ([I10]): chain by chain, the hub first, then
 * each spoke as a whole (see the file header). Keys are unique.
 */
export function graphItems(layout: GraphLayout): GraphItem[] {
  const chainOf = new Map(layout.blocks.map((node) => [node.id, node.chainId]));
  const spokes: SpokeSlot[] = layout.groups.map(() => ({
    group: [],
    labels: [],
    bridges: [],
    chains: [],
    tail: [],
  }));
  const hub = { chains: [] as string[], tail: [] as GraphItem[] };
  const chains = new Map<string, GraphItem[]>();
  const spineTop: GraphItem[] = [];
  const spineBottom: GraphItem[] = [];
  const end: GraphItem[] = [];
  const leftover: GraphItem[] = [];

  // The spoke whose box spans x, or null for the hub (spokes never overlap the hub's chains).
  const spokeAt = (x: number): SpokeSlot | null => {
    const index = layout.groups.findIndex(
      (group) => x >= group.rect.x && x <= group.rect.x + group.rect.w,
    );
    return spokes[index] ?? null;
  };
  const toChain = (chainId: string, item: GraphItem) => {
    let list = chains.get(chainId);
    if (!list) {
      list = [];
      chains.set(chainId, list);
      (spokeAt(readingPoint(item).x) ?? hub).chains.push(chainId);
    }
    list.push(item);
  };

  for (const item of collect(layout)) {
    switch (item.type) {
      case "spine":
        (item.node.role === "deposit" || item.node.role === "idleInput"
          ? spineTop
          : spineBottom
        ).push(item);
        break;
      case "block":
      case "feeSwap":
        toChain(item.node.chainId, item);
        break;
      case "port": {
        const chainId = chainOf.get(item.node.target.blockId);
        if (chainId === undefined) leftover.push(item);
        else toChain(chainId, item);
        break;
      }
      case "label": {
        const { chainId } = item.node.target;
        if (chainId !== null) {
          toChain(chainId, item);
          break;
        }
        const spoke = spokeAt(item.node.center.x);
        if (spoke) spoke.labels.push(item);
        else leftover.push(item);
        break;
      }
      case "group": {
        const spoke = spokes[layout.groups.indexOf(item.node)];
        if (spoke) spoke.group.push(item);
        else leftover.push(item);
        break;
      }
      case "bridge": {
        const spoke = spokeAt(readingPoint(item).x);
        if (spoke) spoke.bridges.push(item);
        else leftover.push(item);
        break;
      }
      case "template":
        if (item.node.target.kind === "addNetwork") end.push(item);
        else (spokeAt(readingPoint(item).x) ?? hub).tail.push(item);
        break;
      case "caption":
        // Each caption follows its template: the hub circle's in the hub, the box's at the end.
        (item.caption === "addProtocol" ? hub.tail : end).push(item);
        break;
      case "sentence":
        end.push(item);
        break;
    }
  }

  const chainItems = (chainId: string): GraphItem[] =>
    (chains.get(chainId) ?? [])
      .map((item) => ({ item, top: readingPoint(item).top }))
      .sort((a, b) => a.top - b.top || chainRank(a.item) - chainRank(b.item))
      .map(({ item }) => item);

  const ordered: GraphItem[] = [
    ...spineTop,
    ...hub.chains.flatMap(chainItems),
    ...hub.tail,
    ...spokes.flatMap((spoke) => [
      ...spoke.group,
      ...spoke.labels,
      ...spoke.bridges,
      ...spoke.chains.flatMap(chainItems),
      ...spoke.tail,
    ]),
    ...end,
    ...byPosition(leftover),
    ...spineBottom,
  ];
  const unique = occurrences();
  return ordered.map((item) => ({ ...item, key: unique(item.key) }));
}

/** The [L7] layer an item paints in. A group's chip is lifted to the label layer by the renderer. */
export function itemLayer(item: GraphItem): number {
  switch (item.type) {
    case "group":
      return GRAPH_LAYER.groups;
    case "port":
      return GRAPH_LAYER.ports;
    case "label":
      return GRAPH_LAYER.labels;
    default:
      return GRAPH_LAYER.nodes;
  }
}

/**
 * The target an item reports and carries as `data-graph-target`: templates, ports, share labels and
 * position cards. Spine cards, pills, the Bridge, groups and the empty-canvas copy have none (I5).
 */
export function itemTarget(item: GraphItem): GraphTarget | null {
  switch (item.type) {
    case "template":
    case "port":
    case "label":
      return item.node.target;
    case "block":
      return item.node.family === "position" || (item.node.kind === "swap" && !item.node.auto)
        ? { kind: "block", blockId: item.node.id }
        : null;
    default:
      return null;
  }
}

/** The four port tooltips of D13, keys under `fundBuilder.canvas.tooltip`. */
export type PortTooltipKey = "portBefore" | "portAfterPool" | "portAfterSupply" | "portAfterBorrow";

/**
 * D13: the tooltip of a port names what its menu offers, by the side of the port and the kind of
 * the card it sits on (I4: before any card a Swap; after a pool its Collect fees; after a supply a
 * Borrow or a Swap; after a borrow a Swap). A kind with no "after" menu (none is configured in this
 * batch) reads as the plain Swap slot.
 */
export function portTooltipKey(side: "before" | "after", blockKind: string): PortTooltipKey {
  if (side === "before") return "portBefore";
  if (blockKind === "uniswapV4Pool" || blockKind === "uniswapV3Pool") return "portAfterPool";
  if (blockKind === "aaveSupply") return "portAfterSupply";
  if (blockKind === "aaveBorrow") return "portAfterBorrow";
  return "portBefore";
}

/** The `GraphEdges` tone of a layout edge: income is green, everything else muted ([BB8]). */
export function edgeTone(kind: EdgeKind): PieceEdge["tone"] {
  return kind === "income" ? "income" : "muted";
}

/**
 * The layout's edges as `GraphEdges` draws them, points unchanged. An id met again (two spokes on
 * one network repeat their stub ids) takes `#2`, `#3`, so every line keeps its own key.
 */
export function pieceEdges(layout: GraphLayout): PieceEdge[] {
  const unique = occurrences();
  return layout.edges.map((edge) => ({
    id: unique(edge.id),
    tone: edgeTone(edge.kind),
    points: edge.points,
  }));
}

/** Each chain's share of the strategy, read from its label (C8). Spoke labels name no chain. */
export function chainShares(layout: GraphLayout): Map<string, number> {
  const shares = new Map<string, number>();
  for (const label of layout.shareLabels) {
    if (label.target.chainId !== null) shares.set(label.target.chainId, label.pct);
  }
  return shares;
}

/** Whole shares print no decimals, any other share one. */
function shareDigits(pct: number): number {
  return Number.isInteger(pct) ? 0 : 1;
}

/**
 * A share rounded once, as the text every message receives ("{pct}% of the strategy's capital"):
 * "60", "12.5", and 100 / 3 is "33.3". The same digits as {@link formatShare}, so the label, its
 * tooltip and the card's name never disagree.
 */
export function shareNumber(pct: number): string {
  return pct.toFixed(shareDigits(pct));
}

/** A share as printed on its label ([BB4]): "60%", "0%", "12.5%", "33.3%". */
export function formatShare(pct: number): string {
  return formatPercent(pct, shareDigits(pct));
}

/** Complete hover paths mapped with the same tone and stable id contract as resting edges. */
export function pieceConnections(layout: GraphLayout): PieceEdge[] {
  const unique = occurrences();
  return (layout.connections ?? layout.edges).map((edge) => ({
    id: unique(edge.id),
    tone: edgeTone(edge.kind),
    points: edge.points,
  }));
}
