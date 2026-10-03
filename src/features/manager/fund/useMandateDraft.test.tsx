/**
 * @id PP-MGR-HOK-006
 * @name useMandateDraft tests
 * @implements-rules-version v1 (POO-2121 rules v1)
 * @analytics-events none, a state hook; the builder shell owns the mandate events.
 *
 * Covers R9: hydration, unknown id, blocked reducers, the save paths (including a throwing
 * localStorage), the dirty flag and the flag-derived catalog.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addToken,
  createEmptyDraft,
  type MandateDraft,
  REQUIRED_PROTOCOLS,
  withNetworks,
  withProtocols,
} from "./mandateDraft";
import { MANDATE_DRAFTS_KEY, MANDATE_DRAFTS_VERSION, upsertDraft } from "./mandateDraftStore";
import { useMandateDraft } from "./useMandateDraft";

const flags = vi.hoisted(() => ({ robinhoodChain: false }));

vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({
    flags: { robinhoodChain: flags.robinhoodChain },
    isEnabled: (key: string) => (key === "robinhoodChain" ? flags.robinhoodChain : false),
  }),
}));

function seed(id: string, over: Partial<MandateDraft> = {}): MandateDraft {
  const base = { ...createEmptyDraft("2026-10-01T00:00:00.000Z", id), ...over };
  const stored = upsertDraft(base);
  if (!stored) throw new Error("fixture: seed write failed");
  return stored;
}

beforeEach(() => {
  flags.robinhoodChain = false;
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("hydration", () => {
  it("starts on a pristine draft and flips hydrated after the first client read", async () => {
    // @rule R9
    const { result } = renderHook(() => useMandateDraft());
    expect(result.current.draft.networks).toEqual(["arbitrum"]);
    expect(result.current.draft.protocols).toEqual([...REQUIRED_PROTOCOLS]);
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.draft.id).not.toBe("");
  });

  it("loads a stored draft by id", async () => {
    // @rule R9
    seed("kept", { name: "ETH and BTC on Arbitrum" });
    const { result } = renderHook(() => useMandateDraft("kept"));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.draft.id).toBe("kept");
    expect(result.current.draft.name).toBe("ETH and BTC on Arbitrum");
    expect(result.current.isDirty).toBe(false);
  });

  it("falls back to an empty draft for an unknown id", async () => {
    // @rule R9
    const { result } = renderHook(() => useMandateDraft("ghost"));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.draft.id).toBe("ghost");
    expect(result.current.draft.tokens.every((t) => t.locked)).toBe(true);
    expect(result.current.draft.pools).toEqual([]);
    expect(result.current.isDirty).toBe(false);
  });

  it("never writes storage on mount", async () => {
    // @rule R9
    const { result } = renderHook(() => useMandateDraft());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(window.localStorage.getItem(MANDATE_DRAFTS_KEY)).toBeNull();
  });
});

describe("update", () => {
  it("applies a reducer that returns a draft", async () => {
    // @rule R9
    const { result } = renderHook(() => useMandateDraft());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    act(() => {
      result.current.update((d) => withProtocols(d, [...REQUIRED_PROTOCOLS, "aave-v3"]));
    });
    expect(result.current.draft.protocols).toContain("aave-v3");
    expect(result.current.lastBlock).toBeNull();
    expect(result.current.isDirty).toBe(true);
  });

  it("keeps the draft and records the block when a reducer refuses", async () => {
    // @rule R9
    const { result } = renderHook(() => useMandateDraft());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    const before = result.current.draft;
    act(() => {
      result.current.update(() => ({
        blocked: { step: "pools", reason: "has_hook", rowId: "pool-1" },
      }));
    });
    expect(result.current.draft).toBe(before);
    expect(result.current.lastBlock).toEqual({
      step: "pools",
      reason: "has_hook",
      rowId: "pool-1",
    });
    expect(result.current.isDirty).toBe(false);
  });

  it("clears the block on request and on the next successful update", async () => {
    // @rule R9
    const { result } = renderHook(() => useMandateDraft());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    act(() => {
      result.current.update(() => ({
        blocked: { step: "tokens", reason: "no_slots", rowId: "arbitrum:0xabc" },
      }));
    });
    expect(result.current.lastBlock).not.toBeNull();
    act(() => result.current.clearBlock());
    expect(result.current.lastBlock).toBeNull();

    act(() => {
      result.current.update(() => ({
        blocked: { step: "tokens", reason: "no_slots", rowId: "arbitrum:0xabc" },
      }));
    });
    expect(result.current.lastBlock).not.toBeNull();
    act(() => {
      result.current.update((d) => withProtocols(d, [...REQUIRED_PROTOCOLS, "aave-v3"]));
    });
    expect(result.current.lastBlock).toBeNull();
  });

  it("never writes storage on update", async () => {
    // @rule R9
    const { result } = renderHook(() => useMandateDraft());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    act(() => {
      result.current.update((d) => withProtocols(d, [...REQUIRED_PROTOCOLS, "aave-v3"]));
    });
    expect(window.localStorage.getItem(MANDATE_DRAFTS_KEY)).toBeNull();
  });
});

describe("save", () => {
  it("rejects an empty name without writing", async () => {
    // @rule R8
    const { result } = renderHook(() => useMandateDraft());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    let outcome: Awaited<ReturnType<typeof result.current.save>> | undefined;
    await act(async () => {
      outcome = await result.current.save("   ");
    });
    expect(outcome).toEqual({ ok: false, error: "empty" });
    expect(window.localStorage.getItem(MANDATE_DRAFTS_KEY)).toBeNull();
  });

  it("rejects a name outside 10 to 50 characters", async () => {
    // @rule R8
    const { result } = renderHook(() => useMandateDraft());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    let outcome: Awaited<ReturnType<typeof result.current.save>> | undefined;
    await act(async () => {
      outcome = await result.current.save("too short");
    });
    expect(outcome).toEqual({ ok: false, error: "length" });
  });

  it("writes the named draft and clears the dirty flag", async () => {
    // @rule R9
    const { result } = renderHook(() => useMandateDraft());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    act(() => {
      result.current.update((d) => withProtocols(d, [...REQUIRED_PROTOCOLS, "aave-v3"]));
    });
    expect(result.current.isDirty).toBe(true);

    let outcome: Awaited<ReturnType<typeof result.current.save>> | undefined;
    await act(async () => {
      outcome = await result.current.save("  ETH and BTC on Arbitrum  ");
    });
    expect(outcome).toEqual({ ok: true });
    expect(result.current.draft.name).toBe("ETH and BTC on Arbitrum");
    expect(result.current.draft.savedAt).not.toBeNull();
    expect(result.current.isDirty).toBe(false);

    const raw = window.localStorage.getItem(MANDATE_DRAFTS_KEY);
    const parsed = JSON.parse(raw ?? "{}");
    expect(parsed.version).toBe(MANDATE_DRAFTS_VERSION);
    expect(parsed.drafts[result.current.draft.id].name).toBe("ETH and BTC on Arbitrum");
  });

  it("saves silently with no name once the draft has one", async () => {
    // @rule R9
    seed("named", { name: "ETH and BTC on Arbitrum" });
    const { result } = renderHook(() => useMandateDraft("named"));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    act(() => {
      result.current.update((d) => withProtocols(d, [...REQUIRED_PROTOCOLS, "aave-v3"]));
    });
    let outcome: Awaited<ReturnType<typeof result.current.save>> | undefined;
    await act(async () => {
      outcome = await result.current.save();
    });
    expect(outcome).toEqual({ ok: true });
    expect(result.current.draft.name).toBe("ETH and BTC on Arbitrum");
    expect(result.current.isDirty).toBe(false);
  });

  it("reports a storage failure and keeps the draft in memory", async () => {
    // @rule R9
    const { result } = renderHook(() => useMandateDraft());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    act(() => {
      result.current.update((d) => withProtocols(d, [...REQUIRED_PROTOCOLS, "aave-v3"]));
    });
    // jsdom's Storage is a Proxy whose `set` trap writes an ITEM, so spying on `setItem` would
    // store a value under that name instead of replacing the method. Swap the whole object.
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem() {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
      clear: () => undefined,
    });

    let outcome: Awaited<ReturnType<typeof result.current.save>> | undefined;
    await act(async () => {
      outcome = await result.current.save("ETH and BTC on Arbitrum");
    });
    expect(outcome).toEqual({ ok: false, error: "storage" });
    expect(result.current.draft.protocols).toContain("aave-v3");
    expect(result.current.isDirty).toBe(true);
  });

  /**
   * A completion is a WRITE, not a click, so the stamp rides on the write that settles it.
   *
   * Stamping the draft first and saving afterwards leaves a `completedAt` behind when the save fails:
   * nothing recorded the completion, no event fired, and the next Save & exit would quietly persist a
   * mandate marked finished, which a `?phase=build` link then opens.
   */
  it("stamps completedAt on the save that completes the mandate", async () => {
    // @rule R6
    seed("to-complete", { name: "ETH and BTC on Arbitrum" });
    const { result } = renderHook(() => useMandateDraft("to-complete"));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.draft.completedAt).toBeNull();

    await act(async () => {
      await result.current.save(undefined, { complete: true });
    });

    expect(result.current.draft.completedAt).not.toBeNull();
    const parsed = JSON.parse(window.localStorage.getItem(MANDATE_DRAFTS_KEY) ?? "{}");
    expect(parsed.drafts["to-complete"].completedAt).toBe(result.current.draft.completedAt);
  });

  it("leaves completedAt null when the completing save fails", async () => {
    // @rule R6
    seed("fails", { name: "ETH and BTC on Arbitrum" });
    const { result } = renderHook(() => useMandateDraft("fails"));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem() {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
      clear: () => undefined,
    });

    let outcome: Awaited<ReturnType<typeof result.current.save>> | undefined;
    await act(async () => {
      outcome = await result.current.save(undefined, { complete: true });
    });

    expect(outcome).toEqual({ ok: false, error: "storage" });
    expect(result.current.draft.completedAt).toBeNull();
  });

  it("keeps the first completion stamp when a completed mandate is saved again", async () => {
    // @rule R6
    seed("again", { name: "ETH and BTC on Arbitrum", completedAt: "2026-10-01T00:00:00.000Z" });
    const { result } = renderHook(() => useMandateDraft("again"));
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    await act(async () => {
      await result.current.save(undefined, { complete: true });
    });

    expect(result.current.draft.completedAt).toBe("2026-10-01T00:00:00.000Z");
  });

  it("does not stamp a plain save", async () => {
    // @rule R6
    seed("plain", { name: "ETH and BTC on Arbitrum" });
    const { result } = renderHook(() => useMandateDraft("plain"));
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    await act(async () => {
      await result.current.save();
    });

    expect(result.current.draft.completedAt).toBeNull();
  });
});

