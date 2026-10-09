/**
 * @id PP-MGR-LIB-023
 * @name graphTypes
 * @implements-rules-version v2 (POO-2273); v1 (POO-2153 rules v1); POO-2213 rules v1; POO-2235 rules v1; POO-2288 rules v1
 * @implements-rules-version v1 (POO-2301 shared local runtime; POO-2302 measured engine)
 * @analytics-events none, type declarations and one pure key function: nothing here is rendered.
 *
 * The shapes the Build canvas layout reads and returns (coordinator plan, section 3.3). The names
 * are binding: the renderer (S6), the interactions (S5) and the Build screen (S7) compile against
 * them.
 *
 * The INPUT is structural ({@link LayoutInput}): networks are plain strings, so the reference
 * canvases can keep Base and Polygon, which the mandate no longer offers (default D15), and
 * `toLayoutInput` maps a stored plan onto it.
 *
 * The OUTPUT ({@link GraphLayout}) is in graph coordinates at 100% zoom, the canvas padding
 * included, origin at the graph's top-left. Conventions (rule L10):
 *
 * - a box ({@link Rect}) is its outer bounds: x, y of the top-left corner, w, h;
 * - `EdgeNode.points` are the CENTRE line of a 1.5 px stroke. A vertical run is at the handoff x;
 *   a horizontal run drawn at handoff y (its top edge) has points at y + 0.75. The renderer draws
 *   a 1.5 stroke along `points` with no further offset. Every edge is one straight segment, so the
 *   handoff's "lines" (the principal line, a bus) are the union of their segments;
 * - a port's `center` and a share label's `center` are the middle of the drawn shape; the label's
 *   width depends on its text, so the renderer centres it there;
 * - a group's `chipAnchor` is the chip's LEFT edge and its vertical CENTRE (the box's top border);
 * - the empty canvas captions are anchored at the middle of their TOP edge; the start-here sentence
 *   is a box whose width the caller measured (`LayoutOptions.startHereWidth`).
 *
 * Menus and tooltips are overlays: they are not part of the graph and not part of its size.
 */

import type { SemanticGraph } from "../graph/semanticGraph";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A plan step, as the layout needs it. `configured` is `config !== null` (a pill counts as true). */
export interface LayoutStep {
  /** Presentation-only mandatory exit conversion; never a stored or executable plan step. */
  returnConversionOf?: string;
  id: string;
  family: "position" | "flow";
  kind: string;
  auto: boolean;
  configured: boolean;
}

export interface LayoutChain {
  id: string;
  sharePct: number;
  /** Top to bottom. */
  steps: LayoutStep[];
}

export interface LayoutSpoke {
  /** Opt-in presentation context, never stored or executable plan data. */
  context?: "solana-local";
  network: string;
  sharePct: number;
  /** Left to right. */
  chains: LayoutChain[];
}

export interface LayoutInput {
  hubNetwork: string;
  /** Left to right. */
  hub: { chains: LayoutChain[] };
  /** Left to right, in the order they were added. */
  spokes: LayoutSpoke[];
}

export interface LayoutOptions {
  /**
   * Measured width of the empty-canvas sentence, in px (English: 420). Read only when empty, and
   * rounded up to an even integer there, so a fractional measure keeps every x whole.
   */
  startHereWidth: number;
}

/** Everything on the canvas a manager can act on, or drop a palette block onto. */
export type GraphTarget =
  | { kind: "addProtocol"; network: string }
  | { kind: "addNetwork" }
  | { kind: "port"; side: "before" | "after"; blockId: string }
  | {
      kind: "shareLabel";
      chainId: string | null;
      network: string | null;
      feedsBlockId: string | null;
    }
  | { kind: "block"; blockId: string };

/** One field of a key: percent-encoded (":" and "~" included), and "~" alone for null. */
function keyPart(value: string | null): string {
  return value === null ? "~" : encodeURIComponent(value).replace(/~/g, "%7E");
}

/**
 * The attribute that carries {@link targetKey} on every drop target the renderer draws (S6), and
 * that the palette's drop resolves (S5). One constant for both sides (S7 wiring, POO-2157): the
 * renderer wrote it as a literal while the palette exported its own copy.
 */
export const GRAPH_TARGET_ATTR = "data-graph-target";

/**
 * A stable string per target, used for `activeTargetKeys` (S5) and `data-graph-target` (S6). Two
 * different targets never share a key: every field is encoded, so an id holding ":" cannot collide.
 */
export function targetKey(target: GraphTarget): string {
  switch (target.kind) {
    case "addProtocol":
      return `addProtocol:${keyPart(target.network)}`;
    case "addNetwork":
      return "addNetwork";
    case "port":
      return `port:${target.side}:${keyPart(target.blockId)}`;
    case "shareLabel":
      return `shareLabel:${keyPart(target.chainId)}:${keyPart(target.network)}:${keyPart(target.feedsBlockId)}`;
    case "block":
      return `block:${keyPart(target.blockId)}`;
  }
}

