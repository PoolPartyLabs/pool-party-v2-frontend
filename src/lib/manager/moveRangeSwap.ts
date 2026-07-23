/**
 * @id PP-MGR (POO-437)
 * @name moveRangeSwap
 * @implements-rules-version v2
 *
 * Legacy (Arbitrum/Base) move-range swap sizing [R2]. Legacy networks have no swap-optimization
 * step, so the interface sizes the rebalance swap itself and hands the amounts to the simpler legacy
 * build (`buildMoveRangeTx_v0_5_0`, which re-derives the exact routing + slippage). Pure port of v1's
 * client-side `calcRatio` + `getNewPositionProportions`: given the position's current pooled supplies
 * and a NEW tick range, returns how much of each token to swap to reach the new range's target value
 * split. Only one direction is ever non-zero — the token the position is over-weight in.
 *
 * The ratio/proportion math runs in JS numbers exactly like v1 (these are estimates the backend
 * refines); only the final decimal→raw amounts are converted at full bigint precision, so an
 * 18-decimal full swap round-trips exactly.
 *
 * PP-NOTE: intentionally SDK-free — uses the raw client-safe `tickToPrice`, not `@uniswap/v3-sdk`,
 * so it stays a pure function. Its server action is the wallet-bound boundary.
 */
import { tickToPrice } from "@/lib/uniswap/tick";

/** Inputs to size a legacy move-range rebalance swap. */
export interface LegacyMoveRangeSwapInput {
  /** Current pooled token0, raw base units (`poolPartyPosition.totalSupply0`). */
  totalSupply0: string;
  /** Current pooled token1, raw base units (`poolPartyPosition.totalSupply1`). */
  totalSupply1: string;
  decimals0: number;
  decimals1: number;
  /** Current pool price, token1 per 1 token0 (same convention as {@link tickToPrice}). */
  currentPrice: number;
  /** The NEW (canonical, spacing-aligned) range. */
  tickLower: number;
  tickUpper: number;
}

/** The rebalance swap amounts, raw base units. At most one is non-zero. */
export interface LegacyMoveRangeSwapAmounts {
  /** token0 to swap into token1. */
  swapZeroForOneAmount: string;
  /** token1 to swap into token0. */
  swapOneForZeroAmount: string;
}

/**
 * The share of value (0–100) that should sit in token0 for a `[lower, upper]` range at the `current`
 * price. Port of v1 `calcRatio`: at/below the range → all token0 (100); at/above → all token1 (0);
 * in range → the Uniswap concentrated-liquidity split. All prices are token1-per-token0.
 */
function token0ValueRatio(current: number, lower: number, upper: number): number {
  if (!(current > lower)) return 100; // price at/below the range → all token0
  if (!(current < upper)) return 0; // price at/above the range → all token1
  const a = lower;
  const b = upper;
  const c = current;
  const ratio = (1 / ((Math.sqrt(a * b) - Math.sqrt(b * c)) / (c - Math.sqrt(b * c)) + 1)) * 100;
  return ratio >= 0 && ratio <= 100 ? ratio : 0;
}

/**
 * The desired pooled token amounts (human units) for the target value split, given the current
 * supplies + price. Port of v1 `getNewPositionProportions`.
 */
function targetPooledAmounts(
  supply0: number,
  supply1: number,
  price: number,
  ratio0: number,
): { token0: number; token1: number } {
  const ratio1 = 100 - ratio0;
  const totalValue = supply0 * price + supply1; // value in token1 units
  const desired0Value = totalValue * (ratio0 / (ratio0 + ratio1 || 1));
  const initial0Value = supply0 * price;
  if (desired0Value > initial0Value) {
    const needed0Value = desired0Value - initial0Value;
    return {
      token0: ratio0 === 0 ? 0 : supply0 + needed0Value / price,
      token1: ratio1 === 0 ? 0 : supply1 - needed0Value,
    };
  }
  const excess0Value = initial0Value - desired0Value;
  return {
    token0: ratio0 === 0 ? 0 : supply0 - excess0Value / price,
    token1: ratio1 === 0 ? 0 : supply1 + excess0Value,
  };
}

/** Convert a positive human amount to raw base units at `decimals`, at full precision. */
function toRawUnits(value: number, decimals: number): bigint {
  if (!Number.isFinite(value) || value <= 0) return BigInt(0);
  const fixed = value.toFixed(decimals); // exactly `decimals` fractional digits, fixed notation
  const [intPart, fracPart = ""] = fixed.split(".");
  return BigInt(intPart + fracPart.padEnd(decimals, "0").slice(0, decimals));
}

/** Parse a raw base-unit string to a bigint, tolerating malformed input (→ 0). */
function safeBigInt(raw: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    return BigInt(0);
  }
}

/** Raw base units → human number for the ratio math (precision-lossy, exactly like v1). */
function toHuman(raw: string, decimals: number): number {
  return Number(safeBigInt(raw)) / 10 ** decimals;
}

/**
 * Size the legacy move-range rebalance swap. The token the position is over-weight in (vs the new
 * range's target split) is swapped into the other; the other direction is `"0"`.
 */
export function computeLegacyMoveRangeSwap(
  input: LegacyMoveRangeSwapInput,
): LegacyMoveRangeSwapAmounts {
  const { totalSupply0, totalSupply1, decimals0, decimals1, currentPrice } = input;
  const lower = tickToPrice(input.tickLower, decimals0, decimals1);
  const upper = tickToPrice(input.tickUpper, decimals0, decimals1);

  const ratio0 = token0ValueRatio(currentPrice, lower, upper);
  const target = targetPooledAmounts(
    toHuman(totalSupply0, decimals0),
    toHuman(totalSupply1, decimals1),
    currentPrice,
    ratio0,
  );

  const supply0Raw = safeBigInt(totalSupply0);
  const supply1Raw = safeBigInt(totalSupply1);
  const pooled0Raw = toRawUnits(target.token0, decimals0);
  const pooled1Raw = toRawUnits(target.token1, decimals1);

  const swap0 = supply0Raw > pooled0Raw ? supply0Raw - pooled0Raw : BigInt(0);
  const swap1 = supply1Raw > pooled1Raw ? supply1Raw - pooled1Raw : BigInt(0);
  return {
    swapZeroForOneAmount: swap0.toString(),
    swapOneForZeroAmount: swap1.toString(),
  };
}
