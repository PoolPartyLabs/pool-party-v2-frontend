/**
 * @id PP-MGR-LIB-052
 * @name manageLayout
 * @implements-rules-version v2 (POO-2270, POO-2271; extends POO-2226, POO-2232)
 * @analytics-events none, pure read-only layout and hover identities.
 * Final outer rects own every port. Diagram routes enable no transfer or financial capability.
 */
import {
  type FinancialPort,
  type FlowClass,
  financialPortId,
  resolvePortPoint,
  resolveSemanticGraph,
  type SemanticGraph,
  type SemanticNode,
  semanticJunctionId,
  semanticSegmentId,
} from "../build/graph/semanticGraph";
import type { Point, Rect } from "../build/layout/graphTypes";
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
  | {
      kind: "flow";
      flow: "swap" | "collectFees" | "feeSwap" | "bridge";
      direction?: "inbound" | "outbound";
    }
  | { kind: "deposit" | "withdraw" | "withdrawal" | "income" }
);
/** Unscaled content dimensions keyed by stable node identity, never by selection or array index. */
export type ManageMeasurements = Readonly<Record<string, { width: number; height: number }>>;
export interface ManageLayout {
  width: number;
  height: number;
  nodes: ManageNode[];
  edges: PieceEdge[];
  connections: PieceEdge[];
  semantic: SemanticGraph;
  /** Complete visible route legs; internal Bridge transitions deliberately have no painted line. */
  hoverRoutes: { id: string; connectionIds: string[] }[];
}
const CASH = { w: 144, h: 96 };
const POSITION = { supply: 160, liquidity: 232, unsupported: 160 };
const center = (node: ManageNode) => node.rect.x + node.rect.w / 2;
const bottom = (node: ManageNode) => node.rect.y + node.rect.h;
const right = (node: ManageNode) => node.rect.x + node.rect.w;

