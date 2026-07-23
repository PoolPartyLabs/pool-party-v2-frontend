/**
 * @id PP-MGR-SCR-002 (POO-309, POO-878)
 * @name seedAmounts
 * @implements-rules-version v1
 * POO-497 rules v1: the no-price seed heuristic (`seedTokensWhenPriceUnknown`) is retired — no-price
 * pools are filtered out of the picker, so the seed step always runs with a known market price.
 * POO-878 rules v1: the wrapped-native (WETH/WPOL) leg can be funded from native msg.value OR the
 * ERC-20 wrapped token via Permit2. These helpers pick the source (default native, auto-switch to the
 * wrapped ERC-20 when native alone can't cover the amount but the wrapped balance can), resolve the
 * selected source's balance for display + validation, and decide when the leg is fully exhausted.
 *
 * Pure helpers for the create-pool seed-liquidity inputs: parse a decimal string into raw token
 * units (wei) for the token's decimals, format a raw balance back for display / "Max", and validate
 * a seed amount against the wallet balance. Kept pure (no React, no RPC) so the validation is
 * unit-tested independently of the card that renders it.
 */
import { formatUnits, parseUnits } from "viem";

/**
 * Funding source for the pool's wrapped-native leg (WETH/WPOL), threaded to the API build so the
 * transaction's `value` matches: `"native"` sends the native coin as `msg.value`, `"erc20"` pulls the
 * wrapped token via Permit2 (`tx.value = 0`). Mirrors the API's `wrappedNativeFunding` field.
 */
export type WrappedNativeFunding = "native" | "erc20";

/**
 * Parse a user-typed decimal string into raw token units for `decimals`.
 *
 * @returns The amount in wei, or `null` when the input is empty, non-numeric, or not greater than 0.
 */
export function parseSeedAmount(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  // Reject anything that isn't a plain decimal (parseUnits is lenient about some shapes).
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === ".") return null;
  try {
    const wei = parseUnits(trimmed, decimals);
    return wei > BigInt(0) ? wei : null;
  } catch {
    return null;
  }
}

/** Format a raw token balance for display / seeding the "Max" input (no thousands separators). */
export function formatTokenAmount(raw: bigint, decimals: number): string {
  return formatUnits(raw, decimals);
}

/** A seed amount is valid when it parses to a positive value within the wallet balance. */
export function seedValid(amount: bigint | null, balanceRaw: bigint): boolean {
  return amount !== null && amount > BigInt(0) && amount <= balanceRaw;
}

/**
 * Auto-select the wrapped-native funding source (POO-878 [R3]): default `"native"`; switch to the
 * wrapped ERC-20 only when native alone can't cover `amount` but the wrapped balance can. With no
 * amount yet, stay native — unless native is empty and the wrapped balance is funded, so the manager
 * sees a usable balance at load instead of a misleading 0. A manual selection always overrides this.
 */
export function autoWrappedFunding(
  amount: bigint | null,
  nativeBalance: bigint,
  erc20Balance: bigint,
): WrappedNativeFunding {
  if (amount != null && amount > nativeBalance && amount <= erc20Balance) return "erc20";
  if (amount == null && nativeBalance === BigInt(0) && erc20Balance > BigInt(0)) return "erc20";
  return "native";
}

/** The balance backing the wrapped-native leg for the selected source (POO-878 [R4]). */
export function wrappedSourceBalance(
  funding: WrappedNativeFunding,
  nativeBalance: bigint,
  erc20Balance: bigint,
): bigint {
  return funding === "erc20" ? erc20Balance : nativeBalance;
}

/**
 * Whether the wrapped-native leg is fully exhausted (POO-878 [R4]): the zero-balance prompt should
 * fire only when NEITHER source can cover it — i.e. both the native and the wrapped ERC-20 balances
 * are zero.
 */
export function wrappedLegExhausted(nativeBalance: bigint, erc20Balance: bigint): boolean {
  return nativeBalance === BigInt(0) && erc20Balance === BigInt(0);
}

/**
 * POO-878 [R5]: flat USD gas headroom reserved when Maxing the NATIVE funding source, so the manager
 * keeps enough native coin to pay for the create-pool tx itself. Flat across all chains (Base / Arb /
 * Polygon) for now — no per-chain differentiation (decided with Rafael, 2026-07-13).
 */
export const NATIVE_MAX_GAS_RESERVE_USD = 1.5;

/**
 * The Max amount (wei) for the NATIVE funding source (POO-878 [R5]): the native balance minus a fixed
 * USD-equivalent gas headroom ({@link NATIVE_MAX_GAS_RESERVE_USD}), converted at the native token's
 * USD price and clamped at 0 (never negative). When the native price is unavailable or non-positive
 * there's nothing to convert the reserve against, so it falls back to the FULL balance — Max is never
 * blocked (existing validation still catches a leg the remainder can't cover). Wrapped-ERC-20 Max is
 * exact and never calls this (gas is paid in the native coin, not the seeded wrapped token).
 */
export function nativeMaxWithGasReserve(
  nativeBalance: bigint,
  decimals: number,
  nativePriceUsd: number | undefined,
): bigint {
  if (nativePriceUsd == null || nativePriceUsd <= 0) return nativeBalance;
  // Reserve in native units = reserveUsd / priceUsd, quantized to the token's decimals for parseUnits.
  const reserveWei = parseUnits(
    (NATIVE_MAX_GAS_RESERVE_USD / nativePriceUsd).toFixed(decimals),
    decimals,
  );
  const remaining = nativeBalance - reserveWei;
  return remaining > BigInt(0) ? remaining : BigInt(0);
}

/** Which of the pool's two tokens a create-pool position actually requires. */
export interface SeedTokensNeeded {
  /** Token0 (base) must be deposited. */
  needs0: boolean;
  /** Token1 (quote) must be deposited. */
  needs1: boolean;
}

/**
 * Decide which seed tokens a Uniswap v3 position needs, from the pool's current tick and the
 * position's tick bounds. A range sitting entirely ABOVE the current price (current tick below the
 * range) is composed of token0 only; entirely BELOW (current tick at/above the range) of token1
 * only; a range straddling the current price needs both. Returns both when any input is unknown
 * (decimals / range still resolving), so the UI defaults to the safe dual-asset path.
 */
export function seedTokensNeeded(
  currentTick: number | null,
  tickLower: number | null,
  tickUpper: number | null,
): SeedTokensNeeded {
  if (
    currentTick === null ||
    Number.isNaN(currentTick) ||
    tickLower === null ||
    tickUpper === null
  ) {
    return { needs0: true, needs1: true };
  }
  return {
    needs0: currentTick < tickUpper,
    needs1: currentTick >= tickLower,
  };
}

// POO-497 [R2]: `seedTokensWhenPriceUnknown` (the funded-token heuristic for a create-pool with no
// market price) is removed as dead code. Managers no longer create no-price pools — the picker offers
// only pools with a defined market price (POO-497 [R1]), so the seed step is always reached with a
// known price. See MandateStep.poolHasMarketPrice.
