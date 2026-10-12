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
import { createEmptyDraft, withNetworks, withProtocols } from "../mandateDraft";
import { buildSolanaBuilderCatalog } from "../solana-preview/solanaBuilderRuntime";
import {
  lockedRowKind,
  orderPoolMeta,
  protocolClick,
  protocolSections,
  SWAP_BRIDGE_DEFAULT_OPEN,
  selectedForYou,
  swapBridgeHead,
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
    messages: { manager: messages },
    namespace: "manager",
  } as unknown as Parameters<typeof createTranslator>[0]);
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
  // @rule R1
  it("captions Other networks with the cost of each network (Figma 9286:2)", () => {
    expect(en$("fundBuilder.networks.othersCaption")).toBe(
      "Each network that you add needs a bridge and one more signature at launch.",
    );
  });

  // @rule R2
  it("shows only the spokes the config enables, and keeps Solana to its preview mode", () => {
    expect(visibleSpokes(catalog).map((n) => n.id)).toEqual(["robinhood"]);
    expect(visibleSpokes(withDisabledSpoke(catalog)).map((n) => n.id)).toEqual(["robinhood"]);
    expect(visibleSpokes(buildSolanaBuilderCatalog()).map((n) => n.id)).toEqual([
      "robinhood",
      "solana",
    ]);
  });
});

describe("Protocols step (POO-2333)", () => {
  const spoke = withNetworks(draft, ["robinhood"], catalog);
  const real = { ...draft, dataMode: "real" as const };
  const realCatalog = { ...catalog, dataMode: "real" as const };

  // @rule R3
  it("puts the swap and the bridge in their own group, below the protocols to operate", () => {
    const sections = protocolSections(catalog, draft);
    expect(sections.swapAndBridge.map((p) => p.id)).toEqual(["uniswap-v3-swap", "across"]);
    expect(sections.operate.map((p) => p.id)).not.toContain("across");
    expect(sections.operate.map((p) => p.id)).not.toContain("uniswap-v3-swap");
    // A real draft on the hub alone has no bridge row: Across needs Robinhood Chain there.
    expect(protocolSections(realCatalog, real).swapAndBridge.map((p) => p.id)).toEqual([
      "uniswap-v3-swap",
    ]);
    const realSpoke = withNetworks(real, ["robinhood"], realCatalog);
    expect(protocolSections(realCatalog, realSpoke).swapAndBridge.map((p) => p.id)).toEqual([
      "uniswap-v3-swap",
      "across",
    ]);
  });

  // @rule R3
  it("starts collapsed, with Show, and names the selected protocols as Figma 8010:1638 does", () => {
    const head = swapBridgeHead(SWAP_BRIDGE_DEFAULT_OPEN, draft);
    expect(head).toEqual({ copy: "collapsed", toggle: "show" });
    const rows = protocolSections(catalog, draft).swapAndBridge;
    const names = selectedForYou(rows, draft)
      .map((id) => en$(`fundBuilder.protocolNames.${id === "across" ? "across" : "uniswapV3Swap"}`))
      .join(" · ");
    expect(en$("fundBuilder.protocols.swapBridgeCollapsed", { names })).toBe(
      "Uniswap v3 · Across · selected for you",
    );
    // A protocol that the manager cleared is not named.
    const swapOnly = withProtocols(draft, ["uniswap-v3-swap"]);
    expect(selectedForYou(rows, swapOnly)).toEqual(["uniswap-v3-swap"]);
  });

  // @rule R3
  it("opens with Hide, and speaks about the bridge only when the mandate has a spoke", () => {
    expect(swapBridgeHead(true, draft)).toEqual({ copy: "openHub", toggle: "hide" });
    expect(swapBridgeHead(true, spoke)).toEqual({ copy: "open", toggle: "hide" });
    expect(en$("fundBuilder.protocols.swapBridgeOpenHub")).not.toMatch(/bridge/i);
    expect(en$("fundBuilder.protocols.swapBridgeOpen")).toMatch(/bridge/);
  });

  // @rule R4
  it("refuses a click that would clear the last swap, or the bridge of a spoke mandate", () => {
    expect(protocolClick(draft, "uniswap-v3-swap")).toBe("locked");
    expect(protocolClick(draft, "across")).toBe("toggle");
    expect(protocolClick(draft, "aave-v3")).toBe("toggle");
    expect(protocolClick(spoke, "uniswap-v3-swap")).toBe("locked");
    expect(protocolClick(spoke, "across")).toBe("locked");
    // A protocol that is not in the draft can always be added back.
    const swapOnly = withProtocols(draft, ["uniswap-v3-swap"]);
    expect(protocolClick(swapOnly, "across")).toBe("toggle");
  });

  // @rule R4
  it("tells which locked row a refused click came from, for the notice beside the group", () => {
    expect(lockedRowKind(catalog, spoke, "uniswap-v3-swap")).toBe("swap");
    expect(lockedRowKind(catalog, spoke, "across")).toBe("bridge");
    expect(lockedRowKind(catalog, draft, "across")).toBeNull();
    expect(lockedRowKind(catalog, spoke, "aave-v3")).toBeNull();
    expect(lockedRowKind(catalog, spoke, undefined)).toBeNull();
  });

  // @rule R5
  it("labels the network column Available on and explains it in a footnote", () => {
    expect(en$("fundBuilder.protocols.on")).toBe("Available on");
    expect(en$("fundBuilder.protocols.onFootnote")).toContain(en$("fundBuilder.protocols.on"));
  });

  // @rule R6
  it("names the Uniswap v3 swap row by what it does, and the head by the protocol only", () => {
    const row = en$("fundBuilder.protocols.rowNames.uniswapV3Swap");
    const protocol = en$("fundBuilder.protocolNames.uniswapV3Swap");
    expect(row.startsWith(protocol)).toBe(true);
    expect(row).not.toBe(protocol);
  });

  // @rule R7
  it("does not show a protocol that the config does not enable", () => {
    const sections = protocolSections(catalog, draft);
    const shown = [...sections.operate, ...sections.swapAndBridge].map((p) => p.id);
    expect(shown).toEqual(expect.arrayContaining(["aave-v3", "uniswap-v4"]));
    for (const hidden of ["uniswap-v3", "gmx", "pendle"]) expect(shown).not.toContain(hidden);
    const solana = buildSolanaBuilderCatalog();
    const solanaShown = protocolSections(solana, draft).operate.map((p) => p.id);
    for (const hidden of ["uniswap-v3", "gmx", "pendle"]) expect(solanaShown).not.toContain(hidden);
  });
});

