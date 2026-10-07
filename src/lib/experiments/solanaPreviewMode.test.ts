/**
 * @id PP-CORE-LIB-124
 * @name solanaPreviewMode tests
 * @implements-rules-version v1 (POO-2281)
 */
import { describe, expect, it } from "vitest";
import { deniedExperimentAccess } from "./access";
import {
  createSolanaPreviewState,
  pressSolanaPreview,
  type SolanaPreviewContext,
  syncSolanaPreview,
} from "./solanaPreviewMode";

const start = Date.parse("2026-10-07T13:00:00Z");
const access = {
  schemaVersion: 1,
  experiment: "solana-preview",
  status: "allowed",
  capabilities: ["preview"],
  expiresAt: "2026-10-07T13:01:00Z",
};
function context(overrides: Partial<SolanaPreviewContext> = {}): SolanaPreviewContext {
  return { family: "v2", accountKey: "account-a", access, now: start, dirty: false, ...overrides };
}
function activate() {
  let state = createSolanaPreviewState();
  for (const delta of [0, 200, 400]) {
    state = pressSolanaPreview(state, context({ now: start + delta }));
  }
  return state;
}

describe("isolated Solana preview preference", () => {
  // @rule R5: V1/V2 family and storage remain independent.
  it("starts in standard mode without a remembered account", () => {
    expect(createSolanaPreviewState()).toEqual({
      mode: "standard",
      accountKey: null,
      pressCount: 0,
      firstPressAt: null,
    });
  });

  // @rule R6: three presses of the selected V2 segment are required.
  it("activates only on the third approved press within one second", () => {
    let state = createSolanaPreviewState();
    state = pressSolanaPreview(state, context());
    expect(state.mode).toBe("standard");
    state = pressSolanaPreview(state, context({ now: start + 300 }));
    expect(state.mode).toBe("standard");
    state = pressSolanaPreview(state, context({ now: start + 1_000 }));
    expect(state.mode).toBe("v2-solana");
    expect(state.accountKey).toBe("account-a");
    expect(state.pressCount).toBe(0);
  });

  // @rule R6: slow presses restart the burst rather than activating accidentally.
  it("restarts the gesture after a one-second window or backwards clock", () => {
    let state = pressSolanaPreview(createSolanaPreviewState(), context());
    state = pressSolanaPreview(state, context({ now: start + 1_001 }));
    expect(state.mode).toBe("standard");
    expect(state.pressCount).toBe(1);
    expect(state.firstPressAt).toBe(start + 1_001);
    state = pressSolanaPreview(state, context({ now: start + 500 }));
    expect(state.pressCount).toBe(1);
    expect(state.firstPressAt).toBe(start + 500);
  });

  // @rule R1: a gesture never grants access by itself.
  it.each([
    { family: "v1" as const },
    { accountKey: null },
    { accountKey: "" },
    { access: deniedExperimentAccess() },
    { access: { isManager: true, solana: true } },
    { now: Date.parse(access.expiresAt) },
    { now: Number.NaN },
  ])("does not activate with rejected context %j", (overrides) => {
    let state = createSolanaPreviewState();
    for (let count = 0; count < 3; count++) {
      state = pressSolanaPreview(state, context(overrides));
    }
    expect(state).toEqual(createSolanaPreviewState());
  });

  // @rule R6: dirty work is not silently replaced by the hidden gesture.
  it("refuses activation while a draft is dirty and clears a pending burst", () => {
    const pending = pressSolanaPreview(createSolanaPreviewState(), context());
    const result = pressSolanaPreview(pending, context({ dirty: true }));
    expect(result.mode).toBe("standard");
    expect(result.pressCount).toBe(0);
  });

  // @rule R6: changing family/account or losing a grant closes the active preview.
  it.each([
    { family: "v1" as const },
    { accountKey: null },
    { accountKey: "account-b" },
    { access: deniedExperimentAccess() },
    { now: Date.parse(access.expiresAt) },
  ])("resets an active preview after context changes: %j", (overrides) => {
    expect(activate().mode).toBe("v2-solana");
    expect(syncSolanaPreview(activate(), context(overrides)).mode).toBe("standard");
  });

  // @rule R2: one approved account cannot inherit another account's gesture.
  it("requires three fresh presses after a different approved account takes over", () => {
    const next = pressSolanaPreview(activate(), context({ accountKey: "account-b" }));
    expect(next.mode).toBe("standard");
    expect(next.accountKey).toBe("account-b");
    expect(next.pressCount).toBe(1);
  });

  // @rule R5: the model never writes EVM family/drafts or any client permission to storage.
  it("is a pure preference model that preserves its input objects", () => {
    const current = Object.freeze(createSolanaPreviewState());
    const before = JSON.stringify(current);
    expect(pressSolanaPreview(current, context()).pressCount).toBe(1);
    expect(JSON.stringify(current)).toBe(before);
    expect(syncSolanaPreview(activate(), context()).mode).toBe("v2-solana");
    expect(createSolanaPreviewState().mode).toBe("standard");
  });
});
