/**
 * @id PP-STR-LIB-016 (POO-897)
 * @name compositionSplit
 * @implements-rules-version v1
 *
 * The Composition card's per-token proportion for a strategy's single Uniswap v3 pool position
 * (POO-897), shared by all three Strategy Details variants. Pure degrade chain, never fabricated:
 *
 * [R2] The split is the pool position's value split at the current tick ({@link positionTokenSplit},
 *      PP-CORE-LIB-022): an investor's own split equals the pool split (proportional share), so the
 *      invested `Position` reserve block and the strategy's `onchain` block agree for the same
 *      strategy at the same time.
 * [R4] Reserves resolve null -> range-math split from the tick bounds ({@link tokenSplit}) when
 *      available -> `null` (the card keeps today's single "Liquidity pool 100%" row).
 * [R5] A zero-liquidity pool (both reserves zero) shows the split a NEW deposit would resolve into:
 *      `positionTokenSplit` nulls on 0/0 and the chain falls through to the range math.
 * [R7] Display-only estimates on JS-number precision: nothing here feeds a signing amount.
 *
 * The range math runs on RAW tick prices (`1.0001^tick`): the value ratio is scale-invariant, so the
 * decimals factor cancels and no token metadata is needed for the tick fallback (the v1 `/pools`
 * path, which serves ticks only).
 */
import { type TokenSplit, tokenSplit } from "@/features/manager/lib/rangeMath";
import type { Position, Strategy } from "@/lib/schemas";
import { positionTokenSplit } from "@/lib/uniswap/positionSplit";

/** Base of the Uniswap v3 tick→price exponent (see `lib/uniswap/tick.ts`). */
const TICK_BASE = 1.0001;

/**
 * Range-math value split from the position's ticks ([R4]/[R5]): the split a deposit at the current
 * tick resolves into. Returns `null` on missing, non-finite, or non-positive-width ticks: NEVER the
 * 50/50 degenerate fallback `tokenSplit` keeps for the builder UI (that would fabricate a split).
 */
export function tokenSplitFromTicks(
  tickLower: number | undefined,
  tickUpper: number | undefined,
  tickCurrent: number | undefined,
): TokenSplit | null {
  if (tickLower == null || tickUpper == null || tickCurrent == null) return null;
  if (!Number.isFinite(tickLower) || !Number.isFinite(tickUpper) || !Number.isFinite(tickCurrent)) {
    return null;
  }
  if (!(tickUpper > tickLower)) return null;
  // Raw prices (token1 base units per token0 base unit); the guards above rule out every degenerate
  // input, so tokenSplit's 50/50 fallback is unreachable from here.
  return tokenSplit(TICK_BASE ** tickCurrent, TICK_BASE ** tickLower, TICK_BASE ** tickUpper);
}

/** A reserve value split as integer-domain percentages (0-100), token0 first. */
function toPercents(share0: number, share1: number): TokenSplit {
  return { pct0: share0 * 100, pct1: share1 * 100 };
}

/**
 * The Composition per-token split for a strategy, resolved through the [R4] degrade chain:
 * the invested position's reserve block -> the strategy's `onchain` reserve block -> range math from
 * the `onchain` ticks -> `null` (the caller renders the single "Liquidity pool 100%" row).
 */
export function strategyCompositionSplit(
  strategy: Strategy,
  position: Position | null,
): TokenSplit | null {
  // [R2] Invested: the position carries its own copy of the pool reserve block (POO-437 fields).
  if (position) {
    const positionSplit = positionTokenSplit(position);
    if (positionSplit) return toPercents(positionSplit.share0, positionSplit.share1);
  }
  const onchain = strategy.onchain;
  if (!onchain) return null;
  // [R2] Non-invested: the pool's reserves at the current tick (same split as any position in it).
  const poolSplit = positionTokenSplit(onchain);
  if (poolSplit) return toPercents(poolSplit.share0, poolSplit.share1);
  // [R4]/[R5] Reserves missing or zero-liquidity: the split a new deposit would resolve into.
  return tokenSplitFromTicks(onchain.tickLower, onchain.tickUpper, onchain.tickCurrent);
}
