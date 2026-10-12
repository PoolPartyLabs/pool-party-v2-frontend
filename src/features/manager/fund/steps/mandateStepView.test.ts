/**
 * @id PP-MGR-LIB-081
 * @name mandateStepView tests
 * @implements-rules-version v1 (POO-2333 rules v1)
 * @analytics-events none, a pure view model and a test of translated strings.
 *
 * POO-2333 makes the Networks, Protocols and Pools steps and Save and exit match Figma. Each
 * visual rule is tested through the decision it takes (which rows render, in which group, in which
 * order) or through the copy it renders, in every locale of `src/i18n/config.ts`.
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
import { buildMandateCatalog, type MandateCatalog } from "../mandateCatalog";
import { createEmptyDraft, withNetworks } from "../mandateDraft";
import { buildSolanaBuilderCatalog } from "../solana-preview/solanaBuilderRuntime";
import {
  POOL_META_ORDER,
  protocolSections,
  selectedForYou,
  visibleSpokes,
} from "./mandateStepView";

const MESSAGES: Record<string, unknown> = {
  en,
  "pt-BR": ptBR,
  es,
  fr,
  de,
  nl,
  ja,
  ko,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  vi,
};

/** The manager translator of one locale. */
function translatorFor(locale: string) {
  const messages = MESSAGES[locale];
  if (!messages) throw new Error(`no messages for ${locale}`);
  const translator = createTranslator({
    locale,
    messages: { manager: messages } as never,
    namespace: "manager",
  });
  return (key: string, values?: Record<string, string | number>) =>
    (translator as unknown as (k: string, v?: Record<string, string | number>) => string)(
      key,
      values,
    );
}

const en$ = translatorFor("en");
const catalog = buildMandateCatalog();
const draft = createEmptyDraft("2026-10-12T00:00:00.000Z", "draft-1");

/** The default catalog with one more network that the config does not enable. */
function withDisabledSpoke(base: MandateCatalog): MandateCatalog {
  return {
    ...base,
    networks: [
      ...base.networks,
      {
        id: "solana",
        name: "fundBuilder.networkNames.solana",
        isHub: false,
        available: false,
        brandColor: "#9945FF",
        chainId: null,
      },
    ],
  };
}

describe("Networks step (POO-2333)", () => {
  it("captions Other networks with the cost of each network", () => {
    // @rule R1
    expect(en$("fundBuilder.networks.othersCaption")).toBe(
      "Each network that you add needs a bridge and one more signature at launch.",
    );
  });

  it("shows only the spokes the config enables, and keeps Solana to its preview mode", () => {
    // @rule R2
    expect(visibleSpokes(catalog).map((n) => n.id)).toEqual(["robinhood"]);
    expect(visibleSpokes(withDisabledSpoke(catalog)).map((n) => n.id)).toEqual(["robinhood"]);
    expect(visibleSpokes(buildSolanaBuilderCatalog()).map((n) => n.id)).toEqual([
      "robinhood",
      "solana",
    ]);
  });
});

