/**
 * @id PP-CORE-LIB-022 (POO-483 / POO-498)
 * @name positionTokenSplit
 * @implements-rules-version v2
 *
 * Pure, client-safe VALUE split of a Uniswap v3 position's raw reserves into per-token shares and,
 * given a USD amount + the position's USD anchor, per-token amounts (POO-483 rules v2 R1, R6). A v3
 * burn returns the two tokens proportionally to the reserves, so a withdrawal of X USD is a fraction
 * f = X / poolValueUsd of each reserve; the value split is `share0 = r0*p / (r0*p + r1)` with
 * `p = tickToPrice(tickCurrent, decimals0, decimals1)` (token1 per token0). Same math family as
 * `range.ts` / the move-range swap sizing; raw math + viem only, no `@uniswap/v3-sdk` on the client.
 *
 * These are DISPLAY estimates on JS-number precision, NEVER signing amounts: the burn executes at
 * execution price under the user's slippage, so the on-chain result differs from this pre-flight
 * estimate. Degenerate inputs (any raw field missing/undefined, a non-finite tick/decimal, BOTH
 * reserves zero, a non-positive anchor, a negative amount) return null; callers degrade to a plain
 * USD total (POO-483 R4) and never fabricate rows.
 *
 * PP-INTEGRATION-POINT (POO-325): when the backend exposes the pool's reserve-in-USD and the
 * per-position per-token split, the backend-verified figures REPLACE this client-side estimate and
 * this lib stays as a cross-check.
 */
import { toTokenAmount } from "./amount";
import { tickToPrice } from "./tick";

/** Raw on-chain reserves + tick + decimals of a position (the POO-437 fields on `Position`). */
export interface PositionSplitInput {
  /** token0 reserve, raw base units (wei string). */
  totalSupply0?: string;
  /** token1 reserve, raw base units (wei string). */
  totalSupply1?: string;
  /** The pool's current tick. */
  tickCurrent?: number;
  /** token0 decimals. */
  decimals0?: number;
  /** token1 decimals. */
  decimals1?: number;
}

/** The value split of a position: human reserves, the current price, and each token's value share. */
export interface PositionSplit {
  /** token1 per 1 token0 at the current tick. */
  price: number;
  /** token0 reserve, human units. */
  reserve0: number;
  /** token1 reserve, human units. */
  reserve1: number;
  /** token0's fraction of the total value (share0 + share1 === 1). */
  share0: number;
  /** token1's fraction of the total value. */
  share1: number;
}

/** Per-token result of splitting a USD withdrawal across the position (amounts + estimated USD). */
export interface SplitUsdAmount {
  /** token0 amount, human units (= f * reserve0). */
  amount0: number;
  /** token1 amount, human units (= f * reserve1). */
  amount1: number;
  /** token0's estimated USD value (= share0 * clamped USD). */
  usd0: number;
  /** token1's estimated USD value (= share1 * clamped USD). */
  usd1: number;
}

/**
 * The value split of a position from its raw reserves + current tick. Returns null on any degenerate
 * input (see the file header). `share0 = r0*p / (r0*p + r1)`, `share1 = 1 - share0`.
 */
export function positionTokenSplit(input: PositionSplitInput): PositionSplit | null {
  const { totalSupply0, totalSupply1, tickCurrent, decimals0, decimals1 } = input;
  // Every raw field must be present — a lean read (missing the block) degrades to USD (R4).
  if (
    totalSupply0 == null ||
    totalSupply1 == null ||
    tickCurrent == null ||
    decimals0 == null ||
    decimals1 == null
  ) {
    return null;
  }
  // Guard non-finite numerics before they poison the price (NaN tick → NaN price → NaN shares).
  if (!Number.isFinite(tickCurrent) || !Number.isFinite(decimals0) || !Number.isFinite(decimals1)) {
    return null;
  }

  const reserve0 = toTokenAmount(totalSupply0, decimals0);
  const reserve1 = toTokenAmount(totalSupply1, decimals1);
  const price = tickToPrice(tickCurrent, decimals0, decimals1);
  if (!Number.isFinite(reserve0) || !Number.isFinite(reserve1) || !Number.isFinite(price)) {
    return null;
  }

  const value0 = reserve0 * price; // token0 value expressed in token1 units
  const value1 = reserve1;
  const totalValue = value0 + value1;
  // Both reserves zero (or a zero-value degenerate) → nothing to split.
  if (!(totalValue > 0)) return null;

  const share0 = value0 / totalValue;
  return { price, reserve0, reserve1, share0, share1: 1 - share0 };
}

/**
 * Split a USD withdrawal across a position's two tokens. `f = usdAmount / poolValueUsd`, CLAMPED at
 * 1 (POO-483 v2 R6: rounding drift between the position value and the anchor must never display more
 * than the position holds). Amounts are `f * reserve`, USD legs are `share * (f-scaled USD)`.
 * Returns null when the split is null, the anchor is non-positive, or the amount is negative.
 */
export function splitUsdAmount(
  split: PositionSplit | null,
  usdAmount: number,
  poolValueUsd: number,
): SplitUsdAmount | null {
  if (!split) return null;
  if (!(poolValueUsd > 0) || !(usdAmount >= 0)) return null;
  // Clamp the fraction: a full exit whose requested USD drifts above the anchor caps at the reserves.
  const f = Math.min(1, usdAmount / poolValueUsd);
  const clampedUsd = f * poolValueUsd;
  return {
    amount0: f * split.reserve0,
    amount1: f * split.reserve1,
    usd0: split.share0 * clampedUsd,
    usd1: split.share1 * clampedUsd,
  };
}
