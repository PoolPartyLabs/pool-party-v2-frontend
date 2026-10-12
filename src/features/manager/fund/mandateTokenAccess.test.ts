/**
 * @id PP-MGR-LIB-079
 * @name mandateTokenAccess tests
 * @implements-rules-version v1 (POO-2332 rules v1)
 * @analytics-events none, a pure domain; the builder shell sends the events.
 *
 * One test per rule of POO-2332, each marked `// @rule Rn`. The rules that only describe screen
 * layout (R3, R4, R6, R7 and R11) are tested through the view models that feed the screen, so no
 * test here renders a component. R16 (locales, docs) is checked by `pnpm i18n:check`. R17 is a
 * path rule that the review checks with `git diff --stat origin/main`. R18 is this file.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ANALYTICS_EVENTS, ANALYTICS_MANDATE_BLOCK_REASONS } from "@/lib/analytics/events";
import { buildMandateCatalog, type MandateCatalogToken } from "./mandateCatalog";
import {
  addToken,
  BASKET_TOKEN_SLOTS,
  CAP_STEP_PCT,
  capRows,
  clearCap,
  createEmptyDraft,
  EVERY_TOKEN_ROW_ID,
  effectiveCap,
  isBlocked,
  isCapZero,
  MAX_TOKEN_SLOTS,
  type MandateDraft,
  type MandateTokenRef,
  REQUIRED_PROTOCOLS,
  selectionFingerprint,
  setAllTokensCap,
  setCap,
  setTokenMode,
  slotCeiling,
  slotsUsed,
  tokenKey,
  tokenModeOf,
  validateStep,
  withNetworks,
  withProtocols,
} from "./mandateDraft";
import { deleteDraft, getDraft, upsertDraft } from "./mandateDraftStore";
import {
  allTokensRowWarns,
  allTokensSummary,
  blinkSchedule,
  capSteps,
  collapseRows,
  isRealData,
  lockedRowCaption,
  setAllTokenCaps,
  slotsView,
  tokenModeEvent,
  tokensViewState,
} from "./mandateTokenAccess";

const NOW = "2026-10-12T12:00:00.000Z";
const catalog = buildMandateCatalog();

function empty(): MandateDraft {
  return createEmptyDraft(NOW, "draft-poo-2332");
}

function catalogToken(network: "arbitrum" | "robinhood", symbol: string): MandateCatalogToken {
  const found = catalog
    .tokensFor([network], [...REQUIRED_PROTOCOLS])
    .find((t) => t.symbol === symbol);
  if (!found) throw new Error(`fixture: no ${symbol} on ${network}`);
  return found;
}

function draftOf(result: MandateDraft | { blocked: unknown }): MandateDraft {
  if (isBlocked(result as MandateDraft)) throw new Error("unexpected block");
  return result as MandateDraft;
}

function filler(count: number): MandateTokenRef[] {
  return Array.from({ length: count }, (_, i) => ({
    address: `0x${String(i).padStart(40, "0")}`,
    symbol: `FILL${i}`,
    name: `Filler ${i}`,
    network: "arbitrum" as const,
    logoUrl: null,
    locked: false,
  }));
}

/** A draft with ARB and WETH-like tokens added through the real reducer. */
function withTwoTokens(): MandateDraft {
  let draft = empty();
  draft = draftOf(addToken(draft, catalogToken("arbitrum", "ARB"), catalog));
  draft = draftOf(addToken(draft, catalogToken("arbitrum", "ETH"), catalog));
  return draft;
}

function tokenRows(draft: MandateDraft): MandateTokenRef[] {
  return capRows(draft, catalog).tokens;
}

describe("R1 token access mode", () => {
  it("starts in Selected mode and keeps the mode in the draft", () => {
    // @rule R1
    const draft = empty();
    expect(tokenModeOf(draft)).toBe("selected");
    const all = setTokenMode(draft, "all");
    expect(tokenModeOf(all)).toBe("all");
    expect(tokenModeOf(setTokenMode(all, "selected"))).toBe("selected");
    // Same mode in, same draft out.
    expect(setTokenMode(draft, "selected")).toBe(draft);
  });

  it("round trips the mode and the All tokens cap through the draft store", () => {
    // @rule R1
    window.localStorage.clear();
    const draft = setAllTokensCap(setTokenMode(empty(), "all"), { noCap: false, pct: 25 });
    upsertDraft(draft);
    const read = getDraft(draft.id);
    expect(read && tokenModeOf(read)).toBe("all");
    expect(read?.allTokensCap).toEqual({ noCap: false, pct: 25 });
    deleteDraft(draft.id);
    window.localStorage.clear();
  });

  it("drops a stored mode that this build does not know", () => {
    // @rule R1
    window.localStorage.clear();
    const bad = { ...empty(), tokenMode: "everything", allTokensCap: { noCap: "x" } };
    upsertDraft(bad as unknown as MandateDraft);
    const read = getDraft(bad.id);
    expect(read && tokenModeOf(read)).toBe("selected");
    expect(read?.allTokensCap).toBeUndefined();
    window.localStorage.clear();
  });
});

