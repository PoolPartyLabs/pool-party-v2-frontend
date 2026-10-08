/**
 * @id PP-MGR-LIB-059
 * @name solanaPreviewModel tests
 * @implements-rules-version v2
 */
import { describe, expect, it } from "vitest";
import {
  createPreviewState,
  hasUnappliedChanges,
  isLiquidityBlock,
  parseAllocation,
  previewReducer,
  totalAllocationBps,
} from "./previewModel";

describe("local Solana drawing model", () => {
  // @rule R3/R5: visual blocks have no pool, mint, balance, price or transaction identity.
  it("adds an isolated local block with zero allocation and selects it", () => {
    const original = createPreviewState();
    const next = previewReducer(original, { type: "add", protocol: "raydium" });
    expect(next.blocks).toEqual([
      { id: "preview-1", protocol: "raydium", allocationBps: 0, pair: "SOL / USDC" },
    ]);
    expect(next.selectedId).toBe("preview-1");
    expect(next.changed).toBe(true);
    expect(original.blocks).toEqual([]);
  });
  // @rule R7: allocations are whole percentages 0..100, stored as integer basis points.
  it.each([
    ["0", 0],
    ["100", 10000],
    ["30", 3000],
    ["1", 100],
    [" 10 ", 1000],
  ] as const)("parses %s exactly", (value, expected) => {
    expect(parseAllocation(value)).toBe(expected);
  });
  it.each([
    "",
    "-1",
    "101",
    "100.01",
    "0,01",
    "1e2",
    "Infinity",
    "NaN",
    "30.001",
    "1.2.3",
    "+5",
  ])("rejects invalid allocation %s", (value) => expect(parseAllocation(value)).toBeNull());
  // @rule R6/R7: only valid Apply changes updates the drawn allocation.
  it("keeps local form edits separate until a valid Apply", () => {
    let state = previewReducer(createPreviewState(), { type: "add", protocol: "orca" });
    state = previewReducer(state, {
      type: "edit",
      value: { allocation: "40", pair: "USDC / SOL" },
    });
    expect(state.blocks[0]?.allocationBps).toBe(0);
    expect(hasUnappliedChanges(state)).toBe(true);
    state = previewReducer(state, { type: "apply" });
    expect(state.blocks[0]).toMatchObject({ allocationBps: 4000, pair: "USDC / SOL" });
    expect(hasUnappliedChanges(state)).toBe(false);
    state = previewReducer(state, { type: "edit", value: { allocation: "999" } });
    state = previewReducer(state, { type: "apply" });
    expect(state.error).toBe("allocation_invalid");
    expect(state.blocks[0]?.allocationBps).toBe(4000);
  });
  // @rule R7: the complete drawing's allocation must never exceed 100%.
  it("rejects totals above 100% and allows exactly 100%", () => {
    let state = previewReducer(createPreviewState(), { type: "add", protocol: "kamino" });
    state = previewReducer(state, { type: "edit", value: { allocation: "60" } });
    state = previewReducer(state, { type: "apply" });
    state = previewReducer(state, { type: "add", protocol: "raydium" });
    state = previewReducer(state, { type: "edit", value: { allocation: "41" } });
    state = previewReducer(state, { type: "apply" });
    expect(state.error).toBe("allocation_total");
    expect(totalAllocationBps(state)).toBe(6000);
    state = previewReducer(state, { type: "edit", value: { allocation: "40" } });
    state = previewReducer(state, { type: "apply" });
    expect(totalAllocationBps(state)).toBe(10000);
  });
  // @rule POO-2291 R8: local Manage writes only its drawing instance, not another editor.
  it("applies one Manage drawing baseline without losing another selected draft", () => {
    let state = previewReducer(createPreviewState(), { type: "add", protocol: "orca" });
    state = previewReducer(state, { type: "edit", value: { allocation: "60" } });
    state = previewReducer(state, { type: "apply" });
    state = previewReducer(state, { type: "add", protocol: "orca" });
    state = previewReducer(state, { type: "edit", value: { allocation: "40" } });
    const sibling = state.blocks[1];
    const next = previewReducer(state, {
      type: "apply-drawing",
      id: "preview-1",
      value: { allocation: "30", pair: "USDC / SOL" },
    });
    expect(next.blocks[0]).toMatchObject({ allocationBps: 3000, pair: "USDC / SOL" });
    expect(next.blocks[1]).toBe(sibling);
    expect(next.selectedId).toBe("preview-2");
    expect(next.edit).toEqual(state.edit);
    expect(hasUnappliedChanges(next)).toBe(true);
    expect(state.blocks[0]?.allocationBps).toBe(6000);
  });
  it("acknowledges only valid Manage allocations within applied drawing capacity", () => {
    let state = previewReducer(createPreviewState(), { type: "add", protocol: "raydium" });
    state = previewReducer(state, { type: "edit", value: { allocation: "60" } });
    state = previewReducer(state, { type: "apply" });
    state = previewReducer(state, { type: "add", protocol: "holding" });
    for (const allocation of ["", "-1", "40.1", "101", "41"]) {
      expect(
        previewReducer(state, {
          type: "apply-drawing",
          id: "preview-2",
          value: { allocation, pair: "SOL / USDC" },
        }),
      ).toBe(state);
    }
    expect(
      previewReducer(state, {
        type: "apply-drawing",
        id: "removed-instance",
        value: { allocation: "10", pair: "SOL / USDC" },
      }),
    ).toBe(state);
    const next = previewReducer(state, {
      type: "apply-drawing",
      id: "preview-2",
      value: { allocation: "40", pair: "USDC / SOL" },
    });
    expect(totalAllocationBps(next)).toBe(10000);
    expect(next.edit).toEqual({ allocation: "40", pair: "USDC / SOL" });
    expect(hasUnappliedChanges(next)).toBe(false);
  });
  // @rule R6: discard retains the last applied configuration; removal is an explicit local action.
  it("discards edits and removes only the requested block", () => {
    let state = previewReducer(createPreviewState(), { type: "add", protocol: "jupiter" });
    state = previewReducer(state, { type: "edit", value: { allocation: "25" } });
    state = previewReducer(state, { type: "discard" });
    expect(state.edit?.allocation).toBe("0");
    state = previewReducer(state, { type: "add", protocol: "kamino" });
    state = previewReducer(state, { type: "remove", id: "preview-1" });
    expect(state.blocks.map((block) => block.protocol)).toEqual(["kamino"]);
  });
  // @rule R6: lending interest returns with principal, manual swaps have no LP fee collector.
  it("adds fee-collection routes only for Raydium and Orca LPs", () => {
    expect(isLiquidityBlock("raydium")).toBe(true);
    expect(isLiquidityBlock("orca")).toBe(true);
    expect(isLiquidityBlock("kamino")).toBe(false);
    expect(isLiquidityBlock("jupiter")).toBe(false);
  });
  it("retains selected unapplied edits when another block is removed", () => {
    let state = previewReducer(createPreviewState(), { type: "add", protocol: "kamino" });
    state = previewReducer(state, { type: "add", protocol: "orca" });
    state = previewReducer(state, { type: "edit", value: { allocation: "65" } });
    state = previewReducer(state, { type: "remove", id: "preview-1" });
    expect(state.selectedId).toBe("preview-2");
    expect(state.edit?.allocation).toBe("65");
    expect(hasUnappliedChanges(state)).toBe(true);
  });
  // @rule POO-2291 R6,R8: custody has independent local instances without pool/range/collector identity.
  it("adds and configures separate Holding custody blocks without LP routes", () => {
    let state = previewReducer(createPreviewState(), { type: "add", protocol: "holding" });
    state = previewReducer(state, {
      type: "edit",
      value: { allocation: "25", pair: "USDC / SOL" },
    });
    state = previewReducer(state, { type: "apply" });
    state = previewReducer(state, { type: "add", protocol: "holding" });
    expect(state.blocks).toEqual([
      { id: "preview-1", protocol: "holding", allocationBps: 2500, pair: "USDC / SOL" },
      { id: "preview-2", protocol: "holding", allocationBps: 0, pair: "SOL / USDC" },
    ]);
    expect(isLiquidityBlock("holding")).toBe(false);
    expect(totalAllocationBps(state)).toBe(2500);
  });
});
