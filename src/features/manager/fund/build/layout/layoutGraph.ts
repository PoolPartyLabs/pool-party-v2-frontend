/**
 * @id PP-MGR-LIB-023
 * @name layoutGraph
 * @implements-rules-version v1 (POO-2153 rules v1)
 * @analytics-events none, a pure geometry module: the Build screen (PP-MGR-SCR-002, S7) owns every
 *   event; nothing here is rendered or tracked.
 *
 * The app lays the graph out; the manager never positions a block (C1). This pure function turns a
 * plan (as a {@link LayoutInput}) into the box of every node, the segments of every line, the
 * centres of the share labels and the ports, the groups, the templates, the empty-canvas captions
 * and the graph size. Same input, same output: no DOM, no React, no clock, no randomness.
 *
 * Rules (handoff v1.2, "Layout rules"), all distances from {@link LAYOUT} (C21):
 *
 * - L2, vertical: Deposit 24, Idle input 110, bus 196, row 244 (hub labels on 220); a group from
 *   228 with its Bridge 244 to 270, its inner bus 294, its row 342 (labels on 318) and its label on
 *   212; each next block 24 under the previous; a group ends 16 under its lowest content.
 * - L3, horizontal: from x 24, each hub chain 176 then 32; the hub circle; 40; each group (16,
 *   chains with 32 between, 32, its circle, 16; a group with no chain is 176 inside, circle
 *   centred); 40 between groups; 40; the Add network box. The spine centre is (24 + the box's right
 *   edge) / 2, never less than 142. The buses span their stubs.
 * - L5, return lines: `deepest` is the lowest of the chains' last blocks and the circles (a group's
 *   lowest content, its circle included). Principal line at deepest + 24; each chain drops to it from
 *   its last block, 12 left of the centre under a Collect fees, which also drops its income 12 right.
 *   The income line runs 24 under the principal, except C11: a single chain ending in Collect fees
 *   whose principal runs left and income runs right turns both at one level. Idle output (and Income,
 *   134 each side of the spine when a Collect fees exists) start 24 under the lower line; a merge line
 *   24 under them, then Withdraw 24 under it. With no chain, no return line and Idle output 48 under
 *   the deepest content.
 * - L6, the empty canvas: spine at 202, templates 60 each side, captions 22 under the circle and 6
 *   under the box, the sentence 28 under the captions' top, Idle output 48 under the sentence.
 * - L4, normalisation, LAST: translate the whole graph RIGHT until the leftmost content sits at x
 *   24; it never moves left.
 *
 * PP-NOTE (L4, the coordinator's reading, review of PR #33): the handoff says "translate the whole
 * graph to the right until the leftmost content sits at x = 24", and for the empty canvas "the
 * whole graph shifts right until the sentence starts at the canvas padding". So the shift is
 * `max(0, 24 - leftmost)`. Outside the empty canvas the leftmost content is never right of 24 (the
 * row starts there), so nothing changes. On an empty canvas whose start-here sentence is narrower
 * than 356 px (a short locale), nothing shifts: the spine stays at 202 and Deposit, the leftmost
 * content, starts at 84. A left padding larger than 24 on a narrow empty canvas is the accepted
 * consequence; the right and bottom paddings stay 24. Every drawn reference is unchanged (English
 * canvas D, 420 px, shifts by 32; Build state 5 by 76).
 *
 * The measured sentence width is rounded UP to an even integer first, so the sentence, centred on a
 * whole spine, keeps every x of the empty graph whole (a measured 419.64 lays out as 420).
 *
 * Every edge is ONE straight segment with a stable id, so a share label names its stub (`edgeId`)
 * and the renderer can highlight it. Ports come from `portSlotsOf` (S1, C17), never re-derived.
 */
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
    locked: role === "deposit" || role === "withdraw",
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
        vertical(`link:${previous.id}`, "structural", centre, bottomOf(previous.rect), y),
      );
    }
    const node: BlockNode = {
      id: step.id,
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
  return { chain, centre, nodes, bottom: last ? bottomOf(last.rect) : top };
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
  /** The lowest content inside the box, its circle included (not the border). */
  lowest: number;
}

