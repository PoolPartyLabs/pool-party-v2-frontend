/**
 * @id PP-MGR-STO-001
 * @name mandateDraftStore tests
 * @implements-rules-version v3 (POO-2121 rules v1, POO-2167 rules v3, POO-2151 rules v1)
 * @analytics-events none, a storage module; the builder shell owns the mandate events.
 *
 * Covers R7/R9: round trip, sort, corrupt payload, unavailable storage, subscription and ids. And
 * R20 v3 (POO-2167): a stored draft that still names Uniswap v3 positions is sanitised on load.
 * And the Storage rule of POO-2151: the Build plan and the phase ride in the draft, optional.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supplyBorrowPlan } from "./build/plan/planTestKit";
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

/**
 * R20 v3 (POO-2167): Uniswap v3 positions became unavailable after drafts naming them were saved.
 * Such a draft is sanitised on READ, through the one path both `getDraft` (the builder's resume) and
 * `listDrafts` (the Console's counts) take, and the stored copy is left alone until the next real
 * write, as for every other entry this module only half agrees with.
 */
describe("drafts stored before Uniswap v3 positions became unavailable", () => {
  function storedWithV3(): MandateDraft {
    const base = draft("v3", "2026-10-02T00:00:00.000Z");
    const side = { address: "0xaa", symbol: "ETH", name: "Ether", logoUrl: null };
    const usdc = { address: "0xbb", symbol: "USDC", name: "USD Coin", logoUrl: null };
    const pool = (id: string, protocol: "uniswap-v3" | "uniswap-v4") => ({
      id,
      address: `0x${id}`,
      network: "arbitrum" as const,
      protocol,
      token0: side,
      token1: usdc,
      feeBps: 5,
      feeTier: 0.05,
      tvlUsd: 42_000_000,
      aprPct: 14.2,
      tierSharePct: null,
      hasHook: false,
    });
    return {
      ...base,
      name: "Blue chips on Arbitrum",
      lastStep: "limits",
      passedSteps: ["networks", "protocols", "tokens", "pools"],
      protocols: ["uniswap-v3-swap", "across", "aave-v3", "uniswap-v3", "uniswap-v4"],
      pools: [pool("p-v3", "uniswap-v3"), pool("p-v4", "uniswap-v4")],
      caps: {
        ...base.caps,
        protocols: {
          "aave-v3": { noCap: false, pct: 20 },
          "uniswap-v3": { noCap: false, pct: 40 },
          "uniswap-v4": { noCap: true, pct: 0 },
        },
      },
      poolUniverseCount: 9,
    };
  }

  function store(entry: MandateDraft): void {
    window.localStorage.setItem(
      MANDATE_DRAFTS_KEY,
      JSON.stringify({ version: MANDATE_DRAFTS_VERSION, drafts: { [entry.id]: entry } }),
    );
  }

  it("drops the protocol, its pools and its cap row when the draft is read", () => {
    // @rule R20 v3
    store(storedWithV3());

    const read = getDraft("v3");
    expect(read?.protocols).toEqual(["uniswap-v3-swap", "across", "aave-v3", "uniswap-v4"]);
    expect(read?.pools.map((p) => p.id)).toEqual(["p-v4"]);
    expect(read?.caps.protocols).toEqual({
      "aave-v3": { noCap: false, pct: 20 },
      "uniswap-v4": { noCap: true, pct: 0 },
    });
    expect(listDrafts()[0]?.protocols).not.toContain("uniswap-v3");
    expect(listDrafts()[0]?.pools).toHaveLength(1);
  });

  it("changes nothing else on the draft", () => {
    // @rule R20 v3
    const stored = storedWithV3();
    store(stored);

    const read = getDraft("v3");
    expect(read?.name).toBe(stored.name);
    expect(read?.lastStep).toBe("limits");
    expect(read?.passedSteps).toEqual(stored.passedSteps);
    expect(read?.tokens).toEqual(stored.tokens);
    expect(read?.networks).toEqual(stored.networks);
    expect(read?.caps.networks).toEqual(stored.caps.networks);
    expect(read?.poolUniverseCount).toBe(9);
    expect(read?.updatedAt).toBe(stored.updatedAt);
  });

  it("leaves the stored copy alone until the next real write", () => {
    // @rule R20 v3 @rule R7
    store(storedWithV3());

    getDraft("v3");
    listDrafts();

    const raw = JSON.parse(window.localStorage.getItem(MANDATE_DRAFTS_KEY) ?? "{}");
    expect(raw.drafts.v3.protocols).toContain("uniswap-v3");
  });
});

/**
 * POO-2151 (Build canvas, slice S1): the plan rides inside the draft, in the same payload, and the
 * payload version does not move, because both new fields are optional and a draft without them is
 * exactly the draft this store already wrote.
 */
