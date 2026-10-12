/**
 * @id PP-MGR-LIB-080
 * @name lendingPanelMath
 * @implements-rules-version v1 (POO-2334 rules v1)
 * @analytics-events none, pure functions: they read a plan and market figures and emit nothing.
 *
 * The decisions of the Aave v3 Build panels (POO-2334), kept out of the components so each rule has
 * an isolated test:
 *
 * - [R1] The Borrow's collateral is the configured Supply directly above it (an app-owned Swap ·
 *   auto in between is skipped). Its USD value is the chain's share of the fund capital.
 * - [R2] The borrow options are the mandate tokens of the block's network, the collateral excluded,
 *   each with its borrow APY (null when the market does not lend it).
 * - [R3] The borrow amount is a % of the collateral value, from 0 to the max LTV, in steps of 5.
 * - [R4] Health factor = liquidation threshold / borrowed share. 1.5 or more is success, 1.1 to
 *   under 1.5 is warning, under 1.1 is destructive.
 * - [R5] Liquidation price = collateral price x borrowed share / liquidation threshold. The drop to
 *   it is 1 - borrowed share / liquidation threshold.
 * - [R10] The Supply APY is the catalog's string, read as a number when it is one and not negative.
 * - [R12] A Supply with a Borrow directly under it is that Borrow's collateral.
 *
 * Why the formulas live here: `manage/manageLendingRisk.ts` (PP-MGR-LIB-068) supplies risk figures
 * from a full account read and calculates none ("no protocol risk formula is assumed"). A Build
 * block has no account yet, so this module estimates the single-collateral, single-debt case from
 * market figures, with a constant price for the borrowed asset. The real account read stays with
 * the Lending risk block (PP-MGR-CMP-094).
 */
import type { MandateTokenRef, NetworkId } from "../../mandateDraft";
import { tokenKey } from "../../mandateDraft";
import type { BuildPlan, PositionBlock } from "../plan/buildPlan";
import { findBlock } from "../plan/planDerive";

/** The market figures of one asset (PP-INTEGRATION-POINT: the mock is PP-MGR-MCK-006). */
export interface BorrowMarketAsset {
  symbol: string;
  priceUsd: number;
  /** Variable borrow APY in percent; null when the market does not lend this asset. */
  borrowApyPct: number | null;
  /** The highest borrowed share of this asset's value as a collateral, in percent. */
  maxLtvPct: number;
  /** The borrowed share at which this collateral is liquidated, in percent. */
  liquidationThresholdPct: number;
}

/** The market, keyed by the uppercase token symbol. */
export type BorrowMarket = Readonly<Record<string, BorrowMarketAsset>>;

/** One step of the borrow amount slider, in percent (the Figma track, as the Allocation's). */
export const BORROW_STEP_PCT = 5;

/** The borrowed share that `Use` writes: a health factor near 2 at an 82.5% threshold. */
export const BORROW_DEFAULT_PCT = 40;

/** The three colors of a health factor (R4). */
export type HealthTone = "success" | "warning" | "destructive";

/** The market asset of a token symbol, or null. */
export function marketAsset(market: BorrowMarket, symbol: string): BorrowMarketAsset | null {
  return market[symbol.toUpperCase()] ?? null;
}

/** R4: the health factor for a borrowed share; null with no debt (no liquidation). */
export function healthFactor(borrowPct: number, liquidationThresholdPct: number): number | null {
  if (!(borrowPct > 0)) return null;
  return liquidationThresholdPct / borrowPct;
}

/** R4: the tone of a health factor. No debt is safe. */
export function healthTone(value: number | null): HealthTone {
  if (value === null || value >= 1.5) return "success";
  if (value >= 1.1) return "warning";
  return "destructive";
}

/** R5: the collateral price at which the position is liquidated; null with no debt. */
export function liquidationPriceUsd(
  collateralPriceUsd: number,
  borrowPct: number,
  liquidationThresholdPct: number,
): number | null {
  if (!(borrowPct > 0) || !(liquidationThresholdPct > 0)) return null;
  return (collateralPriceUsd * borrowPct) / liquidationThresholdPct;
}

/** R5: how far the collateral price may fall before liquidation, in percent; null with no debt. */
export function dropToLiquidationPct(
  borrowPct: number,
  liquidationThresholdPct: number,
): number | null {
  if (!(borrowPct > 0) || !(liquidationThresholdPct > 0)) return null;
  return (1 - borrowPct / liquidationThresholdPct) * 100;
}

/** R3: the slider's ceiling, a whole percent from 0 to 100. */
export function borrowCeilingPct(maxLtvPct: number): number {
  if (!Number.isFinite(maxLtvPct)) return 0;
  return Math.min(100, Math.max(0, Math.floor(maxLtvPct)));
}

/** R3: a share snapped to a step and held between 0 and the ceiling (a stop of its own). */
export function clampBorrowPct(pct: number, ceilingPct: number): number {
  if (!Number.isFinite(pct)) return 0;
  const snapped = Math.round(pct / BORROW_STEP_PCT) * BORROW_STEP_PCT;
  return Math.min(ceilingPct, Math.max(0, snapped));
}

