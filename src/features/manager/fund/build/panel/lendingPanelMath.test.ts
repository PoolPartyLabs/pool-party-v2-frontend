/**
 * @id PP-MGR-LIB-080
 * @name lendingPanelMath tests
 * @implements-rules-version v1 (POO-2334 rules v1)
 * @analytics-events none, pure functions under test
 *
 * One test per rule of POO-2334 that has logic: the Borrow panel's collateral, options, amount
 * and Apply gate (R1 to R3), the health factor (R4), the liquidation price (R5), the status of the
 * Borrow kind (R7), the Swap · auto before a pool (R9), the Supply panel's APY and collateral note
 * (R10), and the copy in 11 locales (R13). R6 is the mock seam, which is a marked constant in the
 * panel. R11 is `planReducers.test.ts` ("takes a Supply's Swap · auto and the Borrow under it").
 */
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
import { BLOCK_KIND_STATUS, type PositionBlock } from "../plan/buildPlan";
import { findBlock } from "../plan/planDerive";
import { needsAutoSwap } from "../plan/planRules";
import {
  hubPoolPlan,
  hubSupplyPlan,
  makeTestDraft,
  supplyBorrowPlan,
  TEST_ASSET_KEYS,
} from "../plan/planTestKit";
import {
  BORROW_DEFAULT_PCT,
  type BorrowMarket,
  type BorrowMarketAsset,
  borrowAmount,
  borrowApplyBlocker,
  borrowCeilingPct,
  borrowCollateral,
  borrowConfigWith,
  borrowOptions,
  borrowRisk,
  clampBorrowPct,
  dropToLiquidationPct,
  hasBorrowBelow,
  healthFactor,
  healthTone,
  liquidationPriceUsd,
  parentSupplyOf,
  readBorrowPct,
  supplyApyValue,
} from "./lendingPanelMath";

/** The Figma frame's market: WETH at 3,050, Aave lends up to 80%, liquidation at 82.5%. */
const MARKET: BorrowMarket = {
  WETH: {
    symbol: "WETH",
    priceUsd: 3050,
    borrowApyPct: 2.1,
    maxLtvPct: 80,
    liquidationThresholdPct: 82.5,
  },
  USDC: {
    symbol: "USDC",
    priceUsd: 1,
    borrowApyPct: 5.6,
    maxLtvPct: 75,
    liquidationThresholdPct: 78,
  },
};

describe("borrowCollateral (R1)", () => {
  it("reads the Supply above the Borrow: its token, amount and USD value", () => {
    // @rule R1
    const plan = supplyBorrowPlan();
    const draft = makeTestDraft();
    const supply = parentSupplyOf(plan, "hub-aave-borrow");
    expect(supply?.id).toBe("hub-aave-supply");
    const collateral = borrowCollateral(plan, draft, "hub-aave-borrow", MARKET, 100_000);
    expect(collateral).toMatchObject({
      assetKey: TEST_ASSET_KEYS.wethArbitrum,
      symbol: "WETH",
      usd: 50_000,
    });
    expect(collateral?.amount).toBeCloseTo(50_000 / 3050, 6);
    expect(parentSupplyOf(hubSupplyPlan(), "hub-supply-supply")).toBeNull();
    expect(borrowCollateral(hubPoolPlan(), draft, "hub-pool-pool", MARKET, 100_000)).toBeNull();
  });
});

describe("borrowOptions (R2)", () => {
  it("lists the mandate tokens of the network but the collateral, each with its borrow APY", () => {
    // @rule R2
    const options = borrowOptions(
      makeTestDraft().tokens,
      "arbitrum",
      TEST_ASSET_KEYS.wethArbitrum,
      MARKET,
    );
    expect(options).toEqual([
      { assetKey: TEST_ASSET_KEYS.usdcArbitrum, symbol: "USDC", apyPct: 5.6, priceUsd: 1 },
    ]);
    const noMarket = borrowOptions(makeTestDraft().tokens, "arbitrum", null, {});
    expect(noMarket.map((row) => row.apyPct)).toEqual([null, null]);
  });
});

