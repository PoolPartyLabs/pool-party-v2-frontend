/**
 * @id PP-MGR-LIB-023
 * @name layoutGraph
 * @implements-rules-version v2 (POO-2273); POO-2153 rules v1; POO-2213 rules v1; POO-2235 rules v1
 * @implements-rules-version v1 (POO-2301 shared local runtime; POO-2302 measured engine)
 * @analytics-events none, a pure geometry module: the Build screen (PP-MGR-SCR-002, S7) owns every
 *   event; nothing here is rendered or tracked.
 *
 * The app lays the graph out; the manager never positions a block (C1). This pure function turns a
 * plan (as a {@link LayoutInput}) into the box of every node, the segments of every line, the
 * centres of the share labels and the ports, the groups, the templates, the empty-canvas captions
 * and the graph size. Same input, same output: no DOM, no React, no clock, no randomness.
 *
 * POO-2273 v2 supersedes the historical return geometry. Principal leaves the last position
 * laterally and bypasses Collect. Collect has one centered green exit through its derived
 * feeSwap. Nonlocal spokes contain one shared return Bridge with class/origin-specific ports.
 * Nodes and enclosing hulls are final before financial endpoints and junctions are declared.
 * Structural input/template segments retain their approved Build geometry. Visible route legs
 * exclude internal Bridge transfers, while hoverRoutes associates all visible legs of one origin.
 * This layout does not infer token compatibility, repayment, operating cash or launch capability.
 * POO-2301 explicitly opts local Solana spokes into an Idle/cash presentation context; no balances
 * or cash financial adjacency are inferred from that declaration.
 * Stored block IDs, insertion/drop ports, chain order and nominal Build sizes remain unchanged.
 */

import {
  type FinancialPort,
  type FlowClass,
  financialPortId,
  resolvePortPoint,
  resolveSemanticGraph,
  type SemanticConnection,
  type SemanticEndpoint,
  type SemanticGraph,
  type SemanticJunction,
  type SemanticNode,
  type SemanticSegment,
  semanticJunctionId,
  semanticNodeId,
  semanticSegmentId,
} from "../graph/semanticGraph";
import { portSlotsOf } from "../plan/planRules";
import type {
  BlockNode,
  EdgeKind,
  EdgeNode,
  EmptyCaptions,
  GraphLayout,
  GroupNode,
  LayoutChain,
  LayoutInput,
  LayoutOptions,
  LayoutSpoke,
  Point,
  Rect,
  ShareLabelNode,
  SpineNode,
  SpineRole,
} from "./graphTypes";
import { LAYOUT } from "./layoutConstants";

