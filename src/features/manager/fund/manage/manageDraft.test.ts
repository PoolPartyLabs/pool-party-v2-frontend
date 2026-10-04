/** @id PP-MGR-LIB-053 @implements-rules-version v1 (POO-2227) */
import { describe, expect, it } from "vitest";
import {
  createManageDraft,
  manageDraftReducer,
  rangeChanged,
  rangeFingerprint,
  validManageRange,
} from "./manageDraft";

const range = { tickLower: -200, tickUpper: 200, fullRange: false, displayInverted: false };
describe("Manage range draft", () => {
  it("[R2] inversion is presentation only and restoring ticks clears the operation", () => {
    let state = createManageDraft("core:42161:key", range);
    state = manageDraftReducer(state, {
      type: "range",
      range: { ...range, displayInverted: true },
    });
    expect(rangeChanged(state)).toBe(false);
    state = manageDraftReducer(state, { type: "range", range: { ...range, tickLower: -300 } });
    expect(rangeChanged(state)).toBe(true);
    state = manageDraftReducer(state, { type: "choose", action: "move" });
    expect(state.action).toBe("move");
    state = manageDraftReducer(state, { type: "range", range });
    expect(state.action).toBe(null);
  });
  it("[R3,R4] each action determines timing and Back keeps canonical edits", () => {
    let state = createManageDraft("core:42161:key", range);
    state = manageDraftReducer(state, { type: "range", range: { ...range, tickUpper: 400 } });
    state = manageDraftReducer(state, { type: "choose", action: "future" });
    expect(state.action).toBe("future");
    state = manageDraftReducer(state, { type: "back" });
    expect(state.action).toBe(null);
    expect(state.range.tickUpper).toBe(400);
    state = manageDraftReducer(state, { type: "choose", action: "move" });
    state = manageDraftReducer(state, { type: "discard" });
    expect(state.range).toEqual(range);
    expect(state.action).toBe(null);
  });
  it("[R7] fingerprints distinguish position, slippage and canonical edits, not inversion", () => {
    const state = createManageDraft("core:42161:key", range);
    expect(rangeFingerprint(state)).toBe(
      rangeFingerprint({ ...state, range: { ...range, displayInverted: true } }),
    );
    expect(rangeFingerprint(state)).not.toBe(
      rangeFingerprint({ ...state, identity: "core:4663:key" }),
    );
    expect(rangeFingerprint(state)).not.toBe(rangeFingerprint({ ...state, slippageBps: 100 }));
  });
  it("[R8] refuses invalid grid and unknown, narrow or out-of-bounds ranges", () => {
    expect(validManageRange(range, 10)).toBe(true);
    expect(validManageRange({ ...range, tickLower: range.tickUpper }, 10)).toBe(false);
    expect(validManageRange({ ...range, tickLower: NaN }, 10)).toBe(false);
    expect(validManageRange({ ...range, tickLower: -201 }, 10)).toBe(false);
    expect(validManageRange({ ...range, tickUpper: 887280 }, 10)).toBe(false);
    expect(validManageRange(range, 0)).toBe(false);
  });
});