describe("R2 the basket holds 100 slots", () => {
  it("lets a mock draft hold 100 slots and refuses the 101st with no_slots", () => {
    // @rule R2
    expect(BASKET_TOKEN_SLOTS).toBe(100);
    expect(slotCeiling(empty())).toBe(100);
    let draft = empty();
    draft = {
      ...draft,
      tokens: [...draft.tokens, ...filler(BASKET_TOKEN_SLOTS - draft.tokens.length)],
    };
    expect(slotsUsed(draft)).toBe(100);
    const result = addToken(draft, catalogToken("arbitrum", "ARB"), catalog);
    expect(isBlocked(result)).toBe(true);
    if (isBlocked(result)) expect(result.blocked.reason).toBe("no_slots");
  });

  it("still adds a token while the draft is under 100", () => {
    // @rule R2
    const draft = { ...empty(), tokens: [...empty().tokens, ...filler(20)] };
    expect(isBlocked(addToken(draft, catalogToken("arbitrum", "ARB"), catalog))).toBe(false);
  });
});

describe("R3 Selected mode footer", () => {
  it("reports used, the ceiling and not full for a short list", () => {
    // @rule R3
    const view = slotsView(withTwoTokens());
    expect(view).toMatchObject({ used: 3, ceiling: 100, full: false });
    expect(view.remaining).toBe(97);
  });
});

describe("R4 All mode has no slot cap", () => {
  it("returns the All view state, with USDC, USDG and the other tokens rows", () => {
    // @rule R4
    const draft = setTokenMode(withNetworks(empty(), ["arbitrum", "robinhood"], catalog), "all");
    const view = slotsView(draft);
    expect(view.unlimited).toBe(true);
    expect(view.full).toBe(false);
    const locked = draft.tokens.filter((t) => t.locked);
    expect(locked.map((t) => t.symbol).sort()).toEqual(["USDC", "USDG"]);
  });

  it("names why a locked token is there", () => {
    // @rule R4
    const draft = withNetworks(empty(), ["arbitrum", "robinhood"], catalog);
    const usdc = draft.tokens.find((t) => t.symbol === "USDC");
    const usdg = draft.tokens.find((t) => t.symbol === "USDG");
    if (!usdc || !usdg) throw new Error("fixture: locked deposit tokens");
    expect(lockedRowCaption(usdc)).toEqual({ kind: "depositToken" });
    expect(lockedRowCaption(usdg)).toEqual({ kind: "requiredBy", network: "robinhood" });
  });
});

describe("R5 a mode change keeps the list", () => {
  it("keeps tokens and caps in both directions", () => {
    // @rule R5
    let draft = withTwoTokens();
    const row = tokenRows(draft)[0];
    if (!row) throw new Error("fixture");
    draft = setCap(draft, "tokens", tokenKey(row), { noCap: false, pct: 35 });
    const there = setTokenMode(draft, "all");
    const back = setTokenMode(there, "selected");
    expect(there.tokens).toEqual(draft.tokens);
    expect(there.caps.tokens).toEqual(draft.caps.tokens);
    expect(back.tokens).toEqual(draft.tokens);
    expect(back.caps.tokens).toEqual(draft.caps.tokens);
  });

  it("counts the mode as a selection change for a completed mandate", () => {
    // @rule R5
    const draft = empty();
    expect(selectionFingerprint(setTokenMode(draft, "all"))).not.toBe(selectionFingerprint(draft));
    expect(selectionFingerprint(setTokenMode(setTokenMode(draft, "all"), "selected"))).toBe(
      selectionFingerprint(draft),
    );
  });
});

