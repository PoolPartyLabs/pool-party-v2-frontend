/**
 * @id PP-CORE-LIB-016 (POO-416)
 * @name computeProvisioningNeed
 * @implements-rules-version v1
 *
 * Pure FE requirement calculator for pre-flight provisioning (epic POO-411). Given wallet state
 * (already converted to USD by the gate, POO-418) + op context, it decides what is missing (native
 * gas, USDC for the op, or funds on the wrong network), by how much, and which UI branch to take:
 *   none      → the op signs unchanged (no modal)
 *   gas-only  → the buy-gas modal (PP-CORE-MOD-010, POO-331) — even when an on-ramp is needed to fund
 *               the gas, the only OP-level requirement is gas, so the simpler modal handles it
 *   multi     → the provisioning wizard (PP-CORE-MOD-011, POO-409) — the op needs USDC and/or a bridge
 *
 * No I/O, no React, no viem: pure number-math so the branch matrix is exhaustively unit-tested. The
 * authoritative amounts come from the planner quote (POO-413); this only drives detection + routing.
 * The mock on-ramp sizing here ({@link sizeOnRampUsd}) is the documented mock heuristic — real mode
 * reads the buffer from {@link ProvisioningQuote}.
 */
import type { ProvisioningNeed, ProvisioningNeedInput, ProvisioningReason } from "./types";

/** Gas preset shortcuts shown in the buy-gas modal (USD). Both ≥ the Paybis $10 floor. */
export const GAS_PRESETS_USD = [10, 25] as const;
/** Default-selected gas amount (USD). */
export const GAS_DEFAULT_USD = 10;
/** Custom gas input bounds (USD) — locked with murilo 2026-06-30. */
export const GAS_CUSTOM_MIN_USD = 10;
export const GAS_CUSTOM_MAX_USD = 200;
/** Paybis on-ramp minimum (USD) — POO-87. */
export const PAYBIS_MIN_USD = 10;
/** Mock slippage buffer applied over a shortfall before the on-ramp (real mode: from the quote). */
export const MOCK_SLIPPAGE_BUFFER_RATE = 0.02;

/** Clamp a custom gas amount to the locked `[10, 200]` bounds. */
export function clampGasUsd(usd: number): number {
  return Math.min(GAS_CUSTOM_MAX_USD, Math.max(GAS_CUSTOM_MIN_USD, usd));
}

/**
 * Mock heuristic for how much USDC to buy on-ramp to cover a `shortfallUsd`: add a slippage buffer
 * and `feesUsd`, round up to whole dollars, and enforce the Paybis $10 floor. Real mode uses the
 * authoritative `ProvisioningQuote` instead of this.
 */
export function sizeOnRampUsd(shortfallUsd: number, feesUsd = 0): number {
  const buffered = Math.ceil(shortfallUsd * (1 + MOCK_SLIPPAGE_BUFFER_RATE) + feesUsd);
  return Math.max(PAYBIS_MIN_USD, buffered);
}

/** Compute what the op is missing and which provisioning branch to take. */
export function computeProvisioningNeed(input: ProvisioningNeedInput): ProvisioningNeed {
  const {
    nativeBalanceUsd,
    usdcBalanceUsd,
    currentChainId,
    targetChainId,
    opRequiredUsdc,
    gasEstimateUsd,
    gasChoiceUsd,
  } = input;

  // A user-chosen gas top-up raises the required native; otherwise the bare op estimate applies.
  const requiredGasUsd = gasChoiceUsd ?? gasEstimateUsd;
  const needsGas = nativeBalanceUsd < requiredGasUsd;
  const gasShortfallUsd = needsGas ? requiredGasUsd - nativeBalanceUsd : 0;

  // USDC is only an op-level requirement when the op actually consumes USDC (invest); collect /
  // withdraw / close pass opRequiredUsdc = 0.
  const needsUsdc = opRequiredUsdc > 0 && usdcBalanceUsd < opRequiredUsdc;
  const usdcShortfallUsd = needsUsdc ? opRequiredUsdc - usdcBalanceUsd : 0;

  // A bridge is an op-level requirement only when the op spends USDC and the funds are off-network.
  const needsBridge = opRequiredUsdc > 0 && currentChainId !== targetChainId;

  const reason: ProvisioningReason[] = [];
  if (needsGas) reason.push("gas");
  if (needsUsdc) reason.push("usdc");
  if (needsBridge) reason.push("network");

  const needed = reason.length > 0;
  const variant = !needed ? "none" : needsUsdc || needsBridge ? "multi" : "gas-only";

  return {
    needed,
    needsGas,
    gasShortfallUsd,
    needsUsdc,
    usdcShortfallUsd,
    needsBridge,
    targetChainId,
    reason,
    variant,
  };
}
