/**
 * @id PP-MGR-LIB-079
 * @name mandateTokenAccess tests
 * @implements-rules-version v1 (POO-2332)
 * @analytics-events none, pure view models.
 *
 * One test per POO-2332 rule that the view models carry: the token panel (R3, R4, R7), the catalog
 * states (R6), the "All tokens" row (R9), the All mode summary (R10), the zero-cap block (R12, R13),
 * real data mode (R14) and the token mode event (R15).
 */
import { describe, expect, it, vi } from "vitest";
import { buildMandateCatalog, type MandateCatalog } from "./mandateCatalog";
import {
  addToken,
  createEmptyDraft,
  EVERY_TOKEN_ROW_ID,
  isBlocked,
  isRealData,
  MAX_TOKEN_SLOTS,
  type MandateDraft,
  REQUIRED_PROTOCOLS,
  setAllTokenCaps,
  setCap,
  setDefaultTokenCap,
  setTokenMode,
  tokenKey,
  validateStep,
  withNetworks,
  withProtocols,
} from "./mandateDraft";
import {
  allTokensRowValue,
  basketRowsView,
  capZeroBlinkKey,
  catalogCardAction,
  firstZeroCap,
  mandateBlockedParams,
  mandateSummaryTokens,
  nextBlockedLabelKey,
  nextButtonView,
  toggleAllTokensNoCap,
  tokenAccessPanel,
  tokenCatalogState,
  tokenModeChangedParams,
} from "./mandateTokenAccess";

const NOW = "2026-10-12T12:00:00.000Z";
const catalog = buildMandateCatalog();

function empty(): MandateDraft {
  return createEmptyDraft(NOW, "draft-1");
}

function token(symbol: string) {
  const found = catalog
    .tokensFor(["arbitrum"], [...REQUIRED_PROTOCOLS])
    .find((t) => t.symbol === symbol);
  if (!found) throw new Error(`fixture: no ${symbol}`);
  return found;
}

function withToken(draft: MandateDraft, symbol: string): MandateDraft {
  const result = addToken(draft, token(symbol), catalog);
  if (isBlocked(result)) throw new Error(`fixture: ${symbol} refused`);
  return result;
}

/** A draft whose basket holds `used` entries: USDC plus synthetic unlocked fillers. */
function withUsed(draft: MandateDraft, used: number): MandateDraft {
  const fillers = Array.from({ length: used - draft.tokens.length }, (_, i) => ({
    address: `0x${String(i).padStart(40, "0")}`,
    symbol: `FILL${i}`,
    name: `Filler ${i}`,
    network: "arbitrum" as const,
    logoUrl: null,
    locked: false,
  }));
  return { ...draft, tokens: [...draft.tokens, ...fillers] };
}

describe("tokenAccessPanel", () => {
  it("shows the list and the slot footer out of 100 in Selected mode", () => {
    // @rule R3
    const draft = withToken(empty(), "ARB");
    expect(tokenAccessPanel(draft, catalog)).toEqual({
      showControl: true,
      mode: "selected",
      yourTokens: "list",
      lockedRows: [],
      showSlotFooter: true,
      slotCount: { used: 2, max: MAX_TOKEN_SLOTS },
      full: false,
    });
  });

  it("shows the locked tokens and no slot footer in All mode", () => {
    // @rule R4
    const draft = setTokenMode(
      withToken(withNetworks(empty(), ["robinhood"], catalog), "ARB"),
      "all",
    );
    const panel = tokenAccessPanel(draft, catalog);
    expect(panel.mode).toBe("all");
    expect(panel.yourTokens).toBe("all");
    expect(panel.showSlotFooter).toBe(false);
    expect(panel.slotCount).toBeNull();
    expect(panel.full).toBe(false);
    expect(panel.lockedRows.map((row) => [row.network, row.kind])).toEqual([
      ["arbitrum", "deposit"],
      ["robinhood", "required"],
    ]);
    // The kept list is not shown in All mode, but it is not dropped either (R5).
    expect(draft.tokens.some((t) => t.symbol === "ARB")).toBe(true);
  });

  it("hides the control in real data mode", () => {
    // @rule R14
    const draft: MandateDraft = { ...empty(), dataMode: "real", catalogVersion: "v2-catalog-v1" };
    const panel = tokenAccessPanel(draft, { ...catalog, dataMode: "real" });
    expect(panel.showControl).toBe(false);
    expect(panel.slotCount).toEqual({ used: 1, max: 16 });
    // One definition of real data mode: the draft or the catalog can say so.
    expect(isRealData(draft, catalog)).toBe(true);
    expect(isRealData(empty(), { ...catalog, dataMode: "real" })).toBe(true);
    expect(isRealData(empty(), catalog)).toBe(false);
  });
});