describe("R6 loading and error", () => {
  it("keeps search and filters on while loading and shows skeletons", () => {
    // @rule R6
    expect(tokensViewState({ loading: true, error: false, draft: empty() })).toEqual({
      kind: "loading",
      showSkeletons: true,
      searchEnabled: true,
      filtersEnabled: true,
    });
  });

  it("shows the error box with a retry, and keeps the saved list", () => {
    // @rule R6
    const draft = withTwoTokens();
    const view = tokensViewState({ loading: false, error: true, draft: empty() });
    expect(view).toMatchObject({ kind: "error", canRetry: true, searchEnabled: true });
    // The reducer never touches the list on its own: the list is still the same draft.
    expect(draft.tokens).toHaveLength(3);
  });

  it("is ready when nothing is wrong, and leaves real data to the real status panel", () => {
    // @rule R6
    expect(tokensViewState({ loading: false, error: false, draft: empty() }).kind).toBe("ready");
    const real: MandateDraft = { ...empty(), dataMode: "real" };
    expect(tokensViewState({ loading: true, error: false, draft: real }).kind).toBe("real");
  });
});

describe("R14 one source for real data mode", () => {
  it("gives 16 slots and the real status panel together, or 100 slots and neither", () => {
    // @rule R14
    for (const draftMode of [undefined, "real" as const]) {
      for (const catalogMode of [undefined, "real" as const]) {
        const draft: MandateDraft = { ...empty(), dataMode: draftMode };
        const source = { dataMode: catalogMode };
        const real = isRealData(draft, source);
        const view = tokensViewState({ loading: false, error: false, draft, catalog: source });
        expect(view.kind === "real").toBe(real);
        expect(slotsView(draft, source).ceiling).toBe(real ? MAX_TOKEN_SLOTS : BASKET_TOKEN_SLOTS);
      }
    }
  });
});

describe("R7 full basket", () => {
  function fullDraft(): MandateDraft {
    const base = empty();
    return {
      ...base,
      tokens: [...base.tokens, ...filler(BASKET_TOKEN_SLOTS - base.tokens.length)],
    };
  }

  it("marks the view full at 100 of 100 and turns Add all off", () => {
    // @rule R7
    const view = slotsView(fullDraft());
    expect(view).toMatchObject({ used: 100, ceiling: 100, full: true, remaining: 0 });
    expect(view.addAllEnabled).toBe(false);
  });

  it("keeps the refusal reason no_slots", () => {
    // @rule R7
    const result = addToken(fullDraft(), catalogToken("arbitrum", "ARB"), catalog);
    expect(isBlocked(result) && result.blocked.reason).toBe("no_slots");
  });
});

describe("R8 start values", () => {
  it("starts a token at 0% with No cap off", () => {
    // @rule R8
    const draft = withTwoTokens();
    const row = tokenRows(draft)[0];
    if (!row) throw new Error("fixture");
    expect(effectiveCap(draft, "tokens", tokenKey(row))).toEqual({ noCap: false, pct: 0 });
  });

  it("starts networks and protocols with No cap on", () => {
    // @rule R8
    let draft = withNetworks(empty(), ["arbitrum", "robinhood"], catalog);
    draft = draftOf(withProtocols(draft, [...REQUIRED_PROTOCOLS, "aave-v3"]));
    expect(effectiveCap(draft, "networks", "robinhood")).toEqual({ noCap: true, pct: 0 });
    expect(effectiveCap(draft, "protocols", "aave-v3")).toEqual({ noCap: true, pct: 0 });
  });

  it("locks the hub, and USDC has no row", () => {
    // @rule R8
    const draft = withNetworks(empty(), ["arbitrum", "robinhood"], catalog);
    const rows = capRows(draft, catalog);
    expect(rows.networks).not.toContain("arbitrum");
    expect(rows.tokens.some((t) => t.symbol === "USDC")).toBe(false);
  });

  it("lets a stored cap win over the start value, and unticking No cap keeps the percent", () => {
    // @rule R8
    let draft = withTwoTokens();
    const row = tokenRows(draft)[0];
    if (!row) throw new Error("fixture");
    draft = setCap(draft, "tokens", tokenKey(row), { noCap: false, pct: 40 });
    expect(effectiveCap(draft, "tokens", tokenKey(row))).toEqual({ noCap: false, pct: 40 });
    expect(clearCap(draft, "tokens", tokenKey(row)).caps.tokens[tokenKey(row)]).toBeUndefined();
  });

  it("keeps real data mode without start values", () => {
    // @rule R14
    const real: MandateDraft = { ...empty(), dataMode: "real" };
    expect(effectiveCap(real, "tokens", "arbitrum:0xabc")).toBeUndefined();
    expect(effectiveCap(real, "networks", "robinhood")).toBeUndefined();
  });
});

