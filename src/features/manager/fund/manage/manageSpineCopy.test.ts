/**
 * @id PP-MGR-LIB-090
 * @name manageSpineCopy tests
 * @implements-rules-version v1 (POO-2335)
 * @analytics-events none, pure copy decisions
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import {
  available,
  type ManageModel,
  type ManageTokenAmount,
  normalizeManageModel,
} from "./manageModel";
import { deriveManageInspection, type ManageInspectableNode } from "./manageSelection";
import {
  MANAGE_PERCENT_FORMAT,
  MANAGE_SPINE_KEYS,
  type ManageSpineCopy,
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
  // The same percent format as ManageScreen.
  percent: (value) => new Intl.NumberFormat("en-US", MANAGE_PERCENT_FORMAT).format(value / 100),
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
const spokeChainId = model.chains.find((chain) => !chain.hub)?.chainId;
/** The mock with the spoke idle share that frames 8609:3517 and 8674:14982 show. */
const withSpokeShare: ManageModel = {
  ...model,
  chains: model.chains.map((chain) =>
    chain.hub ? chain : { ...chain, idleSharePct: available("15", "test") },
  ),
};
function amountOf(decimal: string, symbol: string, decimals: number): ManageTokenAmount {
  return { chainId: model.hubChainId, address: null, symbol, decimals, raw: "0", decimal };
}
/** Strip comments, so that the guard reads only shipped code. */
function code(file: string): string {
  return readFileSync(join(__dirname, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
/** The body of one top-level function, up to the next top-level function. */
function body(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("Manage spine card copy", () => {
  // @rule R1
  it("shows the route context on the entry and exit cards", () => {
    expect(card(node((n) => n.kind === "deposit")).subtitle).toBe("Route context · Entry");
    expect(card(node((n) => n.kind === "withdraw")).subtitle).toBe("Route context · Exit");
  });

  // @rule R2
  it("shows the route scope of each route card from the field that the frame describes", () => {
    const swap = node((n) => n.kind === "swap");
    const entry = node((n) => n.kind === "bridge" && n.direction === "inbound");
    const exit = node((n) => n.kind === "bridge" && n.direction === "outbound");
    const collect = node((n) => n.kind === "collectFees");
    const feeSwap = node((n) => n.kind === "feeSwap");
    expect(swap.chainId).toBe(spokeChainId);
    expect(entry.chainId).toBe(spokeChainId);
    // Swap input and Bridge entry: the spoke idle share.
    expect(card(swap, withSpokeShare)).toMatchObject({
      title: "Swap input",
      subtitle: "Route scope · 15%",
    });
    expect(card(swap).subtitle).toBe("Route scope · Not available");
    expect(card(entry, withSpokeShare)).toMatchObject({
      title: "Bridge entry",
      subtitle: "Route scope · 15%",
    });
    expect(card(entry).subtitle).toBe("Route scope · Not available");
    // Collect fees: the share of the linked position.
    expect(card(collect)).toMatchObject({ title: "Collect fees", subtitle: "Route scope · 40%" });
    // Swap fees: the income share of strategy value.
    expect(card(feeSwap)).toMatchObject({
      title: "Swap fees",
      subtitle: "Route scope · Not available",
    });
    expect(
      manageSpineCard(feeSwap, model, copy, { incomeSharePct: available("0.245", "test") })
        .subtitle,
    ).toBe("Route scope · 0.245%");
    // Bridge return: no read gives its scope.
    expect(card(exit, withSpokeShare)).toMatchObject({
      title: "Bridge return",
      subtitle: "Route scope · Not available",
    });
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

  // @rule R3
  it("shows the cash amount, USD value and share of strategy value", () => {
    const cash = node((n) => n.kind === "cash" && n.chainId === model.hubChainId);
    const withCash: ManageModel = {
      ...model,
      chains: model.chains.map((chain) =>
        chain.hub
          ? {
              ...chain,
              cash: chain.cash.map((token) => ({
                ...token,
                amount: available(amountOf("0.025", token.symbol, token.decimals), "test"),
                valueUsd: available("75", "test"),
              })),
            }
          : chain,
      ),
    };
    expect(card(cash, withCash)).toMatchObject({
      title: "Operating cash",
      subtitle: "0.025 ETH · $75.00 · Not available",
    });
    expect(
      manageSpineCard(cash, withCash, copy, {
        cashSharePct: { [model.hubChainId]: available("0.0075", "test") },
      }).subtitle,
    ).toBe("0.025 ETH · $75.00 · 0.0075%");
    expect(card(cash).subtitle).toBe("Not available");
  });

  // @rule R3
  it("shows the requested amount with its symbol and the reserved share on Idle output", () => {
    const output = node((n) => n.kind === "idleOutput");
    const withQueue: ManageModel = {
      ...model,
      withdrawal: {
        ...model.withdrawal,
        requested: available(amountOf("25000", "USDC", 6), "test"),
        coveragePct: available("40", "test"),
      },
    };
    expect(card(output, withQueue)).toMatchObject({
      title: "Idle output",
      subtitle: "25,000 USDC requested · 40% reserved",
    });
    expect(card(output).subtitle).toBe("Not available");
  });

  // @rule R3
  it("shows the income amount and its share of strategy value", () => {
    const income = node((n) => n.kind === "income");
    const withIncome: ManageModel = {
      ...model,
      income: { ...model.income, amount: available(amountOf("2450", "USDC", 6), "test") },
    };
    expect(card(income, withIncome)).toMatchObject({
      title: "Income (fees)",
      subtitle: "2,450 USDC · Not available",
    });
    expect(
      manageSpineCard(income, withIncome, copy, { incomeSharePct: available("0.245", "test") })
        .subtitle,
    ).toBe("2,450 USDC · 0.245%");
    expect(card(income).subtitle).toBe("Not available");
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
  it("keeps View mandate at the bottom of the aside, after the Explorer block, with no condition", () => {
    const screen = code("ManageScreen.tsx");
    const explorer = screen.indexOf("data-manage-explorer=");
    const mandate = screen.indexOf('t("viewMandate")');
    expect(explorer).toBeGreaterThan(0);
    expect(mandate).toBeGreaterThan(explorer);
    expect(screen).not.toContain("links.mandate");
  });
});

describe("Manage action timing", () => {
  // @rule R7
  it("never renders a When to apply selector for Move range or Create new position", () => {
    const panel = code("ManageBlockPanel.tsx");
    const range = body(panel, "RangeSettings");
    expect(range).not.toContain('t("whenToApply")');
    expect(range).not.toContain('type="radio"');
    // Move range shows "Apply now". Create new position shows "New deposits only".
    expect(range).toContain('t("applyNow")');
    expect(range).toContain('t("newDeposits")');
    // Supply keeps its selector.
    expect(body(panel, "SupplySettings")).toContain('t("whenToApply")');
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
        expect(value).not.toContain("\u2014");
      }
  });
});
