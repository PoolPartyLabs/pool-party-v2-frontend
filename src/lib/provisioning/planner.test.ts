/**
 * @id PP-CORE-LIB-016 (POO-416)
 * @name computePlan seam tests
 * @implements-rules-version v2
 *
 * In the test env `NEXT_PUBLIC_MOCK_MODE` is unset → mock mode, so `computePlan` returns the mock
 * planner's output. The real branch (POO-413) is exercised by the integration wiring, not here.
 */
import { describe, expect, it } from "vitest";
import { SCENARIOS } from "./fixtures/mockPlan";
import { computePlan } from "./planner";

describe("computePlan (mock mode)", () => {
  it("delegates to the mock planner and returns a ProvisioningPlan", async () => {
    const plan = await computePlan(SCENARIOS.usdcOnly);
    expect(plan.variant).toBe("multi");
    expect(plan.steps.map((s) => s.type)).toEqual(["buy", "op"]);
    expect(plan.steps.at(-1)?.type).toBe("op");
  });

  it("passes the gas choice through to size the swap", async () => {
    const plan = await computePlan(SCENARIOS.gasOnly, { presetUsd: null, amountUsd: 30 });
    expect(plan.steps.find((s) => s.type === "swap-gas")?.amountUsd).toBe(30);
    expect(plan.gas?.amountUsd).toBe(30);
  });

  // @rule POO-523 R2 — the gear's slippage rides input.slippagePct through the seam onto the plan.
  it("threads input.slippagePct through to the plan (POO-523)", async () => {
    const plan = await computePlan({ ...SCENARIOS.usdcOnly, slippagePct: 0.5 });
    expect(plan.slippagePct).toBe(0.5);
  });
});