describe("Pools step (POO-2333)", () => {
  // @rule R8
  it.each([...locales])("%s prints the fee tier with the share of LPs that chose it", (locale) => {
    const text = translatorFor(locale)("fundBuilder.pools.tierShare", { fee: "0.05%", pct: 47 });
    expect(text).toContain("0.05%");
    expect(text).toContain("47");
  });

  // @rule R9
  it("draws the network icon before the fee tier, whatever order the parts arrive in", () => {
    expect(orderPoolMeta({ feeTier: "fee", network: "net", protocol: "proto" })).toEqual([
      "proto",
      "net",
      "fee",
    ]);
  });
});

describe("Save and exit (POO-2333)", () => {
  // @rule R10
  it.each([...locales])("%s uses the Save and exit label in the empty drafts text", (locale) => {
    const t = translatorFor(locale);
    expect(t("fundBuilder.drafts.empty")).toContain(t("fundBuilder.header.saveExit"));
  });

  // @rule R10
  it("spells Save and exit in full and keeps the name helper short", () => {
    expect(en$("fundBuilder.header.saveExit")).toBe("Save and exit");
    expect(en$("fundBuilder.draft.helper")).toBe("10 to 50 characters.");
  });
});

describe("locales (POO-2333)", () => {
  const KEYS: Array<[string, Record<string, string | number>?]> = [
    ["fundBuilder.networks.othersCaption"],
    ["fundBuilder.protocols.swapBridge"],
    ["fundBuilder.protocols.swapBridgeCollapsed", { names: "Uniswap v3 · Swap · Across" }],
    ["fundBuilder.protocols.swapBridgeOpen"],
    ["fundBuilder.protocols.swapBridgeOpenHub"],
    ["fundBuilder.protocols.lockedSwap"],
    ["fundBuilder.protocols.lockedBridge"],
    ["fundBuilder.protocols.show"],
    ["fundBuilder.protocols.hide"],
    ["fundBuilder.protocols.on"],
    ["fundBuilder.protocols.onFootnote"],
    ["fundBuilder.protocols.rowNames.uniswapV3Swap"],
    ["fundBuilder.pools.tierShare", { fee: "0.30%", pct: 31 }],
    ["fundBuilder.header.saveExit"],
    ["fundBuilder.drafts.empty"],
    ["fundBuilder.draft.helper"],
  ];

  // @rule R11
  it.each([...locales])("%s carries every new string, formatted, with no em dash", (locale) => {
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
