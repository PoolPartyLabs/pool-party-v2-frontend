/**
 * @id PP-CORE-LIB-016 (POO-416, POO-1034)
 * @name computePlan (provisioning planner seam)
 * @implements-rules-version v3 (POO-1024 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The single entry every provisioning surface calls to learn what to provision. Real mode crosses
 * the server boundary to {@link computePlanAction}, behind which the real planner (`buildPlan.ts`,
 * POO-1034) prices every leg against the live Uniswap Trading API. Mock mode resolves locally from
 * the deterministic fixture. Both branches return the same {@link ProvisioningPlan}, so flipping the
 * toggle changes nothing downstream.
 *
 * POO-1024: the real branch used to `throw` inline here. It cannot simply be filled in, because this
 * module is reachable from `"use client"` components through the package barrel, and the real planner
 * reads `UNISWAP_API_KEY` (server-only, ADR 0003). The work therefore lives behind a `"use server"`
 * module; this file keeps only the toggle. See `planActions.ts` and `serverBoundary.test.ts`.
 *
 * POO-1034 retired the mock planner as a PLANNER but kept it as the mock branch's fixture, for that
 * same boundary reason: `buildPlan` is `server-only`, so a mock branch that called it would ship the
 * server graph into the browser, and routing mock mode through the action instead would demand a
 * SIWE session and a live API key from a mode that exists to need neither. See
 * `fixtures/mockPlan.ts`.
 */
import { isMockMode } from "@/lib/services";
import { TransactionError } from "@/lib/tx/sendTransaction";
import { mockComputePlan } from "./fixtures/mockPlan";
import { computePlanAction } from "./planActions";
import type { GasChoice, ProvisioningNeedInput, ProvisioningPlan } from "./types";

/**
 * Compute the provisioning plan for an op. `gasChoice` (from the gas selector) resizes the gas top-up
 * and whatever funds it; pass it on the re-plan after the user picks an amount.
 * POO-523 R2: `input.slippagePct` (the settings gear's Max slippage) rides along, so the planner sizes
 * swap buffers with it and echoes it on the plan for the rail.
 *
 * Rejects with a `TransactionError` carrying the failure code on `error.cause.code` when the real
 * planner reports a failure, so callers (the `useProvisioningPlan` hook) can surface it as a
 * recoverable error state and `classifyTxError` can act on the code.
 */
export async function computePlan(
  input: ProvisioningNeedInput,
  gasChoice?: GasChoice,
  selection?: readonly string[],
): Promise<ProvisioningPlan> {
  if (!isMockMode) {
    // PP-INTEGRATION-POINT: the real planner runs server-side (POO-1034/POO-1042) so the Uniswap
    // API key never reaches the browser. The action returns a typed result rather than throwing
    // across the RSC boundary; we convert a failure into a rejection here, which is what the hook
    // expects.
    //
    // `gasChoice` is NOT forwarded: in real mode the gas top-up is sized by the classifier from a
    // live quote, so there is nothing for a typed amount to attach to (see `planActions.ts`, and
    // PP-TODO(POO-1044) which owns the real gas selector). The panel hides the selector in real
    // mode accordingly, so nothing on screen implies a control that would do nothing.
    const result = await computePlanAction(input, selection);
    if (!result.ok) {
      // The house error contract (POO-475 [R3], documented in `@/lib/tx/actionResult`): a typed
      // action failure is rethrown as a `TransactionError` carrying the code on `error.cause.code`,
      // which is where `toTxError` reads it first (`causeCode ?? ownCode`) and what
      // `collectErrorFacets` / `classifyTxError` (`@/lib/tx/diagnostics`) walk. Identical conversion
      // to useInvest / useWithdraw / useCollectFees, so a provisioning failure classifies and renders
      // exactly like every other build-action failure instead of being a second, private shape.
      throw new TransactionError(result.message, { code: result.code });
    }
    return result.plan;
  }
  // PP-MOCK: deterministic local fixture (POO-420, retired as a planner by POO-1034 and moved to
  // `fixtures/`). It stays because mock mode must run offline, in the client bundle, with no session
  // and no API key — see this file's header and `fixtures/mockPlan.ts`.
  return mockComputePlan(input, { gas: gasChoice });
}
