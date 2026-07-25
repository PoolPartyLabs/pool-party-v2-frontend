/**
 * @id PP-CORE-HOK-019 (POO-1023)
 * @name useProvisioningPlan
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Resolves a {@link ProvisioningPlan} through the ONE seam that decides mock vs real:
 * {@link computePlan} (`src/lib/provisioning/planner.ts`).
 *
 * Why this hook exists at all. Both provisioning surfaces (PP-CORE-CMP-046 `ProvisioningPanel` and
 * PP-CORE-MOD-011 `ProvisioningWizardModal`) used to call `mockComputePlan` DIRECTLY inside a
 * synchronous `useMemo`, bypassing the seam. That meant the real planner could be fully wired and
 * still never be called: flipping `NEXT_PUBLIC_MOCK_MODE=false` changed nothing. Two live PP-FIXMEs
 * recorded it (POO-432 on the panel, POO-418 on the wizard); this hook deletes both.
 *
 * The seam is async (the real planner reaches the network, POO-1034), so a synchronous `useMemo`
 * cannot express it. This hook owns the resulting lifecycle so neither surface has to:
 *   [R3] `loading` covers the resolve; `plan` stays null until a plan actually exists, so a surface
 *        never renders a half-plan, and a planner failure surfaces as `error` rather than a plan card
 *        that spins forever.
 *   [R4] a re-plan (a valid explicit `gasChoice`) re-invokes the seam and passes the choice through.
 *
 * Race guard: plans resolve out of order (a slow first request can settle after a newer one). Each
 * run carries a monotonic id and only the newest may write state, so a superseded plan can never
 * clobber a fresher one. Without it, editing the gas amount quickly could leave the UI showing a plan
 * for an amount the user already moved off.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import type { GasChoice, ProvisioningNeedInput, ProvisioningPlan } from "@/lib/provisioning";
import { computePlan } from "@/lib/provisioning";

/** What {@link useProvisioningPlan} returns. Exactly one of `plan` / `error` is set once settled. */
export interface ProvisioningPlanState {
  /** The resolved plan, or null while pending or failed. */
  plan: ProvisioningPlan | null;
  /** True while the seam is resolving. */
  loading: boolean;
  /** The planner failure, when the seam rejected. */
  error: Error | null;
}

/**
 * Resolve the provisioning plan for `input`.
 *
 * `gasChoice` is the user's explicit gas top-up from the inline selector. Pass `undefined` while the
 * choice is absent or invalid: the callers deliberately do NOT re-plan on an empty or invalid Custom
 * amount, so the swap-gas step never silently drops mid-edit (review POO-409).
 */
export function useProvisioningPlan(
  input: ProvisioningNeedInput,
  gasChoice?: GasChoice,
): ProvisioningPlanState {
  const [state, setState] = useState<ProvisioningPlanState>({
    plan: null,
    loading: true,
    error: null,
  });

  // Monotonic run id: only the newest run may write state (see the race guard above).
  const runIdRef = useRef(0);

  // The seam takes plain data, and callers build these objects inline, so depending on their IDENTITY
  // would re-plan on every render. We key the effect on their serialized VALUES instead and read the
  // live objects from refs, so a re-plan happens when the planner's inputs actually changed.
  const inputKey = JSON.stringify(input);
  const gasKey = JSON.stringify(gasChoice ?? null);
  const inputRef = useRef(input);
  inputRef.current = input;
  const gasRef = useRef(gasChoice);
  gasRef.current = gasChoice;

  // The deps are the serialized KEYS, while the effect body reads the live objects from refs. Biome
  // sees that as two extra dependencies; removing them is exactly the bug (the plan would never
  // refresh when the inputs change). The keys are the intended re-plan trigger.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-plan is keyed on serialized values, not object identity
  useEffect(() => {
    const runId = ++runIdRef.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    // PP-INTEGRATION-POINT: the mock/real provisioning planner seam (POO-1034 wires the real one).
    computePlan(inputRef.current, gasRef.current)
      .then((plan) => {
        if (runIdRef.current !== runId) return; // superseded
        setState({ plan, loading: false, error: null });
      })
      .catch((caught: unknown) => {
        if (runIdRef.current !== runId) return; // superseded
        const error = caught instanceof Error ? caught : new Error(String(caught));
        setState({ plan: null, loading: false, error });
      });
  }, [inputKey, gasKey]);

  return state;
}