/** R3: the borrowed value in USD, and in the borrowed token (null without a price). */
export function borrowAmount(
  collateralUsd: number,
  borrowPct: number,
  borrowPriceUsd: number,
): { usd: number; amount: number | null } {
  const usd = (collateralUsd * borrowPct) / 100;
  return { usd, amount: borrowPriceUsd > 0 ? usd / borrowPriceUsd : null };
}

/** R4, R5: what the risk block shows for a collateral and a share; null without market data. */
export function borrowRisk(collateral: BorrowMarketAsset | null, borrowPct: number) {
  if (!collateral) return null;
  const ceilingPct = borrowCeilingPct(collateral.maxLtvPct);
  const factor = healthFactor(borrowPct, collateral.liquidationThresholdPct);
  return {
    ceilingPct,
    atLimit: ceilingPct > 0 && borrowPct >= ceilingPct,
    healthFactor: factor,
    tone: healthTone(factor),
    liquidationPriceUsd: liquidationPriceUsd(
      collateral.priceUsd,
      borrowPct,
      collateral.liquidationThresholdPct,
    ),
    dropPct: dropToLiquidationPct(borrowPct, collateral.liquidationThresholdPct),
  };
}

/** R1: the configured Aave Supply directly above a Borrow, skipping an app-owned step; or null. */
export function parentSupplyOf(plan: BuildPlan, blockId: string): PositionBlock | null {
  const found = findBlock(plan, blockId);
  if (found?.block.family !== "position" || found.block.kind !== "aaveBorrow") return null;
  for (let i = found.index - 1; i >= 0; i -= 1) {
    const step = found.chain.steps[i];
    if (!step || (step.family === "flow" && step.auto)) continue;
    return step.family === "position" && step.kind === "aaveSupply" ? step : null;
  }
  return null;
}

/** R12: whether a Borrow sits directly under this Supply (so the Supply is its collateral). */
export function hasBorrowBelow(plan: BuildPlan, supplyId: string): boolean {
  const found = findBlock(plan, supplyId);
  const below = found?.chain.steps[found.index + 1];
  return below?.family === "position" && below.kind === "aaveBorrow";
}

/** R1: the read-only collateral of a Borrow: token, amount and USD value. */
export interface BorrowCollateral {
  assetKey: string;
  symbol: string;
  usd: number;
  /** Null when the market has no price for the token. */
  amount: number | null;
  market: BorrowMarketAsset | null;
}

/** R1: the collateral of a Borrow, from the Supply above it and the chain's share of the capital. */
export function borrowCollateral(
  plan: BuildPlan,
  draft: { tokens: readonly MandateTokenRef[] },
  blockId: string,
  market: BorrowMarket,
  capitalUsd: number,
): BorrowCollateral | null {
  const supply = parentSupplyOf(plan, blockId);
  const found = findBlock(plan, blockId);
  if (!supply?.config || !found || !("assetKey" in supply.config)) return null;
  const assetKey = supply.config.assetKey.toLowerCase();
  const token = draft.tokens.find((row) => tokenKey(row) === assetKey);
  const symbol = token?.symbol ?? "";
  const asset = symbol ? marketAsset(market, symbol) : null;
  const usd = (capitalUsd * found.chain.sharePct) / 100;
  return {
    assetKey,
    symbol,
    usd,
    amount: asset && asset.priceUsd > 0 ? usd / asset.priceUsd : null,
    market: asset,
  };
}

/** R2: one borrow option. */
export interface BorrowOption {
  assetKey: string;
  symbol: string;
  /** Null: the market does not lend it (the option is disabled with a reason). */
  apyPct: number | null;
  priceUsd: number | null;
}

/** R2: the mandate tokens of the network, the collateral excluded, with their borrow APY. */
export function borrowOptions(
  tokens: readonly MandateTokenRef[],
  network: NetworkId,
  collateralKey: string | null,
  market: BorrowMarket,
): BorrowOption[] {
  const excluded = collateralKey?.toLowerCase() ?? null;
  return tokens
    .filter((token) => token.network === network && tokenKey(token) !== excluded)
    .map((token) => {
      const asset = marketAsset(market, token.symbol);
      return {
        assetKey: tokenKey(token),
        symbol: token.symbol,
        apyPct: asset?.borrowApyPct ?? null,
        priceUsd: asset ? asset.priceUsd : null,
      };
    });
}

/** Why Apply changes is held on a Borrow; null when it may run. */
export type BorrowApplyBlocker = "needSupply" | "unavailable" | "needAmount" | "overLimit";

/** R3, R6: Apply needs a collateral, a lendable asset, and a share over 0 within the max LTV. */
export function borrowApplyBlocker(input: {
  collateral: boolean;
  option: BorrowOption | null;
  borrowPct: number;
  ceilingPct: number;
}): BorrowApplyBlocker | null {
  if (!input.collateral) return "needSupply";
  if (!input.option || input.option.apyPct === null) return "unavailable";
  if (!(input.borrowPct > 0)) return "needAmount";
  if (input.borrowPct > input.ceilingPct) return "overLimit";
  return null;
}

/** R10: the catalog's supply APY as a number, or null when it is empty, not a number or negative. */
export function supplyApyValue(supplyApy: string): number | null {
  if (supplyApy.trim() === "") return null;
  const rate = Number(supplyApy);
  return Number.isFinite(rate) && rate >= 0 ? rate : null;
}
