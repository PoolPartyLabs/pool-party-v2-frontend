/**
 * @id PP-CORE-LIB-016 (POO-416)
 * @name mock provisioning planner tests
 * @implements-rules-version v2
 *
 * The deterministic mock planner returns a {@link ProvisioningPlan} with the exact same shape the BE
 * planner (POO-413) will return, so the FE builds against it in Phase 0. Covers the four canonical
 * scenarios (gas-only, usdc-only, usdc+bridge, usdc+bridge+gas) + the satisfied no-op, and the
 * slippage threading (POO-523 R2).
 */
import { describe, expect, it } from "vitest";
import { mockComputePlan, SCENARIOS } from "./mockPlanner";
import type { ProvisioningStepType } from "./types";

const NOW = "2026-06-30T12:00:00.000Z";

/** The ordered step types of a plan (handy for asserting assembly). */
function stepTypes(steps: { type: ProvisioningStepType }[]): ProvisioningStepType[] {
  return steps.map((s) => s.type);
}

describe("mockComputePlan", () => {
  it("returns a no-op plan when nothing is missing", () => {
    const plan = mockComputePlan(SCENARIOS.satisfied, { nowIso: NOW });
    expect(plan.needed).toBe(false);
    expect(plan.variant).toBe("none");
    expect(stepTypes(plan.steps)).toEqual(["op"]);
    expect(plan.quote.totalPayUsd).toBe(0);
    expect(plan.gas).toBeUndefined();
  });

  it("gas-only (has USDC): swaps USDC→native, then the op", () => {
    const plan = mockComputePlan(SCENARIOS.gasOnly, { nowIso: NOW });
    expect(plan.variant).toBe("gas-only");
    expect(stepTypes(plan.steps)).toEqual(["swap-gas", "op"]);
    expect(plan.gas).toBeDefined();
    expect(plan.reason).toEqual(["gas"]);
  });

  it("gas-only (no USDC): buys USDC first, swaps to native, then the op", () => {
    const plan = mockComputePlan(SCENARIOS.gasOnlyNoUsdc, { nowIso: NOW });
    expect(plan.variant).toBe("gas-only");
    expect(stepTypes(plan.steps)).toEqual(["buy-usdc", "swap-gas", "op"]);
    expect(plan.steps[0]?.poweredBy).toBe("paybis");
  });

  it("usdc-only (same chain): buys USDC, then the op", () => {
    const plan = mockComputePlan(SCENARIOS.usdcOnly, { nowIso: NOW });
    expect(plan.variant).toBe("multi");
    expect(stepTypes(plan.steps)).toEqual(["buy-usdc", "op"]);
    expect(plan.reason).toContain("usdc");
  });

  it("usdc+bridge (wrong network, has USDC): bridges, then the op", () => {
    const plan = mockComputePlan(SCENARIOS.usdcBridge, { nowIso: NOW });
    expect(plan.variant).toBe("multi");
    expect(stepTypes(plan.steps)).toEqual(["bridge", "op"]);
    expect(plan.reason).toContain("network");
  });

  it("usdc+bridge+gas (worst case): buy → bridge → swap-gas → op", () => {
    const plan = mockComputePlan(SCENARIOS.usdcBridgeGas, { nowIso: NOW });
    expect(plan.variant).toBe("multi");
    expect(stepTypes(plan.steps)).toEqual(["buy-usdc", "bridge", "swap-gas", "op"]);
    expect(plan.reason).toEqual(["gas", "usdc", "network"]);
    expect(plan.gas).toBeDefined();
  });

  it("always ends with the op anchor and carries i18n labelKeys (never raw copy)", () => {
    const plan = mockComputePlan(SCENARIOS.usdcBridgeGas, { nowIso: NOW });
    expect(plan.steps.at(-1)?.type).toBe("op");
    for (const step of plan.steps) {
      expect(step.labelKey).toMatch(/^provisioning\.steps\./);
    }
  });

  it("quote obeys totalPay = shortfall + buffer + fees and stamps the clock", () => {
    const plan = mockComputePlan(SCENARIOS.usdcOnly, { nowIso: NOW });
    const { shortfallUsd, bufferUsd, feesUsd, totalPayUsd, quotedAt, ttlMs } = plan.quote;
    expect(totalPayUsd).toBeCloseTo(shortfallUsd + bufferUsd + feesUsd, 2);
    expect(shortfallUsd).toBeGreaterThan(0);
    expect(quotedAt).toBe(NOW);
    expect(ttlMs).toBeGreaterThan(0);
  });

  it("sizes the swap to the user-chosen gas amount", () => {
    const plan = mockComputePlan(SCENARIOS.gasOnly, {
      nowIso: NOW,
      gas: { presetUsd: null, amountUsd: 25 },
    });
    const swap = plan.steps.find((s) => s.type === "swap-gas");
    expect(swap?.amountUsd).toBe(25);
    expect(plan.gas?.amountUsd).toBe(25);
  });

  // @rule POO-523 R2 — the gear's slippage rides the input: it sizes the quote buffer and echoes on
  // the plan so the build seam (POO-414 rail) receives it.
  it("uses input.slippagePct for the quote buffer and echoes it on the plan (POO-523)", () => {
    const at2 = mockComputePlan(SCENARIOS.usdcOnly, { nowIso: NOW });
    const at05 = mockComputePlan({ ...SCENARIOS.usdcOnly, slippagePct: 0.5 }, { nowIso: NOW });
    // Absent a choice the planner keeps the 2% default (DEFAULT_SLIPPAGE_PCT).
    expect(at2.slippagePct).toBe(2);
    expect(at05.slippagePct).toBe(0.5);
    // A tighter tolerance shrinks the slippage buffer.
    expect(at05.quote.bufferUsd).toBeLessThan(at2.quote.bufferUsd);
  });
});