describe("borrow amount (R3)", () => {
  it("runs from 0 to the max LTV, reads a stored share within it, and gives the amount", () => {
    // @rule R3
    expect(borrowCeilingPct(80)).toBe(80);
    expect(borrowCeilingPct(77.5)).toBe(77);
    expect(borrowCeilingPct(140)).toBe(100);
    expect(clampBorrowPct(43, 80)).toBe(43);
    expect(clampBorrowPct(95, 80)).toBe(80);
    expect(clampBorrowPct(-5, 80)).toBe(0);
    expect(clampBorrowPct(Number.NaN, 80)).toBe(0);
    // The default share over a low max LTV: the slider, the risk rows and Apply read the same value.
    const lowLtv: BorrowMarketAsset = { ...(MARKET.WETH as BorrowMarketAsset), maxLtvPct: 33 };
    const read = readBorrowPct(BORROW_DEFAULT_PCT, lowLtv);
    expect(read).toBe(33);
    expect(borrowRisk(lowLtv, read)).toMatchObject({ ceilingPct: 33, atLimit: true });
    const option = { assetKey: "a", symbol: "USDC", apyPct: 5.6, priceUsd: 1 };
    expect(
      borrowApplyBlocker({ collateral: true, option, borrowPct: read, ceilingPct: 33 }),
    ).toBeNull();
    expect(readBorrowPct(45, MARKET.WETH ?? null)).toBe(45);
    expect(readBorrowPct(undefined, MARKET.WETH ?? null)).toBe(0);
    expect(readBorrowPct(45, null)).toBe(45);
    expect(borrowAmount(50_000, 40, 1)).toEqual({ usd: 20_000, amount: 20_000 });
    expect(borrowAmount(50_000, 40, 0)).toEqual({ usd: 20_000, amount: null });
  });
});

describe("a Borrow config the panel writes (R3)", () => {
  it("carries the share that the panel reads within the max LTV, whatever field changes", () => {
    // @rule R3
    const wbtc: BorrowMarketAsset = { ...(MARKET.WETH as BorrowMarketAsset), maxLtvPct: 73 };
    // Supply WETH (80), Borrow at 80%, then the Supply takes WBTC (73): the panel reads 73.
    const stored = { assetKey: "usdc", borrowPct: 80 };
    expect(borrowConfigWith(stored, { assetKey: "dai" }, wbtc)).toEqual({
      assetKey: "dai",
      borrowPct: 73,
    });
    expect(borrowConfigWith(stored, { borrowPct: 50 }, wbtc)).toEqual({
      assetKey: "usdc",
      borrowPct: 50,
    });
    expect(borrowConfigWith(stored, { borrowPct: 99 }, wbtc).borrowPct).toBe(73);
    expect(borrowConfigWith({ assetKey: "usdc" }, { assetKey: "dai" }, wbtc).borrowPct).toBe(0);
    expect(borrowConfigWith(stored, { assetKey: "dai" }, null)).toEqual({
      assetKey: "dai",
      borrowPct: 80,
    });
    expect(stored).toEqual({ assetKey: "usdc", borrowPct: 80 });
  });
});

describe("health factor (R4)", () => {
  it("is the liquidation threshold over the borrowed share, with three tones", () => {
    // @rule R4
    expect(healthFactor(45, 82.5)).toBeCloseTo(1.833, 3);
    expect(healthFactor(80, 82.5)).toBeCloseTo(1.031, 3);
    expect(healthFactor(0, 82.5)).toBeNull();
    expect(healthTone(null)).toBe("success");
    expect(healthTone(1.5)).toBe("success");
    expect(healthTone(1.49)).toBe("warning");
    expect(healthTone(1.1)).toBe("warning");
    expect(healthTone(1.09)).toBe("destructive");
  });
});

describe("liquidation price (R5)", () => {
  it("gives the price of the collateral at liquidation and the drop to it", () => {
    // @rule R5
    expect(liquidationPriceUsd(3050, 80, 82.5)).toBeCloseTo(2957.58, 2);
    expect(liquidationPriceUsd(3050, 45, 82.5)).toBeCloseTo(1663.64, 2);
    expect(liquidationPriceUsd(3050, 0, 82.5)).toBeNull();
    expect(dropToLiquidationPct(80, 82.5)).toBeCloseTo(3.03, 2);
    expect(dropToLiquidationPct(0, 82.5)).toBeNull();
    const risk = borrowRisk(MARKET.WETH ?? null, 80);
    expect(risk).toMatchObject({ ceilingPct: 80, atLimit: true, tone: "destructive" });
    expect(borrowRisk(MARKET.WETH ?? null, 45)).toMatchObject({ atLimit: false, tone: "success" });
    expect(borrowRisk(null, 45)).toBeNull();
  });
});