/**
 * The prompt asks about WORK, not about where the manager is standing.
 *
 * `isDirty` arms the browser's leave-page prompt, so it has to mean "a selection differs from the
 * stored copy". Comparing the whole draft counted `lastStep`, `passedSteps`, `poolUniverseCount` and
 * `updatedAt` as edits, which made a Next, a Back or a deep link into a step already passed arm the
 * prompt on a saved draft nobody touched: the manager then gets "Leave anyway?" for work that is
 * already safely in storage, which is exactly the warning that teaches people to ignore warnings.
 */
describe("isDirty", () => {
  it("stays down while the manager only navigates a saved draft", async () => {
    // @rule R9
    seed("nav", {
      name: "ETH and BTC on Arbitrum",
      savedAt: "2026-10-01T00:00:00.000Z",
      passedSteps: ["networks"],
    });
    const { result } = renderHook(() => useMandateDraft("nav"));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.update((d) => ({
        ...d,
        lastStep: "protocols",
        passedSteps: [...d.passedSteps, "protocols"],
      }));
    });
    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.update((d) => ({ ...d, poolUniverseCount: 14 }));
    });
    expect(result.current.isDirty).toBe(false);
  });

  it("goes up on a selection, a rename and a completion", async () => {
    // @rule R9
    seed("edit", { name: "ETH and BTC on Arbitrum", savedAt: "2026-10-01T00:00:00.000Z" });
    const { result } = renderHook(() => useMandateDraft("edit"));
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => {
      result.current.update((d) => withProtocols(d, [...REQUIRED_PROTOCOLS, "aave-v3"]));
    });
    expect(result.current.isDirty).toBe(true);

    const { result: renamed } = renderHook(() => useMandateDraft("edit"));
    await waitFor(() => expect(renamed.current.hydrated).toBe(true));
    act(() => {
      renamed.current.update((d) => ({ ...d, name: "Something else entirely" }));
    });
    expect(renamed.current.isDirty).toBe(true);

    const { result: completed } = renderHook(() => useMandateDraft("edit"));
    await waitFor(() => expect(completed.current.hydrated).toBe(true));
    act(() => {
      completed.current.update((d) => ({ ...d, completedAt: "2026-10-03T00:00:00.000Z" }));
    });
    expect(completed.current.isDirty).toBe(true);
  });
});

