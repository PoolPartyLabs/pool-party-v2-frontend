/**
 * @id PP-MGR-LIB-024
 * @name blockCopy tests
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @analytics-events none, a test of translated strings
 *
 * The two strings review F2 and F3 of PR #36 changed, in every locale of `src/i18n/config.ts`,
 * through next-intl's own formatter (so an ICU syntax error fails here, not on screen):
 * - F2: `menu.networks.placed` agrees with the number of networks placed (ICU plural on `count`),
 *   so one network reads in the singular where the language marks it;
 * - F3: `panel.menuOpenNetwork`, the panel sentence while the Add network menu is open.
 */
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import de from "@/i18n/messages/de/manager.json";
import en from "@/i18n/messages/en/manager.json";
import es from "@/i18n/messages/es/manager.json";
import fr from "@/i18n/messages/fr/manager.json";
import ja from "@/i18n/messages/ja/manager.json";
import ko from "@/i18n/messages/ko/manager.json";
import nl from "@/i18n/messages/nl/manager.json";
import ptBR from "@/i18n/messages/pt-BR/manager.json";
import vi from "@/i18n/messages/vi/manager.json";
import zhCN from "@/i18n/messages/zh-CN/manager.json";
import zhTW from "@/i18n/messages/zh-TW/manager.json";
import { type ManagerTranslate, makeBlockCopy } from "./blockCopy";

const MESSAGES: Record<string, typeof en> = {
  en,
  "pt-BR": ptBR as typeof en,
  es: es as typeof en,
  fr: fr as typeof en,
  de: de as typeof en,
  nl: nl as typeof en,
  ja: ja as typeof en,
  ko: ko as typeof en,
  "zh-CN": zhCN as typeof en,
  "zh-TW": zhTW as typeof en,
  vi: vi as typeof en,
};

function copyFor(locale: string) {
  const messages = MESSAGES[locale];
  if (!messages) throw new Error(`no messages for ${locale}`);
  const translator = createTranslator({
    locale,
    messages: { manager: messages },
    namespace: "manager",
  });
  const t: ManagerTranslate = (key, values) =>
    (translator as unknown as ManagerTranslate)(key, values);
  return makeBlockCopy(t, locale);
}

/** The singular and plural of "already on the canvas", where the language marks the number. */
const AGREEMENT: Record<string, { one: string; other: string }> = {
  en: { one: "is already", other: "are already" },
  "pt-BR": { one: "já está", other: "já estão" },
  es: { one: "ya está", other: "ya están" },
  fr: { one: "est déjà", other: "sont déjà" },
  de: { one: "ist bereits", other: "sind bereits" },
  nl: { one: "staat al", other: "staan al" },
};

describe("menu.networks.placed (review F2)", () => {
  it("covers every locale of the i18n config", () => {
    // @rule I2
    expect(Object.keys(MESSAGES).sort()).toEqual([...locales].sort());
  });

  it.each([
    ...locales,
  ])("%s formats one and two networks with every name and no ICU left", (locale) => {
    // @rule I2
    const copy = copyFor(locale);
    const one = copy.menu.networksPlaced("Robinhood Chain", 1);
    const two = copy.menu.networksPlaced("Base, Robinhood Chain", 2);
    for (const text of [one, two]) {
      expect(text).not.toMatch(/[{}]/);
      expect(text).not.toContain("count");
    }
    expect(one).toContain("Robinhood Chain");
    expect(two).toContain("Base, Robinhood Chain");
  });

  it.each(Object.keys(AGREEMENT))("%s agrees with the number of networks placed", (locale) => {
    // @rule I2
    const copy = copyFor(locale);
    const agreement = AGREEMENT[locale];
    if (!agreement) throw new Error(`no agreement for ${locale}`);
    expect(copy.menu.networksPlaced("Robinhood Chain", 1)).toContain(agreement.one);
    expect(copy.menu.networksPlaced("Base, Robinhood Chain", 2)).toContain(agreement.other);
  });
});

describe("panel.menuOpenNetwork (review F3)", () => {
  it("reads in English in parallel to the protocol sentence", () => {
    // @rule AN10
    expect(copyFor("en").panel.menuOpenNetwork).toBe(
      "Choose a network in the menu. The network is added to the canvas with its bridge.",
    );
  });

  it.each([...locales])("%s has its own sentence, with no em dash", (locale) => {
    // @rule AN10
    // @rule G7
    const sentence = copyFor(locale).panel.menuOpenNetwork;
    expect(sentence.length).toBeGreaterThan(10);
    expect(sentence).not.toContain("fundBuilder");
    expect(sentence).not.toContain("—");
    if (locale !== "en") expect(sentence).not.toBe(copyFor("en").panel.menuOpenNetwork);
  });
});