describe("catalogCardAction", () => {
  it("gives no_free_slots and marks the basket full at 100 used", () => {
    // @rule R7
    const full = withUsed(empty(), MAX_TOKEN_SLOTS);
    expect(catalogCardAction(full, [token("ARB")])).toBe("no_free_slots");
    expect(tokenAccessPanel(full, catalog).full).toBe(true);
    expect(tokenAccessPanel(full, catalog).slotCount).toEqual({ used: 100, max: 100 });

    const room = withUsed(empty(), MAX_TOKEN_SLOTS - 1);
    expect(catalogCardAction(room, [token("ARB")])).toBe("add");
    expect(catalogCardAction(withToken(empty(), "ARB"), [token("ARB")])).toBe("added");
    // All mode has no slot cap, so a full basket can still add.
    expect(catalogCardAction(setTokenMode(full, "all"), [token("ARB")])).toBe("add");

    // The full basket shows 4 rows, then "and 34 more tokens" (Figma 9295:1116).
    expect(basketRowsView(38, false)).toEqual({ shown: 4, hidden: 34 });
    expect(basketRowsView(38, true)).toEqual({ shown: 38, hidden: 0 });
    expect(basketRowsView(3, false)).toEqual({ shown: 3, hidden: 0 });
  });
});

describe("tokenCatalogState", () => {
  it("keeps the list on error and reloads through retry", () => {
    // @rule R6
    const retry = vi.fn();
    const failed: MandateCatalog = { ...catalog, error: true, retry };
    const state = tokenCatalogState(failed);
    expect(state.status).toBe("error");
    state.retry?.();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(tokenCatalogState({ ...failed, retry: undefined })).toEqual({
      status: "error",
      retry: null,
    });
    expect(tokenCatalogState({ ...catalog, loading: true })).toEqual({
      status: "loading",
      retry: null,
    });
    expect(tokenCatalogState(catalog)).toEqual({ status: "ready", retry: null });
  });
});

describe("allTokensRowValue", () => {
  it("sets every token with one change and shows Mixed when the caps differ", () => {
    // @rule R9
    const draft = withToken(withToken(empty(), "ARB"), "ETH");
    const keys = draft.tokens.filter((t) => !t.locked).map(tokenKey);
    const same = setAllTokenCaps(draft, { noCap: false, pct: 30 });
    for (const key of keys) expect(same.caps.tokens[key]).toEqual({ noCap: false, pct: 30 });
    expect(allTokensRowValue(same, keys)).toEqual({ kind: "value", pct: 30 });
    expect(allTokensRowValue(setAllTokenCaps(draft, { noCap: true, pct: 0 }), keys)).toEqual({
      kind: "no_cap",
    });
    const [firstKey] = keys;
    if (!firstKey) throw new Error("fixture: no token key");
    expect(
      allTokensRowValue(setCap(same, "tokens", firstKey, { noCap: false, pct: 10 }), keys),
    ).toEqual({
      kind: "mixed",
    });
    // Start values: two unset rows read as the same 0%.
    expect(allTokensRowValue(draft, keys)).toEqual({ kind: "value", pct: 0 });

    // No cap on "All tokens", then off again, gives each token its own value back.
    const [arbKey, ethKey] = keys;
    if (!arbKey || !ethKey) throw new Error("fixture: no token keys");
    const own = setCap(
      setCap(draft, "tokens", arbKey, { noCap: false, pct: 30 }),
      "tokens",
      ethKey,
      { noCap: false, pct: 10 },
    );
    const ticked = toggleAllTokensNoCap(own, keys);
    expect(allTokensRowValue(ticked, keys)).toEqual({ kind: "no_cap" });
    const unticked = toggleAllTokensNoCap(ticked, keys);
    expect(unticked.caps.tokens[arbKey]).toEqual({ noCap: false, pct: 30 });
    expect(unticked.caps.tokens[ethKey]).toEqual({ noCap: false, pct: 10 });
    expect(firstZeroCap(unticked, catalog)).toBeNull();
    // "Mixed" with one row at No cap: the tick sets No cap on every row and keeps each value.
    const mixed = toggleAllTokensNoCap(
      setCap(own, "tokens", arbKey, { noCap: true, pct: 30 }),
      keys,
    );
    expect(mixed.caps.tokens[ethKey]).toEqual({ noCap: true, pct: 10 });
  });
});

