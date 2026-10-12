/**
 * @id PP-MGR-LIB-079
 * @name mandateTokenMode tests
 * @implements-rules-version v1 (POO-2332 rules v1)
 * @analytics-events builder_mandate_token_mode_changed (params only; the shell sends it)
 *
 * One `it()` per POO-2332 rule. The rule numbers in this file are POO-2332 rule numbers. Pure logic
 * only: the reducers and the read models the Tokens and Limits steps render.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildMandateCatalog, type MandateCatalog } from "./mandateCatalog";
import {
  addToken,
  CAP_STEP_PCT,
  capRows,
  createEmptyDraft,
  EVERY_TOKEN_ROW_ID,
  effectiveCap,
  isBlocked,
  MAX_MANDATE_SLOTS,
  MAX_TOKEN_SLOTS,
  type MandateDraft,
  type MandateTokenRef,
  maxTokenSlots,
  REQUIRED_PROTOCOLS,
  type StepBlock,
  setCap,
  tokenKey,
  tokenModeOf,
  validateStep,
  withNetworks,
  withProtocols,
} from "./mandateDraft";
import {
  allModeTokenRows,
  bulkTokenCap,
  CAP_ZERO_BLINKS,
  canAddEntries,
  limitTokenRowIds,
  nextHold,
  slotFooter,
  tokenListState,
  tokenModeChangedParams,
  withAllTokenCaps,
  withEveryTokenCap,
  withTokenMode,
} from "./mandateTokenMode";

const NOW = "2026-10-12T12:00:00.000Z";
const catalog = buildMandateCatalog();
const realCatalog: MandateCatalog = { ...catalog, dataMode: "real" };

function empty(): MandateDraft {
  return createEmptyDraft(NOW, "draft-1");
}

function realDraft(): MandateDraft {
  return { ...empty(), dataMode: "real", catalogVersion: "v2-catalog-v1" };
}

function draftOf(result: MandateDraft | { blocked: StepBlock }): MandateDraft {
  if (isBlocked(result)) throw new Error(`fixture: blocked ${result.blocked.reason}`);
  return result;
}

function token(network: "arbitrum" | "robinhood", symbol: string) {
  const found = catalog
    .tokensFor([network], [...REQUIRED_PROTOCOLS])
    .find((entry) => entry.symbol === symbol);
  if (!found) throw new Error(`fixture: no ${symbol} on ${network}`);
  return found;
}

/** A draft that holds `count` token entries in total, the locked hub USDC included. */
function filled(base: MandateDraft, count: number): MandateDraft {
  const filler: MandateTokenRef[] = Array.from({ length: count - base.tokens.length }, (_, i) => ({
    address: `0x${String(i).padStart(40, "0")}`,
    symbol: `FILL${i}`,
    name: `Filler ${i}`,
    network: "arbitrum",
    logoUrl: null,
    locked: false,
  }));
  return { ...base, tokens: [...base.tokens, ...filler] };
}

/** ARB and ETH on the hub, each with the cap given. */
function twoTokens(arb: number, weth: number): MandateDraft {
  let draft = draftOf(addToken(empty(), token("arbitrum", "ARB"), catalog));
  draft = draftOf(addToken(draft, token("arbitrum", "ETH"), catalog));
  draft = setCap(draft, "tokens", tokenKey(token("arbitrum", "ARB")), { noCap: false, pct: arb });
  return setCap(draft, "tokens", tokenKey(token("arbitrum", "ETH")), { noCap: false, pct: weth });
}

