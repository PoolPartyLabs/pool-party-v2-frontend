/**
 * @id PP-MGR-LIB-080
 * @name lendingPanelMath tests
 * @implements-rules-version v1 (POO-2334 rules v1)
 * @analytics-events none, pure functions under test
 *
 * One test per rule of POO-2334 that has logic: the Borrow panel's collateral, options, amount,
 * health factor and liquidation price (R1 to R6), and the pins for the Borrow status, the Swap ·
 * auto before a pool, the Supply APY and the Supply remove cascade (R7, R9 to R12).
 */
import { describe, expect, it } from "vitest";
import { BORROW_MARKET_FIXTURES, MOCK_FUND_CAPITAL_USD } from "@/mocks/data/borrowMarketFixtures";
import { BLOCK_KIND_STATUS, isPlanBlocked, type PositionBlock } from "../plan/buildPlan";
import { findBlock } from "../plan/planDerive";
import { removeBlock } from "../plan/planReducers";
import { needsAutoSwap } from "../plan/planRules";
import {
  hubPoolPlan,
  hubSupplyPlan,
  makeTestContext,
  makeTestDraft,
  supplyBorrowPlan,
  TEST_ASSET_KEYS,
} from "../plan/planTestKit";
import {
  BORROW_STEP_PCT,
  type BorrowMarket,
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
  it("runs from 0 to the max LTV in steps of 5, and gives the amount in token and USD", () => {
    // @rule R3
    expect(BORROW_STEP_PCT).toBe(5);
    expect(borrowCeilingPct(80)).toBe(80);
    expect(borrowCeilingPct(77.5)).toBe(77);
    expect(borrowCeilingPct(140)).toBe(100);
    expect(clampBorrowPct(43, 80)).toBe(45);
    expect(clampBorrowPct(95, 80)).toBe(80);
    expect(clampBorrowPct(-5, 80)).toBe(0);
    expect(clampBorrowPct(Number.NaN, 80)).toBe(0);
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

describe("the mock market (R6)", () => {
  it("holds plausible Aave figures for every asset the panel reads", () => {
    // @rule R6
    expect(MOCK_FUND_CAPITAL_USD).toBeGreaterThan(0);
    for (const asset of Object.values(BORROW_MARKET_FIXTURES)) {
      expect(asset.priceUsd).toBeGreaterThan(0);
      expect(asset.maxLtvPct).toBeGreaterThanOrEqual(0);
      expect(asset.liquidationThresholdPct).toBeGreaterThanOrEqual(asset.maxLtvPct);
      expect(asset.liquidationThresholdPct).toBeLessThan(100);
      if (asset.borrowApyPct !== null) {
        expect(asset.borrowApyPct).toBeGreaterThan(0);
        expect(asset.borrowApyPct).toBeLessThan(40);
      }
    }
    expect(BORROW_MARKET_FIXTURES.WETH?.maxLtvPct).toBe(80);
    expect(BORROW_MARKET_FIXTURES.USDC?.borrowApyPct).toBe(5.6);
  });
});

describe("the Borrow status (R7)", () => {
  it("keeps Aave v3 Borrow enabled", () => {
    // @rule R7
    expect(BLOCK_KIND_STATUS.aaveBorrow).toBe("enabled");
  });
});

describe("borrowApplyBlocker (R3, R6)", () => {
  it("holds Apply without a collateral, an asset with a rate, or an amount over 0", () => {
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

describe("the Uniswap panel's swap (R9)", () => {
  it("always puts a Swap · auto before a pool, whatever token arrives", () => {
    // @rule R9
    const found = findBlock(hubPoolPlan(), "hub-pool-pool");
    const pool = found?.block as PositionBlock;
    expect(needsAutoSwap(pool, TEST_ASSET_KEYS.usdcArbitrum)).toBe(true);
    expect(needsAutoSwap(pool, TEST_ASSET_KEYS.wethArbitrum)).toBe(true);
    expect(found?.chain.steps[0]).toMatchObject({ kind: "swap", auto: true });
  });
});

describe("supplyApyValue (R10)", () => {
  it("reads the catalog's supply APY, and refuses an empty or negative one", () => {
    // @rule R10
    expect(supplyApyValue("4.12")).toBe(4.12);
    expect(supplyApyValue("0")).toBe(0);
    expect(supplyApyValue("")).toBeNull();
    expect(supplyApyValue("-1")).toBeNull();
    expect(supplyApyValue("n/a")).toBeNull();
  });
});

describe("removing a Supply (R11)", () => {
  it("removes the Borrow under it too", () => {
    // @rule R11
    const after = removeBlock(supplyBorrowPlan(), makeTestContext(), "hub-aave-supply");
    if (isPlanBlocked(after)) throw new Error("refused");
    const ids = after.hub.chains.flatMap((chain) => chain.steps.map((step) => step.id));
    expect(ids).not.toContain("hub-aave-supply");
    expect(ids).not.toContain("hub-aave-borrow");
  });
});

describe("hasBorrowBelow (R12)", () => {
  it("tells the Supply panel when its asset is a Borrow's collateral", () => {
    // @rule R12
    expect(hasBorrowBelow(supplyBorrowPlan(), "hub-aave-supply")).toBe(true);
    expect(hasBorrowBelow(hubSupplyPlan(), "hub-supply-supply")).toBe(false);
    expect(hasBorrowBelow(supplyBorrowPlan(), "missing")).toBe(false);
  });
});