describe("the Build plan inside a draft", () => {
  function storeRaw(entries: Record<string, unknown>): void {
    window.localStorage.setItem(
      MANDATE_DRAFTS_KEY,
      JSON.stringify({ version: MANDATE_DRAFTS_VERSION, drafts: entries }),
    );
  }

  it("reads a saved plan and its phase back deep-equal, under payload version 1", () => {
    // @rule Storage
    const plan = supplyBorrowPlan();
    upsertDraft({ ...draft("p", "2026-10-03T00:00:00.000Z"), plan, lastPhase: "build" });
    expect(MANDATE_DRAFTS_VERSION).toBe(1);
    expect(getDraft("p")?.plan).toEqual(plan);
    expect(getDraft("p")?.lastPhase).toBe("build");
  });

  it("keeps a draft whose plan is unreadable, without the plan, and marks it planUnreadable", () => {
    // @rule Storage
    const good = draft("broken-plan", "2026-10-03T00:00:00.000Z");
    storeRaw({ "broken-plan": { ...good, plan: { version: 9, hub: null } } });
    const read = getDraft("broken-plan");
    expect(read?.id).toBe("broken-plan");
    expect(read?.networks).toEqual(good.networks);
    expect(read).not.toHaveProperty("plan");
    expect(read?.planUnreadable).toBe(true);
    expect(listDrafts().map((d) => d.id)).toEqual(["broken-plan"]);
  });

  it("marks no draft whose plan it could read, or that has none", () => {
    // @rule Storage
    storeRaw({
      fine: { ...draft("fine", "2026-10-03T00:00:00.000Z"), plan: supplyBorrowPlan() },
      none: draft("none", "2026-10-02T00:00:00.000Z"),
    });
    expect(getDraft("fine")).not.toHaveProperty("planUnreadable");
    expect(getDraft("none")).not.toHaveProperty("planUnreadable");
  });

  describe("an unreadable plan is never deleted silently", () => {
    /** A plan a newer build wrote: version 2 means nothing to this one. */
    const NEWER = { version: 2, hub: { chains: [] }, spokes: [], lanes: ["future"] };

    function rawPlanOf(id: string): string | undefined {
      const raw = JSON.parse(window.localStorage.getItem(MANDATE_DRAFTS_KEY) ?? "{}");
      const plan = raw.drafts?.[id]?.plan;
      return plan === undefined ? undefined : JSON.stringify(plan);
    }

    function seedNewer(): void {
      storeRaw({
        b: { ...draft("b", "2026-10-02T00:00:00.000Z"), plan: NEWER },
        a: draft("a", "2026-10-01T00:00:00.000Z"),
      });
    }

    it("keeps it byte for byte when ANOTHER draft is saved", () => {
      // @rule Storage
      seedNewer();
      const before = rawPlanOf("b");
      upsertDraft({ ...draft("a", "2026-10-01T00:00:00.000Z"), plan: supplyBorrowPlan() });
      expect(rawPlanOf("b")).toBe(before);
      expect(rawPlanOf("b")).toBe(JSON.stringify(NEWER));
      expect(getDraft("b")?.planUnreadable).toBe(true);
    });

    it("keeps it byte for byte when another draft is deleted", () => {
      // @rule Storage
      seedNewer();
      expect(deleteDraft("a")).toBe(true);
      expect(rawPlanOf("b")).toBe(JSON.stringify(NEWER));
    });

    it("keeps it when the affected draft is saved without a new plan, and never stores the marker", () => {
      // @rule Storage
      seedNewer();
      const loaded = getDraft("b");
      if (!loaded) throw new Error("fixture: b not read");
      const saved = upsertDraft({ ...loaded, name: "Renamed while unreadable" });
      expect(rawPlanOf("b")).toBe(JSON.stringify(NEWER));
      expect(saved?.planUnreadable).toBe(true);
      expect(saved).not.toHaveProperty("plan");
      const raw = JSON.parse(window.localStorage.getItem(MANDATE_DRAFTS_KEY) ?? "{}");
      expect(raw.drafts.b).not.toHaveProperty("planUnreadable");
      expect(raw.drafts.b.name).toBe("Renamed while unreadable");
    });

    it("replaces it, and drops the marker, when the affected draft is saved WITH a new plan", () => {
      // @rule Storage
      seedNewer();
      const loaded = getDraft("b");
      if (!loaded) throw new Error("fixture: b not read");
      const saved = upsertDraft({ ...loaded, plan: supplyBorrowPlan() });
      expect(rawPlanOf("b")).toBe(JSON.stringify(supplyBorrowPlan()));
      expect(saved).not.toHaveProperty("planUnreadable");
      expect(getDraft("b")?.plan).toEqual(supplyBorrowPlan());
      expect(getDraft("b")).not.toHaveProperty("planUnreadable");
    });
  });

  it("reads a draft written before the canvas as a draft with no plan and no phase", () => {
    // @rule Storage
    storeRaw({ older: draft("older", "2026-10-01T00:00:00.000Z") });
    const read = getDraft("older");
    expect(read).not.toHaveProperty("plan");
    expect(read).not.toHaveProperty("lastPhase");
  });

  it("drops a phase it does not know, which then reads as the mandate", () => {
    // @rule Storage
    storeRaw({ odd: { ...draft("odd", "2026-10-01T00:00:00.000Z"), lastPhase: "unknown" } });
    expect(getDraft("odd")).not.toHaveProperty("lastPhase");
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