describe("token access (POO-2332)", () => {
  it("starts in Selected mode, and the draft keeps the mode it is given", () => {
    // @rule R1
    expect(tokenModeOf(empty())).toBe("selected");
    const all = withTokenMode(empty(), "all");
    expect(all.tokenMode).toBe("all");
    expect(tokenModeOf(all)).toBe("all");
    expect(tokenModeOf(withTokenMode(all, "selected"))).toBe("selected");
  });

  it("holds 100 slots in Selected mode and marks the 16-slot contracts apart", () => {
    // @rule R2
    expect(MAX_MANDATE_SLOTS).toBe(100);
    expect(maxTokenSlots(empty())).toBe(100);
    expect(MAX_TOKEN_SLOTS).toBe(16);
    const nearlyFull = filled(empty(), MAX_MANDATE_SLOTS - 1);
    expect(isBlocked(addToken(nearlyFull, token("arbitrum", "ARB"), catalog))).toBe(false);
  });

  it("counts the slots used out of 100 in Selected mode", () => {
    // @rule R3
    expect(slotFooter(empty())).toEqual({ kind: "count", used: 1, max: 100, full: false });
    const draft = draftOf(addToken(empty(), token("arbitrum", "ARB"), catalog));
    expect(slotFooter(draft)).toEqual({ kind: "count", used: 2, max: 100, full: false });
  });

  it("has no slot cap in All mode and lists the locked tokens and every other token", () => {
    // @rule R4
    const all = withTokenMode(filled(empty(), MAX_MANDATE_SLOTS), "all");
    expect(slotFooter(all)).toEqual({ kind: "unlimited", max: 100 });
    expect(maxTokenSlots(all)).toBe(Number.POSITIVE_INFINITY);
    expect(canAddEntries(all, 5)).toBe(true);
    expect(isBlocked(addToken(all, token("arbitrum", "ARB"), catalog))).toBe(false);

    const withSpoke = withTokenMode(withNetworks(empty(), ["robinhood"], catalog), "all");
    const rows = allModeTokenRows(withSpoke);
    expect(rows.map((row) => row.kind)).toEqual(["deposit", "required", "everyOther"]);
    const [deposit, required] = rows;
    expect(deposit?.kind === "deposit" && deposit.token.network).toBe("arbitrum");
    expect(required?.kind === "required" && required.token.network).toBe("robinhood");
  });

  it("keeps the selected tokens and their caps across a mode change", () => {
    // @rule R5
    const draft = twoTokens(10, 20);
    const back = withTokenMode(withTokenMode(draft, "all"), "selected");
    expect(back.tokens).toEqual(draft.tokens);
    expect(back.caps.tokens).toEqual(draft.caps.tokens);
  });

  it("reads loading, error and ready from the catalog, and the error can retry", () => {
    // @rule R6
    let retried = 0;
    expect(tokenListState(catalog)).toBe("ready");
    expect(tokenListState({ ...catalog, loading: true })).toBe("loading");
    const failed: MandateCatalog = { ...catalog, error: true, retry: () => void retried++ };
    expect(tokenListState(failed)).toBe("error");
    failed.retry?.();
    expect(retried).toBe(1);
  });

  it("is full at 100 of 100: no add fits and an add refuses with no_slots", () => {
    // @rule R7
    const full = filled(empty(), MAX_MANDATE_SLOTS);
    expect(slotFooter(full)).toEqual({ kind: "count", used: 100, max: 100, full: true });
    expect(canAddEntries(full, 1)).toBe(false);
    const arb = token("arbitrum", "ARB");
    const result = addToken(full, arb, catalog);
    expect(isBlocked(result) && result.blocked).toEqual({
      step: "tokens",
      reason: "no_slots",
      rowId: tokenKey(arb),
    });
  });
});