describe("remove", () => {
  it("deletes the stored copy", async () => {
    // @rule R9
    seed("doomed", { name: "ETH and BTC on Arbitrum" });
    const { result } = renderHook(() => useMandateDraft("doomed"));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    act(() => result.current.remove());
    const parsed = JSON.parse(window.localStorage.getItem(MANDATE_DRAFTS_KEY) ?? "{}");
    expect(parsed.drafts?.doomed).toBeUndefined();
  });
});

describe("catalog", () => {
  it("builds the catalog from the robinhoodChain flag", async () => {
    // @rule R17
    const { result } = renderHook(() => useMandateDraft());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.catalog.networks).toHaveLength(5);
    expect(result.current.catalog.networks.find((n) => n.id === "robinhood")?.available).toBe(
      false,
    );
  });

  it("opens Robinhood Chain while the flag is on", async () => {
    // @rule R17
    flags.robinhoodChain = true;
    const { result } = renderHook(() => useMandateDraft());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.catalog.networks.find((n) => n.id === "robinhood")?.available).toBe(true);

    act(() => {
      result.current.update((d) => withNetworks(d, ["robinhood"], result.current.catalog));
    });
    expect(result.current.draft.networks).toEqual(["arbitrum", "robinhood"]);
  });

  it("keeps the same catalog instance across renders", async () => {
    // @rule R17
    const { result, rerender } = renderHook(() => useMandateDraft());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    const first = result.current.catalog;
    rerender();
    expect(result.current.catalog).toBe(first);
  });

  it("feeds the catalog into a reducer that needs it", async () => {
    // @rule R27
    const { result } = renderHook(() => useMandateDraft());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    act(() => {
      result.current.update((d) => {
        const arb = result.current.catalog
          .tokensFor(d.networks, d.protocols)
          .find((t) => t.symbol === "ARB");
        if (!arb) throw new Error("fixture: no ARB on arbitrum");
        return addToken(d, arb, result.current.catalog);
      });
    });
    expect(result.current.draft.tokens.some((t) => t.symbol === "ARB")).toBe(true);
  });
});
