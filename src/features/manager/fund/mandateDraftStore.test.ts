/**
 * @id PP-MGR-STO-001
 * @name mandateDraftStore tests
 * @implements-rules-version v1 (POO-2121 rules v1)
 * @analytics-events none, a storage module; the builder shell owns the mandate events.
 *
 * Covers R7/R9: round trip, sort, corrupt payload, unavailable storage, subscription and ids.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyDraft, type MandateDraft } from "./mandateDraft";
import {
  deleteDraft,
  getDraft,
  listDrafts,
  MANDATE_DRAFTS_KEY,
  MANDATE_DRAFTS_VERSION,
  newDraftId,
  subscribe,
  upsertDraft,
} from "./mandateDraftStore";

function draft(id: string, updatedAt: string): MandateDraft {
  return { ...createEmptyDraft("2026-10-01T00:00:00.000Z", id), updatedAt };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("round trip", () => {
  it("writes a draft and reads it back", () => {
    // @rule R7
    const stored = upsertDraft(draft("a", "2026-10-01T00:00:00.000Z"));
    expect(stored).not.toBeNull();
    const read = getDraft("a");
    expect(read?.id).toBe("a");
    expect(read?.networks).toEqual(["arbitrum"]);
  });

  it("stores the versioned payload under the namespaced key", () => {
    // @rule R7
    upsertDraft(draft("a", "2026-10-01T00:00:00.000Z"));
    expect(MANDATE_DRAFTS_KEY).toBe("pp.manager.mandateDrafts.v1");
    const raw = window.localStorage.getItem(MANDATE_DRAFTS_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? "{}");
    expect(parsed.version).toBe(MANDATE_DRAFTS_VERSION);
    expect(Object.keys(parsed.drafts)).toEqual(["a"]);
  });

  it("stamps updatedAt on every write", () => {
    // @rule R7
    const stored = upsertDraft(draft("a", "2020-01-01T00:00:00.000Z"));
    expect(stored?.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
    expect(Date.parse(stored?.updatedAt ?? "")).toBeGreaterThan(Date.parse("2020-01-01"));
    expect(getDraft("a")?.updatedAt).toBe(stored?.updatedAt);
  });

  it("returns null for an unknown id", () => {
    // @rule R7
    expect(getDraft("nope")).toBeNull();
  });

  it("lists the drafts newest first", () => {
    // @rule R7
    window.localStorage.setItem(
      MANDATE_DRAFTS_KEY,
      JSON.stringify({
        version: MANDATE_DRAFTS_VERSION,
        drafts: {
          old: draft("old", "2026-01-01T00:00:00.000Z"),
          newest: draft("newest", "2026-09-01T00:00:00.000Z"),
          middle: draft("middle", "2026-05-01T00:00:00.000Z"),
        },
      }),
    );
    expect(listDrafts().map((d) => d.id)).toEqual(["newest", "middle", "old"]);
  });

  it("deletes one draft and leaves the others", () => {
    // @rule R7
    upsertDraft(draft("a", "2026-10-01T00:00:00.000Z"));
    upsertDraft(draft("b", "2026-10-02T00:00:00.000Z"));
    deleteDraft("a");
    expect(getDraft("a")).toBeNull();
    expect(getDraft("b")).not.toBeNull();
  });

  it("deleting an unknown id is a no-op", () => {
    // @rule R7
    upsertDraft(draft("a", "2026-10-01T00:00:00.000Z"));
    expect(() => deleteDraft("nope")).not.toThrow();
    expect(listDrafts()).toHaveLength(1);
  });
});

describe("corrupt and foreign payloads", () => {
  it("reads a corrupt payload as empty and does not overwrite it", () => {
    // @rule R7
    window.localStorage.setItem(MANDATE_DRAFTS_KEY, "{not json");
    expect(listDrafts()).toEqual([]);
    expect(getDraft("a")).toBeNull();
    expect(window.localStorage.getItem(MANDATE_DRAFTS_KEY)).toBe("{not json");
  });

  it("reads a payload of the wrong version as empty", () => {
    // @rule R7
    window.localStorage.setItem(
      MANDATE_DRAFTS_KEY,
      JSON.stringify({ version: 99, drafts: { a: draft("a", "2026-10-01T00:00:00.000Z") } }),
    );
    expect(listDrafts()).toEqual([]);
  });

  it("reads a payload with no drafts map as empty", () => {
    // @rule R7
    window.localStorage.setItem(MANDATE_DRAFTS_KEY, JSON.stringify({ version: 1 }));
    expect(listDrafts()).toEqual([]);
  });

  it("replaces the corrupt payload on the next write", () => {
    // @rule R7
    window.localStorage.setItem(MANDATE_DRAFTS_KEY, "{not json");
    upsertDraft(draft("a", "2026-10-01T00:00:00.000Z"));
    expect(listDrafts().map((d) => d.id)).toEqual(["a"]);
  });

  /**
   * A well-formed payload can still hold a malformed DRAFT.
   *
   * The version check proves the envelope, not its contents, and the contents are not all ours: an
   * older build, a half-finished migration or a hand-edited entry can leave a draft with no
   * `protocols` array, which reaches `visibleSteps` and throws on the builder's first render. Each
   * entry is therefore checked on its own and a bad one is dropped, so one broken draft costs the
   * manager that draft rather than the whole Console.
   */
  it("drops a malformed draft and keeps the good ones beside it", () => {
    // @rule R7
    window.localStorage.setItem(
      MANDATE_DRAFTS_KEY,
      JSON.stringify({
        version: MANDATE_DRAFTS_VERSION,
        drafts: {
          good: draft("good", "2026-05-01T00:00:00.000Z"),
          "no-protocols": { ...draft("no-protocols", "2026-06-01T00:00:00.000Z"), protocols: null },
          "no-tokens": { ...draft("no-tokens", "2026-07-01T00:00:00.000Z"), tokens: undefined },
          "no-caps": { ...draft("no-caps", "2026-08-01T00:00:00.000Z"), caps: {} },
          "not-an-object": 7,
        },
      }),
    );

    expect(listDrafts().map((d) => d.id)).toEqual(["good"]);
    expect(getDraft("no-protocols")).toBeNull();
    expect(getDraft("no-tokens")).toBeNull();
    expect(getDraft("no-caps")).toBeNull();
    expect(getDraft("not-an-object")).toBeNull();
    // Read-only: a payload we only half understand is replaced by the next real write, never by a read.
    expect(
      JSON.parse(window.localStorage.getItem(MANDATE_DRAFTS_KEY) ?? "{}").drafts,
    ).toHaveProperty("no-protocols");
  });

  it("defaults a missing poolUniverseCount to null, for drafts written before that field", () => {
    // @rule R13
    const { poolUniverseCount: _dropped, ...older } = draft("older", "2026-05-01T00:00:00.000Z");
    window.localStorage.setItem(
      MANDATE_DRAFTS_KEY,
      JSON.stringify({ version: MANDATE_DRAFTS_VERSION, drafts: { older } }),
    );

    expect(getDraft("older")?.poolUniverseCount).toBeNull();
    expect(getDraft("older")?.id).toBe("older");
  });
});