/** Layout consumes observed positions only; unsupported adapters gain no LP/debt/Holding assumptions. */
export function layoutManageGraph(
  model: ManageModel,
  measured: ManageMeasurements = {},
): ManageLayout {
  const nodes: ManageNode[] = [];
  const semantic: SemanticGraph = {
    nodes: [],
    ports: [],
    junctions: [],
    segments: [],
    connections: [],
  };
  const semanticNodes: SemanticNode[] = [];
  const ports: FinancialPort[] = [];
  const junctions: Array<SemanticGraph["junctions"][number]> = [];
  const segments: Array<SemanticGraph["segments"][number]> = [];
  const connections: Array<SemanticGraph["connections"][number]> = [];
  const hidden = new Set<string>();
  const routes = new Map<string, string[]>();
  const size = (id: string, w: number, h: number) => {
    const value = measured[id];
    return {
      w: value && Number.isFinite(value.width) ? Math.max(w, Math.ceil(value.width)) : w,
      h: value && Number.isFinite(value.height) ? Math.max(h, Math.ceil(value.height)) : h,
    };
  };
  const add = (node: ManageNode) => {
    nodes.push(node);
    if (node.kind !== "group") {
      const isBridge = node.kind === "flow" && node.flow === "bridge";
      const network = String(node.chainId ?? model.hubChainId);
      const direction = isBridge ? (node.direction ?? "inbound") : null;
      semanticNodes.push({
        id: node.id,
        rect: node.rect,
        network,
        kind: isBridge
          ? "bridge"
          : node.kind === "position"
            ? "position"
            : node.kind === "flow" && (node.flow === "swap" || node.flow === "feeSwap")
              ? "conversion"
              : "structural",
        ...(direction
          ? {
              bridge: {
                direction,
                fromNetwork: direction === "inbound" ? String(model.hubChainId) : network,
                toNetwork: direction === "inbound" ? network : String(model.hubChainId),
              },
            }
          : {}),
      });
    }
    return node;
  };
  const port = (
    node: ManageNode,
    role: string,
    flow: FlowClass,
    origin: string | null,
    direction: "in" | "out",
    side: FinancialPort["side"],
    offset = 0.5,
    network = String(node.chainId ?? model.hubChainId),
  ) => {
    const id = financialPortId(node.id, `${role}:${origin ?? "structural"}`);
    const existing = ports.find((value) => value.id === id);
    if (existing) return existing;
    const value: FinancialPort = {
      id,
      nodeId: node.id,
      direction,
      class: flow,
      originId: origin,
      side,
      offset,
      network,
    };
    ports.push(value);
    return value;
  };
  const point = (value: FinancialPort) => {
    const node = semanticNodes.find((item) => item.id === value.nodeId);
    if (!node) throw new Error(`Missing Manage node ${value.nodeId}`);
    return resolvePortPoint(node, value);
  };
  const connect = (
    id: string,
    source: FinancialPort,
    target: FinancialPort,
    bends: Point[] = [],
    routeId = id,
    visible = true,
  ) => {
    const path = [point(source), ...bends, point(target)];
    const refs: Array<SemanticGraph["segments"][number]["from"]> = [
      { kind: "port", id: source.id },
    ];
    for (const [index, at] of bends.entries()) {
      const junctionId = semanticJunctionId(
        `${id}:bend:${index}`,
        source.network,
        source.class,
        source.originId,
      );
      junctions.push({
        id: junctionId,
        point: at,
        network: source.network,
        class: source.class,
        originId: source.originId,
      });
      refs.push({ kind: "junction", id: junctionId });
    }
    refs.push({ kind: "port", id: target.id });
    const segmentIds: string[] = [];
    for (let index = 0; index < path.length - 1; index++) {
      const from = refs[index];
      const to = refs[index + 1];
      if (!from || !to) continue;
      const segmentId = semanticSegmentId(id, `leg:${index}`);
      segments.push({ id: segmentId, connectionId: id, from, to });
      segmentIds.push(segmentId);
    }
    connections.push({
      id,
      class: source.class,
      originId: source.originId,
      sourcePortId: source.id,
      targetPortId: target.id,
      segmentIds,
    });
    if (!visible) hidden.add(id);
    else routes.set(routeId, [...(routes.get(routeId) ?? []), id]);
  };
  const bridgePorts = (node: ManageNode, flow: FlowClass, origin: string, offset: number) => {
    const bridge = semanticNodes.find((item) => item.id === node.id)?.bridge;
    if (!bridge) throw new Error("Missing Bridge direction");
    const incoming = port(
      node,
      `${flow}-in`,
      flow,
      origin,
      "in",
      "top",
      offset,
      bridge.fromNetwork,
    );
    const internalOut = port(
      node,
      `${flow}-transfer-out`,
      flow,
      origin,
      "out",
      "top",
      offset,
      bridge.fromNetwork,
    );
    const internalIn = port(
      node,
      `${flow}-transfer-in`,
      flow,
      origin,
      "in",
      "bottom",
      offset,
      bridge.toNetwork,
    );
    const outgoing = port(
      node,
      `${flow}-out`,
      flow,
      origin,
      "out",
      "bottom",
      offset,
      bridge.toNetwork,
    );
    connect(`transfer:${node.id}:${flow}:${origin}`, internalOut, internalIn, [], undefined, false);
    return { incoming, outgoing };
  };

  const hub = model.chains.find((chain) => chain.chainId === model.hubChainId);
  const spokes = model.chains.filter((chain) => chain.chainId !== model.hubChainId);
  /** Each column reserves the widest measured member, including centered flow pills. */
  const columnWidth = (id: string) => {
    const p = model.positions.find((position) => position.id === id);
    const width = size(`position:${id}`, LAYOUT.CARD_W, POSITION[p?.kind ?? "unsupported"]).w;
    return p?.kind === "liquidity"
      ? Math.max(
          width,
          ...[`swap:${id}`, `collect:${id}`, `fee-swap:${id}`].map(
            (flowId) => size(flowId, LAYOUT.PILL_W, LAYOUT.PILL_H).w,
          ),
        )
      : width;
  };
  const rowWidth = (ids: string[]) =>
    ids.reduce((sum, id, index) => sum + columnWidth(id) + (index ? LAYOUT.SIBLING : 0), 0) ||
    LAYOUT.CARD_W;
  const firstLeft = LAYOUT.CANVAS_PAD + LAYOUT.CARD_W / 2;
  let cursor = hub?.positions.length
    ? firstLeft + rowWidth(hub.positions.map((p) => p.id)) + LAYOUT.SIBLING
    : firstLeft - LAYOUT.GROUP_PAD;
  const slots = spokes.map((chain) => {
    const idleSize = size(`idle:${chain.chainId}`, LAYOUT.CARD_W, 104);
    const width = Math.max(
      rowWidth(chain.positions.map((p) => p.id)),
      idleSize.w,
      size(`bridge:${chain.chainId}`, LAYOUT.PILL_W, LAYOUT.PILL_H).w,
      size(`bridge:${chain.chainId}:outbound`, LAYOUT.PILL_W, LAYOUT.PILL_H).w,
    );
    const axis = cursor + LAYOUT.GROUP_PAD + width / 2;
    const cashSize = size(`cash:${chain.chainId}`, CASH.w, CASH.h);
    const groupWidth = Math.max(
      width + 2 * LAYOUT.GROUP_PAD,
      width / 2 + LAYOUT.GROUP_PAD + idleSize.w / 2 + LAYOUT.LINK + cashSize.w + LAYOUT.GROUP_PAD,
    );
    const result = { chain, x: cursor, axis, width: groupWidth, innerWidth: width };
    cursor += groupWidth + LAYOUT.SIBLING;
    return result;
  });
  const hubAxes: number[] = [];
  let hubCursor = firstLeft;
  for (const p of hub?.positions ?? []) {
    const w = columnWidth(p.id);
    hubAxes.push(hubCursor + w / 2);
    hubCursor += w + LAYOUT.SIBLING;
  }
  const axes = [...hubAxes, ...slots.map((slot) => slot.axis)];
  const midpoint = axes.length
    ? (Math.min(...axes) + Math.max(...axes)) / 2
    : LAYOUT.SPINE_MIN_CENTRE + LAYOUT.OUTPUT_OFFSET;
  const shift = Math.max(0, LAYOUT.SPINE_MIN_CENTRE + LAYOUT.OUTPUT_OFFSET - midpoint);
  const spineX = midpoint + shift;
  const depositSize = size("deposit", LAYOUT.SPINE_W, LAYOUT.CARD_H);
  const deposit = add({
    id: "deposit",
    kind: "deposit",
    rect: { x: spineX - depositSize.w / 2, y: LAYOUT.DEPOSIT_TOP, ...depositSize },
  });
  const idleSize = size(`idle:${model.hubChainId}`, LAYOUT.SPINE_W, 104);
  const idle = add({
    id: `idle:${model.hubChainId}`,
    kind: "idle",
    chainId: model.hubChainId,
    rect: { x: spineX - idleSize.w / 2, y: bottom(deposit) + LAYOUT.LINK, ...idleSize },
  });
  const cashSize = size(`cash:${model.hubChainId}`, CASH.w, CASH.h);
  const cash = add({
    id: `cash:${model.hubChainId}`,
    kind: "cash",
    chainId: model.hubChainId,
    rect: {
      x: right(idle) + LAYOUT.LINK,
      y: idle.rect.y + (idle.rect.h - cashSize.h) / 2,
      ...cashSize,
    },
  });
  connect(
    "deposit:idle",
    port(deposit, "out", "structural", null, "out", "bottom"),
    port(idle, "in", "structural", null, "in", "top"),
  );
  connect(
    "hub:cash",
    port(idle, "cash", "structural", null, "out", "right"),
    port(cash, "in", "structural", null, "in", "left"),
  );
  const allocationY = Math.max(bottom(idle), bottom(cash)) + LAYOUT.LINK;
  const returns: {
    position: ManageNode;
    principal: FinancialPort;
    fee: FinancialPort | null;
    principalRoute: string;
    feeRoute: string;
  }[] = [];
  const makePosition = (
    chainId: number,
    positionId: string,
    x: number,
    top: number,
    input: FinancialPort,
    busY: number,
  ) => {
    const p = model.positions.find((item) => item.id === positionId);
    if (!p) return;
    const dim = size(`position:${p.id}`, LAYOUT.CARD_W, POSITION[p.kind]);
    x += (columnWidth(p.id) - dim.w) / 2;
    const axis = x + dim.w / 2;
    const entryRoute = `entry:${p.id}`;
    let first: ManageNode | null = null;
    if (p.kind === "liquidity") {
      const swapSize = size(`swap:${p.id}`, LAYOUT.PILL_W, LAYOUT.PILL_H);
      first = add({
        id: `swap:${p.id}`,
        kind: "flow",
        flow: "swap",
        chainId,
        positionId,
        rect: { x: axis - swapSize.w / 2, y: top, ...swapSize },
      });
      top = bottom(first) + LAYOUT.LINK;
    }
    const node = add({
      id: `position:${p.id}`,
      kind: "position",
      chainId,
      positionId,
      rect: { x, y: top, ...dim },
    });
    const head = first ?? node;
    const entry = port(head, "principal-in", "principal", p.id, "in", "top");
    connect(
      `allocation:${p.id}`,
      input,
      entry,
      [
        { x: point(input).x, y: busY },
        { x: point(entry).x, y: busY },
      ],
      entryRoute,
    );
    if (first)
      connect(
        `input:${p.id}`,
        port(first, "principal-out", "principal", p.id, "out", "bottom"),
        port(node, "principal-in", "principal", p.id, "in", "top"),
        [],
        entryRoute,
      );
    const principalRoute = `principal:${node.id}`;
    const feeRoute = `income:${node.id}`;
    const principal = port(node, "principal-out", "principal", p.id, "out", "left");
    let fee: FinancialPort | null = null;
    if (p.kind === "liquidity") {
      const collectSize = size(`collect:${p.id}`, LAYOUT.PILL_W, LAYOUT.PILL_H);
      const collect = add({
        id: `collect:${p.id}`,
        kind: "flow",
        flow: "collectFees",
        chainId,
        positionId,
        rect: {
          x: axis - collectSize.w / 2,
          y: bottom(node) + LAYOUT.LINK,
          ...collectSize,
        },
      });
      const swapSize = size(`fee-swap:${p.id}`, LAYOUT.PILL_W, LAYOUT.PILL_H);
      const swap = add({
        id: `fee-swap:${p.id}`,
        kind: "flow",
        flow: "feeSwap",
        chainId,
        positionId,
        rect: {
          x: axis - swapSize.w / 2,
          y: bottom(collect) + LAYOUT.LINK,
          ...swapSize,
        },
      });
      connect(
        `fee-collect:${p.id}`,
        port(node, "income-out", "income", p.id, "out", "bottom"),
        port(collect, "income-in", "income", p.id, "in", "top"),
        [],
        feeRoute,
      );
      connect(
        `conversion:${p.id}`,
        port(collect, "income-out", "income", p.id, "out", "bottom"),
        port(swap, "income-in", "income", p.id, "in", "top"),
        [],
        feeRoute,
      );
      fee = port(swap, "income-out", "income", p.id, "out", "bottom");
    }
    returns.push({ position: node, principal, fee, principalRoute, feeRoute });
  };
  hubCursor = firstLeft + shift;
  for (const p of hub?.positions ?? []) {
    makePosition(
      model.hubChainId,
      p.id,
      hubCursor,
      allocationY + LAYOUT.STUB,
      port(idle, "principal-out", "principal", p.id, "out", "bottom"),
      allocationY,
    );
    hubCursor += columnWidth(p.id) + LAYOUT.SIBLING;
  }
  const principalCorridor = (position: ManageNode) =>
    Math.min(
      ...nodes.filter((node) => node.positionId === position.positionId).map((node) => node.rect.x),
    ) - LAYOUT.PAIR;
  const returned: {
    principal: FinancialPort;
    fee: FinancialPort | null;
    principalRoute: string;
    feeRoute: string;
    origin: string;
    bypassX?: number;
  }[] = returns.map((r) => ({
    ...r,
    origin: r.position.positionId ?? r.position.id,
    bypassX: principalCorridor(r.position),
  }));
  const spokeReturns: {
    slot: (typeof slots)[number];
    inbound: ManageNode;
    local: (typeof returns)[number][];
  }[] = [];
  for (const slot of slots) {
    const { chain } = slot;
    const axis = slot.axis + shift;
    const inboundSize = size(`bridge:${chain.chainId}`, LAYOUT.PILL_W, LAYOUT.PILL_H);
    const inbound = add({
      id: `bridge:${chain.chainId}`,
      kind: "flow",
      flow: "bridge",
      direction: "inbound",
      chainId: chain.chainId,
      rect: {
        x: axis - inboundSize.w / 2,
        y: allocationY + LAYOUT.STUB,
        ...inboundSize,
      },
    });
    const dim = size(`idle:${chain.chainId}`, LAYOUT.CARD_W, 104);
    const chainIdle = add({
      id: `idle:${chain.chainId}`,
      kind: "idle",
      chainId: chain.chainId,
      rect: { x: axis - dim.w / 2, y: bottom(inbound) + LAYOUT.LINK, ...dim },
    });
    const chainCashSize = size(`cash:${chain.chainId}`, CASH.w, CASH.h);
    const chainCash = add({
      id: `cash:${chain.chainId}`,
      kind: "cash",
      chainId: chain.chainId,
      rect: {
        x: right(chainIdle) + LAYOUT.LINK,
        y: chainIdle.rect.y + (chainIdle.rect.h - chainCashSize.h) / 2,
        ...chainCashSize,
      },
    });
    connect(
      `spoke:cash:${chain.chainId}`,
      port(chainIdle, "cash", "structural", null, "out", "right"),
      port(chainCash, "in", "structural", null, "in", "left"),
    );
    const origin = `chain:${chain.chainId}`;
    const entryBridge = bridgePorts(inbound, "principal", origin, 0.5);
    const hubPort = port(idle, `spoke-out:${chain.chainId}`, "principal", origin, "out", "bottom");
    const entryRoute = `entry:${origin}`;
    connect(
      `spoke:allocation:${chain.chainId}`,
      hubPort,
      entryBridge.incoming,
      [
        { x: point(hubPort).x, y: allocationY },
        { x: axis, y: allocationY },
      ],
      entryRoute,
    );
    connect(
      `bridge:idle:${chain.chainId}`,
      entryBridge.outgoing,
      port(chainIdle, "principal-in", "principal", origin, "in", "top"),
      [],
      entryRoute,
    );
    const before = returns.length;
    let positionX =
      slot.x +
      shift +
      LAYOUT.GROUP_PAD +
      (slot.innerWidth - rowWidth(chain.positions.map((p) => p.id))) / 2;
    const innerBusY = Math.max(bottom(chainIdle), bottom(chainCash)) + LAYOUT.LINK;
    for (const p of chain.positions) {
      makePosition(
        chain.chainId,
        p.id,
        positionX,
        innerBusY + LAYOUT.STUB,
        port(chainIdle, "principal-out", "principal", p.id, "out", "bottom"),
        innerBusY,
      );
      positionX += columnWidth(p.id) + LAYOUT.SIBLING;
    }
    const local = returns.slice(before);
    spokeReturns.push({ slot, inbound, local });
  }
  // All content bounds are final before a return bus crosses columns of unequal height.
  const contentBottom = Math.max(...nodes.map(bottom));
  for (const { slot, inbound, local } of spokeReturns) {
    const { chain } = slot;
    const axis = slot.axis + shift;
    const grayY = contentBottom + LAYOUT.LINK;
    const greenY = grayY + LAYOUT.LINK;
    const outboundSize = size(`bridge:${chain.chainId}:outbound`, LAYOUT.PILL_W, LAYOUT.PILL_H);
    const outbound = add({
      id: `bridge:${chain.chainId}:outbound`,
      kind: "flow",
      flow: "bridge",
      direction: "outbound",
      chainId: chain.chainId,
      rect: {
        x: axis - outboundSize.w / 2,
        y: (local.some((r) => r.fee) ? greenY : grayY) + LAYOUT.LINK,
        ...outboundSize,
      },
    });
    for (const r of local) {
      const positionId = r.position.positionId ?? r.position.id;
      const principalBridge = bridgePorts(
        outbound,
        "principal",
        positionId,
        (LAYOUT.PILL_W / 2 - LAYOUT.PAIR) / LAYOUT.PILL_W,
      );
      const bypass = principalCorridor(r.position);
      connect(
        r.principalRoute,
        r.principal,
        principalBridge.incoming,
        [
          { x: bypass, y: point(r.principal).y },
          { x: bypass, y: grayY },
          { x: point(principalBridge.incoming).x, y: grayY },
        ],
        r.principalRoute,
      );
      let fee: FinancialPort | null = null;
      if (r.fee) {
        const feeBridge = bridgePorts(
          outbound,
          "income",
          positionId,
          (LAYOUT.PILL_W / 2 + LAYOUT.PAIR) / LAYOUT.PILL_W,
        );
        connect(
          `income:${r.fee.nodeId}`,
          r.fee,
          feeBridge.incoming,
          [
            { x: point(r.fee).x, y: greenY },
            { x: point(feeBridge.incoming).x, y: greenY },
          ],
          r.feeRoute,
        );
        fee = feeBridge.outgoing;
      }
      returned.push({
        principal: principalBridge.outgoing,
        fee,
        principalRoute: r.principalRoute,
        feeRoute: r.feeRoute,
        origin: positionId,
      });
    }
    const groupTop = inbound.rect.y - LAYOUT.GROUP_PAD;
    const groupNodes = nodes.filter((node) => node.chainId === chain.chainId);
    add({
      id: `group:${chain.chainId}`,
      kind: "group",
      chainId: chain.chainId,
      rect: {
        x: slot.x + shift,
        y: groupTop,
        w: Math.max(
          slot.width,
          Math.max(...groupNodes.map(right)) + LAYOUT.GROUP_PAD - slot.x - shift,
        ),
        h: Math.max(...groupNodes.map(bottom)) + LAYOUT.GROUP_PAD - groupTop,
      },
    });
  }
  const lastBottom = Math.max(...nodes.map(bottom));
  const grayY = lastBottom + LAYOUT.LINK;
  const greenY = grayY + LAYOUT.LINK;
  const finalY = greenY + LAYOUT.LINK;
  const outputDim = size("withdrawal", LAYOUT.SPINE_W, 168);
  const incomeDim = size("income", LAYOUT.SPINE_W, 102);
  const outputX =
    spineX - Math.max(LAYOUT.OUTPUT_OFFSET, (outputDim.w + incomeDim.w) / 4 + LAYOUT.SPINE_GAP / 2);
  const incomeX =
    spineX + Math.max(LAYOUT.OUTPUT_OFFSET, (outputDim.w + incomeDim.w) / 4 + LAYOUT.SPINE_GAP / 2);
  const output = add({
    id: "withdrawal",
    kind: "withdrawal",
    rect: { x: outputX - outputDim.w / 2, y: finalY + LAYOUT.STUB, ...outputDim },
  });
  const income = add({
    id: "income",
    kind: "income",
    rect: { x: incomeX - incomeDim.w / 2, y: output.rect.y, ...incomeDim },
  });
  const leftTrunk = Math.max(
    0,
    Math.min(outputX, ...returned.map((r) => r.bypassX ?? point(r.principal).x)) - LAYOUT.PAIR,
  );
  const rightTrunk =
    Math.max(incomeX, ...returned.flatMap((r) => (r.fee ? [point(r.fee).x] : []))) + LAYOUT.LINK;
  for (const r of returned) {
    const source = point(r.principal);
    const bypass = r.bypassX ?? source.x;
    const bends = r.bypassX ? [{ x: bypass, y: source.y }] : [];
    connect(
      r.bypassX ? r.principalRoute : `principal:return:${r.origin}`,
      r.principal,
      port(output, "principal-in", "principal", r.origin, "in", "top"),
      [
        ...bends,
        { x: bypass, y: grayY },
        { x: leftTrunk, y: grayY },
        { x: leftTrunk, y: finalY },
        { x: outputX, y: finalY },
      ],
      r.principalRoute,
    );
    if (r.fee)
      connect(
        `income:return:${r.origin}`,
        r.fee,
        port(income, "income-in", "income", r.origin, "in", "top"),
        [
          { x: point(r.fee).x, y: greenY },
          { x: rightTrunk, y: greenY },
          { x: rightTrunk, y: finalY },
          { x: incomeX, y: finalY },
        ],
        r.feeRoute,
      );
  }
  const withdrawalY = Math.max(bottom(output), bottom(income)) + LAYOUT.LINK;
  const withdrawDim = size("withdraw", LAYOUT.SPINE_W, LAYOUT.CARD_H);
  const withdraw = add({
    id: "withdraw",
    kind: "withdraw",
    rect: { x: spineX - withdrawDim.w / 2, y: withdrawalY + LAYOUT.LINK, ...withdrawDim },
  });
  for (const node of [output, income])
    connect(
      `withdraw:${node.id}`,
      port(node, "withdraw-out", "structural", null, "out", "bottom"),
      port(withdraw, `in:${node.id}`, "structural", null, "in", "top"),
      [
        { x: center(node), y: withdrawalY },
        { x: spineX, y: withdrawalY },
      ],
    );
  const graph: SemanticGraph = {
    ...semantic,
    nodes: semanticNodes,
    ports,
    junctions,
    segments,
    connections,
  };
  const resolved = resolveSemanticGraph(graph);
  const visible = resolved.connections.filter((connection) => !hidden.has(connection.id));
  const piece = (connection: (typeof visible)[number]): PieceEdge => ({
    id: connection.id,
    tone: connection.class === "income" ? "income" : "muted",
    points: connection.points,
  });
  return {
    width: Math.max(...nodes.map(right), rightTrunk) + LAYOUT.CANVAS_PAD,
    height: bottom(withdraw) + LAYOUT.CANVAS_PAD,
    nodes,
    edges: visible.map(piece),
    connections: visible.map(piece),
    semantic: graph,
    hoverRoutes: [...routes].map(([id, connectionIds]) => ({ id, connectionIds })),
  };
}
