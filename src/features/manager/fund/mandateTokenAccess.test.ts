/**
 * @id PP-MGR-LIB-079
 * @name mandateTokenAccess tests
 * @implements-rules-version v1 (POO-2332)
 * @analytics-events none, pure view models.
 *
 * One test per POO-2332 rule that the view models carry: the token panel (R3, R4, R7), the catalog
 * states (R6), the "All tokens" row (R9), the zero-cap block label (R12) and the analytics lists
 * (R15).
 */
import { describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_EVENTS,
  ANALYTICS_MANDATE_BLOCK_REASONS,
  type AnalyticsParams,
} from "@/lib/analytics/events";
import { buildMandateCatalog, type MandateCatalog } from "./mandateCatalog";
import {
  addToken,
  createEmptyDraft,
  EVERY_TOKEN_ROW_ID,
  isBlocked,
  MAX_TOKEN_SLOTS,
  type MandateDraft,
  REQUIRED_PROTOCOLS,
  setAllTokenCaps,
  setCap,
  setDefaultTokenCap,
  setTokenMode,
  tokenKey,
  withNetworks,
  withProtocols,
} from "./mandateDraft";
import {
  allTokensRowValue,
  catalogCardAction,
  firstZeroCap,
  nextBlockedLabelKey,
  tokenAccessPanel,
  tokenCatalogState,
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
  });
});

describe("tokenCatalogState", () => {
  it("keeps the list on error and reloads through retry", () => {
    // @rule R6
    const retry = vi.fn();
    const failed: MandateCatalog = { ...catalog, error: true, retry };
    const draft = withToken(empty(), "ARB");
    const state = tokenCatalogState(failed);
    expect(state.status).toBe("error");
    state.retry?.();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(draft.tokens.some((t) => t.symbol === "ARB")).toBe(true);
    expect(tokenCatalogState({ ...catalog, loading: true }).status).toBe("loading");
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
  });
});

describe("firstZeroCap and nextBlockedLabelKey", () => {
  it("finds the first zero cap in screen order and names it for the Next label", () => {
    // @rule R12
    let draft = withNetworks(empty(), ["robinhood"], catalog);
    const dex = withProtocols(draft, [...REQUIRED_PROTOCOLS, "aave-v3"]);
    if (isBlocked(dex)) throw new Error("fixture: protocols refused");
    draft = withToken(dex, "ARB");
    const arb = tokenKey(token("ARB"));

    expect(firstZeroCap(draft, catalog)).toEqual({ group: "token", rowId: arb });
    draft = setCap(draft, "protocols", "aave-v3", { noCap: false, pct: 0 });
    expect(firstZeroCap(draft, catalog)).toEqual({ group: "protocol", rowId: "aave-v3" });
    draft = setCap(draft, "networks", "robinhood", { noCap: false, pct: 0 });
    expect(firstZeroCap(draft, catalog)).toEqual({ group: "network", rowId: "robinhood" });

    const all = setTokenMode(empty(), "all");
    expect(firstZeroCap(all, catalog)).toEqual({ group: "token", rowId: EVERY_TOKEN_ROW_ID });
    expect(firstZeroCap(setDefaultTokenCap(all, { noCap: false, pct: 5 }), catalog)).toBeNull();

    const block = (rowId: string) => ({
      step: "limits" as const,
      reason: "cap_zero" as const,
      rowId,
    });
    expect(nextBlockedLabelKey(block("robinhood"))).toBe("fundBuilder.limits.capZeroNetwork");
    expect(nextBlockedLabelKey(block("aave-v3"))).toBe("fundBuilder.limits.capZeroProtocol");
    expect(nextBlockedLabelKey(block(arb))).toBe("fundBuilder.limits.capZeroToken");
    expect(nextBlockedLabelKey(block(EVERY_TOKEN_ROW_ID))).toBe("fundBuilder.limits.capZeroToken");
    expect(
      nextBlockedLabelKey({ step: "limits", reason: "token_allowance_required", rowId: null }),
    ).toBeNull();
    expect(nextBlockedLabelKey(null)).toBeNull();
  });
});

describe("analytics lists", () => {
  it("lists the token mode event, its property and the cap_zero reason", () => {
    // @rule R15
    expect(ANALYTICS_EVENTS).toContain("builder_mandate_token_mode_changed");
    expect(ANALYTICS_MANDATE_BLOCK_REASONS).toContain("cap_zero");
    const params: AnalyticsParams = { token_mode: "all", block_reason: "cap_zero" };
    expect(params.token_mode).toBe("all");
    expect("builder_mandate_token_mode_changed".length).toBeLessThanOrEqual(40);
  });
});