const L = LAYOUT;
function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing layout ${label}`);
  return value;
}
/** A horizontal run's centre line sits half a stroke under its handoff y (its top edge). */
const HALF_LINE = L.LINE_W / 2;
const HALF_SPINE = L.SPINE_W / 2;

/** The layout under construction, before normalisation. */
type Draft = Omit<GraphLayout, "width" | "height">;

interface PlacedChain {
  chain: LayoutChain;
  centre: number;
  nodes: BlockNode[];
  /** Bottom edge of the last block (the stub's end when the chain is empty). */
  bottom: number;
}

function newDraft(spineCentreX: number): Draft {
  return {
    spineCentreX,
    spine: [],
    blocks: [],
    bridges: [],
    feeSwaps: [],
    groups: [],
    templates: [],
    ports: [],
    shareLabels: [],
    edges: [],
    emptyCaptions: null,
  };
}

function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h };
}

function rightOf(r: Rect): number {
  return r.x + r.w;
}

function bottomOf(r: Rect): number {
  return r.y + r.h;
}

function centreOf(r: Rect): number {
  return r.x + r.w / 2;
}

/** A vertical segment at x, from y `from` down to y `to` (handoff values). */
function vertical(id: string, kind: EdgeKind, x: number, from: number, to: number): EdgeNode {
  return {
    id,
    kind,
    points: [
      { x, y: from },
      { x, y: to },
    ],
  };
}

/** A horizontal segment drawn at handoff y (its top edge), spanning [from, to]. */
function horizontal(id: string, kind: EdgeKind, y: number, from: number, to: number): EdgeNode {
  return {
    id,
    kind,
    points: [
      { x: from, y: y + HALF_LINE },
      { x: to, y: y + HALF_LINE },
    ],
  };
}

/** A horizontal run through every x given; nothing when they all coincide. */
function spanning(id: string, kind: EdgeKind, y: number, xs: number[]): EdgeNode[] {
  const from = Math.min(...xs);
  const to = Math.max(...xs);
  return to > from ? [horizontal(id, kind, y, from, to)] : [];
}

function spineNode(role: SpineRole, centre: number, top: number): SpineNode {
  return {
    role,
    rect: rect(centre - HALF_SPINE, top, L.SPINE_W, L.CARD_H),
    locked: true,
  };
}

/** Deposit, Idle input and the two links down to the Idle input bus. */
function placeSpineTop(d: Draft, c: number): void {
  d.spine.push(spineNode("deposit", c, L.DEPOSIT_TOP), spineNode("idleInput", c, L.IDLE_INPUT_TOP));
  d.edges.push(
    vertical("spine:deposit", "structural", c, L.DEPOSIT_TOP + L.CARD_H, L.IDLE_INPUT_TOP),
    vertical("spine:idleInput", "structural", c, L.IDLE_INPUT_TOP + L.CARD_H, L.BUS_Y),
  );
}

/** The blocks of one chain, top to bottom from `top`, with their links and their ports. */
function placeChain(
  d: Draft,
  chain: LayoutChain,
  network: string,
  left: number,
  top: number,
): PlacedChain {
  const centre = left + L.CARD_W / 2;
  const nodes: BlockNode[] = [];
  let y = top;
  for (const step of chain.steps) {
    const card = step.family === "position";
    const w = card ? L.CARD_W : L.PILL_W;
    const h = card ? L.CARD_H : L.PILL_H;
    const previous = nodes[nodes.length - 1];
    if (previous) {
      d.edges.push(
        vertical(
          `link:${previous.id}`,
          step.kind === "collectFees" ? "income" : "structural",
          centre,
          bottomOf(previous.rect),
          y,
        ),
      );
    }
    const node: BlockNode = {
      id: step.id,
      ...(step.returnConversionOf ? { returnConversionOf: step.returnConversionOf } : {}),
      chainId: chain.id,
      network,
      family: step.family,
      kind: step.kind,
      auto: step.auto,
      rect: rect(centre - w / 2, y, w, h),
    };
    nodes.push(node);
    d.blocks.push(node);
    y += h + L.LINK;
    if (step.kind === "collectFees") {
      d.feeSwaps?.push({
        sourceBlockId: step.id,
        chainId: chain.id,
        network,
        rect: rect(centre - L.PILL_W / 2, y, L.PILL_W, L.PILL_H),
      });
      y += L.PILL_H + L.LINK;
    }
  }
  // C17: where the ports sit is S1's rule, read here and never re-derived.
  for (const slot of portSlotsOf(chain.steps)) {
    const node = nodes[slot.index];
    if (!node) continue;
    if (slot.top) {
      d.ports.push({
        target: { kind: "port", side: "before", blockId: node.id },
        center: { x: centre, y: node.rect.y },
      });
    }
    if (slot.bottom) {
      d.ports.push({
        target: { kind: "port", side: "after", blockId: node.id },
        center: { x: centre, y: bottomOf(node.rect) },
      });
    }
  }
  const last = nodes[nodes.length - 1];
  return { chain, centre, nodes, bottom: last ? y - L.LINK : top };
}

/** The stub from a bus to a chain's first block, with the chain's share label on it (C8). */
function hangChain(
  d: Draft,
  placed: PlacedChain,
  network: string,
  busY: number,
  rowTop: number,
  labelY: number,
): void {
  const edgeId = `stub:chain:${placed.chain.id}`;
  d.edges.push(vertical(edgeId, "structural", placed.centre, busY, rowTop));
  const feeds = placed.nodes.find((n) => n.family === "position");
  const label: ShareLabelNode = {
    target: {
      kind: "shareLabel",
      chainId: placed.chain.id,
      network,
      feedsBlockId: feeds?.id ?? null,
    },
    pct: placed.chain.sharePct,
    center: { x: placed.centre, y: labelY },
    edgeId,
  };
  d.shareLabels.push(label);
}

/** An Add protocol circle and the stub that feeds it from its row's bus. */
function placeCircle(d: Draft, network: string, left: number, busY: number, top: number): Rect {
  const r = rect(left, top, L.CIRCLE, L.CIRCLE);
  d.templates.push({ target: { kind: "addProtocol", network }, rect: r });
  d.edges.push(vertical(`template:addProtocol:${network}`, "template", centreOf(r), busY, top));
  return r;
}

/** The Add network box and its 32 px stub from the Idle input bus. */
function placeNetbox(d: Draft, left: number): Rect {
  const r = rect(left, L.GROUP_TOP, L.NETBOX_W, L.NETBOX_H);
  d.templates.push({ target: { kind: "addNetwork" }, rect: r });
  d.edges.push(vertical("template:addNetwork", "template", centreOf(r), L.BUS_Y, L.GROUP_TOP));
  return r;
}

interface PlacedSpoke {
  chains: PlacedChain[];
  group: GroupNode;
  axisX: number;
  satelliteWidth: number;
  /** The lowest content inside the box, its circle included (not the border). */
  lowest: number;
}

/** A spoke's group: its chains, its circle, its Bridge, its inner bus and its label (C3, C20). */
function placeSpoke(d: Draft, spoke: LayoutSpoke, left: number, occurrence: string): PlacedSpoke {
  const local = spoke.context === "solana-local" && spoke.network === "solana";
  const circleLeft =
    spoke.chains.length > 0
      ? left + L.GROUP_PAD + spoke.chains.length * (L.CARD_W + L.SIBLING)
      : left + L.GROUP_PAD + (L.CARD_W - L.CIRCLE) / 2;
  const innerRight =
    spoke.chains.length > 0 ? circleLeft + L.CIRCLE : left + L.GROUP_PAD + L.CARD_W;
  const financialRight = local
    ? Math.max(innerRight + L.GROUP_PAD, left + L.LOCAL_IDLE_W + L.GROUP_PAD * 2)
    : innerRight + L.GROUP_PAD;
  const centre = (left + financialRight) / 2;
  const bridge = rect(centre - L.PILL_W / 2, L.ROW_TOP, L.PILL_W, L.PILL_H);
  let busY: number = L.INNER_BUS_Y;
  let rowTop: number = L.INNER_ROW_TOP;
  let labelY: number = L.INNER_LABEL_Y;
  let right = financialRight;
  if (local) {
    const idle = rect(
      centre - L.LOCAL_IDLE_W / 2,
      bottomOf(bridge) + L.LINK,
      L.LOCAL_IDLE_W,
      L.LOCAL_IDLE_H,
    );
    const cash = rect(
      rightOf(idle) + L.LOCAL_CASH_GAP,
      idle.y + (idle.h - L.LOCAL_CASH_H) / 2,
      L.LOCAL_CASH_W,
      L.LOCAL_CASH_H,
    );
    d.spokeContexts ??= [];
    // PP-INTEGRATION-POINT: POO-2301 local context has no authoritative Idle/native amount or valuation source.
    d.spokeContexts.push({
      network: spoke.network,
      axisX: centre,
      idle: {
        id: `spoke-idle:${encodeURIComponent(spoke.network)}${occurrence}`,
        rect: idle,
        stableSymbol: "USDC",
        amount: null,
        valueUsd: null,
      },
      cash: {
        id: `operating-cash:${encodeURIComponent(spoke.network)}${occurrence}`,
        rect: cash,
        nativeSymbol: "SOL",
        mint: null,
        amount: null,
        valueUsd: null,
      },
    });
    busY = Math.max(bottomOf(idle), bottomOf(cash)) + L.LINK;
    rowTop = busY + L.STUB;
    labelY = rowTop - L.LINK;
    right = Math.max(financialRight, rightOf(cash) + L.GROUP_PAD);
  }
  const chains: PlacedChain[] = [];
  let x = left + L.GROUP_PAD;
  for (const chain of spoke.chains) {
    const placed = placeChain(d, chain, spoke.network, x, rowTop);
    hangChain(d, placed, spoke.network, busY, rowTop, labelY);
    chains.push(placed);
    x += L.CARD_W + L.SIBLING;
  }
  // C16: with no chain the group is one card wide inside its padding, the circle centred in it.
  const circle = placeCircle(d, spoke.network, circleLeft, busY, rowTop);
  const lowest = Math.max(bottomOf(circle), ...chains.map((c) => c.bottom));

  // C20: the Bridge, the stub that enters the box and the spoke's label sit on its centre.
  d.bridges.push({ network: spoke.network, rect: bridge, direction: "inbound" });
  const stubId = `stub:spoke:${spoke.network}`;
  d.edges.push(
    vertical(stubId, "structural", centre, L.BUS_Y, L.ROW_TOP),
    ...(local
      ? [
          vertical(
            `bridge:${spoke.network}`,
            "structural",
            centre,
            bottomOf(bridge),
            bottomOf(bridge) + L.LINK,
          ),
          vertical(
            `idle:spoke:${spoke.network}`,
            "structural",
            centre,
            bottomOf(bridge) + L.LINK + L.LOCAL_IDLE_H,
            busY,
          ),
        ]
      : [vertical(`bridge:${spoke.network}`, "structural", centre, bottomOf(bridge), busY)]),
    ...spanning(`bus:spoke:${spoke.network}`, "structural", busY, [
      centre,
      centreOf(circle),
      ...chains.map((c) => c.centre),
    ]),
  );
  d.shareLabels.push({
    target: { kind: "shareLabel", chainId: null, network: spoke.network, feedsBlockId: null },
    pct: spoke.sharePct,
    center: { x: centre, y: L.SPOKE_LABEL_Y },
    edgeId: stubId,
  });

  let contentBottom = lowest;
  if (chains.some((chain) => chain.nodes.some((node) => node.family === "position"))) {
    const outbound = rect(centre - L.PILL_W / 2, lowest + L.RETURN_BRIDGE_GAP, L.PILL_W, L.PILL_H);
    d.bridges.push({ network: spoke.network, rect: outbound, direction: "outbound" });
    contentBottom = bottomOf(outbound);
  }
  const box = rect(left, L.GROUP_TOP, right - left, contentBottom + L.GROUP_PAD - L.GROUP_TOP);
  const group: GroupNode = {
    network: spoke.network,
    rect: box,
    chipAnchor: { x: left + L.CHIP_INSET, y: L.GROUP_TOP },
    hasChains: chains.length > 0,
  };
  d.groups.push(group);
  return {
    chains,
    group,
    lowest: contentBottom,
    axisX: centre,
    satelliteWidth: right - financialRight,
  };
}

/** The return lines, Idle output, Income (fees) and Withdraw, under `deepest` (L5, C10, C11). */
function placeReturns(d: Draft, chains: PlacedChain[], deepest: number): void {
  const c = d.spineCentreX;
  const fees = chains.flatMap((p) =>
    p.nodes.filter((n) => n.kind === "collectFees").map((n) => ({ p, n })),
  );
  const income = fees.length > 0;
  const outputCentre = income ? c - L.OUTPUT_OFFSET : c;
  const incomeCentre = c + L.OUTPUT_OFFSET;

  let outputTop = deepest + L.EMPTY_OUTPUT_GAP;
  if (chains.length > 0) {
    const principalY = deepest + L.LINK;
    const incomeY = principalY + L.LINK;
    outputTop = (income ? incomeY : principalY) + L.LINK;
  }

  d.spine.push(spineNode("idleOutput", outputCentre, outputTop));
  const outputBottom = outputTop + L.CARD_H;
  let withdrawTop = outputBottom + L.LINK;
  if (income) {
    d.spine.push(spineNode("income", incomeCentre, outputTop));
    const mergeY = outputBottom + L.LINK;
    withdrawTop = mergeY + L.LINK;
    d.edges.push(
      vertical("output:idleOutput", "structural", outputCentre, outputBottom, mergeY),
      vertical("output:income", "structural", incomeCentre, outputBottom, mergeY),
      ...spanning("merge:line", "structural", mergeY, [outputCentre, incomeCentre]),
      vertical("merge:withdraw", "structural", c, mergeY, withdrawTop),
    );
  } else {
    d.edges.push(vertical("output:idleOutput", "structural", c, outputBottom, withdrawTop));
  }
  d.spine.push(spineNode("withdraw", c, withdrawTop));
}

/** A plan with at least one chain or one spoke. */
function layoutPlan(input: LayoutInput): Draft {
  const d = newDraft(0);
  const hub: PlacedChain[] = [];
  let x: number = L.CANVAS_PAD;
  for (const chain of input.hub.chains) {
    const placed = placeChain(d, chain, input.hubNetwork, x, L.ROW_TOP);
    hangChain(d, placed, input.hubNetwork, L.BUS_Y, L.ROW_TOP, L.HUB_LABEL_Y);
    hub.push(placed);
    x += L.CARD_W + L.SIBLING;
  }
  // L3 rule 2: 32 after the last hub chain, or the row's left end with no hub chain (D10).
  const hubCircle = placeCircle(d, input.hubNetwork, x, L.BUS_Y, L.ROW_TOP);
  x = rightOf(hubCircle) + L.GROUP_GAP;

  const spokes: PlacedSpoke[] = [];
  const occurrences = new Map<string, number>();
  for (const spoke of input.spokes) {
    const occurrence = occurrences.get(spoke.network) ?? 0;
    occurrences.set(spoke.network, occurrence + 1);
    const placed = placeSpoke(d, spoke, x, occurrence ? `#${occurrence + 1}` : "");
    spokes.push(placed);
    x = rightOf(placed.group.rect) + L.GROUP_GAP;
  }
  const netbox = placeNetbox(d, x);

  const c = Math.max(
    (L.CANVAS_PAD +
      rightOf(netbox) -
      spokes.reduce((sum, spoke) => sum + spoke.satelliteWidth, 0)) /
      2,
    L.SPINE_MIN_CENTRE,
  );
  d.spineCentreX = c;
  placeSpineTop(d, c);
  d.edges.push(
    ...spanning("bus:idleInput", "structural", L.BUS_Y, [
      c,
      centreOf(hubCircle),
      centreOf(netbox),
      ...hub.map((p) => p.centre),
      ...spokes.map((s) => s.axisX),
    ]),
  );

  const deepest = Math.max(
    bottomOf(hubCircle),
    ...hub.map((p) => p.bottom),
    ...spokes.map((s) => s.lowest),
  );
  placeReturns(d, [...hub, ...spokes.flatMap((s) => s.chains)], deepest);
  return d;
}

