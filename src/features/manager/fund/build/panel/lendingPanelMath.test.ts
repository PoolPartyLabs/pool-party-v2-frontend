/**
 * @id PP-MGR-LIB-080
 * @name lendingPanelMath tests
 * @implements-rules-version v1 (POO-2334 rules v1)
 * @analytics-events none, pure functions under test
 *
 * One test per rule of POO-2334 that has logic: the Borrow panel's collateral, options, amount,
 * health factor, liquidation price and Apply gate (R1 to R6), the Swap · auto before a pool (R9)
 * and the Supply panel's APY and collateral note (R10), and the copy in 11 locales (R13). R7 is a
 * constant of `BLOCK_KIND_STATUS`,
 * and R11 is `planReducers.test.ts` ("takes a Supply's Swap · auto and the Borrow under it").
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import type { PositionBlock } from "../plan/buildPlan";
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

describe("borrowApplyBlocker (R6)", () => {
  it("holds Apply without a collateral, a market rate for the asset, or an amount in the limit", () => {
    // @rule R6
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

describe("the panel copy (R13)", () => {
  it("has the Borrow panel and the collateral note in all 11 locales, with no em dash", () => {
    // @rule R13
    const read = (locale: string) =>
      JSON.parse(
        readFileSync(
          join(process.cwd(), "src", "i18n", "messages", locale, "manager.json"),
          "utf8",
        ),
      ).fundBuilder.build;
    const english = read("en");
    const englishKeys = leafKeys(english.borrowPanel).sort();
    expect(locales).toHaveLength(11);
    for (const locale of locales) {
      const build = read(locale);
      expect(leafKeys(build.borrowPanel).sort(), locale).toEqual(englishKeys);
      const values = [
        ...englishKeys.map((key) =>
          key.split(".").reduce((node, part) => node?.[part], build.borrowPanel),
        ),
        build.supplyPanel.collateralNote,
      ];
      for (const value of values) {
        expect(typeof value === "string" && value.trim() !== "", locale).toBe(true);
        expect(value, locale).not.toContain("\u2014");
      }
    }
  });
});
