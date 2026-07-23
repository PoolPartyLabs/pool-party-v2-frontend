/**
 * @id PP-CORE-LIB-016 (POO-416)
 * @name computeProvisioningNeed tests
 * @implements-rules-version v1
 *
 * Pure requirement calculator: given wallet state (in USD) + op context, decide what is missing
 * (gas / usdc / network), by how much, and which UI branch to take (none / gas-only / multi).
 * Plus the gas-bounds clamp and the mock on-ramp sizing (slippage buffer + Paybis $10 floor).
 */
import { describe, expect, it } from "vitest";
import {
  clampGasUsd,
  computeProvisioningNeed,
  GAS_CUSTOM_MAX_USD,
  GAS_CUSTOM_MIN_USD,
  PAYBIS_MIN_USD,
  sizeOnRampUsd,
} from "./computeNeed";
import type { ProvisioningNeedInput } from "./types";

const BASE = 8453;
const ARBITRUM = 42161;

/** A fully-satisfied baseline (lots of native + USDC on the target chain, op needs little). */
function input(overrides: Partial<ProvisioningNeedInput> = {}): ProvisioningNeedInput {
  return {
    nativeBalanceUsd: 50,
    usdcBalanceUsd: 1_000,
    currentChainId: BASE,
    targetChainId: BASE,
    opRequiredUsdc: 100,
    gasEstimateUsd: 0.5,
    ...overrides,
  };
}

describe("computeProvisioningNeed", () => {
  it("returns variant 'none' when nothing is missing", () => {
    const need = computeProvisioningNeed(input());
    expect(need.needed).toBe(false);
    expect(need.variant).toBe("none");
    expect(need.reason).toEqual([]);
    expect(need.needsGas).toBe(false);
    expect(need.needsUsdc).toBe(false);
    expect(need.needsBridge).toBe(false);
  });

  it("is satisfied at the exact boundary (balance == requirement)", () => {
    const need = computeProvisioningNeed(
      input({
        nativeBalanceUsd: 0.5,
        usdcBalanceUsd: 100,
        gasEstimateUsd: 0.5,
        opRequiredUsdc: 100,
      }),
    );
    expect(need.variant).toBe("none");
  });

  it("flags gas-only when just native is short (same chain, op needs no extra USDC)", () => {
    const need = computeProvisioningNeed(
      input({ nativeBalanceUsd: 0, opRequiredUsdc: 0, gasEstimateUsd: 0.8 }),
    );
    expect(need.variant).toBe("gas-only");
    expect(need.needsGas).toBe(true);
    expect(need.gasShortfallUsd).toBeCloseTo(0.8);
    expect(need.reason).toEqual(["gas"]);
  });

  it("is still gas-only when gas is missing and the wallet has no USDC (buy-gas modal on-ramps)", () => {
    const need = computeProvisioningNeed(
      input({ nativeBalanceUsd: 0, usdcBalanceUsd: 0, opRequiredUsdc: 0, gasEstimateUsd: 0.5 }),
    );
    expect(need.variant).toBe("gas-only");
    expect(need.needsUsdc).toBe(false);
  });

  it("flags multi when the op needs more USDC than the wallet holds", () => {
    const need = computeProvisioningNeed(input({ usdcBalanceUsd: 40, opRequiredUsdc: 100 }));
    expect(need.variant).toBe("multi");
    expect(need.needsUsdc).toBe(true);
    expect(need.usdcShortfallUsd).toBeCloseTo(60);
    expect(need.reason).toContain("usdc");
  });

  it("flags a bridge when the op's USDC is on the wrong network", () => {
    const need = computeProvisioningNeed(
      input({
        currentChainId: BASE,
        targetChainId: ARBITRUM,
        usdcBalanceUsd: 1_000,
        opRequiredUsdc: 100,
      }),
    );
    expect(need.needsBridge).toBe(true);
    expect(need.variant).toBe("multi");
    expect(need.reason).toContain("network");
  });

  it("does not flag a bridge for a same-network op", () => {
    const need = computeProvisioningNeed(input({ currentChainId: BASE, targetChainId: BASE }));
    expect(need.needsBridge).toBe(false);
  });

  it("does not bridge when the op consumes no USDC (gas-only across chains stays gas-only)", () => {
    const need = computeProvisioningNeed(
      input({
        currentChainId: BASE,
        targetChainId: ARBITRUM,
        opRequiredUsdc: 0,
        nativeBalanceUsd: 0,
        gasEstimateUsd: 0.5,
      }),
    );
    expect(need.needsBridge).toBe(false);
    expect(need.variant).toBe("gas-only");
  });

  it("orders reasons gas → usdc → network", () => {
    const need = computeProvisioningNeed(
      input({
        nativeBalanceUsd: 0,
        usdcBalanceUsd: 0,
        opRequiredUsdc: 100,
        currentChainId: BASE,
        targetChainId: ARBITRUM,
        gasEstimateUsd: 0.5,
      }),
    );
    expect(need.variant).toBe("multi");
    expect(need.reason).toEqual(["gas", "usdc", "network"]);
  });

  it("lets a user-chosen gas amount raise the requirement (sizes the top-up)", () => {
    // 8 USD of native covers the 5 USD estimate, but the user chose a 10 USD top-up → short by 2.
    const need = computeProvisioningNeed(
      input({ nativeBalanceUsd: 8, opRequiredUsdc: 0, gasEstimateUsd: 5, gasChoiceUsd: 10 }),
    );
    expect(need.needsGas).toBe(true);
    expect(need.gasShortfallUsd).toBeCloseTo(2);
  });
});

describe("clampGasUsd", () => {
  it("keeps an in-range value", () => {
    expect(clampGasUsd(50)).toBe(50);
  });
  it("clamps below the min up to the floor", () => {
    expect(clampGasUsd(3)).toBe(GAS_CUSTOM_MIN_USD);
    expect(clampGasUsd(9.99)).toBe(GAS_CUSTOM_MIN_USD);
  });
  it("clamps above the max down to the ceiling", () => {
    expect(clampGasUsd(500)).toBe(GAS_CUSTOM_MAX_USD);
    expect(clampGasUsd(200.01)).toBe(GAS_CUSTOM_MAX_USD);
  });
});

describe("sizeOnRampUsd", () => {
  it("enforces the Paybis $10 floor for tiny shortfalls", () => {
    expect(sizeOnRampUsd(3)).toBe(PAYBIS_MIN_USD);
    expect(sizeOnRampUsd(0)).toBe(PAYBIS_MIN_USD);
  });
  it("adds a 2% slippage buffer and rounds up to whole dollars", () => {
    expect(sizeOnRampUsd(100)).toBe(102); // ceil(100 * 1.02)
    expect(sizeOnRampUsd(100, 2)).toBe(104); // ceil(100 * 1.02 + 2)
  });
  it("rounds a sub-$10 buffered amount up to the floor", () => {
    expect(sizeOnRampUsd(9.5)).toBe(PAYBIS_MIN_USD); // ceil(9.69) = 10
  });
});