export type SpineRole = "deposit" | "idleInput" | "idleOutput" | "income" | "withdraw";

/** A spine card. Deposit and Withdraw are `locked` (C2). Income exists iff a Collect fees does. */
export interface SpineNode {
  role: SpineRole;
  rect: Rect;
  locked: boolean;
}

/** A card or a pill of the plan. `network` is where it sits (C5). */
export interface BlockNode {
  returnConversionOf?: string;
  id: string;
  chainId: string;
  network: string;
  family: "position" | "flow";
  kind: string;
  auto: boolean;
  rect: Rect;
}

/** The Bridge · auto pill of a spoke: derived, never stored (C4). */
export interface BridgeNode {
  network: string;
  rect: Rect;
  /** Additive identity for the return Bridge; omitted retains the original inbound key. */
  direction?: "inbound" | "outbound";
}

/** Derived fee conversion on the income branch, never a stored or editable plan block. */
export interface FeeSwapNode {
  sourceBlockId: string;
  chainId: string;
  network: string;
  rect: Rect;
}

/** A spoke's dashed box. `chipAnchor` is the chip's left edge on the box's top border. */
export interface GroupNode {
  network: string;
  rect: Rect;
  chipAnchor: Point;
  hasChains: boolean;
}

/** Local Build context identity is explicit; native cash never carries a pool mint or financial port. */
export interface SpokeContextNode {
  network: string;
  /** Financial axis, independent of the asymmetric cash satellite and group bounds. */
  axisX: number;
  idle: {
    /** Complete semantic node identity; renderers map this value directly. */
    id: string;
    rect: Rect;
    stableSymbol: "USDC";
    amount: null;
    valueUsd: null;
  };
  cash: {
    /** Complete handle-less decoration identity. */
    id: string;
    rect: Rect;
    nativeSymbol: "SOL";
    mint: null;
    amount: null;
    valueUsd: null;
  };
}

/** The Add protocol circle of a row, or the Add network box (C15). */
export interface TemplateNode {
  target: Extract<GraphTarget, { kind: "addProtocol" | "addNetwork" }>;
  rect: Rect;
}

/** An insert port on the top ("before") or bottom ("after") edge of a card (C17). */
export interface PortNode {
  target: Extract<GraphTarget, { kind: "port" }>;
  center: Point;
}

/** The share label on the stub above a chain or a Bridge (C8). `edgeId` is that stub. */
export interface ShareLabelNode {
  target: Extract<GraphTarget, { kind: "shareLabel" }>;
  pct: number;
  center: Point;
  edgeId: string;
}

/**
 * `structural`: the spine, the buses, the stubs and the links (grey). `template`: the stub of an
 * Add protocol circle or the Add network box (grey). `principal`: the grey return to Idle output.
 * `income`: the green return to Income (fees), down to the merge line.
 */
export type EdgeKind = "structural" | "principal" | "income" | "template";

/** One orthogonal segment; `points` are the stroke's centre line (see the file header). */
export interface EdgeNode {
  id: string;
  kind: EdgeKind;
  points: Point[];
}

/** The empty canvas only: the two template captions and the start-here sentence (L6). */
export interface EmptyCaptions {
  addProtocol: Point;
  addNetwork: Point;
  startHere: Rect;
}

export interface GraphLayout {
  /** Present only for explicitly opted-in local spokes. */
  spokeContexts?: SpokeContextNode[];
  /** The existing core network, also the destination of derived return Bridges. */
  hubNetwork?: string;
  width: number;
  height: number;
  spineCentreX: number;
  /** Deposit, Idle input, Idle output, Income (when present), Withdraw. */
  spine: SpineNode[];
  /** Hub chains left to right, then each spoke's; each chain top to bottom. */
  blocks: BlockNode[];
  bridges: BridgeNode[];
  feeSwaps?: FeeSwapNode[];
  groups: GroupNode[];
  /** The hub circle, each spoke's circle, then the Add network box. */
  templates: TemplateNode[];
  ports: PortNode[];
  shareLabels: ShareLabelNode[];
  edges: EdgeNode[];
  /** Complete block-to-block paths, with shared buses clipped to this connection. */
  connections?: EdgeNode[];
  /** Explicit financial routes. Legacy layouts retain their existing edges until migrated. */
  semantic?: SemanticGraph;
  /** Visible legs of one financial route; Bridge transfers remain semantic and unpainted. */
  hoverRoutes?: { id: string; connectionIds: string[] }[];
  emptyCaptions: EmptyCaptions | null;
}
