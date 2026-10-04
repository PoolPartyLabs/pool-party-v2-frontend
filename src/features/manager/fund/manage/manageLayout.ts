/**
 * @id PP-MGR-LIB-052
 * @name manageLayout
 * @implements-rules-version v1 (POO-2226, POO-2232)
 * @analytics-events none, pure read-only layout.
 *
 * Build's sizes, chain hierarchy and orthogonal relationships with taller live balance cards.
 * Unmapped positions remain independent identity nodes; this layout does not claim persisted lineage.
 */
import type { Rect } from "../build/layout/graphTypes";
import { LAYOUT } from "../build/layout/layoutConstants";
import type { PieceEdge } from "../build/pieces/pieceTypes";
import type { ManageModel } from "./manageModel";

export type ManageNode = {
  id: string;
  rect: Rect;
  chainId?: number;
  positionId?: string;
} & (
  | { kind: "position" }
  | { kind: "cash" | "idle" | "group" }
  | { kind: "flow"; flow: "swap" | "collectFees" | "feeSwap" | "bridge" }
  | { kind: "deposit" | "withdraw" | "withdrawal" | "income" }
);
export interface ManageLayout {
  width: number;
  height: number;
  nodes: ManageNode[];
  edges: PieceEdge[];
}
const CASH = { w: 160, h: 136 };
const POSITION = { supply: 160, liquidity: 232, unsupported: 160 };
const OUTPUT = { withdrawal: 168, income: 102 };
const POSITION_STEP = LAYOUT.CARD_W + LAYOUT.SIBLING;
const positionRowWidth = (count: number) => LAYOUT.CARD_W + Math.max(0, count - 1) * POSITION_STEP;

