/**
 * @id PP-MGR-LIB-097
 * @name limitsNoCap tests
 * @implements-rules-version v1 (POO-2349 rules v1)
 * @analytics-events none, a pure domain. The row "No cap" sends no event today, so the section box sends none.
 *
 * One test per rule of POO-2349 that code can prove, each marked `// @rule Rn`. R1 (place of the
 * box) is checked by the Limits step test. R5 and R6 read the locale files and the step source as
 * text, so no test here renders a component.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import {
  sectionCapsOf,
  sectionNoCapState,
  setEveryTokenNoCap,
  setSectionNoCap,
  toggleNoCap,
} from "./limitsNoCap";
import {
  clearCap,
  createEmptyDraft,
  effectiveCap,
  type MandateDraft,
  setAllTokensCap,
  setCap,
} from "./mandateDraft";

const NOW = "2026-10-13T12:00:00.000Z";
const NETWORKS = ["arbitrum", "robinhood"] as const;
const TOKENS = ["arbitrum:0xaaa", "arbitrum:0xbbb", "robinhood:0xccc"] as const;

function empty(): MandateDraft {
  return createEmptyDraft(NOW, "draft-poo-2349");
}

function real(): MandateDraft {
  return { ...empty(), dataMode: "real" };
}

describe("R2 the section box sets every row", () => {
  it("checks No cap on every row and keeps the share each row had", () => {
    // @rule R2
    let draft = setCap(empty(), "tokens", TOKENS[0], { noCap: false, pct: 25 });
    draft = setCap(draft, "tokens", TOKENS[1], { noCap: true, pct: 10 });
    const next = setSectionNoCap(draft, "tokens", TOKENS, true, false);
    expect(sectionCapsOf(next, "tokens", TOKENS)).toEqual([
      { noCap: true, pct: 25 },
      { noCap: true, pct: 10 },
      { noCap: true, pct: 0 },
    ]);
  });

  it("clears every row like the row box does in the mock builder", () => {
    // @rule R2
    let draft = setCap(empty(), "networks", NETWORKS[0], { noCap: true, pct: 40 });
    draft = setCap(draft, "networks", NETWORKS[1], { noCap: true, pct: 0 });
    const next = setSectionNoCap(draft, "networks", NETWORKS, false, false);
    expect(effectiveCap(next, "networks", NETWORKS[0])).toEqual({ noCap: false, pct: 40 });
    expect(effectiveCap(next, "networks", NETWORKS[1])).toEqual({ noCap: false, pct: 0 });
  });

  it("gives each row the state that the row box gives in real data mode", () => {
    // @rule R2
    let draft = setCap(real(), "protocols", "aave-v3", { noCap: true, pct: 30 });
    draft = setCap(draft, "protocols", "uniswap-v4", { noCap: true, pct: 0 });
    const next = setSectionNoCap(draft, "protocols", ["aave-v3", "uniswap-v4"], false, true);
    // A row with a stored share returns to it. A row with none returns to unset.
    expect(effectiveCap(next, "protocols", "aave-v3")).toEqual({ noCap: false, pct: 30 });
    expect(effectiveCap(next, "protocols", "uniswap-v4")).toBeUndefined();
    // The same two moves, made on the row box, give the same draft.
    const byRow = toggleNoCap(
      toggleNoCap(draft, "protocols", "aave-v3", effectiveCap(draft, "protocols", "aave-v3")),
      "protocols",
      "uniswap-v4",
      effectiveCap(draft, "protocols", "uniswap-v4"),
    );
    expect(next.caps).toEqual(byRow.caps);
  });

  it("leaves a row that already has the target state as it is", () => {
    // @rule R2
    const draft = setCap(empty(), "networks", NETWORKS[0], { noCap: false, pct: 15 });
    const cleared = setSectionNoCap(draft, "networks", NETWORKS, false, false);
    expect(effectiveCap(cleared, "networks", NETWORKS[0])).toEqual({ noCap: false, pct: 15 });
  });

  it("sets No cap on the one Every token row in All tokens mode", () => {
    // @rule R2
    const draft = setAllTokensCap(empty(), { noCap: false, pct: 20 });
    expect(setEveryTokenNoCap(draft, true).allTokensCap).toEqual({ noCap: true, pct: 20 });
    expect(setEveryTokenNoCap(setEveryTokenNoCap(draft, true), false).allTokensCap).toEqual({
      noCap: false,
      pct: 20,
    });
  });

  it("does not drop the cap row of a real draft when it clears an unset row", () => {
    // @rule R2
    const draft = clearCap(real(), "networks", "arbitrum");
    const next = setSectionNoCap(draft, "networks", ["arbitrum"], false, true);
    expect(effectiveCap(next, "networks", "arbitrum")).toBeUndefined();
  });
});

describe("R3 the three states of the box", () => {
  it("is checked when every row has No cap", () => {
    // @rule R3
    expect(
      sectionNoCapState([
        { noCap: true, pct: 0 },
        { noCap: true, pct: 35 },
      ]),
    ).toBe("checked");
  });

  it("is mixed when only some rows have No cap", () => {
    // @rule R3
    expect(
      sectionNoCapState([
        { noCap: true, pct: 0 },
        { noCap: false, pct: 35 },
      ]),
    ).toBe("mixed");
  });

  it("is clear when no row has No cap, and an unset row does not count as No cap", () => {
    // @rule R3
    expect(sectionNoCapState([{ noCap: false, pct: 0 }, undefined])).toBe("clear");
    expect(sectionNoCapState([undefined, { noCap: true, pct: 0 }])).toBe("mixed");
  });

  it("has no box for a section with no rows", () => {
    // @rule R3
    expect(sectionNoCapState([])).toBe("none");
  });
});

describe("R4 a change on one row updates the box", () => {
  it("follows each tick and untick of a row", () => {
    // @rule R4
    const state = (draft: MandateDraft) =>
      sectionNoCapState(sectionCapsOf(draft, "tokens", TOKENS));
    let draft = empty();
    expect(state(draft)).toBe("clear");
    draft = toggleNoCap(draft, "tokens", TOKENS[0], effectiveCap(draft, "tokens", TOKENS[0]));
    expect(state(draft)).toBe("mixed");
    for (const id of TOKENS.slice(1)) {
      draft = toggleNoCap(draft, "tokens", id, effectiveCap(draft, "tokens", id));
    }
    expect(state(draft)).toBe("checked");
    draft = toggleNoCap(draft, "tokens", TOKENS[1], effectiveCap(draft, "tokens", TOKENS[1]));
    expect(state(draft)).toBe("mixed");
  });

  it("follows the slider that reaches 100%", () => {
    // @rule R4
    const draft = setCap(empty(), "tokens", TOKENS[0], { noCap: true, pct: 0 });
    expect(sectionNoCapState(sectionCapsOf(draft, "tokens", TOKENS))).toBe("mixed");
    const all = TOKENS.reduce((d, id) => setCap(d, "tokens", id, { noCap: true, pct: 0 }), draft);
    expect(sectionNoCapState(sectionCapsOf(all, "tokens", TOKENS))).toBe("checked");
  });
});

const ROOT = resolve(__dirname, "../../../..");

type Messages = { fundBuilder: { real: Record<string, string>; limits: Record<string, string> } };

function messagesOf(locale: string): Messages {
  return JSON.parse(readFileSync(join(ROOT, "src/i18n/messages", locale, "manager.json"), "utf8"));
}

describe("R5 the captions of Per protocol and Per token", () => {
  it("use different keys, each with its own text, in the mock builder and in real data mode", () => {
    // @rule R5
    const source = readFileSync(
      join(ROOT, "src/features/manager/fund/steps/LimitsStep.tsx"),
      "utf8",
    );
    for (const key of [
      "fundBuilder.limits.perProtocolCaption",
      "fundBuilder.real.allocationProtocol",
      "fundBuilder.limits.perTokenCaption",
      "fundBuilder.real.allocationToken",
    ]) {
      expect(source.split(`t("${key}")`).length - 1, key).toBe(1);
    }
    for (const locale of locales) {
      const { limits, real } = messagesOf(locale).fundBuilder;
      expect(limits.perProtocolCaption, locale).not.toBe(limits.perTokenCaption);
      expect(real.allocationProtocol, locale).not.toBe(real.allocationToken);
    }
  });
});

describe("R6 the new texts are in every locale", () => {
  it("has the new keys in all locales, with no em dash", () => {
    // @rule R6
    expect(locales.length).toBeGreaterThan(0);
    for (const locale of locales) {
      const { limits, real } = messagesOf(locale).fundBuilder;
      for (const text of [
        real.allocationProtocol,
        real.allocationToken,
        limits.sectionNoCapLabel,
      ]) {
        expect(text, locale).toBeTruthy();
        expect(text, locale).not.toContain("\u2014");
      }
      expect(limits.sectionNoCapLabel, locale).toContain("{name}");
    }
  });

  it("keeps pt-BR different from English", () => {
    // @rule R6
    const en = messagesOf("en").fundBuilder;
    const ptBR = messagesOf("pt-BR").fundBuilder;
    expect(ptBR.limits.sectionNoCapLabel).not.toBe(en.limits.sectionNoCapLabel);
    expect(ptBR.real.allocationProtocol).not.toBe(en.real.allocationProtocol);
  });
});