/** The empty canvas: templates, captions and the start-here sentence (L6, C16). */
function layoutEmpty(input: LayoutInput, options: LayoutOptions): Draft {
  const c = L.EMPTY_SPINE_CENTRE;
  const d = newDraft(c);
  placeSpineTop(d, c);
  const circle = placeCircle(
    d,
    input.hubNetwork,
    c - L.EMPTY_TEMPLATE_OFFSET - L.CIRCLE / 2,
    L.BUS_Y,
    L.ROW_TOP,
  );
  const netbox = placeNetbox(d, c + L.EMPTY_TEMPLATE_OFFSET - L.NETBOX_W / 2);
  d.edges.push(
    ...spanning("bus:idleInput", "structural", L.BUS_Y, [c, centreOf(circle), centreOf(netbox)]),
  );

  const measured =
    Number.isFinite(options.startHereWidth) && options.startHereWidth > 0
      ? options.startHereWidth
      : 0;
  // Up to an even integer, so the sentence centred on the spine starts on a whole x.
  const width = Math.ceil(measured / 2) * 2;
  const captionTop = Math.max(
    bottomOf(circle) + L.EMPTY_CAPTION_GAP_CIRCLE,
    bottomOf(netbox) + L.EMPTY_CAPTION_GAP_BOX,
  );
  const startHere = rect(
    c - width / 2,
    captionTop + L.EMPTY_SENTENCE_OFFSET,
    width,
    L.EMPTY_SENTENCE_LINE_H,
  );
  const captions: EmptyCaptions = {
    addProtocol: { x: centreOf(circle), y: captionTop },
    addNetwork: { x: centreOf(netbox), y: captionTop },
    startHere,
  };
  d.emptyCaptions = captions;
  placeReturns(d, [], bottomOf(startHere));
  return d;
}