/** Geometry depends only on observed chain/position identities, never panel selection or draft. */
export function layoutManageGraph(model: ManageModel): ManageLayout {
  const nodes: ManageNode[] = [];
  const edges: PieceEdge[] = [];
  const add = (node: ManageNode) => {
    nodes.push(node);
    return node;
  };
  const edge = (id: string, points: PieceEdge["points"], tone: PieceEdge["tone"] = "muted") =>
    edges.push({ id, points, tone });
  const center = (n: ManageNode) => n.rect.x + n.rect.w / 2;
  const bottom = (n: ManageNode) => n.rect.y + n.rect.h;
  const hub = model.chains.find((c) => c.hub);
  const spokes = model.chains.filter((c) => !c.hub);
  // Entry anchors determine the hub axis. Cash only enlarges the enclosing chain/canvas bounds.
  const firstPositionLeft = LAYOUT.CANVAS_PAD + LAYOUT.CARD_W / 2;
  const hubCount = hub?.positions.length ?? 0;
  const hubRowWidth = hubCount ? positionRowWidth(hubCount) : 0;
  let cursor = hubCount
    ? firstPositionLeft + hubRowWidth + LAYOUT.SIBLING
    : firstPositionLeft - LAYOUT.GROUP_PAD;
  const spokeSlots = spokes.map((chain) => {
    const x = cursor;
    const rowWidth = positionRowWidth(chain.positions.length);
    const axis = x + LAYOUT.GROUP_PAD + rowWidth / 2;
    const right = Math.max(
      x + LAYOUT.GROUP_PAD + rowWidth + LAYOUT.PAIR,
      axis + LAYOUT.CARD_W / 2 + LAYOUT.LINK + CASH.w,
    );
    const width = right + LAYOUT.GROUP_PAD - x;
    cursor += width + LAYOUT.SIBLING;
    return { chain, x, width, axis };
  });
  const entryAxes = [
    ...Array.from(
      { length: hubCount },
      (_, index) => firstPositionLeft + LAYOUT.CARD_W / 2 + index * POSITION_STEP,
    ),
    ...spokeSlots.map((slot) => slot.axis),
  ];
  const entryMidpoint = entryAxes.length
    ? (Math.min(...entryAxes) + Math.max(...entryAxes)) / 2
    : LAYOUT.SPINE_MIN_CENTRE + LAYOUT.OUTPUT_OFFSET;
  const shift = Math.max(0, LAYOUT.SPINE_MIN_CENTRE + LAYOUT.OUTPUT_OFFSET - entryMidpoint);
  const spineX = entryMidpoint + shift;
  const deposit = add({
    id: "deposit",
    kind: "deposit",
    rect: {
      x: spineX - LAYOUT.SPINE_W / 2,
      y: LAYOUT.DEPOSIT_TOP,
      w: LAYOUT.SPINE_W,
      h: LAYOUT.CARD_H,
    },
  });
  const idle = add({
    id: `idle:${model.hubChainId}`,
    kind: "idle",
    chainId: model.hubChainId,
    rect: {
      x: spineX - LAYOUT.SPINE_W / 2,
      y: LAYOUT.IDLE_INPUT_TOP,
      w: LAYOUT.SPINE_W,
      h: CASH.h,
    },
  });
  const cash = add({
    id: `cash:${model.hubChainId}`,
    kind: "cash",
    chainId: model.hubChainId,
    rect: { x: idle.rect.x + idle.rect.w + LAYOUT.LINK, y: idle.rect.y, ...CASH },
  });
  edge("deposit:idle", [
    { x: spineX, y: bottom(deposit) },
    { x: spineX, y: idle.rect.y },
  ]);
  edge("hub:cash", [
    { x: idle.rect.x + idle.rect.w, y: idle.rect.y + CASH.h / 2 },
    { x: cash.rect.x, y: cash.rect.y + CASH.h / 2 },
  ]);
  const returns: { source: ManageNode; principalSource: ManageNode; income: boolean }[] = [];
  function position(chainId: number, positionId: string, x: number, top: number) {
    const p = model.positions.find((item) => item.id === positionId);
    if (!p) return;
    let first: ManageNode | null = null;
    if (p.kind === "liquidity") {
      first = add({
        id: `swap:${p.id}`,
        kind: "flow",
        flow: "swap",
        chainId,
        positionId,
        rect: { x, y: top, w: LAYOUT.PILL_W, h: LAYOUT.PILL_H },
      });
      top += LAYOUT.PILL_H + LAYOUT.LINK;
    }
    const node = add({
      id: `position:${p.id}`,
      kind: "position",
      chainId,
      positionId,
      rect: { x, y: top, w: LAYOUT.CARD_W, h: POSITION[p.kind] },
    });
    if (first)
      edge(`input:${p.id}`, [
        { x: center(node), y: bottom(first) },
        { x: center(node), y: node.rect.y },
      ]);
    if (p.kind === "liquidity") {
      const collect = add({
        id: `collect:${p.id}`,
        kind: "flow",
        flow: "collectFees",
        chainId,
        positionId,
        rect: { x, y: bottom(node) + LAYOUT.LINK, w: LAYOUT.PILL_W, h: LAYOUT.PILL_H },
      });
      const swap = add({
        id: `fee-swap:${p.id}`,
        kind: "flow",
        flow: "feeSwap",
        chainId,
        positionId,
        // Fees keep their own +PAIR port. Principal skirts this pill, retaining its -PAIR port.
        rect: {
          x: x + LAYOUT.PAIR,
          y: bottom(collect) + LAYOUT.LINK,
          w: LAYOUT.PILL_W,
          h: LAYOUT.PILL_H,
        },
      });
      edge(`collect:${p.id}`, [
        { x: center(node), y: bottom(node) },
        { x: center(node), y: collect.rect.y },
      ]);
      edge(
        `conversion:${p.id}`,
        [
          { x: center(collect) + LAYOUT.PAIR, y: bottom(collect) },
          { x: center(collect) + LAYOUT.PAIR, y: swap.rect.y },
        ],
        "income",
      );
      returns.push({ source: swap, principalSource: collect, income: true });
    } else returns.push({ source: node, principalSource: node, income: false });
    return first ?? node;
  }
  const busY = bottom(idle) + LAYOUT.LINK;
  const entrances: number[] = [];
  for (const [index, p] of (hub?.positions ?? []).entries()) {
    const first = position(
      model.hubChainId,
      p.id,
      firstPositionLeft + shift + index * POSITION_STEP,
      busY + LAYOUT.STUB,
    );
    if (first) {
      entrances.push(center(first));
      edge(`hub:allocation:${p.id}`, [
        { x: center(first), y: busY },
        { x: center(first), y: first.rect.y },
      ]);
    }
  }
  for (const slot of spokeSlots) {
    const { chain, width: groupWidth } = slot;
    const x = slot.x + shift;
    const axis = slot.axis + shift;
    const start = nodes.length;
    const bridge = add({
      id: `bridge:${chain.chainId}`,
      kind: "flow",
      flow: "bridge",
      chainId: chain.chainId,
      rect: {
        x: axis - LAYOUT.PILL_W / 2,
        y: busY + LAYOUT.STUB,
        w: LAYOUT.PILL_W,
        h: LAYOUT.PILL_H,
      },
    });
    entrances.push(center(bridge));
    edge(`spoke:allocation:${chain.chainId}`, [
      { x: center(bridge), y: busY },
      { x: center(bridge), y: bridge.rect.y },
    ]);
    const chainIdle = add({
      id: `idle:${chain.chainId}`,
      kind: "idle",
      chainId: chain.chainId,
      rect: {
        x: axis - LAYOUT.CARD_W / 2,
        y: bottom(bridge) + LAYOUT.LINK,
        w: LAYOUT.CARD_W,
        h: CASH.h,
      },
    });
    const chainCash = add({
      id: `cash:${chain.chainId}`,
      kind: "cash",
      chainId: chain.chainId,
      rect: { x: chainIdle.rect.x + chainIdle.rect.w + LAYOUT.LINK, y: chainIdle.rect.y, ...CASH },
    });
    edge(`bridge:idle:${chain.chainId}`, [
      { x: center(bridge), y: bottom(bridge) },
      { x: center(chainIdle), y: chainIdle.rect.y },
    ]);
    edge(`spoke:cash:${chain.chainId}`, [
      { x: chainIdle.rect.x + chainIdle.rect.w, y: chainIdle.rect.y + CASH.h / 2 },
      { x: chainCash.rect.x, y: chainCash.rect.y + CASH.h / 2 },
    ]);
    for (const [index, p] of chain.positions.entries()) {
      const first = position(
        chain.chainId,
        p.id,
        x + LAYOUT.GROUP_PAD + index * POSITION_STEP,
        bottom(chainIdle) + LAYOUT.LINK,
      );
      if (first)
        edge(`spoke:input:${p.id}`, [
          { x: center(chainIdle), y: bottom(chainIdle) },
          { x: center(chainIdle), y: first.rect.y - LAYOUT.LINK / 2 },
          { x: center(first), y: first.rect.y - LAYOUT.LINK / 2 },
          { x: center(first), y: first.rect.y },
        ]);
    }
    const groupBottom = Math.max(...nodes.slice(start).map(bottom));
    add({
      id: `group:${chain.chainId}`,
      kind: "group",
      chainId: chain.chainId,
      rect: {
        x,
        y: bridge.rect.y - LAYOUT.GROUP_PAD,
        w: groupWidth,
        h: groupBottom + LAYOUT.GROUP_PAD - (bridge.rect.y - LAYOUT.GROUP_PAD),
      },
    });
  }
  if (entrances.length) {
    edge("allocation:spine", [
      { x: spineX, y: bottom(idle) },
      { x: spineX, y: busY },
    ]);
    edge("allocation:bus", [
      { x: Math.min(spineX, ...entrances), y: busY },
      { x: Math.max(spineX, ...entrances), y: busY },
    ]);
  }
  // The unconverted Figma fixture bends LINK below Collect. Keeping the fee Swap adds one
  // PILL_H + LINK step (50px), then both independent return paths share the same bend.
  const branchBendY =
    Math.max(...nodes.filter((node) => node.kind !== "group").map(bottom)) + LAYOUT.LINK;
  const outputX = spineX - LAYOUT.OUTPUT_OFFSET;
  const incomeX = spineX + LAYOUT.OUTPUT_OFFSET;
  const principalPorts = returns.map(
    (r) => center(r.principalSource) - (r.income ? LAYOUT.PAIR : 0),
  );
  const incomePorts = returns.filter((r) => r.income).map((r) => center(r.source));
  const overlapsDirectReturns = principalPorts.some((gray) =>
    incomePorts.some(
      (green) =>
        Math.min(gray, outputX) < Math.max(green, incomeX) &&
        Math.min(green, incomeX) < Math.max(gray, outputX),
    ),
  );
  // Several positions can place gray and green spans on top of each other. Aggregate each tone
  // on a separate upstream bus, then use trunks outside every return port for the shared final
  // bend. Same-tone joins remain intentional; perpendicular crossings never merge the tones.
  const principalBusY = branchBendY;
  const incomeBusY = branchBendY + (overlapsDirectReturns ? LAYOUT.LINK : 0);
  const returnBendY = incomeBusY + (overlapsDirectReturns ? LAYOUT.LINK : 0);
  const allPorts = [outputX, incomeX, ...principalPorts, ...incomePorts];
  const principalTrunkX = Math.min(...allPorts) - LAYOUT.LINK;
  const incomeTrunkX = Math.max(...allPorts) + LAYOUT.LINK;
  const outputsTop = returnBendY + LAYOUT.STUB;
  const output = add({
    id: "withdrawal",
    kind: "withdrawal",
    rect: {
      x: outputX - LAYOUT.SPINE_W / 2,
      y: outputsTop,
      w: LAYOUT.SPINE_W,
      h: OUTPUT.withdrawal,
    },
  });
  const income = add({
    id: "income",
    kind: "income",
    rect: {
      x: incomeX - LAYOUT.SPINE_W / 2,
      y: outputsTop,
      w: LAYOUT.SPINE_W,
      h: OUTPUT.income,
    },
  });
  for (const r of returns) {
    const cx = center(r.principalSource) - (r.income ? LAYOUT.PAIR : 0);
    const principal = [{ x: cx, y: bottom(r.principalSource) }];
    if (r.income) {
      // Take the short left corridor while the conversion occupies the straight principal lane.
      // Rejoin below it so the final gray/green ports remain PAIR * 2 apart at the shared bend.
      const besideConversionX = r.source.rect.x - LAYOUT.PAIR;
      const aboveConversionY = r.source.rect.y - LAYOUT.PAIR;
      const belowConversionY = bottom(r.source) + LAYOUT.PAIR;
      principal.push(
        { x: cx, y: aboveConversionY },
        { x: besideConversionX, y: aboveConversionY },
        { x: besideConversionX, y: belowConversionY },
        { x: cx, y: belowConversionY },
      );
    }
    if (overlapsDirectReturns)
      principal.push({ x: cx, y: principalBusY }, { x: principalTrunkX, y: principalBusY });
    else
      principal.push(
        { x: cx, y: returnBendY },
        { x: center(output), y: returnBendY },
        { x: center(output), y: outputsTop },
      );
    edge(`principal:${r.principalSource.id}`, principal);
    if (r.income)
      edge(
        `income:${r.source.id}`,
        overlapsDirectReturns
          ? [
              { x: center(r.source), y: bottom(r.source) },
              { x: center(r.source), y: incomeBusY },
              { x: incomeTrunkX, y: incomeBusY },
            ]
          : [
              { x: center(r.source), y: bottom(r.source) },
              { x: center(r.source), y: returnBendY },
              { x: center(income), y: returnBendY },
              { x: center(income), y: outputsTop },
            ],
        "income",
      );
  }
  if (overlapsDirectReturns) {
    edge("principal:aggregation", [
      { x: principalTrunkX, y: principalBusY },
      { x: principalTrunkX, y: returnBendY },
      { x: center(output), y: returnBendY },
      { x: center(output), y: outputsTop },
    ]);
    edge(
      "income:aggregation",
      [
        { x: incomeTrunkX, y: incomeBusY },
        { x: incomeTrunkX, y: returnBendY },
        { x: center(income), y: returnBendY },
        { x: center(income), y: outputsTop },
      ],
      "income",
    );
  }
  const withdraw = add({
    id: "withdraw",
    kind: "withdraw",
    rect: {
      x: spineX - LAYOUT.SPINE_W / 2,
      y: bottom(output) + LAYOUT.STUB,
      w: LAYOUT.SPINE_W,
      h: LAYOUT.CARD_H,
    },
  });
  for (const [node, tone] of [
    [output, "muted"],
    [income, "income"],
  ] as const)
    edge(
      `withdraw:${node.id}`,
      [
        { x: center(node), y: bottom(node) },
        { x: center(node), y: withdraw.rect.y - LAYOUT.LINK },
        { x: spineX, y: withdraw.rect.y - LAYOUT.LINK },
        { x: spineX, y: withdraw.rect.y },
      ],
      tone,
    );
  return {
    width: Math.max(...nodes.map((node) => node.rect.x + node.rect.w)) + LAYOUT.CANVAS_PAD,
    height: bottom(withdraw) + LAYOUT.CANVAS_PAD,
    nodes,
    edges,
  };
}
