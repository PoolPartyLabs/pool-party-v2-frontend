/**
 * @id PP-CORE-LIB-018 (POO-1030)
 * @name provisioningView contract-v3 additivity tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * [R2] of the contract bump: the v3 fields are additive, so the view mapper must render a plan that
 * carries them EXACTLY as it renders the same plan without them, with no edit to `provisioningView.ts`
 * or `ProvisioningPlanCard.tsx`.
 *
 * A new file rather than a case appended to `provisioningView.test.ts`, deliberately: that suite is
 * the untouched-by-construction proof that v2 rendering did not move, and editing it would blunt the
 * evidence. This file asserts the additive half.
 */
import { describe, expect, it } from "vitest";
import { mockComputePlan, type ProvisioningPlan, SCENARIOS } from "@/lib/provisioning";
import { buildPlanView, type PlanView } from "./provisioningView";

const NOW = "2026-06-30T12:00:00.000Z";

/**
 * Decorate every step with the v3 plan coordinates the real planner (POO-1034) will attach. Values
 * are irrelevant to the view by design; that is the point of the assertion below.
 */
function withV3Fields(plan: ProvisioningPlan): ProvisioningPlan {
  return {
    ...plan,
    steps: plan.steps.map((step, index) => ({
      ...step,
      planId: "plan_01JZQ8V3H2M4K7N9P0R1S2T3U4",
      stepIndex: index,
      method: "SEND_TX" as const,
      payload: { to: "0x0000000000000000000000000000000000000001", data: "0xabcdef", value: "0" },
      chainId: step.fromChainId ?? step.toChainId ?? 8453,
      etaSeconds: step.type === "bridge" ? 180 : 15,
    })),
  };
}

/**
 * Drop the bridge ETA before comparing.
 *
 * POO-1041 [R2] deliberately made `etaSeconds` the ONE v3 field the mapper reads: a bridge row now
 * says how long it takes, and the figure is the quote's own estimate. That is a rule supersession,
 * not a regression, so the additivity assertion below is narrowed to everything else rather than
 * dropped, and the ETA gets its own explicit assertion underneath.
 */
function withoutEta(view: PlanView): PlanView {
  return { ...view, rows: view.rows.map(({ eta: _eta, ...row }) => row) };
}

describe("buildPlanView against contract v3 (POO-1030)", () => {
  // [R2] The whole rule in one assertion, over the worst-case four-step plan.
  it.each([
    "gasOnly",
    "gasOnlyNoUsdc",
    "usdcOnly",
    "usdcBridge",
    "usdcBridgeGas",
  ] as const)("renders %s identically with and without the v3 fields", (scenario) => {
    const plan = mockComputePlan(SCENARIOS[scenario], { nowIso: NOW });

    expect(withoutEta(buildPlanView(withV3Fields(plan)))).toEqual(withoutEta(buildPlanView(plan)));
  });

  // POO-1041 [R2]: the exception, stated out loud. `etaSeconds` reaches the bridge row, and only it.
  it("reads etaSeconds onto the bridge row, and nothing else off the v3 fields", () => {
    const plan = mockComputePlan(SCENARIOS.usdcBridgeGas, { nowIso: NOW });
    const rows = buildPlanView(withV3Fields(plan)).rows;

    expect(rows.find((row) => row.type === "bridge")?.eta).toEqual({
      key: "provisioning.bridge.etaMinutes",
      values: { minutes: 3 },
    });
    expect(rows.filter((row) => row.eta !== undefined)).toHaveLength(1);
  });

  // [R2] And the mapper keeps reading `toChainId` for the bridge row's network name, rather than
  // being tempted by the new step-level `chainId` (which is the ORIGIN chain of a bridge leg).
  it("still names the destination network from toChainId, not the new chainId", () => {
    const plan = withV3Fields(mockComputePlan(SCENARIOS.usdcBridge, { nowIso: NOW }));
    const bridgeStep = plan.steps.find((step) => step.type === "bridge");
    const bridgeRow = buildPlanView(plan).rows.find((row) => row.type === "bridge");

    expect(bridgeStep?.chainId).toBe(8453); // origin
    expect(bridgeStep?.toChainId).toBe(42161); // destination
    expect(bridgeRow?.networkName).toBe("Arbitrum");
  });
});