function moveRect(r: Rect, dx: number): Rect {
  return { ...r, x: r.x + dx };
}

function movePoint(p: Point, dx: number): Point {
  return { ...p, x: p.x + dx };
}

/** L4, last: translate everything right until the leftmost content sits at the canvas padding. */
function normalise(d: Draft): GraphLayout {
  const content: Rect[] = [
    ...d.spine.map((n) => n.rect),
    ...d.blocks.map((n) => n.rect),
    ...d.bridges.map((n) => n.rect),
    ...(d.feeSwaps ?? []).map((n) => n.rect),
    ...d.groups.map((n) => n.rect),
    ...(d.spokeContexts ?? []).flatMap((context) => [context.idle.rect, context.cash.rect]),
    ...d.templates.map((n) => n.rect),
    ...(d.emptyCaptions ? [d.emptyCaptions.startHere] : []),
  ];
  const dx = Math.max(0, L.CANVAS_PAD - Math.min(...content.map((r) => r.x)));
  const right = Math.max(...content.map(rightOf)) + dx;
  const bottom = Math.max(...content.map(bottomOf));
  const captions = d.emptyCaptions;
  return {
    width: right + L.CANVAS_PAD,
    height: bottom + L.CANVAS_PAD,
    spineCentreX: d.spineCentreX + dx,
    ...(d.spokeContexts
      ? {
          spokeContexts: d.spokeContexts.map((context) => ({
            ...context,
            axisX: context.axisX + dx,
            idle: { ...context.idle, rect: moveRect(context.idle.rect, dx) },
            cash: { ...context.cash, rect: moveRect(context.cash.rect, dx) },
          })),
        }
      : {}),
    spine: d.spine.map((n) => ({ ...n, rect: moveRect(n.rect, dx) })),
    blocks: d.blocks.map((n) => ({ ...n, rect: moveRect(n.rect, dx) })),
    bridges: d.bridges.map((n) => ({ ...n, rect: moveRect(n.rect, dx) })),
    feeSwaps: (d.feeSwaps ?? []).map((n) => ({ ...n, rect: moveRect(n.rect, dx) })),
    groups: d.groups.map((n) => ({
      ...n,
      rect: moveRect(n.rect, dx),
      chipAnchor: movePoint(n.chipAnchor, dx),
    })),
    templates: d.templates.map((n) => ({ ...n, rect: moveRect(n.rect, dx) })),
    ports: d.ports.map((n) => ({ ...n, center: movePoint(n.center, dx) })),
    shareLabels: d.shareLabels.map((n) => ({ ...n, center: movePoint(n.center, dx) })),
    edges: d.edges.map((e) => ({ ...e, points: e.points.map((p) => movePoint(p, dx)) })),
    emptyCaptions: captions
      ? {
          addProtocol: movePoint(captions.addProtocol, dx),
          addNetwork: movePoint(captions.addNetwork, dx),
          startHere: moveRect(captions.startHere, dx),
        }
      : null,
  };
}

