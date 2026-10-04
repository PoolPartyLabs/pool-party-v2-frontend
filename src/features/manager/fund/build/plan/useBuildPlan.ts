/**
 * @id PP-MGR-HOK-007
 * @name useBuildPlan
 * @implements-rules-version v1 (POO-2151 rules v1)
 * @analytics-events none, this hook owns plan STATE rather than instrumentation. `apply` returns the
 *   refusal, and the Build screen (PP-MGR-SCR-002, slice S7) turns it into `builder_build_blocked`;
 *   a hook that emitted it would fire once per consumer and could not say how the manager got there.
 *
 * React access to the Build plan inside one mandate draft. It owns no state of its own: the plan IS
 * `draft.plan`, written through the draft hook's `update`, so it follows the draft through Back to
 * Mandate, Save & exit and a reload (handoff acceptance 8), and it reaches storage only through the
 * mandate's own `save()`.
 *
 * Two rules, both from the mandate hook and for the same reasons:
 *
 * - A REFUSAL CHANGES NOTHING. When a reducer returns `{ blocked }`, `apply` hands the current draft
 *   back to `update` untouched, so the draft keeps its object identity, and returns the refusal.
 * - `apply` READS THE CURRENT DRAFT. It runs the reducer inside the `update(fn)` callback, which the
 *   draft hook calls synchronously on its ref (`fn(draftRef.current)`), never on the draft this
 *   render closed over. Two applies in one event therefore chain: the second sees the first.
 *
 * `violations` is `validatePlan` memoised on the plan, the draft and the catalog (coordinator default
 * D6): a plan loaded after the mandate changed lists what broke, and nothing is fixed silently.
 */
"use client";

import { useCallback, useMemo } from "react";
import type { MandateCatalog } from "../../mandateCatalog";
import type { MandateDraft } from "../../mandateDraft";
import { newDraftId } from "../../mandateDraftStore";
import type { UseMandateDraftResult } from "../../useMandateDraft";
import {
  type AaveBlockConfig,
  type BuildPlan,
  createEmptyPlan,
  isPlanBlocked,
  type PlanBlock,
  type PlanContext,
  type PlanReducerResult,
  type PoolBlockConfig,
  planOf,
} from "./buildPlan";
import { type PlanViolation, validatePlan } from "./planInvariants";
import { applyBlockConfig } from "./planReducers";

/** What one `apply` did: the plan changed, or the reducer refused and nothing changed. */
export type PlanApplyResult = { ok: true } | { ok: false; blocked: PlanBlock };

export interface UseBuildPlanResult {
  plan: BuildPlan;
  /** `validatePlan` of the plan against the current mandate, memoised (open point 6, D6). */
  violations: readonly PlanViolation[];
  /** Run a plan reducer on the CURRENT draft's plan and write the result into the draft. */
  apply(reducer: (plan: BuildPlan, ctx: PlanContext) => PlanReducerResult): PlanApplyResult;
  /**
   * The panel's Apply changes (POO-2184): `applyBlockConfig` as ONE `apply`, so the config, the
   * chain's share and, on a spoke, the spoke's share land in one draft update or not at all.
   */
  applyBlockConfig(
    blockId: string,
    config: PoolBlockConfig | AaveBlockConfig | null,
    sharePct?: number,
  ): PlanApplyResult;
}

/** Read and edit the Build plan of the draft the mandate hook holds. */
export function useBuildPlan(input: {
  draft: MandateDraft;
  catalog: MandateCatalog;
  update: UseMandateDraftResult["update"];
}): UseBuildPlanResult {
  const { draft, catalog, update } = input;

  // Keyed on the stored plan alone, so a draft with no plan keeps ONE empty plan across renders.
  const stored = draft.plan;
  const plan = useMemo(() => stored ?? createEmptyPlan(), [stored]);

  const violations = useMemo(() => validatePlan(plan, { draft, catalog }), [plan, draft, catalog]);

  const apply = useCallback(
    (reducer: (plan: BuildPlan, ctx: PlanContext) => PlanReducerResult): PlanApplyResult => {
      let outcome: PlanApplyResult = { ok: true };
      update((current) => {
        // Ids are the one thing a reducer cannot make itself (no randomness in the domain), so the
        // hook hands it the same id source the drafts use.
        const ctx: PlanContext = { draft: current, catalog, newId: newDraftId };
        const result = reducer(planOf(current), ctx);
        if (isPlanBlocked(result)) {
          outcome = { ok: false, blocked: result.blocked };
          return current;
        }
        outcome = { ok: true };
        return { ...current, plan: result };
      });
      return outcome;
    },
    [update, catalog],
  );

  const applyConfig = useCallback(
    (
      blockId: string,
      config: PoolBlockConfig | AaveBlockConfig | null,
      sharePct?: number,
    ): PlanApplyResult =>
      apply((current, ctx) => applyBlockConfig(current, ctx, blockId, config, sharePct)),
    [apply],
  );

  return { plan, violations, apply, applyBlockConfig: applyConfig };
}
