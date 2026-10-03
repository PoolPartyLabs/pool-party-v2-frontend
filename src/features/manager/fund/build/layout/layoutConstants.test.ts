/**
 * @id PP-MGR-LIB-023
 * @name layoutConstants tests
 * @implements-rules-version v1 (POO-2153 rules v1)
 * @analytics-events none, a pure geometry module: nothing here is rendered or tracked.
 *
 * [L1] every constant of the handoff table (v1.2, "Layout rules · Constants") with its exact value,
 * plus the empty-canvas constants the handoff states or implies. [L2] the fixed vertical positions,
 * each one checked against the rule that defines it, so a constant can never drift from its rule.
 */
import { describe, expect, it } from "vitest";
import { LAYOUT } from "./layoutConstants";

describe("LAYOUT constants", () => {
  // @rule L1
  it("[L1] holds the handoff constants table exactly", () => {
    expect(LAYOUT.CARD_W).toBe(176);
    expect(LAYOUT.CARD_H).toBe(62);
    expect(LAYOUT.SPINE_W).toBe(236);
    expect(LAYOUT.PILL_W).toBe(176);
    expect(LAYOUT.PILL_H).toBe(26);
    expect(LAYOUT.LINK).toBe(24);
    expect(LAYOUT.STUB).toBe(48);
    expect(LAYOUT.SIBLING).toBe(32);
    expect(LAYOUT.GROUP_GAP).toBe(40);
    expect(LAYOUT.GROUP_PAD).toBe(16);
    expect(LAYOUT.CANVAS_PAD).toBe(24);
    expect(LAYOUT.CIRCLE).toBe(40);
    expect(LAYOUT.NETBOX_W).toBe(64);
    expect(LAYOUT.NETBOX_H).toBe(72);
    expect(LAYOUT.PAIR).toBe(12);
    expect(LAYOUT.SPINE_GAP).toBe(32);
  });

  // @rule L1
  it("[L1] holds the building-block sizes the layout places (line, port, label, chip inset)", () => {
    expect(LAYOUT.LINE_W).toBe(1.5);
    expect(LAYOUT.PORT).toBe(16);
    expect(LAYOUT.SHARE_LABEL_H).toBe(20);
    expect(LAYOUT.CHIP_INSET).toBe(12);
  });

  // @rule L1
  it("[L1] holds the empty-canvas constants the handoff states or implies", () => {
    expect(LAYOUT.EMPTY_SPINE_CENTRE).toBe(202);
    expect(LAYOUT.EMPTY_TEMPLATE_OFFSET).toBe(60);
    expect(LAYOUT.EMPTY_CAPTION_GAP_CIRCLE).toBe(22);
    expect(LAYOUT.EMPTY_CAPTION_GAP_BOX).toBe(6);
    expect(LAYOUT.EMPTY_SENTENCE_OFFSET).toBe(28);
    expect(LAYOUT.EMPTY_SENTENCE_LINE_H).toBe(18);
    expect(LAYOUT.EMPTY_OUTPUT_GAP).toBe(48);
  });

  // @rule L2
  it("[L2] places Deposit at 24, Idle input at 110, the bus at 196 and the row at 244", () => {
    expect(LAYOUT.DEPOSIT_TOP).toBe(24);
    expect(LAYOUT.DEPOSIT_TOP).toBe(LAYOUT.CANVAS_PAD);
    expect(LAYOUT.IDLE_INPUT_TOP).toBe(110);
    expect(LAYOUT.IDLE_INPUT_TOP).toBe(LAYOUT.DEPOSIT_TOP + LAYOUT.CARD_H + LAYOUT.LINK);
    expect(LAYOUT.BUS_Y).toBe(196);
    expect(LAYOUT.BUS_Y).toBe(LAYOUT.IDLE_INPUT_TOP + LAYOUT.CARD_H + LAYOUT.LINK);
    expect(LAYOUT.ROW_TOP).toBe(244);
    expect(LAYOUT.ROW_TOP).toBe(LAYOUT.BUS_Y + LAYOUT.STUB);
  });

  // @rule L2
  it("[L2] centres a hub label on 220 and a spoke label on 212, between the bus and the box", () => {
    expect(LAYOUT.HUB_LABEL_Y).toBe(220);
    expect(LAYOUT.HUB_LABEL_Y).toBe(LAYOUT.BUS_Y + LAYOUT.STUB / 2);
    expect(LAYOUT.GROUP_TOP).toBe(228);
    expect(LAYOUT.GROUP_TOP).toBe(LAYOUT.ROW_TOP - LAYOUT.GROUP_PAD);
    expect(LAYOUT.NETBOX_STUB).toBe(32);
    expect(LAYOUT.NETBOX_STUB).toBe(LAYOUT.GROUP_TOP - LAYOUT.BUS_Y);
    expect(LAYOUT.SPOKE_LABEL_Y).toBe(212);
    expect(LAYOUT.SPOKE_LABEL_Y).toBe((LAYOUT.BUS_Y + LAYOUT.GROUP_TOP) / 2);
  });

  // @rule L2
  it("[L2] places, inside a group, the Bridge at 244, the inner bus at 294, the row at 342", () => {
    expect(LAYOUT.INNER_BUS_Y).toBe(294);
    expect(LAYOUT.INNER_BUS_Y).toBe(LAYOUT.ROW_TOP + LAYOUT.PILL_H + LAYOUT.LINK);
    expect(LAYOUT.INNER_ROW_TOP).toBe(342);
    expect(LAYOUT.INNER_ROW_TOP).toBe(LAYOUT.INNER_BUS_Y + LAYOUT.STUB);
    expect(LAYOUT.INNER_LABEL_Y).toBe(318);
    expect(LAYOUT.INNER_LABEL_Y).toBe(LAYOUT.INNER_BUS_Y + LAYOUT.STUB / 2);
  });

  // @rule L3
  it("[L3] keeps the spine centre at least 142 and puts the outputs 134 each side of it", () => {
    expect(LAYOUT.SPINE_MIN_CENTRE).toBe(142);
    expect(LAYOUT.SPINE_MIN_CENTRE).toBe(LAYOUT.CANVAS_PAD + LAYOUT.SPINE_W / 2);
    expect(LAYOUT.OUTPUT_OFFSET).toBe(134);
    expect(LAYOUT.OUTPUT_OFFSET).toBe((LAYOUT.SPINE_W + LAYOUT.SPINE_GAP) / 2);
  });

  // @rule C21
  it("[C21] is frozen data: one rule set for every graph", () => {
    expect(Object.isFrozen(LAYOUT)).toBe(true);
  });
});