/**
 * The Build canvas graph of a plan (C1). `options.startHereWidth` is read only for the empty canvas,
 * whose sentence decides the shift (L6).
 */
export function layoutGraph(input: LayoutInput, options: LayoutOptions): GraphLayout {
  const empty = input.hub.chains.length === 0 && input.spokes.length === 0;
  const graph = normalise(empty ? layoutEmpty(input, options) : layoutPlan(input));
  graph.hubNetwork = input.hubNetwork;
  const horizontals = graph.edges.filter((edge) => edge.points[0]?.y === edge.points[1]?.y);
  graph.edges = graph.edges.map((edge) =>
    edge.points[0]?.x !== edge.points[1]?.x
      ? edge
      : {
          ...edge,
          points: edge.points.map((point) => {
            const run = horizontals.find(
              (entry) =>
                entry.kind === edge.kind &&
                entry.points[0]?.y === point.y + HALF_LINE &&
                point.x >=
                  Math.min(entry.points[0]?.x ?? Number.NaN, entry.points[1]?.x ?? Number.NaN) &&
                point.x <=
                  Math.max(entry.points[0]?.x ?? Number.NaN, entry.points[1]?.x ?? Number.NaN),
            );
            return run ? { ...point, y: run.points[0]?.y ?? point.y } : point;
          }),
        },
  );
  declareRoutes(graph, input);
  return graph;
}

