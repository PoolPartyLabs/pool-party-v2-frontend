/**
 * @id PP-CORE-LIB-016 (POO-416)
 * @name computePlan (provisioning planner seam)
 * @implements-rules-version v2
 *
 * The single entry the FE gate (POO-418) calls to learn what to provision. In mock mode it delegates
 * to the deterministic {@link mockComputePlan}; in real mode it will POST the op context + wallet
 * state to the BE planner (POO-413) and return its {@link ProvisioningPlan} verbatim. Both branches
 * return the same shape, so flipping the toggle changes nothing downstream.
 */
import { isMockMode } from "@/lib/services";
import { mockComputePlan } from "./mockPlanner";
import type { GasChoice, ProvisioningNeedInput, ProvisioningPlan } from "./types";

/**
 * Compute the provisioning plan for an op. `gasChoice` (from the buy-gas modal) resizes the gas
 * top-up + the buy/bridge that feeds it; pass it on the re-plan after the user picks an amount.
 * POO-523 R2: `input.slippagePct` (the settings gear's Max slippage) rides along; the planner sizes
 * swap buffers with it and echoes it on the plan for the rail (POO-414).
 */
export async function computePlan(
  input: ProvisioningNeedInput,
  gasChoice?: GasChoice,
): Promise<ProvisioningPlan> {
  if (!isMockMode) {
    // PP-INTEGRATION-POINT: real provisioning planner (POO-413) — POST { op, wallet (incl.
    // slippagePct, POO-523 R2), gasChoice } and return the ProvisioningPlan. The contract is pinned
    // on POO-413; the FE consumes it as-is.
    throw new Error("Provisioning planner is not wired yet (POO-413)");
  }
  // PP-MOCK: deterministic local planner (POO-420) until the BE rail lands.
  return mockComputePlan(input, { gas: gasChoice });
}