describe("Protocols step (POO-2333)", () => {
  it("puts Swap and bridge below the divider, preselected, with its collapsed and open copy", () => {
    // @rule R3
    const sections = protocolSections(catalog, draft);
    expect(sections.swapAndBridge.map((p) => p.id)).toEqual(["uniswap-v3-swap", "across"]);
    expect(sections.operate.map((p) => p.id)).not.toContain("across");
    expect(selectedForYou(sections.swapAndBridge, draft)).toEqual(["uniswap-v3-swap", "across"]);
    expect(en$("fundBuilder.protocols.swapBridge")).toBe("Swap and bridge");
    expect(
      en$("fundBuilder.protocols.swapBridgeCollapsed", { names: "Uniswap v3 · Swap · Across" }),
    ).toBe("Uniswap v3 · Swap · Across · selected for you");
    expect(en$("fundBuilder.protocols.swapBridgeOpen")).toBe(
      "Selected for you. Keep at least one swap, and one bridge when you add a network.",
    );
    expect([en$("fundBuilder.protocols.show"), en$("fundBuilder.protocols.hide")]).toEqual([
      "Show",
      "Hide",
    ]);
    // A real draft on the hub alone has no bridge row: Across needs Robinhood Chain there.
    const real = { ...draft, dataMode: "real" as const };
    const realCatalog = { ...catalog, dataMode: "real" as const };
    expect(protocolSections(realCatalog, real).swapAndBridge.map((p) => p.id)).toEqual([
      "uniswap-v3-swap",
    ]);
    const realSpoke = withNetworks(real, ["robinhood"], realCatalog);
    expect(protocolSections(realCatalog, realSpoke).swapAndBridge.map((p) => p.id)).toEqual([
      "uniswap-v3-swap",
      "across",
    ]);
  });

  it("labels the network column Available on and explains it in a footnote", () => {
    // @rule R5
    expect(en$("fundBuilder.protocols.on")).toBe("Available on");
    expect(en$("fundBuilder.protocols.onFootnote")).toBe(
      '"Available on" shows which of your networks from step 1 each protocol supports.',
    );
  });

  it("names the two Uniswap v3 rows by what they do", () => {
    // @rule R6
    expect(en$("fundBuilder.protocols.rowNames.uniswapV3Swap")).toBe("Uniswap v3 · Swap");
    expect(en$("fundBuilder.protocols.rowNames.uniswapV3")).toBe("Uniswap v3 · Liquidity");
  });

  it("does not show a protocol that the config does not enable", () => {
    // @rule R7
    const sections = protocolSections(catalog, draft);
    const shown = [...sections.operate, ...sections.swapAndBridge].map((p) => p.id);
    expect(shown).toEqual(expect.arrayContaining(["aave-v3", "uniswap-v4"]));
    for (const hidden of ["uniswap-v3", "gmx", "pendle"]) expect(shown).not.toContain(hidden);
  });
});

describe("Pools step (POO-2333)", () => {
  it("prints the fee tier with the share of LPs that chose it", () => {
    // @rule R8
    expect(en$("fundBuilder.pools.tierShare", { fee: "0.30%", pct: 31 })).toBe(
      "0.30% fee tier · chosen by 31% of LPs",
    );
  });

  it("draws the network icon before the fee tier", () => {
    // @rule R9
    expect(POOL_META_ORDER).toEqual(["protocol", "network", "feeTier"]);
  });
});

describe("Save and exit (POO-2333)", () => {
  it("spells Save and exit in full, also in the empty drafts text, and keeps the helper short", () => {
    // @rule R10
    expect(en$("fundBuilder.header.saveExit")).toBe("Save and exit");
    expect(en$("fundBuilder.drafts.empty")).toBe(
      "No drafts yet. Start a strategy and use Save and exit to keep one.",
    );
    expect(en$("fundBuilder.draft.helper")).toBe("10 to 50 characters.");
  });
});

describe("locales (POO-2333)", () => {
  const KEYS: Array<[string, Record<string, string | number>?]> = [
    ["fundBuilder.networks.othersCaption"],
    ["fundBuilder.protocols.swapBridge"],
    ["fundBuilder.protocols.swapBridgeCollapsed", { names: "Uniswap v3 · Swap · Across" }],
    ["fundBuilder.protocols.swapBridgeOpen"],
    ["fundBuilder.protocols.show"],
    ["fundBuilder.protocols.hide"],
    ["fundBuilder.protocols.on"],
    ["fundBuilder.protocols.onFootnote"],
    ["fundBuilder.protocols.rowNames.uniswapV3Swap"],
    ["fundBuilder.protocols.rowNames.uniswapV3"],
    ["fundBuilder.pools.tierShare", { fee: "0.30%", pct: 31 }],
    ["fundBuilder.header.saveExit"],
    ["fundBuilder.drafts.empty"],
    ["fundBuilder.draft.helper"],
  ];

  it.each([...locales])("%s carries every new string, formatted, with no em dash", (locale) => {
    // @rule R11
    expect(Object.keys(MESSAGES).sort()).toEqual([...locales].sort());
    const t = translatorFor(locale);
    for (const [key, values] of KEYS) {
      const text = t(key, values);
      expect(text).not.toBe(`manager.${key}`);
      expect(text).not.toMatch(/[{}]/);
      expect(text).not.toContain("\u2014");
      if (key === "fundBuilder.pools.tierShare") expect(text).toContain("31");
    }
  });
});