/** A spoke's group: its chains, its circle, its Bridge, its inner bus and its label (C3, C20). */
function placeSpoke(d: Draft, spoke: LayoutSpoke, left: number): PlacedSpoke {
  const chains: PlacedChain[] = [];
  let x = left + L.GROUP_PAD;
  for (const chain of spoke.chains) {
    const placed = placeChain(d, chain, spoke.network, x, L.INNER_ROW_TOP);
    hangChain(d, placed, spoke.network, L.INNER_BUS_Y, L.INNER_ROW_TOP, L.INNER_LABEL_Y);
    chains.push(placed);
    x += L.CARD_W + L.SIBLING;
  }
  // C16: with no chain the group is one card wide inside its padding, the circle centred in it.
  const circleLeft = chains.length > 0 ? x : left + L.GROUP_PAD + (L.CARD_W - L.CIRCLE) / 2;
  const circle = placeCircle(d, spoke.network, circleLeft, L.INNER_BUS_Y, L.INNER_ROW_TOP);
  const innerRight = chains.length > 0 ? rightOf(circle) : left + L.GROUP_PAD + L.CARD_W;
  const right = innerRight + L.GROUP_PAD;
  const centre = (left + right) / 2;
  const lowest = Math.max(bottomOf(circle), ...chains.map((c) => c.bottom));

  // C20: the Bridge, the stub that enters the box and the spoke's label sit on its centre.
  const bridge = rect(centre - L.PILL_W / 2, L.ROW_TOP, L.PILL_W, L.PILL_H);
  d.bridges.push({ network: spoke.network, rect: bridge });
  const stubId = `stub:spoke:${spoke.network}`;
  d.edges.push(
    vertical(stubId, "structural", centre, L.BUS_Y, L.ROW_TOP),
    vertical(`bridge:${spoke.network}`, "structural", centre, bottomOf(bridge), L.INNER_BUS_Y),
    ...spanning(`bus:spoke:${spoke.network}`, "structural", L.INNER_BUS_Y, [
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

  const box = rect(left, L.GROUP_TOP, right - left, lowest + L.GROUP_PAD - L.GROUP_TOP);
  const group: GroupNode = {
    network: spoke.network,
    rect: box,
    chipAnchor: { x: left + L.CHIP_INSET, y: L.GROUP_TOP },
    hasChains: chains.length > 0,
  };
  d.groups.push(group);
  return { chains, group, lowest };
}

/** The return lines, Idle output, Income (fees) and Withdraw, under `deepest` (L5, C10, C11). */
function placeReturns(d: Draft, chains: PlacedChain[], deepest: number): void {
  const c = d.spineCentreX;
  const endsInFees = (p: PlacedChain) =>
    p.chain.steps[p.chain.steps.length - 1]?.kind === "collectFees";
  const fees = chains.flatMap((p) =>
    p.nodes.filter((n) => n.kind === "collectFees").map((n) => ({ p, n })),
  );
  const income = fees.length > 0;
  const outputCentre = income ? c - L.OUTPUT_OFFSET : c;
  const incomeCentre = c + L.OUTPUT_OFFSET;

  let outputTop = deepest + L.EMPTY_OUTPUT_GAP;
  if (chains.length > 0) {
    const principalY = deepest + L.LINK;
    const drops = chains.map((p) => ({ p, x: endsInFees(p) ? p.centre - L.PAIR : p.centre }));
    const incomeDrops = fees.map(({ p, n }) => ({ n, x: p.centre + L.PAIR }));
    const [only] = chains;
    const [onlyDrop] = drops;
    const [onlyIncome] = incomeDrops;
    // C11: one chain on the canvas, ending in Collect fees, principal running left, income right.
    const oneLevel =
      chains.length === 1 &&
      only !== undefined &&
      endsInFees(only) &&
      onlyDrop !== undefined &&
      onlyIncome !== undefined &&
      outputCentre <= onlyDrop.x &&
      onlyIncome.x <= incomeCentre;
    const incomeY = oneLevel ? principalY : principalY + L.LINK;
    outputTop = (income ? Math.max(principalY, incomeY) : principalY) + L.LINK;

    for (const { p, x } of drops) {
      d.edges.push(vertical(`principal:chain:${p.chain.id}`, "principal", x, p.bottom, principalY));
    }
    d.edges.push(
      ...spanning("principal:line", "principal", principalY, [
        outputCentre,
        ...drops.map((x) => x.x),
      ]),
      vertical("principal:out", "principal", outputCentre, principalY, outputTop),
    );
    if (income) {
      for (const { n, x } of incomeDrops) {
        d.edges.push(vertical(`income:block:${n.id}`, "income", x, bottomOf(n.rect), incomeY));
      }
      d.edges.push(
        ...spanning("income:line", "income", incomeY, [
          incomeCentre,
          ...incomeDrops.map((x) => x.x),
        ]),
        vertical("income:out", "income", incomeCentre, incomeY, outputTop),
      );
    }
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
      vertical("output:income", "income", incomeCentre, outputBottom, mergeY),
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
  for (const spoke of input.spokes) {
    const placed = placeSpoke(d, spoke, x);
    spokes.push(placed);
    x = rightOf(placed.group.rect) + L.GROUP_GAP;
  }
  const netbox = placeNetbox(d, x);

  const c = Math.max((L.CANVAS_PAD + rightOf(netbox)) / 2, L.SPINE_MIN_CENTRE);
  d.spineCentreX = c;
  placeSpineTop(d, c);
  d.edges.push(
    ...spanning("bus:idleInput", "structural", L.BUS_Y, [
      c,
      centreOf(hubCircle),
      centreOf(netbox),
      ...hub.map((p) => p.centre),
      ...spokes.map((s) => centreOf(s.group.rect)),
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
    ...d.groups.map((n) => n.rect),
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
    spine: d.spine.map((n) => ({ ...n, rect: moveRect(n.rect, dx) })),
    blocks: d.blocks.map((n) => ({ ...n, rect: moveRect(n.rect, dx) })),
    bridges: d.bridges.map((n) => ({ ...n, rect: moveRect(n.rect, dx) })),
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
  return normalise(empty ? layoutEmpty(input, options) : layoutPlan(input));
}
