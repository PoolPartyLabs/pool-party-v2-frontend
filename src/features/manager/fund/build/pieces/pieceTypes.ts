/**
 * @id PP-MGR-CMP-049
 * @name pieceTypes
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @implements-rules-version v1 (POO-2301 shared local runtime; POO-2302 measured engine)
 * @analytics-events none, types only; the Build screen (PP-MGR-SCR-002, S7) owns every event
 *
 * The shared contract of the Build canvas pieces (slice S4, POO-2154; coordinator plan section 3.4).
 * Filed under PP-MGR-CMP-049 (PositionCard), the slice's main id: every piece of PP-MGR-CMP-048 to
 * 055 reads these types, and the block registry (S5) and the graph renderer (S6) build them.
 *
 * Presentational contract: a piece receives every string through these shapes and never derives one.
 * A card's title, caption and accessible name come from the block's `config` (heads-up HU2), so S5
 * computes them once in `describeBlock` and the card only draws them.
 */

import type { ReactNode } from "react";

/**
 * The icon of a block, a flow pill or a spine card. A closed set, so a renderer cannot ask a piece
 * for an icon it does not draw. `coins` also stands for Collect fees (the handoff gives that pill no
 * icon; `coins` is the nearest, and the Income (fees) spine card already uses it).
 */
export type BlockIcon =
  | "layers"
  | "bank"
  | "swap"
  | "coins"
  | "bridge"
  | "depositIn"
  | "withdrawOut"
  | "hourglass";

/**
 * The look of a position card (handoff [BB1], defaults D27). Selection is NOT a state here: it is a
 * separate `selected` flag, because an empty, invalid or coming-soon block can be selected too.
 */
export type CardState = "default" | "empty" | "invalid" | "comingSoon";

/** What a position card shows. Built by S5 (`describeBlock`) from the block's `config`. */
export interface BlockContent {
  /** Optional protocol mark inside the existing icon box; decorative. */
  mark?: ReactNode;
  /** One line: the pair ("WETH / USDC"), "Supply USDC", or the empty title ("Uniswap v4"). */
  title: string;
  /** One line: "Uniswap v4 · 0.05%", "Pick a pool", or "No longer in your mandate" when invalid. */
  caption: string;
  icon: BlockIcon;
  state: CardState;
  /** The card's accessible name (I10): "WETH / USDC, Uniswap v4 · 0.05%, on Arbitrum, 60% of the capital". */
  accessibleName: string;
  /**
   * D11: the text of the tooltip that opens when the caption is cut by its ellipsis. Defaults to
   * `caption`; the card opens the tooltip only when the caption overflows its line.
   */
  fullCaption?: string;
  /**
   * D27: the text of the "Soon" tag drawn at the right end of a coming-soon card. Read only when
   * `state` is `comingSoon`. (An addition to plan section 3.4: the tag is copy, so it arrives as a
   * prop like every other string.)
   */
  soonTag?: string;
}

/** What a flow pill shows (Swap · auto, Swap, Collect fees, Bridge · auto). Built by S5 or S6. */
export interface FlowContent {
  /** One line: "Swap · auto". */
  text: string;
  /** One line, on hover and focus (C19): "The app swaps USDC into the pool tokens". */
  tooltip: string;
  icon: BlockIcon;
}

/** A point in graph coordinates (the layout at 100%). */
export interface PiecePoint {
  x: number;
  y: number;
}

/**
 * One line of the graph, as {@link GraphEdges} draws it. `points` are the CENTRE line of the stroke
 * (S3 adds 0.75 to the handoff y of a horizontal run), so a stroke of 1.5 is drawn along them with no
 * further offset. `muted` covers principal, structural and template lines; `income` is the green
 * return line of Collect fees ([BB8]).
 */
export interface PieceEdge {
  id: string;
  tone: "muted" | "income";
  points: ReadonlyArray<PiecePoint>;
}
