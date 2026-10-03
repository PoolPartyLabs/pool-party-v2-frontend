/**
 * @id PP-MGR-CMP-059
 * @name graphModel
 * @implements-rules-version v1 (POO-2156 rules v1)
 * @analytics-events none, pure helpers of the graph renderer: activations leave the renderer through
 *   `onTarget` and the Build screen (PP-MGR-SCR-002, S7) owns every event.
 *
 * What {@link BuildGraph} derives from a laid-out graph before it draws anything. Pure: same layout,
 * same answer; no DOM, no React, no strings (copy is the renderer's, through next-intl).
 *
 * 1. **Items in reading order ([I10]).** Every node the layout returns becomes one item with a
 *    stable key (the {@link targetKey} of its target when it has one), and the items are sorted the
 *    way a page is read: by the TOP edge of what is drawn, then by its horizontal CENTRE. The DOM
 *    follows this order, so the tab order is the reading order and nothing needs a positive
 *    `tabIndex`. A spoke group is read where its network chip sits (the chip is its only focusable
 *    part), so the chip comes after the share labels above it and before its Bridge.
 * 2. **Layers ([L7]).** Back to front: group boxes, lines, cards, pills and templates (and the spine
 *    cards and the empty-canvas copy), insert ports, share labels and network chips. Because the DOM
 *    is in reading order, not in layer order, the renderer paints the layers with `z-index`.
 * 3. **Port tooltips (D13).** A port names what its menu offers: before any card "Swap"; after a
 *    pool "Collect fees"; after a supply "Borrow, Swap"; after a borrow "Swap" (the I4 list).
 * 4. **Line tones.** `income` lines are green, every other kind is muted (the `GraphEdges` contract).
 */
import { formatPercent } from "@/lib/utils/format";
import type {
  BlockNode,
  BridgeNode,
  EdgeKind,
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
  | { type: "group"; key: string; node: GroupNode }
  | { type: "template"; key: string; node: TemplateNode }
  | { type: "port"; key: string; node: PortNode }
  | { type: "label"; key: string; node: ShareLabelNode }
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

/** Every node of a layout, one item each, before sorting. */
function collect(layout: GraphLayout): GraphItem[] {
  const items: GraphItem[] = [];
  for (const node of layout.spine) items.push({ type: "spine", key: `spine:${node.role}`, node });
  for (const node of layout.blocks) {
    items.push({ type: "block", key: targetKey({ kind: "block", blockId: node.id }), node });
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
    items.push({ type: "label", key: targetKey(node.target), node });
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

/**
 * Every node of a layout as an item, in reading order ([I10]): top to bottom, then left to right.
 * The sort is stable, so two items read at the same point keep the layout's order.
 */
export function graphItems(layout: GraphLayout): GraphItem[] {
  return collect(layout)
    .map((item) => ({ item, at: readingPoint(item) }))
    .sort((a, b) => a.at.top - b.at.top || a.at.x - b.at.x)
    .map(({ item }) => item);
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
      return item.node.family === "position" ? { kind: "block", blockId: item.node.id } : null;
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

/** The layout's edges as `GraphEdges` draws them (ids and points unchanged). */
export function pieceEdges(layout: GraphLayout): PieceEdge[] {
  return layout.edges.map((edge) => ({
    id: edge.id,
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

/** A share as printed on its label ([BB4]): "60%", "0%", "12.5%". */
export function formatShare(pct: number): string {
  return formatPercent(pct, Number.isInteger(pct) ? 0 : 1);
}