describe("mandateSummaryTokens", () => {
  it("keeps the All mode default cap for the summary and lists only the locked tokens", () => {
    // @rule R10
    const selected = withToken(empty(), "ARB");
    const arb = tokenKey(token("ARB"));
    const listed = mandateSummaryTokens(
      setCap(selected, "tokens", arb, { noCap: false, pct: 25 }),
      catalog,
    );
    expect(listed.mode).toBe("selected");
    expect(listed.tokens.map((t) => t.symbol)).toEqual(["USDC", "ARB"]);
    expect(listed.tokenCaps).toEqual([{ key: arb, symbol: "ARB", cap: { noCap: false, pct: 25 } }]);
    expect(listed.defaultCap).toBeNull();

    const all = mandateSummaryTokens(
      setDefaultTokenCap(setTokenMode(selected, "all"), { noCap: false, pct: 15 }),
      catalog,
    );
    expect(all.mode).toBe("all");
    expect(all.tokens.map((t) => t.symbol)).toEqual(["USDC"]);
    expect(all.tokenCaps).toBeNull();
    expect(all.defaultCap).toEqual({ noCap: false, pct: 15 });
  });
});

describe("the zero-cap block", () => {
  it("finds the first zero cap in screen order and gives Next its reason and blocked look", () => {
    // @rule R12
    let draft = withNetworks(empty(), ["robinhood"], catalog);
    const dex = withProtocols(draft, [...REQUIRED_PROTOCOLS, "aave-v3"]);
    if (isBlocked(dex)) throw new Error("fixture: protocols refused");
    draft = withToken(dex, "ARB");
    const arb = tokenKey(token("ARB"));

    const tokenZero = firstZeroCap(draft, catalog);
    expect(tokenZero).toEqual({ group: "token", rowId: arb });
    expect(nextButtonView(tokenZero)).toEqual({
      variant: "secondary",
      ariaDisabled: "true",
      labelKey: "fundBuilder.limits.capZeroToken",
    });

    draft = setCap(draft, "protocols", "aave-v3", { noCap: false, pct: 0 });
    const protocolZero = firstZeroCap(draft, catalog);
    expect(protocolZero).toEqual({ group: "protocol", rowId: "aave-v3" });
    expect(nextBlockedLabelKey(protocolZero)).toBe("fundBuilder.limits.capZeroProtocol");

    draft = setCap(draft, "networks", "robinhood", { noCap: false, pct: 0 });
    const networkZero = firstZeroCap(draft, catalog);
    expect(networkZero).toEqual({ group: "network", rowId: "robinhood" });
    expect(nextBlockedLabelKey(networkZero)).toBe("fundBuilder.limits.capZeroNetwork");

    // All mode: the "Every token" row at 0% blocks; a default cap above 0% lets Next through.
    const all = setTokenMode(empty(), "all");
    const everyZero = firstZeroCap(all, catalog);
    expect(everyZero).toEqual({ group: "token", rowId: EVERY_TOKEN_ROW_ID });
    expect(nextBlockedLabelKey(everyZero)).toBe("fundBuilder.limits.capZeroToken");
    const clear = firstZeroCap(setDefaultTokenCap(all, { noCap: false, pct: 5 }), catalog);
    expect(clear).toBeNull();
    expect(nextButtonView(clear)).toEqual({
      variant: "primary",
      ariaDisabled: undefined,
      labelKey: null,
    });
  });

  it("reports cap_zero on each press and replays the blink once per press", () => {
    // @rule R13
    const draft = withToken(empty(), "ARB");
    const block = validateStep(draft, "limits", catalog);
    if (!block) throw new Error("fixture: Limits is not blocked");
    expect(mandateBlockedParams(block)).toEqual({ step: "limits", block_reason: "cap_zero" });

    const arb = tokenKey(token("ARB"));
    expect(capZeroBlinkKey(block, 1)).toBe(`${arb}:1`);
    // A re-render with the same press gives the same key, so the blink does not play again.
    expect(capZeroBlinkKey({ ...block }, 1)).toBe(capZeroBlinkKey(block, 1));
    // The next press gives a new key, so the blink plays one more time.
    expect(capZeroBlinkKey(block, 2)).toBe(`${arb}:2`);
    // Any other block has no blink.
    expect(
      capZeroBlinkKey({ step: "limits", reason: "token_allowance_required", rowId: null }, 3),
    ).toBeNull();
    expect(capZeroBlinkKey(null, 3)).toBeNull();
  });
});

describe("tokenModeChangedParams", () => {
  it("sends the event only for a real change of the mode on the same draft", () => {
    // @rule R15
    const selected = { draftId: "draft-1", mode: "selected" as const };
    const all = { draftId: "draft-1", mode: "all" as const };
    // First render: no baseline yet.
    expect(tokenModeChangedParams(null, all)).toBeNull();
    // Resume or switch to another draft that is already in All mode.
    expect(tokenModeChangedParams(selected, { draftId: "draft-2", mode: "all" })).toBeNull();
    // A re-render with no change.
    expect(tokenModeChangedParams(all, all)).toBeNull();
    // A real change, in each direction.
    expect(tokenModeChangedParams(selected, all)).toEqual({ token_mode: "all" });
    expect(tokenModeChangedParams(all, selected)).toEqual({ token_mode: "selected" });
  });
});