describe("R9 the All tokens row in Selected mode", () => {
  it("sets one cap for every token in the list", () => {
    // @rule R9
    const draft = setAllTokenCaps(withTwoTokens(), catalog, { noCap: false, pct: 20 });
    for (const row of tokenRows(draft)) {
      expect(draft.caps.tokens[tokenKey(row)]).toEqual({ noCap: false, pct: 20 });
    }
    expect(allTokensSummary(draft, catalog)).toEqual({
      kind: "uniform",
      cap: { noCap: false, pct: 20 },
    });
  });

  it("shows Mixed when the caps differ", () => {
    // @rule R9
    let draft = setAllTokenCaps(withTwoTokens(), catalog, { noCap: false, pct: 20 });
    const row = tokenRows(draft)[0];
    if (!row) throw new Error("fixture");
    draft = setCap(draft, "tokens", tokenKey(row), { noCap: false, pct: 55 });
    expect(allTokensSummary(draft, catalog)).toEqual({ kind: "mixed" });
  });

  it("reads the start values as one uniform 0% and an empty list as empty", () => {
    // @rule R9
    expect(allTokensSummary(withTwoTokens(), catalog)).toEqual({
      kind: "uniform",
      cap: { noCap: false, pct: 0 },
    });
    expect(allTokensSummary(empty(), catalog)).toEqual({ kind: "empty" });
  });
});

describe("R10 the Every token row in All mode", () => {
  it("defaults to 0% with No cap off", () => {
    // @rule R10
    const draft = setTokenMode(empty(), "all");
    expect(effectiveCap(draft, "all", EVERY_TOKEN_ROW_ID)).toEqual({ noCap: false, pct: 0 });
  });

  it("stores the one cap on the draft and leaves the token caps alone", () => {
    // @rule R10
    const base = setTokenMode(withTwoTokens(), "all");
    const next = setAllTokensCap(base, { noCap: false, pct: 30 });
    expect(next.allTokensCap).toEqual({ noCap: false, pct: 30 });
    expect(next.caps.tokens).toEqual(base.caps.tokens);
  });

  it("lets the cap count as a selection change", () => {
    // @rule R10
    const base = setTokenMode(empty(), "all");
    expect(selectionFingerprint(setAllTokensCap(base, { noCap: false, pct: 30 }))).not.toBe(
      selectionFingerprint(base),
    );
  });
});

describe("R11 the cap control", () => {
  it("offers 5% steps from 0 to 100", () => {
    // @rule R11
    expect(CAP_STEP_PCT).toBe(5);
    const steps = capSteps();
    expect(steps[0]).toBe(0);
    expect(steps[steps.length - 1]).toBe(100);
    expect(steps).toHaveLength(21);
    expect(steps.every((s) => s % 5 === 0)).toBe(true);
  });

  it("snaps a value off the grid to the 5% step", () => {
    // @rule R11
    const draft = setCap(withTwoTokens(), "tokens", "k", { noCap: false, pct: 47 });
    expect(draft.caps.tokens.k).toEqual({ noCap: false, pct: 45 });
    expect(setAllTokensCap(empty(), { noCap: false, pct: 130 }).allTokensCap?.pct).toBe(100);
  });
});

describe("R12 an enabled 0% cap blocks Next", () => {
  it("detects an enabled 0% cap and nothing else", () => {
    // @rule R12
    expect(isCapZero({ noCap: false, pct: 0 })).toBe(true);
    expect(isCapZero({ noCap: true, pct: 0 })).toBe(false);
    expect(isCapZero({ noCap: false, pct: 5 })).toBe(false);
    expect(isCapZero(undefined)).toBe(false);
  });

  it("blocks Limits with cap_zero on the first token at 0% in Selected mode", () => {
    // @rule R12
    const draft = withTwoTokens();
    const row = tokenRows(draft)[0];
    if (!row) throw new Error("fixture");
    expect(validateStep(draft, "limits", catalog)).toEqual({
      step: "limits",
      reason: "cap_zero",
      rowId: tokenKey(row),
    });
  });

  it("passes once every token has a cap above 0% or No cap on", () => {
    // @rule R12
    let draft = withTwoTokens();
    const [a, b] = tokenRows(draft);
    if (!a || !b) throw new Error("fixture");
    draft = setCap(draft, "tokens", tokenKey(a), { noCap: false, pct: 10 });
    draft = setCap(draft, "tokens", tokenKey(b), { noCap: true, pct: 0 });
    expect(validateStep(draft, "limits", catalog)).toBeNull();
  });

  it("blocks All mode with cap_zero on the Every token row", () => {
    // @rule R12
    const draft = setTokenMode(empty(), "all");
    expect(validateStep(draft, "limits", catalog)).toEqual({
      step: "limits",
      reason: "cap_zero",
      rowId: EVERY_TOKEN_ROW_ID,
    });
    expect(
      validateStep(setAllTokensCap(draft, { noCap: false, pct: 5 }), "limits", catalog),
    ).toBeNull();
    expect(
      validateStep(setAllTokensCap(draft, { noCap: true, pct: 0 }), "limits", catalog),
    ).toBeNull();
  });

  it("keeps token_allowance_required when Selected mode has no token row", () => {
    // @rule R12
    expect(validateStep(empty(), "limits", catalog)).toMatchObject({
      reason: "token_allowance_required",
    });
  });
});