describe("borrowApplyBlocker (R3)", () => {
  it("holds Apply without a collateral, a market rate for the asset, or an amount in the limit", () => {
    // @rule R3
    const option = { assetKey: "a", symbol: "USDC", apyPct: 5.6, priceUsd: 1 };
    expect(borrowApplyBlocker({ collateral: false, option, borrowPct: 40, ceilingPct: 80 })).toBe(
      "needSupply",
    );
    expect(
      borrowApplyBlocker({ collateral: true, option: null, borrowPct: 40, ceilingPct: 80 }),
    ).toBe("unavailable");
    expect(
      borrowApplyBlocker({
        collateral: true,
        option: { ...option, apyPct: null },
        borrowPct: 40,
        ceilingPct: 80,
      }),
    ).toBe("unavailable");
    expect(borrowApplyBlocker({ collateral: true, option, borrowPct: 0, ceilingPct: 80 })).toBe(
      "needAmount",
    );
    expect(borrowApplyBlocker({ collateral: true, option, borrowPct: 85, ceilingPct: 80 })).toBe(
      "overLimit",
    );
    expect(
      borrowApplyBlocker({ collateral: true, option, borrowPct: 40, ceilingPct: 80 }),
    ).toBeNull();
  });
});

describe("the Borrow kind status (R7)", () => {
  it("keeps aaveBorrow enabled in BLOCK_KIND_STATUS", () => {
    // @rule R7
    expect(BLOCK_KIND_STATUS.aaveBorrow).toBe("enabled");
  });
});

describe("the Uniswap panel's swap (R9)", () => {
  it("puts a Swap · auto before a pool for USDC too, so Max slippage always shows", () => {
    // @rule R9
    const found = findBlock(hubPoolPlan(), "hub-pool-pool");
    const pool = found?.block as PositionBlock;
    expect(needsAutoSwap(pool, TEST_ASSET_KEYS.usdcArbitrum)).toBe(true);
    expect(needsAutoSwap(pool, TEST_ASSET_KEYS.wethArbitrum)).toBe(true);
    expect(found?.chain.steps[0]).toMatchObject({ kind: "swap", auto: true });
  });
});

describe("the Supply panel (R10)", () => {
  it("reads the catalog's supply APY, and shows the collateral note over a Borrow", () => {
    // @rule R10
    expect(supplyApyValue("4.12")).toBe(4.12);
    expect(supplyApyValue("0")).toBe(0);
    expect(supplyApyValue("")).toBeNull();
    expect(supplyApyValue("-1")).toBeNull();
    expect(supplyApyValue("n/a")).toBeNull();
    expect(hasBorrowBelow(supplyBorrowPlan(), "hub-aave-supply")).toBe(true);
    expect(hasBorrowBelow(hubSupplyPlan(), "hub-supply-supply")).toBe(false);
    expect(hasBorrowBelow(supplyBorrowPlan(), "missing")).toBe(false);
  });
});

/** The leaf keys of a copy object, as dotted paths. */
function leafKeys(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return [prefix];
  return Object.entries(node).flatMap(([key, value]) =>
    leafKeys(value, prefix ? `${prefix}.${key}` : key),
  );
}

/** Every locale's manager copy, as the JSON files hold it. */
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

describe("the panel copy (R13)", () => {
  it("has the Borrow panel and the collateral note in every locale, with no em dash", () => {
    // @rule R13
    const read = (locale: string) => MESSAGES[locale]?.fundBuilder.build;
    const english = read("en");
    const englishKeys = leafKeys(english?.borrowPanel).sort();
    for (const locale of locales) {
      const build = read(locale);
      expect(build, locale).toBeDefined();
      expect(leafKeys(build?.borrowPanel).sort(), locale).toEqual(englishKeys);
      const values = [
        ...englishKeys.map((key) =>
          key
            .split(".")
            .reduce<unknown>(
              (node, part) => (node as Record<string, unknown> | undefined)?.[part],
              build?.borrowPanel,
            ),
        ),
        build?.supplyPanel.collateralNote,
      ];
      for (const value of values) {
        expect(typeof value === "string" && value.trim() !== "", locale).toBe(true);
        expect(value, locale).not.toContain("\u2014");
      }
    }
  });
});