/** Explicit endpoints are declared after node/hull bounds and normalization are final. */
function declareRoutes(graph: GraphLayout, input: LayoutInput): void {
  const trailingLinks = new Set<string>();
  for (const chain of [...input.hub.chains, ...input.spokes.flatMap((spoke) => spoke.chains)]) {
    const lastPosition = chain.steps.findLastIndex((step) => step.family === "position");
    for (
      let index = lastPosition + 1;
      lastPosition >= 0 && index < chain.steps.length;
      index += 1
    ) {
      if (chain.steps[index]?.kind === "swap")
        trailingLinks.add(`link:${chain.steps[index - 1]?.id}`);
    }
  }
  const existingEdges = graph.edges.filter(
    (edge) =>
      (edge.kind === "structural" || edge.kind === "template") && !trailingLinks.has(edge.id),
  );
  const nodes: SemanticNode[] = [];
  const ports: FinancialPort[] = [];
  const junctions: SemanticJunction[] = [];
  const segments: SemanticSegment[] = [];
  const connections: SemanticConnection[] = [];
  const hidden = new Set<string>();
  const routes: { id: string; connectionIds: string[] }[] = [];
  const hub = input.hubNetwork;
  const addNode = (
    id: string,
    kind: SemanticNode["kind"],
    network: string,
    rect: Rect,
    bridge?: SemanticNode["bridge"],
  ): SemanticNode => {
    const node = { id, kind, network, rect, ...(bridge ? { bridge } : {}) };
    nodes.push(node);
    return node;
  };
  const spine = new Map(
    graph.spine.map((node) => [
      node.role,
      addNode(`node:${semanticNodeId("spine", node.role)}`, "structural", hub, node.rect),
    ]),
  );
  const contextIdles = new Map(
    (graph.spokeContexts ?? []).map((context) => [
      context.idle.id,
      addNode(context.idle.id, "structural", context.network, context.idle.rect),
    ]),
  );
  const contextFor = (network: string, occurrence: string) => {
    const id = `spoke-idle:${encodeURIComponent(network)}${occurrence}`;
    const context = graph.spokeContexts?.find((entry) => entry.idle.id === id);
    const node = contextIdles.get(id);
    return context && node ? { context, node } : undefined;
  };
  const blocks = new Map(
    graph.blocks.map((node) => [
      node.id,
      addNode(
        semanticNodeId("block", node.id),
        node.family === "position" ? "position" : "structural",
        node.network,
        node.rect,
      ),
    ]),
  );
  const swaps = new Map(
    (graph.feeSwaps ?? []).map((node) => [
      node.sourceBlockId,
      addNode(
        semanticNodeId("fee-swap", node.sourceBlockId),
        chainHasPosition(input, node.chainId) ? "conversion" : "structural",
        node.network,
        node.rect,
      ),
    ]),
  );
  const seenBridges = new Map<string, number>();
  const bridges = new Map(
    graph.bridges.map((node) => {
      const direction = node.direction ?? "inbound";
      const baseId = semanticNodeId("bridge", node.network, direction);
      const occurrence = seenBridges.get(baseId) ?? 0;
      seenBridges.set(baseId, occurrence + 1);
      const id = `${baseId}${occurrence ? `#${occurrence + 1}` : ""}`;
      return [
        id,
        addNode(id, "bridge", node.network, node.rect, {
          direction,
          fromNetwork: direction === "inbound" ? hub : node.network,
          toNetwork: direction === "inbound" ? node.network : hub,
        }),
      ];
    }),
  );
  const seenTemplates = new Map<string, number>();
  const templateNodes = graph.templates.map((node) => {
    const baseId = `node:template:${node.target.kind === "addNetwork" ? "addNetwork" : node.target.network}`;
    const occurrence = seenTemplates.get(baseId) ?? 0;
    seenTemplates.set(baseId, occurrence + 1);
    return addNode(
      `${baseId}${occurrence ? `#${occurrence + 1}` : ""}`,
      "structural",
      node.target.kind === "addNetwork" ? hub : node.target.network,
      node.rect,
    );
  });
  // Spoke ownership comes from the plan, never from node proximity or the enclosing hull.
  const spokeOccurrences = new Map<string, number>();
  const spokeKeys = new Map<LayoutSpoke, string>();
  for (const spoke of input.spokes) {
    const occurrence = spokeOccurrences.get(spoke.network) ?? 0;
    spokeOccurrences.set(spoke.network, occurrence + 1);
    spokeKeys.set(spoke, occurrence ? `#${occurrence + 1}` : "");
  }
  const bridgeFor = (network: string, direction: "inbound" | "outbound", occurrence = "") =>
    bridges.get(`${semanticNodeId("bridge", network, direction)}${occurrence}`);
  const port = (
    node: SemanticNode,
    role: string,
    flowClass: FlowClass,
    originId: string | null,
    direction: FinancialPort["direction"],
    side: FinancialPort["side"],
    offset: number = L.PORT_CENTER,
    network = node.network,
  ): FinancialPort => {
    const value = {
      id: financialPortId(node.id, role),
      nodeId: node.id,
      direction,
      class: flowClass,
      network,
      originId,
      side,
      offset,
    };
    const existing = ports.find((entry) => entry.id === value.id);
    if (existing) return existing;
    ports.push(value);
    return value;
  };
  const point = (value: FinancialPort): Point => {
    const node = nodes.find((entry) => entry.id === value.nodeId);
    if (!node) throw new Error(`Missing financial node ${value.nodeId}`);
    return resolvePortPoint(node, value);
  };
  const connect = (
    id: string,
    source: FinancialPort,
    target: FinancialPort,
    bends: Point[] = [],
    invisible = false,
  ): string => {
    const connection: SemanticConnection = {
      id,
      class: source.class,
      originId: source.originId,
      sourcePortId: source.id,
      targetPortId: target.id,
      segmentIds: [],
    };
    const refs: SemanticEndpoint[] = [{ kind: "port", id: source.id }];
    for (const [index, value] of bends.entries()) {
      const junction = {
        id: semanticJunctionId(
          `${id}:bend:${index}`,
          source.network,
          source.class,
          source.originId,
        ),
        class: source.class,
        network: source.network,
        originId: source.originId,
        point: value,
      };
      junctions.push(junction);
      refs.push({ kind: "junction", id: junction.id });
    }
    refs.push({ kind: "port", id: target.id });
    const segmentIds: string[] = [];
    for (let index = 0; index < refs.length - 1; index += 1) {
      const segmentId = semanticSegmentId(id, `leg:${index}`);
      segments.push({
        id: segmentId,
        connectionId: id,
        from: required(refs[index], "segment start"),
        to: required(refs[index + 1], "segment end"),
      });
      segmentIds.push(segmentId);
    }
    connection.segmentIds = segmentIds;
    connections.push(connection);
    if (invisible) hidden.add(id);
    return id;
  };
  const structural = (
    id: string,
    source: SemanticNode,
    target: SemanticNode,
    bends: Point[] = [],
    flowClass: FlowClass = "structural",
    origin: string | null = null,
  ) =>
    connect(
      id,
      port(source, `out:${id}`, flowClass, origin, "out", "bottom"),
      port(target, `in:${id}`, flowClass, origin, "in", "top"),
      bends,
    );
  const bridgePorts = (
    node: SemanticNode,
    role: string,
    flowClass: FlowClass,
    origin: string | null,
    offset: number,
  ) => {
    const incoming = port(
      node,
      `${role}:incoming`,
      flowClass,
      origin,
      "in",
      "top",
      offset,
      required(node.bridge, "bridge metadata").fromNetwork,
    );
    const transferOut = port(
      node,
      `${role}:transfer-out`,
      flowClass,
      origin,
      "out",
      "top",
      offset,
      required(node.bridge, "bridge metadata").fromNetwork,
    );
    const transferIn = port(
      node,
      `${role}:transfer-in`,
      flowClass,
      origin,
      "in",
      "bottom",
      offset,
      required(node.bridge, "bridge metadata").toNetwork,
    );
    const outgoing = port(
      node,
      `${role}:outgoing`,
      flowClass,
      origin,
      "out",
      "bottom",
      offset,
      required(node.bridge, "bridge metadata").toNetwork,
    );
    const transferId = `bridge-transfer:${node.id}:${role}`;
    if (!connections.some((entry) => entry.id === transferId))
      connect(transferId, transferOut, transferIn, [], true);
    return { incoming, outgoing };
  };
  const idle = required(spine.get("idleInput"), "node");
  structural("spine:deposit", required(spine.get("deposit"), "node"), idle);
  const chainEntries = [
    ...input.hub.chains.map((chain) => ({ chain, network: hub, spokeKey: "" })),
    ...input.spokes.flatMap((spoke) =>
      spoke.chains.map((chain) => ({
        chain,
        network: spoke.network,
        spokeKey: spokeKeys.get(spoke) ?? "",
      })),
    ),
  ];
  for (const { chain, network, spokeKey } of chainEntries) {
    const members = chain.steps.flatMap((step) => {
      const node = blocks.get(step.id);
      return node ? [node] : [];
    });
    const first = members[0];
    if (!first) continue;
    const origin = null;
    const legIds: string[] = [];
    let source = port(idle, `entry:${chain.id}`, "structural", origin, "out", "bottom");
    const localContext = contextFor(network, spokeKey);
    if (network !== hub) {
      const inbound = required(bridgeFor(network, "inbound", spokeKey), "bridge");
      const bridge = bridgePorts(inbound, `entry:${chain.id}`, "structural", origin, L.PORT_CENTER);
      const targetPoint = point(bridge.incoming);
      legIds.push(
        connect(`entry:bridge:${chain.id}`, source, bridge.incoming, [
          { x: point(source).x, y: L.BUS_Y + HALF_LINE },
          { x: targetPoint.x, y: L.BUS_Y + HALF_LINE },
        ]),
      );
      source = bridge.outgoing;
      if (localContext) {
        const contextIn = port(
          localContext.node,
          `entry:${chain.id}`,
          "structural",
          origin,
          "in",
          "top",
        );
        legIds.push(connect(`entry:idle:${chain.id}`, source, contextIn));
        source = port(
          localContext.node,
          `branch:${chain.id}`,
          "structural",
          origin,
          "out",
          "bottom",
        );
      }
    }
    const rowY = localContext
      ? Math.max(
          bottomOf(localContext.context.idle.rect),
          bottomOf(localContext.context.cash.rect),
        ) +
        L.LINK +
        HALF_LINE
      : network === hub
        ? L.BUS_Y + HALF_LINE
        : L.INNER_BUS_Y + HALF_LINE;
    const target = port(first, `entry:${chain.id}`, "structural", origin, "in", "top");
    legIds.push(
      connect(`stub:chain:${chain.id}`, source, target, [
        { x: point(source).x, y: rowY },
        { x: point(target).x, y: rowY },
      ]),
    );
    routes.push({ id: `stub:chain:${chain.id}`, connectionIds: legIds });
    for (let index = 1; index < members.length; index += 1) {
      const previous = required(members[index - 1], "previous member");
      const next = required(members[index], "next member");
      const fees = chain.steps[index]?.kind === "collectFees";
      const lastPosition = chain.steps.findLastIndex((step) => step.family === "position");
      if (index > lastPosition && lastPosition >= 0 && chain.steps[index]?.kind === "swap")
        continue;
      structural(
        `link:${required(chain.steps[index - 1], "previous step").id}`,
        previous,
        next,
        [],
        fees ? "income" : "structural",
        fees ? previous.id.slice("block:".length) : null,
      );
    }
  }
  for (const template of templateNodes) {
    let source = port(idle, `entry:${template.id}`, "template", null, "out", "bottom");
    const legIds: string[] = [];
    const occurrence = template.id.includes("#") ? template.id.slice(template.id.indexOf("#")) : "";
    const localContext = contextFor(template.network, occurrence);
    if (template.network !== hub) {
      const inbound = required(bridgeFor(template.network, "inbound", occurrence), "bridge");
      const bridge = bridgePorts(inbound, template.id, "template", null, L.PORT_CENTER);
      legIds.push(
        connect(`entry:${template.id}`, source, bridge.incoming, [
          { x: point(source).x, y: L.BUS_Y + HALF_LINE },
          { x: point(bridge.incoming).x, y: L.BUS_Y + HALF_LINE },
        ]),
      );
      source = bridge.outgoing;
      if (localContext) {
        legIds.push(
          connect(
            `entry:idle:${template.id}`,
            source,
            port(localContext.node, `entry:${template.id}`, "template", null, "in", "top"),
          ),
        );
        source = port(
          localContext.node,
          `branch:${template.id}`,
          "template",
          null,
          "out",
          "bottom",
        );
      }
    }
    const rowY = localContext
      ? Math.max(
          bottomOf(localContext.context.idle.rect),
          bottomOf(localContext.context.cash.rect),
        ) +
        L.LINK +
        HALF_LINE
      : template.network === hub
        ? L.BUS_Y + HALF_LINE
        : L.INNER_BUS_Y + HALF_LINE;
    const target = port(template, "entry", "template", null, "in", "top");
    legIds.push(
      connect(template.id.slice("node:".length), source, target, [
        { x: point(source).x, y: rowY },
        { x: point(target).x, y: rowY },
      ]),
    );
    routes.push({ id: template.id.slice("node:".length), connectionIds: legIds });
  }
  // The spoke share label still names its original inbound connection.
  const spokeLabels = graph.shareLabels.filter((entry) => entry.target.chainId === null);
  for (const [index, label] of spokeLabels.entries()) {
    const spoke = required(input.spokes[index], "spoke");
    const inbound = required(
      bridgeFor(spoke.network, "inbound", spokeKeys.get(spoke) ?? ""),
      "bridge",
    );
    const bridge = bridgePorts(inbound, "share", "structural", null, L.PORT_CENTER);
    const labelId = `${label.edgeId}${inbound.id.includes("#") ? inbound.id.slice(inbound.id.indexOf("#")) : ""}`;
    connect(labelId, port(idle, labelId, "structural", null, "out", "bottom"), bridge.incoming, [
      { x: centreOf(idle.rect), y: L.BUS_Y + HALF_LINE },
      { x: centreOf(inbound.rect), y: L.BUS_Y + HALF_LINE },
    ]);
  }
  const output = required(spine.get("idleOutput"), "node");
  const income = spine.get("income");
  const principalY = output.rect.y - (income ? L.LINK * 2 : L.LINK) + HALF_LINE;
  const incomeY = output.rect.y - L.LINK + HALF_LINE;
  for (const { chain, network, spokeKey } of chainEntries) {
    const position = [...chain.steps].reverse().find((step) => step.family === "position");
    if (!position) continue;
    const node = required(blocks.get(position.id), "node");
    const source = port(node, "principal", "principal", position.id, "out", "right");
    const laneX = rightOf(node.rect) + L.PAIR;
    const outbound = bridgeFor(network, "outbound", spokeKey);
    const principalIds: string[] = [];
    let principalSource = source;
    const positionIndex = chain.steps.findIndex((step) => step.id === position.id);
    for (const conversion of chain.steps
      .slice(positionIndex + 1)
      .filter((step) => step.kind === "swap")) {
      const swap = required(blocks.get(conversion.id), "principal conversion");
      swap.kind = chain.steps.slice(positionIndex + 1).every((step) => step.kind === "swap")
        ? "conversion"
        : "structural";
      const target = port(
        swap,
        `principal-in:${position.id}`,
        "principal",
        position.id,
        "in",
        "top",
      );
      principalIds.push(
        connect(`principal:conversion:${conversion.id}`, principalSource, target, [
          { x: laneX, y: point(principalSource).y },
          { x: laneX, y: swap.rect.y - L.LINK / 2 },
          { x: point(target).x, y: swap.rect.y - L.LINK / 2 },
        ]),
      );
      principalSource = port(
        swap,
        `principal-out:${position.id}`,
        "principal",
        position.id,
        "out",
        "bottom",
      );
    }
    const returnSource = principalSource;
    if (outbound) {
      const own = chainEntries
        .filter(
          (entry) =>
            entry.network === network &&
            entry.chain.steps.some((step) => step.family === "position"),
        )
        .map((entry) => entry.chain.id);
      const offset = ((own.indexOf(chain.id) + 1) / (own.length + 1)) * L.PRINCIPAL_PORT_SPAN;
      const bridge = bridgePorts(
        outbound,
        `principal:${position.id}`,
        "principal",
        position.id,
        offset,
      );
      const busY = outbound.rect.y - L.LINK * 2 + HALF_LINE;
      principalIds.push(
        connect(`principal:chain:${chain.id}`, returnSource, bridge.incoming, [
          { x: laneX, y: point(returnSource).y },
          { x: laneX, y: busY },
          { x: point(bridge.incoming).x, y: busY },
        ]),
      );
      principalSource = bridge.outgoing;
    }
    const target = port(output, `principal:${position.id}`, "principal", position.id, "in", "top");
    principalIds.push(
      connect(
        outbound ? `principal:returned:${chain.id}` : `principal:chain:${chain.id}`,
        principalSource,
        target,
        outbound
          ? [
              { x: point(principalSource).x, y: principalY },
              { x: point(target).x, y: principalY },
            ]
          : [
              { x: laneX, y: point(returnSource).y },
              { x: laneX, y: principalY },
              { x: point(target).x, y: principalY },
            ],
      ),
    );
    routes.push({ id: `principal:chain:${chain.id}`, connectionIds: principalIds });
    for (const fee of chain.steps.filter((step) => step.kind === "collectFees")) {
      const collect = required(blocks.get(fee.id), "node");
      const swap = required(swaps.get(fee.id), "node");
      structural(`income:block:${fee.id}`, collect, swap, [], "income", position.id);
      const feeSource = port(swap, "income", "income", position.id, "out", "bottom");
      const feeIndex = chain.steps.findIndex((step) => step.id === fee.id);
      const previous = chain.steps[feeIndex - 1];
      const incomeIds: string[] = [
        ...(previous ? [`link:${previous.id}`] : []),
        `income:block:${fee.id}`,
      ];
      let incomeSource = feeSource;
      if (outbound) {
        const fees = chainEntries
          .filter(
            (entry) =>
              entry.network === network &&
              entry.chain.steps.some((step) => step.kind === "collectFees"),
          )
          .map((entry) => entry.chain.id);
        const offset =
          L.INCOME_PORT_START +
          ((fees.indexOf(chain.id) + 1) / (fees.length + 1)) * L.PRINCIPAL_PORT_SPAN;
        const bridge = bridgePorts(
          outbound,
          `income:${position.id}`,
          "income",
          position.id,
          offset,
        );
        const busY = outbound.rect.y - L.LINK + HALF_LINE;
        incomeIds.push(
          connect(`income:converted:${fee.id}`, feeSource, bridge.incoming, [
            { x: point(feeSource).x, y: busY },
            { x: point(bridge.incoming).x, y: busY },
          ]),
        );
        incomeSource = bridge.outgoing;
      }
      if (income) {
        const target = port(income, `income:${position.id}`, "income", position.id, "in", "top");
        incomeIds.push(
          connect(
            outbound ? `income:returned:${fee.id}` : `income:converted:${fee.id}`,
            incomeSource,
            target,
            [
              { x: point(incomeSource).x, y: incomeY },
              { x: point(target).x, y: incomeY },
            ],
          ),
        );
      }
      routes.push({ id: `income:converted:${fee.id}`, connectionIds: incomeIds });
    }
  }
  const withdraw = required(spine.get("withdraw"), "node");
  for (const node of [output, ...(income ? [income] : [])]) {
    const role = node === output ? "idleOutput" : "income";
    const mergeY = bottomOf(output.rect) + L.LINK + HALF_LINE;
    structural(
      `output:${role}`,
      node,
      withdraw,
      income
        ? [
            { x: centreOf(node.rect), y: mergeY },
            { x: centreOf(withdraw.rect), y: mergeY },
          ]
        : [],
    );
  }
  const model: SemanticGraph = { nodes, ports, junctions, segments, connections };
  const resolved = resolveSemanticGraph(model);
  const visible = resolved.connections.filter((connection) => !hidden.has(connection.id));
  const visibleIds = new Set(visible.map((entry) => entry.id));
  graph.semantic = model;
  graph.hoverRoutes = routes;
  graph.connections = visible.map((entry) => ({
    id: entry.id,
    kind: entry.class as EdgeKind,
    points: entry.points.filter(
      (point, index) =>
        index === 0 ||
        point.x !== entry.points[index - 1]?.x ||
        point.y !== entry.points[index - 1]?.y,
    ),
  }));
  graph.edges = [
    ...existingEdges,
    ...resolved.segments
      .filter(
        (segment) =>
          (segment.class === "principal" || segment.class === "income") &&
          (segment.points[0]?.x !== segment.points[1]?.x ||
            segment.points[0]?.y !== segment.points[1]?.y) &&
          visibleIds.has(
            required(
              segments.find((entry) => entry.id === segment.id),
              "segment",
            ).connectionId,
          ),
      )
      .map((entry) => {
        const segment = required(
          segments.find((value) => value.id === entry.id),
          "segment",
        );
        const connection = required(
          connections.find((value) => value.id === segment.connectionId),
          "connection",
        );
        const index = connection.segmentIds.indexOf(entry.id);
        return {
          id: index === 0 ? connection.id : `${connection.id}:leg:${index}`,
          kind: entry.class as EdgeKind,
          points: entry.points,
        };
      }),
  ];
}

function chainHasPosition(input: LayoutInput, chainId: string): boolean {
  return [...input.hub.chains, ...input.spokes.flatMap((spoke) => spoke.chains)].some(
    (chain) => chain.id === chainId && chain.steps.some((step) => step.family === "position"),
  );
}