describe("limits (POO-2332)", () => {
  it("starts a token at 0% with No cap off, networks and protocols with No cap on", () => {
    // @rule R8
    let draft = withNetworks(empty(), ["robinhood"], catalog);
    draft = draftOf(withProtocols(draft, [...REQUIRED_PROTOCOLS, "aave-v3"]));
    draft = draftOf(addToken(draft, token("arbitrum", "ARB"), catalog));
    const arbKey = tokenKey(token("arbitrum", "ARB"));

    expect(effectiveCap(draft, "tokens", arbKey)).toEqual({ noCap: false, pct: 0 });
    expect(effectiveCap(draft, "networks", "robinhood")).toEqual({ noCap: true, pct: 0 });
    expect(effectiveCap(draft, "protocols", "aave-v3")).toEqual({ noCap: true, pct: 0 });
    expect(effectiveCap(draft, "networks", "arbitrum")).toEqual({ noCap: true, pct: 0 });
    // The hub and the deposit tokens get no row.
    const rows = capRows(draft, catalog);
    expect(rows.networks).toEqual(["robinhood"]);
    expect(rows.tokens.map((entry) => entry.symbol)).toEqual(["ARB"]);
  });

  it("sets one cap for every token from the All tokens row and reads Mixed when they differ", () => {
    // @rule R9
    expect(bulkTokenCap(twoTokens(10, 20), catalog)).toBe("mixed");
    expect(bulkTokenCap(twoTokens(15, 15), catalog)).toEqual({ noCap: false, pct: 15 });
    const set = withAllTokenCaps(twoTokens(10, 20), catalog, { noCap: false, pct: 25 });
    expect(Object.values(set.caps.tokens)).toEqual([
      { noCap: false, pct: 25 },
      { noCap: false, pct: 25 },
    ]);
    expect(bulkTokenCap(set, catalog)).toEqual({ noCap: false, pct: 25 });
    expect(bulkTokenCap(empty(), catalog)).toBeNull();
  });

  it("shows one Every token row at 0% in All mode, and its cap is what Next checks", () => {
    // @rule R10
    const all = withTokenMode(twoTokens(10, 20), "all");
    expect(limitTokenRowIds(all, catalog)).toEqual([EVERY_TOKEN_ROW_ID]);
    expect(effectiveCap(all, "everyToken", EVERY_TOKEN_ROW_ID)).toEqual({ noCap: false, pct: 0 });
    const set = withEveryTokenCap(all, { noCap: false, pct: 10 });
    expect(set.caps.everyToken).toEqual({ noCap: false, pct: 10 });
    expect(validateStep(set, "limits", catalog)).toBeNull();
    expect(limitTokenRowIds(twoTokens(10, 20), catalog)).toHaveLength(2);
  });

  it("snaps every cap to 5% steps between 0 and 100", () => {
    // @rule R11
    expect(CAP_STEP_PCT).toBe(5);
    const all = withTokenMode(empty(), "all");
    expect(withEveryTokenCap(all, { noCap: false, pct: 37 }).caps.everyToken?.pct).toBe(35);
    expect(withEveryTokenCap(all, { noCap: false, pct: 140 }).caps.everyToken?.pct).toBe(100);
    expect(withEveryTokenCap(all, { noCap: false, pct: -3 }).caps.everyToken?.pct).toBe(0);
    const bulk = withAllTokenCaps(twoTokens(0, 0), catalog, { noCap: false, pct: 12 });
    expect(bulkTokenCap(bulk, catalog)).toEqual({ noCap: false, pct: 10 });
  });

  it("holds Next on an enabled 0% cap in both modes, with a reason by scope", () => {
    // @rule R12
    expect(nextHold(twoTokens(0, 20), catalog, "limits")).toBe("token");
    expect(nextHold(twoTokens(10, 20), catalog, "limits")).toBeNull();
    expect(nextHold(withTokenMode(twoTokens(10, 20), "all"), catalog, "limits")).toBe("token");
    const zeroNetwork = setCap(
      withNetworks(twoTokens(10, 20), ["robinhood"], catalog),
      "networks",
      "robinhood",
      { noCap: false, pct: 0 },
    );
    expect(nextHold(zeroNetwork, catalog, "limits")).toBe("network");
    expect(nextHold(twoTokens(0, 0), catalog, "tokens")).toBeNull();
  });

  it("refuses Next with cap_zero on the first 0% row, which the step blinks twice", () => {
    // @rule R13
    expect(CAP_ZERO_BLINKS).toBe(2);
    expect(validateStep(twoTokens(10, 0), "limits", catalog)).toEqual({
      step: "limits",
      reason: "cap_zero",
      rowId: tokenKey(token("arbitrum", "ETH")),
    });
    expect(validateStep(withTokenMode(empty(), "all"), "limits", catalog)).toEqual({
      step: "limits",
      reason: "cap_zero",
      rowId: EVERY_TOKEN_ROW_ID,
    });
  });

  it("keeps real data mode as it is: 16 slots, no All mode, no 0% hold", () => {
    // @rule R14
    const real = realDraft();
    expect(maxTokenSlots(real)).toBe(MAX_TOKEN_SLOTS);
    expect(withTokenMode(real, "all")).toBe(real);
    expect(tokenModeOf({ ...real, tokenMode: "all" })).toBe("selected");
    expect(slotFooter(real)).toEqual({ kind: "count", used: 1, max: 16, full: false });
    expect(effectiveCap(real, "networks", "robinhood")).toBeNull();
    const spoke = withNetworks(real, ["robinhood"], realCatalog);
    expect(validateStep(spoke, "limits", realCatalog)).toMatchObject({ reason: "cap_missing" });
    expect(nextHold(spoke, realCatalog, "limits")).toBeNull();
  });
});

describe("quality (POO-2332)", () => {
  it("builds the token mode event params", () => {
    // @rule R15
    expect(tokenModeChangedParams("all")).toEqual({ token_mode: "all" });
    expect(tokenModeChangedParams("selected")).toEqual({ token_mode: "selected" });
  });

  it("has every new string in all 11 locales, with no em dash", () => {
    // @rule R16
    const locales = ["en", "pt-BR", "es", "fr", "de", "nl", "ja", "ko", "zh-CN", "zh-TW", "vi"];
    const keys = [
      "tokens.access",
      "tokens.accessSelected",
      "tokens.accessAll",
      "tokens.accessHelper",
      "tokens.allTitle",
      "tokens.allBody",
      "tokens.yoursAll",
      "tokens.requiredBy",
      "tokens.everyOther",
      "tokens.everyOtherCaption",
      "tokens.slots",
      "tokens.noLimit",
      "tokens.slotsAllCaption",
      "tokens.loading",
      "tokens.errorTitle",
      "tokens.errorHeading",
      "tokens.errorBody",
      "tokens.retry",
      "tokens.full",
      "tokens.noFreeSlots",
      "limits.allTokens",
      "limits.allTokensCaption",
      "limits.mixed",
      "limits.everyToken",
      "limits.everyTokenCaption",
      "limits.perTokenAllCaption",
      "limits.anyTokenTitle",
      "limits.anyTokenBody",
      "limits.allTokensTag",
      "limits.capZero",
      "limits.nextHold.network",
      "limits.nextHold.protocol",
      "limits.nextHold.token",
    ];
    for (const locale of locales) {
      const file = join(process.cwd(), "src/i18n/messages", locale, "manager.json");
      const messages = JSON.parse(readFileSync(file, "utf8")) as {
        fundBuilder: Record<string, unknown>;
      };
      for (const key of keys) {
        const value = key
          .split(".")
          .reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part],
            messages.fundBuilder,
          );
        expect(typeof value, `${locale} fundBuilder.${key}`).toBe("string");
        expect(value as string, `${locale} fundBuilder.${key}`).not.toContain("\u2014");
      }
    }
  });
});
