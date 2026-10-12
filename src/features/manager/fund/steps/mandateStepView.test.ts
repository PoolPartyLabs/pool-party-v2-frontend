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
import {
  createEmptyDraft,
  lockedProtocols,
  summaryProtocols,
  withNetworks,
  withProtocols,
} from "../mandateDraft";
import { buildSolanaBuilderCatalog } from "../solana-preview/solanaBuilderRuntime";
import {
  availableOnColumn,
  poolMeta,
  protocolClick,
  protocolRowNames,
  protocolSections,
  refusedProtocolClick,
  SWAP_BRIDGE_DEFAULT_OPEN,
  selectedForYou,
  swapBridgeHead,
  swapBridgeHeadText,
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

/** One protocol of the default catalog. */
function protocolOf(id: string) {
  const protocol = catalog.protocols.find((p) => p.id === id);
  if (!protocol) throw new Error(`no protocol ${id}`);
  return protocol;
}

describe("Networks step (POO-2333)", () => {
  // @rule R1
  it("adds a bridge that the manager cannot clear for a network, as the caption says", () => {
    const swapOnly = withProtocols(draft, ["uniswap-v3-swap"]);
    expect(swapOnly.protocols).not.toContain("across");
    const spoke = withNetworks(swapOnly, ["robinhood"], catalog);
    expect(spoke.protocols).toContain("across");
    expect(lockedProtocols(spoke).has("across")).toBe(true);
    expect(protocolClick(spoke, "across")).toBe("locked");
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
    expect(swapBridgeHeadText(en$, head, selectedForYou(rows, draft))).toBe(
      "Uniswap v3 · Across · selected for you",
    );
    // A protocol that the manager cleared is not named.
    const swapOnly = withProtocols(draft, ["uniswap-v3-swap"]);
    expect(swapBridgeHeadText(en$, head, selectedForYou(rows, swapOnly))).toBe(
      "Uniswap v3 · selected for you",
    );
  });

  // @rule R3
  it("opens with Hide, and speaks about the bridge only when the mandate has a spoke", () => {
    const hubHead = swapBridgeHead(true, draft);
    const spokeHead = swapBridgeHead(true, spoke);
    expect(hubHead).toEqual({ copy: "openHub", toggle: "hide" });
    expect(spokeHead).toEqual({ copy: "open", toggle: "hide" });
    expect(swapBridgeHeadText(en$, hubHead, [])).not.toMatch(/bridge/i);
    expect(swapBridgeHeadText(en$, spokeHead, [])).toMatch(/bridge/);
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
    // The refusal has its own reason, so builder_mandate_blocked does not count it as an empty step.
    expect(refusedProtocolClick(spoke, "across")).toEqual({
      step: "protocols",
      reason: "required_protocol",
      rowId: "across",
    });
    expect(refusedProtocolClick(draft, "uniswap-v3-swap")?.reason).toBe("required_protocol");
    expect(refusedProtocolClick(draft, "across")).toBeNull();
    expect(refusedProtocolClick(spoke, "aave-v3")).toBeNull();
  });

  // @rule R4
  it("locks in the summary only the rows that the mandate cannot clear", () => {
    expect(summaryProtocols(draft)).toEqual([
      { id: "uniswap-v3-swap", locked: true },
      { id: "across", locked: false },
    ]);
    const withAave = withProtocols(spoke, [...spoke.protocols, "aave-v3"]);
    expect(summaryProtocols(withAave)).toEqual([
      { id: "uniswap-v3-swap", locked: true },
      { id: "across", locked: true },
      { id: "aave-v3", locked: false },
    ]);
  });

  // @rule R5
  it("fills Available on with the networks of the mandate that the protocol runs on", () => {
    // Aave v3 runs on the hub only, so a spoke mandate does not show Robinhood Chain beside it.
    expect(availableOnColumn(protocolOf("aave-v3"), spoke)).toEqual(["arbitrum"]);
    expect(availableOnColumn(protocolOf("uniswap-v4"), spoke)).toEqual(["arbitrum", "robinhood"]);
    // A network that the mandate does not hold is not shown, although the protocol runs there.
    expect(availableOnColumn(protocolOf("uniswap-v4"), draft)).toEqual(["arbitrum"]);
    // No network in common: the column is empty and the row drops it.
    expect(availableOnColumn({ availableOn: [] }, spoke)).toEqual([]);
  });

  // @rule R6
  it("gives each Uniswap v3 row a name that says what the row does", () => {
    const names = protocolRowNames(en$);
    expect(names["uniswap-v3-swap"]).toBe("Uniswap v3 · Swap");
    expect(names["uniswap-v3"]).toBe("Uniswap v3 · Liquidity");
    expect(names["uniswap-v4"]).toBe("Uniswap v4");
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
  it("puts the network of the pool before its fee tier in the pool row", () => {
    const pool = { protocol: "uniswap-v4" as const, network: "robinhood" as const, feeBps: 30 };
    expect(poolMeta(pool)).toEqual([
      { part: "protocol", protocol: "uniswap-v4" },
      { part: "network", network: "robinhood" },
      { part: "feeTier", fee: "0.30%" },
    ]);
  });
});

describe("Save and exit (POO-2333)", () => {
  // @rule R10
  it.each([...locales])("%s uses the Save and exit label in the empty drafts text", (locale) => {
    const t = translatorFor(locale);
    expect(t("fundBuilder.drafts.empty")).toContain(t("fundBuilder.header.saveExit"));
  });
});

describe("locales (POO-2333)", () => {
  // @rule R11
  it.each([
    ...locales,
  ])("%s resolves each row name and each head text, with no em dash", (locale) => {
    expect(Object.keys(MESSAGES).sort()).toEqual([...locales].sort());
    const t = translatorFor(locale);
    const names = protocolRowNames(t);
    expect(names["uniswap-v3-swap"]).not.toBe(names["uniswap-v3"]);
    const rows = protocolSections(catalog, draft).swapAndBridge;
    const spoke = withNetworks(draft, ["robinhood"], catalog);
    const texts = [
      ...Object.values(names),
      swapBridgeHeadText(t, swapBridgeHead(false, draft), selectedForYou(rows, draft)),
      swapBridgeHeadText(t, swapBridgeHead(true, draft), []),
      swapBridgeHeadText(t, swapBridgeHead(true, spoke), []),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/^manager\./);
      expect(text).not.toMatch(/[{}]/);
      expect(text).not.toContain("\u2014");
    }
  });
});
