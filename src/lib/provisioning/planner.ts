/**
 * @id PP-CORE-LIB-016 (POO-416)
 * @name computePlan (provisioning planner seam)
 * @implements-rules-version v3 (POO-1024 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The single entry every provisioning surface calls to learn what to provision. Mock mode delegates
 * to the deterministic {@link mockComputePlan}, which runs locally in the client bundle. Real mode
 * delegates across the server boundary to {@link computePlanAction}. Both branches return the same
 * {@link ProvisioningPlan}, so flipping the toggle changes nothing downstream.
 *
 * POO-1024: the real branch used to `throw` inline here. It cannot simply be filled in, because this
 * module is reachable from `"use client"` components through the package barrel, and the real planner
 * reads `UNISWAP_API_KEY` (server-only, ADR 0003). The work therefore lives behind a `"use server"`
 * module; this file keeps only the toggle. See `planActions.ts` and `serverBoundary.test.ts`.
 *
 * The mock branch deliberately does NOT cross the boundary: a local call keeps mock mode fast and
 * offline, and keeps the deterministic fixtures out of a network round trip.
 */
import { isMockMode } from "@/lib/services";
import { mockComputePlan } from "./mockPlanner";
import { computePlanAction } from "./planActions";
import type { GasChoice, ProvisioningNeedInput, ProvisioningPlan } from "./types";

/**
 * Compute the provisioning plan for an op. `gasChoice` (from the gas selector) resizes the gas top-up
 * and whatever funds it; pass it on the re-plan after the user picks an amount.
 * POO-523 R2: `input.slippagePct` (the settings gear's Max slippage) rides along, so the planner sizes
 * swap buffers with it and echoes it on the plan for the rail.
 *
 * Rejects with a typed `Error` when the real planner reports a failure, so callers (the
 * `useProvisioningPlan` hook) can surface it as a recoverable error state.
 */
export async function computePlan(
  input: ProvisioningNeedInput,
  gasChoice?: GasChoice,
): Promise<ProvisioningPlan> {
  if (!isMockMode) {
    // PP-INTEGRATION-POINT: the real planner runs server-side (POO-1034) so the Uniswap API key
    // never reaches the browser. The action returns a typed result rather than throwing across the
    // RSC boundary; we convert a failure into a rejection here, which is what the hook expects.
    const result = await computePlanAction(input, gasChoice);
    if (!result.ok) {
      throw Object.assign(new Error(result.message), { code: result.code });
    }
    return result.plan;
  }
  // PP-MOCK: deterministic local planner (POO-420), retired when the real planner lands (POO-1030).
  return mockComputePlan(input, { gas: gasChoice });
}
