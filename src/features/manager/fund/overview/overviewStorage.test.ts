import { beforeEach, describe, expect, it, vi } from "vitest";
import { listLaunchJourneysSnapshot } from "../launch/journey";
import { createEmptyDraft } from "../mandateDraft";
import { listDraftsSnapshot, MANDATE_DRAFTS_KEY, upsertDraft } from "../mandateDraftStore";

describe("Overview storage status POO-2245", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });
  // @rule R5
  it("preserves corrupt draft payload and reports corrupt instead of empty", () => {
    localStorage.setItem(MANDATE_DRAFTS_KEY, "broken");
    expect(listDraftsSnapshot().status).toBe("corrupt");
    expect(localStorage.getItem(MANDATE_DRAFTS_KEY)).toBe("broken");
  });
  // @rule R5
  it("keeps valid entries while reporting invalid sibling", () => {
    upsertDraft(createEmptyDraft("2026-10-06", "valid"));
    const payload = JSON.parse(localStorage.getItem(MANDATE_DRAFTS_KEY) ?? "{}");
    payload.drafts.bad = { id: "bad" };
    localStorage.setItem(MANDATE_DRAFTS_KEY, JSON.stringify(payload));
    expect(listDraftsSnapshot().drafts).toHaveLength(1);
    expect(listDraftsSnapshot().status).toBe("corrupt");
  });
  // @rule R5
  it("distinguishes blocked storage reads from invalid JSON", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(listDraftsSnapshot().status).toBe("unavailable");
  });
  it("excludes a mismatched draft ID instead of resuming a different storage key", () => {
    upsertDraft(createEmptyDraft("2026-10-06", "valid"));
    const payload = JSON.parse(localStorage.getItem(MANDATE_DRAFTS_KEY) ?? "{}");
    payload.drafts.valid.id = "other";
    localStorage.setItem(MANDATE_DRAFTS_KEY, JSON.stringify(payload));
    expect(listDraftsSnapshot()).toEqual({ drafts: [], status: "corrupt" });
  });
  it("quarantines invalid dates before they reach relative-time rendering", () => {
    upsertDraft(createEmptyDraft("2026-10-06", "valid"));
    const payload = JSON.parse(localStorage.getItem(MANDATE_DRAFTS_KEY) ?? "{}");
    payload.drafts.valid.updatedAt = "not-a-date";
    localStorage.setItem(MANDATE_DRAFTS_KEY, JSON.stringify(payload));
    expect(listDraftsSnapshot()).toEqual({ drafts: [], status: "corrupt" });
  });
  it("projects one storage snapshot without losing a valid read on a second access", () => {
    upsertDraft(createEmptyDraft("2026-10-06", "valid"));
    const raw = localStorage.getItem(MANDATE_DRAFTS_KEY);
    const read = vi
      .spyOn(Storage.prototype, "getItem")
      .mockReturnValueOnce(raw)
      .mockImplementation(() => {
        throw new Error("blocked second access");
      });
    expect(listDraftsSnapshot().drafts).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(1);
  });
  // @rule R4
  it("reports a corrupt journey without removing its payload", () => {
    const manager = `0x${"11".repeat(20)}`;
    const key = `pp:v2:journey:1:${manager}:draft`;
    localStorage.setItem(key, "bad");
    expect(listLaunchJourneysSnapshot(manager).status).toBe("corrupt");
    expect(localStorage.getItem(key)).toBe("bad");
  });
});
