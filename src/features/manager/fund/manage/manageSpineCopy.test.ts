/**
 * @id PP-MGR-LIB-090
 * @name manageSpineCopy tests
 * @implements-rules-version v1 (POO-2335)
 * @analytics-events none, pure copy decisions
 */
import { describe, expect, it } from "vitest";
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
import { mockFund } from "@/mocks/data/v2Funds";
import { available, type ManageModel, normalizeManageModel } from "./manageModel";
import { deriveManageInspection, type ManageInspectableNode } from "./manageSelection";
import {
  MANAGE_SPINE_KEYS,
  type ManageSpineCopy,
  manageActionTiming,
  manageRangeTone,
  manageSpineCard,
  manageStrategyLinks,
} from "./manageSpineCopy";

function lookup(messages: unknown, key: string): string {
  const value = key
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      messages,
    );
  if (typeof value !== "string") throw new Error(`Missing message ${key}`);
  return value;
}
const copy: ManageSpineCopy = {
  t: (key, values = {}) =>
    lookup(en, key).replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`),
  percent: (value) =>
    new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 4 }).format(
      value / 100,
    ),
  usd: (value) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value),
  amount: (value) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value),
};
const model = normalizeManageModel(mockFund);
const nodes = deriveManageInspection(model).nodes;
function node(predicate: (node: ManageInspectableNode) => boolean): ManageInspectableNode {
  const found = nodes.find(predicate);
  if (!found) throw new Error("Missing node");
  return found;
}
const card = (target: ManageInspectableNode, source: ManageModel = model) =>
  manageSpineCard(target, source, copy);

describe("Manage spine card copy", () => {
  // @rule R1
  it("shows the route context on the entry and exit cards", () => {
    expect(card(node((n) => n.kind === "deposit")).subtitle).toBe("Route context · Entry");
    expect(card(node((n) => n.kind === "withdraw")).subtitle).toBe("Route context · Exit");
  });

  // @rule R2
  it("shows the route scope of the linked position, or Not available", () => {
    expect(card(node((n) => n.kind === "collectFees"))).toMatchObject({
      title: "Collect fees",
      subtitle: "Route scope · 40%",
    });
    expect(card(node((n) => n.kind === "swap"))).toMatchObject({
      title: "Swap input",
      subtitle: "Route scope · 40%",
    });
    expect(card(node((n) => n.kind === "feeSwap")).title).toBe("Swap fees");
    const entry = node((n) => n.kind === "bridge" && n.direction === "inbound");
    expect(card(entry)).toMatchObject({
      title: "Bridge entry",
      subtitle: "Route scope · Not available",
    });
    expect(card(node((n) => n.kind === "bridge" && n.direction === "outbound")).title).toBe(
      "Bridge return",
    );
  });

  // @rule R3
  it("shows the share of strategy value on the idle cards", () => {
    const hub = node((n) => n.kind === "idleInput" && n.chainId === model.hubChainId);
    const withIdle: ManageModel = {
      ...model,
      chains: model.chains.map((chain) =>
        chain.hub ? { ...chain, idleSharePct: available("19", "test") } : chain,
      ),
    };
    expect(card(hub, withIdle)).toMatchObject({
      title: "Idle input",
      subtitle: "Of strategy value · 19%",
    });
    expect(card(hub).subtitle).toBe("Of strategy value · Not available");
    const spoke = node((n) => n.kind === "idleInput" && n.chainId !== model.hubChainId);
    expect(card(spoke)).toMatchObject({
      title: "Idle",
      subtitle: "Of strategy value · Not available",
    });
  });

  // @rule R4
  it("shows the Supply value, share and health factor, with HF Not available as the fallback", () => {
    const supply = node((n) => n.kind === "position" && n.position?.kind === "supply");
    expect(card(supply)).toMatchObject({
      title: "Supply USDC",
      subtitle: "$250,000.00 · 25% · HF Not available",
    });
    expect(
      manageSpineCard(supply, model, copy, { healthFactor: available("1.85", "test") }).subtitle,
    ).toBe("$250,000.00 · 25% · HF 1.85");
  });

  // @rule R8
  it("shows the range status on the liquidity card and never uses success for an unknown status", () => {
    const liquidity = node((n) => n.kind === "position" && n.position?.kind === "liquidity");
    expect(card(liquidity)).toMatchObject({
      title: "USDC / WETH",
      subtitle: "$400,000.00 · 40% · In range",
      range: { tone: "success" },
    });
    expect(manageRangeTone({ status: "available", value: "out", source: "test" })).toEqual({
      labelKey: "operate.outOfRange",
      tone: "destructive",
    });
    const unknown = manageRangeTone({ status: "unavailable", reason: "missing" });
    expect(unknown.tone).not.toBe("success");
    expect(unknown).toEqual({ labelKey: "manageV2.notAvailable", tone: "muted" });
  });
});

describe("Manage strategy links", () => {
  // @rule R5
  it("links the explorer to the strategy address, or says that the address is unavailable", () => {
    const core = "0x1111111111111111111111111111111111111111";
    expect(manageStrategyLinks(core, 42161).explorer).toEqual({
      status: "available",
      href: `https://arbiscan.io/address/${core}`,
      label: "0x1111…1111",
    });
    expect(manageStrategyLinks("", 42161).explorer).toEqual({ status: "unavailable" });
    expect(lookup(en, "manageV2.explorer")).toBe("Explorer");
    expect(lookup(en, "manageV2.strategyAddressUnavailable")).toBe(
      "Strategy address is unavailable.",
    );
  });

  // @rule R6
  it("keeps View mandate with or without an explorer link", () => {
    expect(manageStrategyLinks("", 42161).mandate).toBe(true);
    expect(manageStrategyLinks("0x1111111111111111111111111111111111111111", 42161).mandate).toBe(
      true,
    );
  });
});

describe("Manage action timing", () => {
  // @rule R7
  it("applies Move range now and Create new position to new deposits, with no selector", () => {
    expect(manageActionTiming("move")).toEqual({
      applies: "now",
      timingKey: "applyNow",
      submitKey: "reviewMove",
      selector: false,
    });
    expect(manageActionTiming("future")).toEqual({
      applies: "newDeposits",
      timingKey: "newDeposits",
      submitKey: "saveFuture",
      selector: false,
    });
    expect(lookup(en, "manageV2.applyNow")).toBe("Apply now");
    expect(lookup(en, "manageV2.newDeposits")).toBe("New deposits only");
    expect(lookup(en, "manageV2.saveFuture")).toBe("Save for new deposits");
  });
});

describe("Manage spine locales", () => {
  // @rule R10
  it("has every new key in 11 locales with no em dash", () => {
    const all = [en, de, es, fr, ja, ko, nl, ptBR, vi, zhCN, zhTW];
    expect(all).toHaveLength(11);
    for (const messages of all)
      for (const key of MANAGE_SPINE_KEYS) {
        const value = lookup(messages, key);
        expect(value.length).toBeGreaterThan(0);
        expect(value).not.toContain("—");
      }
  });
});
