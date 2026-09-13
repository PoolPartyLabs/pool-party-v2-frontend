/**
 * @id PP-CORE-LIB-016 (POO-416, POO-1034, POO-1641)
 * @name mock-mode plan fixture tests
 * @implements-rules-version v3 (POO-1641 rules v1) · v2
 * @hackathon POO-1022 (Universal Funding)
 *
 * Kept, and moved with the fixture it covers (POO-1034). The module is no longer "the planner", but
 * it still backs mock mode, which is the repo default — so it is still production behaviour on the
 * default path, and deleting its suite would be a real coverage regression dressed up as cleanup.
 *
 * The fixture returns a {@link ProvisioningPlan} in the same shape `buildPlan` does, so every render
 * surface builds against one contract. Covers the four canonical scenarios (gas-only, usdc-only,
 * usdc+bridge, usdc+bridge+gas), the satisfied no-op, and the slippage threading (POO-523 R2).
 */
import { describe, expect, it } from "vitest";
import type { ProvisioningStepType } from "../types";
import { mockComputePlan, SCENARIOS } from "./mockPlan";

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
    expect(stepTypes(plan.steps)).toEqual(["buy", "swap-gas", "op"]);
    expect(plan.steps[0]?.poweredBy).toBe("paybis");
  });

  it("usdc-only (same chain): buys USDC, then the op", () => {
    const plan = mockComputePlan(SCENARIOS.usdcOnly, { nowIso: NOW });
    expect(plan.variant).toBe("multi");
    expect(stepTypes(plan.steps)).toEqual(["buy", "op"]);
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
    expect(stepTypes(plan.steps)).toEqual(["buy", "bridge", "swap-gas", "op"]);
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

  /**
   * @rule R5 — the fixture stops fabricating a fee line.
   *
   * This is the trap POO-1641 names explicitly. Every design and QA review of
   * `ProvisioningCostBreakdown` happens in MOCK mode, and this fixture was rendering
   * `max($0.99, order x 1%)` as a real fee row, so anyone who approved "the fee looks right" approved
   * a number that never existed in real mode either. `usdcOnly` is the clean read: buy then op, no
   * bridge and no gas swap, so the on-ramp term was the ENTIRE fee line and its removal takes the
   * whole row with it (`ProvisioningCostBreakdown` renders the row only when `feesUsd > 0`).
   */
  it("charges no on-ramp fee on a buy-only plan, so the breakdown shows no fee row", () => {
    const plan = mockComputePlan(SCENARIOS.usdcOnly, { nowIso: NOW });
    expect(stepTypes(plan.steps)).toEqual(["buy", "op"]);
    expect(plan.quote.feesUsd).toBe(0);
    expect(plan.quote.totalPayUsd).toBeCloseTo(plan.quote.shortfallUsd + plan.quote.bufferUsd, 2);
  });

  /**
   * @rule R5 R6 — and the fee is gone from the SIZING as well as from the quote line.
   *
   * The worst-case scenario is the one where the removal is visible in whole dollars: $100 of USDC
   * plus $10 of funded gas is $110 to buy, which the 2% buffer takes to $112.20. It used to be ceiled
   * with a $1.12 fee on top ($114); it is now ceiled alone ($113). The buffer itself is untouched:
   * it covers the bridge and the gas swap, which are real.
   */
  it("sizes the buy from the buffer alone, with no fee term folded in", () => {
    const plan = mockComputePlan(SCENARIOS.usdcBridgeGas, { nowIso: NOW });
    const buy = plan.steps.find((step) => step.type === "buy");
    expect(buy?.amountUsd).toBe(113);
    expect(buy?.order?.fiatAmount).toBe("113.00");
    // The remaining fee line is the bridge and the gas swap, both real, neither ours.
    expect(plan.quote.feesUsd).toBeGreaterThan(0);
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
