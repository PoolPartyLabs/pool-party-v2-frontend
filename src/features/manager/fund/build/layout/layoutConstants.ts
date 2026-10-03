/**
 * @id PP-MGR-LIB-023
 * @name layoutConstants
 * @implements-rules-version v1 (POO-2153 rules v1)
 * @analytics-events none, constants of a pure geometry module: nothing here is rendered or tracked.
 *
 * Every distance the Build canvas layout uses, in px at 100% zoom (handoff v1.2, "Layout rules").
 * One rule set for every graph, with no per-screen exception (C21): `layoutGraph` reads all its
 * numbers from here, and a test scans it for any other.
 *
 * Three groups:
 *
 * 1. The handoff's constants table (CARD_W to SPINE_GAP), verbatim.
 * 2. The fixed vertical positions (L2), each one a sum of the table's values; the tests check every
 *    one against the rule that defines it, so a value here cannot drift from its rule.
 * 3. The empty-canvas constants the handoff states or implies (verification E21): the spine centre
 *    before normalisation (202), the templates 60 each side, the captions 22 under the circle and 6
 *    under the box, the sentence 28 under the captions' top and 18 high, Idle output 48 under it.
 *
 * Added beyond the coordinator plan (section 3.3): `CHIP_INSET`, the 12 px between a group's left
 * border and its network chip (handoff "Spoke group"), so the chip anchor carries no literal.
 */
export const LAYOUT = Object.freeze({
  // The handoff constants table.
  CARD_W: 176,
  CARD_H: 62,
  SPINE_W: 236,
  PILL_W: 176,
  PILL_H: 26,
  LINK: 24,
  STUB: 48,
  SIBLING: 32,
  GROUP_GAP: 40,
  GROUP_PAD: 16,
  CANVAS_PAD: 24,
  CIRCLE: 40,
  NETBOX_W: 64,
  NETBOX_H: 72,
  /** From the bus down to the top of the Add network box (GROUP_TOP - BUS_Y). */
  NETBOX_STUB: 32,
  PAIR: 12,
  SPINE_GAP: 32,

  // Building-block sizes the layout places.
  LINE_W: 1.5,
  PORT: 16,
  SHARE_LABEL_H: 20,
  /** A group's network chip sits 12 from the box's left border, centred on its top border. */
  CHIP_INSET: 12,

  // Vertical positions, fixed for every graph (L2).
  DEPOSIT_TOP: 24,
  IDLE_INPUT_TOP: 110,
  BUS_Y: 196,
  ROW_TOP: 244,
  HUB_LABEL_Y: 220,
  GROUP_TOP: 228,
  SPOKE_LABEL_Y: 212,
  INNER_BUS_Y: 294,
  INNER_ROW_TOP: 342,
  INNER_LABEL_Y: 318,

  // Horizontal rules (L3, L5).
  /** CANVAS_PAD + SPINE_W / 2: Deposit never starts left of the padding. */
  SPINE_MIN_CENTRE: 142,
  /** (SPINE_W + SPINE_GAP) / 2: Idle output and Income (fees) centres, each side of the spine. */
  OUTPUT_OFFSET: 134,

  // The empty canvas (L6).
  EMPTY_SPINE_CENTRE: 202,
  EMPTY_TEMPLATE_OFFSET: 60,
  EMPTY_CAPTION_GAP_CIRCLE: 22,
  EMPTY_CAPTION_GAP_BOX: 6,
  EMPTY_SENTENCE_OFFSET: 28,
  EMPTY_SENTENCE_LINE_H: 18,
  /** Idle output starts this far under the lowest content when nothing returns yet. */
  EMPTY_OUTPUT_GAP: 48,
} as const);

export type LayoutConstants = typeof LAYOUT;