describe("unavailable storage", () => {
  it("never throws when reading fails", () => {
    // @rule R7
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("SecurityError");
      },
      removeItem() {
        throw new Error("SecurityError");
      },
    });
    expect(listDrafts()).toEqual([]);
    expect(getDraft("a")).toBeNull();
  });

  it("returns null from a write that failed", () => {
    // @rule R7
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem() {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    });
    expect(upsertDraft(draft("a", "2026-10-01T00:00:00.000Z"))).toBeNull();
  });

  it("never throws when deleting fails", () => {
    // @rule R7
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem() {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    });
    expect(() => deleteDraft("a")).not.toThrow();
  });

  /**
   * A delete says whether it happened.
   *
   * The Console's card tracks `builder_draft_deleted` and drops the row on the answer, so a swallowed
   * failure would report a deletion that did not happen and show a list the storage disagrees with.
   */
  it("reports false when the delete could not be written, and true when it was", () => {
    // @rule R7
    const payload = JSON.stringify({
      version: MANDATE_DRAFTS_VERSION,
      drafts: { a: draft("a", "2026-10-01T00:00:00.000Z") },
    });
    vi.stubGlobal("localStorage", {
      getItem: () => payload,
      setItem() {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    });
    expect(deleteDraft("a")).toBe(false);

    vi.unstubAllGlobals();
    upsertDraft(draft("b", "2026-10-01T00:00:00.000Z"));
    expect(deleteDraft("b")).toBe(true);
  });

  it("reports false when storage cannot be reached at all", () => {
    // @rule R7
    vi.stubGlobal("localStorage", undefined);
    expect(deleteDraft("a")).toBe(false);
  });

  it("touches no storage at import time", async () => {
    // @rule R7
    const getItem = vi.fn(() => null);
    vi.stubGlobal("localStorage", { getItem, setItem: vi.fn(), removeItem: vi.fn() });
    vi.resetModules();
    await import("./mandateDraftStore");
    expect(getItem).not.toHaveBeenCalled();
  });
});

describe("subscribe", () => {
  it("notifies in-process listeners on write and delete", () => {
    // @rule R9
    const listener = vi.fn();
    const off = subscribe(listener);
    upsertDraft(draft("a", "2026-10-01T00:00:00.000Z"));
    expect(listener).toHaveBeenCalledTimes(1);
    deleteDraft("a");
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    upsertDraft(draft("b", "2026-10-01T00:00:00.000Z"));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("notifies on a cross-tab storage event for this key only", () => {
    // @rule R9
    const listener = vi.fn();
    const off = subscribe(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: MANDATE_DRAFTS_KEY }));
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: "pp.something.else" }));
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    window.dispatchEvent(new StorageEvent("storage", { key: MANDATE_DRAFTS_KEY }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify a listener when the write failed", () => {
    // @rule R9
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem() {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    });
    const listener = vi.fn();
    const off = subscribe(listener);
    upsertDraft(draft("a", "2026-10-01T00:00:00.000Z"));
    expect(listener).not.toHaveBeenCalled();
    off();
  });
});

describe("newDraftId", () => {
  it("returns a distinct non-empty id", () => {
    // @rule R7
    const a = newDraftId();
    const b = newDraftId();
    expect(a).not.toBe("");
    expect(a).not.toBe(b);
  });

  it("falls back when crypto.randomUUID is missing", () => {
    // @rule R7
    vi.stubGlobal("crypto", {});
    const id = newDraftId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(8);
  });
});