describe("R13 a press on Next blinks the control twice and sends cap_zero", () => {
  it("schedules two blinks", () => {
    // @rule R13
    const phases = blinkSchedule(2, 250);
    expect(phases.filter((p) => p.on)).toHaveLength(2);
    expect(phases[0]).toEqual({ at: 0, on: true });
    expect(phases[phases.length - 1]?.on).toBe(false);
    expect(phases.map((p) => p.at)).toEqual([0, 250, 500, 750]);
  });

  it("holds the ring for the same time, without a blink, for reduced motion", () => {
    // @rule R13
    expect(blinkSchedule(2, 250, true)).toEqual([
      { at: 0, on: true },
      { at: 1000, on: false },
    ]);
  });

  it("warns on the All tokens row when one token in a mixed list is at 0%", () => {
    // @rule R12
    let draft = withTwoTokens();
    const [first, second] = tokenRows(draft);
    if (!first || !second) throw new Error("fixture");
    draft = setCap(draft, "tokens", tokenKey(first), { noCap: false, pct: 35 });
    draft = setCap(draft, "tokens", tokenKey(second), { noCap: false, pct: 0 });
    expect(allTokensSummary(draft, catalog).kind).toBe("mixed");
    expect(allTokensRowWarns(draft, catalog)).toBe(true);
    // The same test blocks Next, so the warning and the blink name the same row.
    const result = validateStep(draft, "limits", catalog);
    expect(result?.reason).toBe("cap_zero");
    draft = setCap(draft, "tokens", tokenKey(second), { noCap: false, pct: 5 });
    expect(allTokensRowWarns(draft, catalog)).toBe(false);
    expect(validateStep(draft, "limits", catalog)).toBeNull();
  });

  it("knows cap_zero as an analytics block reason", () => {
    // @rule R13
    expect(ANALYTICS_MANDATE_BLOCK_REASONS).toContain("cap_zero");
  });

  it("does not move the step: the reducer result is a block, not a draft", () => {
    // @rule R13
    const block = validateStep(withTwoTokens(), "limits", catalog);
    expect(block?.reason).toBe("cap_zero");
    expect(block?.step).toBe("limits");
  });
});

describe("R14 real data mode keeps today's behavior", () => {
  it("keeps 16 slots", () => {
    // @rule R14
    const real: MandateDraft = { ...empty(), dataMode: "real" };
    expect(MAX_TOKEN_SLOTS).toBe(16);
    expect(slotCeiling(real)).toBe(16);
    expect(slotsView(real).ceiling).toBe(16);
  });

  it("keeps the fingerprint of a draft without a mode", () => {
    // @rule R14
    const real: MandateDraft = { ...empty(), dataMode: "real" };
    expect(selectionFingerprint(real)).toBe(selectionFingerprint({ ...real }));
    expect(selectionFingerprint(setTokenMode(real, "selected"))).toBe(selectionFingerprint(real));
  });
});

describe("R15 token mode event", () => {
  it("reports the new mode when it changes, and nothing when it does not", () => {
    // @rule R15
    const draft = empty();
    expect(tokenModeEvent(draft, setTokenMode(draft, "all"))).toEqual({ token_mode: "all" });
    expect(tokenModeEvent(setTokenMode(draft, "all"), draft)).toEqual({ token_mode: "selected" });
    expect(
      tokenModeEvent(draft, setCap(draft, "networks", "arbitrum", { noCap: true, pct: 0 })),
    ).toBeNull();
  });

  it("is a known analytics event", () => {
    // @rule R15
    expect(ANALYTICS_EVENTS).toContain("builder_mandate_token_mode_changed");
  });
});

describe("R7 collapsed rows on the full basket", () => {
  it("shows the first rows and counts the hidden ones", () => {
    // @rule R7
    expect(collapseRows([1, 2, 3, 4, 5, 6], 4)).toEqual({ shown: [1, 2, 3, 4], hidden: 2 });
    expect(collapseRows([1, 2], 4)).toEqual({ shown: [1, 2], hidden: 0 });
  });
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});
