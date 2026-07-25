/**
 * @id PP-CORE-LIB-058
 * @name provisioning funnel analytics
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The Universal Funding funnel, in one place (POO-1048).
 *
 * The epic's entire value proposition is a funnel: a user holding money on the wrong chain has to
 * FIND it, CHOOSE it, and land it where the operation runs. Until this file none of those steps
 * emitted anything, so "does provisioning work" was a question nobody could answer with data.
 *
 * Two pieces: pure derivation of what a funding route IS ([R2]), and a hook that owns the emission
 * rules the two shipped analytics defects in this repository violate.
 *
 * ## [R3] Completion means settlement
 *
 * `DepositScreen.confirmFiat` fires `deposit_completed` synchronously on the confirm click, so GA4
 * counts intent as revenue and the deposit conversion rate is fiction. Nothing here fires from a
 * click. {@link ProvisioningFunnel.planCompleted} is called by the panel's flow-status effect, which
 * runs only once every leg's `run()` has resolved, and it emits at most once per session.
 *
 * ## [R4] A declared event that never fires is worse than no event
 *
 * `deposit_failed` is in the catalog and is emitted by nothing, so a failed deposit and an abandoned
 * one are the same row. Here every terminal outcome emits: a failure on each terminal failure
 * (a second one after a retry is a second failure, not a duplicate), and an abandonment on the way
 * out for a session that concluded neither way. Started minus completed minus failed minus abandoned
 * is therefore zero, which is what makes the funnel arithmetic trustworthy.
 *
 * ## [R2] What is deliberately NOT in a payload
 *
 * No wallet address, no token address, no transaction hash. `sanitizeParams` would scrub a raw
 * address anyway, but relying on the scrub for data we chose to derive is backwards: the derivation
 * below reads shape, count and USD off a plan and never touches
 * {@link ProvisioningLegToken.address}. The pseudonymous `user_id` (server-HMAC, consent-gated) is
 * attached by `useAnalytics` exactly as it is for every other event.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ProvisioningPlan, ProvisioningStep, ProvisioningStepType } from "@/lib/provisioning";
import type { AnalyticsEvent, AnalyticsParams } from "./events";
import { useAnalytics } from "./useAnalytics";

/** How a route gets the money there. Typed off the catalog so the two cannot drift. */
export type FundingRouteShape = NonNullable<AnalyticsParams["route_shape"]>;
/** The settlement unit of a plan: every step except its display anchor. */
export type FundingLegKind = NonNullable<AnalyticsParams["leg_kind"]>;
/** Where an unfinished session was when the user left it. */
export type FundingExit = NonNullable<AnalyticsParams["funding_exit"]>;

/**
 * Step type → the leg kind it is reported as, `null` for the trailing `op` anchor, which is a label
 * for the operation the route funds and never something the rail executes.
 *
 * `satisfies` over the whole {@link ProvisioningStepType} union rather than a lookup with a default:
 * a step type added to the contract has to be classified here, at compile time, instead of silently
 * disappearing from every count and shape in the funnel.
 */
const LEG_KIND_BY_STEP_TYPE = {
  "buy-usdc": "buy-usdc",
  bridge: "bridge",
  "swap-gas": "swap-gas",
  "swap-token": "swap-token",
  op: null,
} as const satisfies Record<ProvisioningStepType, FundingLegKind | null>;

/**
 * What a step executes.
 *
 * The v5 `leg` is the machine-grade truth when the real planner produced one; the display `type` is
 * what a mock plan carries. They agree wherever both exist, so preferring the leg costs nothing and
 * keeps one code path across mock and real mode.
 */
function legKindOf(step: ProvisioningStep): FundingLegKind | null {
  return LEG_KIND_BY_STEP_TYPE[step.leg?.kind ?? step.type];
}

/** The plan's executable steps, in execution order. */
function fundingLegs(plan: ProvisioningPlan): ProvisioningStep[] {
  return plan.steps.filter((step) => legKindOf(step) !== null);
}

/** How many legs the user has to get through. Never counts the `op` anchor. */
export function fundingLegCount(plan: ProvisioningPlan): number {
  return fundingLegs(plan).length;
}

/**
 * The route's shape ([R2]), which is the dimension the funnel is really segmented on: a same-chain
 * swap and a decomposed swap-then-bridge are different products with different completion rates.
 *
 * A `swap-gas` leg never changes the answer. It is the precondition for transacting on a chain at
 * all, not a route to the operation, and counting it as a swap would report every gas top-up on a
 * bridged route as a decomposition.
 */
export function fundingRouteShape(plan: ProvisioningPlan): FundingRouteShape {
  const kinds = fundingLegs(plan).map(legKindOf);
  if (!kinds.includes("bridge")) return "same-chain";
  return kinds.includes("swap-token") ? "decomposed" : "cross-chain";
}

/**
 * Shape, length and size of a route ([R2]).
 *
 * `value` is the quote's own `totalPayUsd`, the same "You pay" figure the cost breakdown renders, so
 * the number in GA4 is the number the user was shown. Passed through verbatim: the cost model
 * already rounded it to cents in integer micro-dollars, and re-deriving it here in floats is exactly
 * how a total and its report come apart.
 */
export function fundingPlanParams(plan: ProvisioningPlan): AnalyticsParams {
  return {
    route_shape: fundingRouteShape(plan),
    leg_count: fundingLegCount(plan),
    value: plan.quote.totalPayUsd,
    currency: "USD",
  };
}

/** Which leg, where in the route, and how much it moves. Null when the key is not a leg. */
function fundingLegParams(plan: ProvisioningPlan, stepKey: string): AnalyticsParams | null {
  const legs = fundingLegs(plan);
  const position = legs.findIndex((step) => step.key === stepKey);
  const step = legs[position];
  if (!step) return null;
  return {
    leg_kind: legKindOf(step) ?? undefined,
    // The planner's own index when there is one; otherwise the position, which is the same number
    // for every plan either can produce.
    leg_index: step.leg?.index ?? position,
    value: step.amountUsd,
    currency: "USD",
  };
}

/** How a host describes the session it is reporting. */
export interface ProvisioningFunnelOptions {
  /**
   * The operation the route funds ("invest" / "withdraw" / …), on the shipped `flow` param. Absent
   * where the host does not know it, which is honest: five of the six operation modals do not yet
   * thread their operation into the provisioning panel at all.
   */
  flow?: string;
  /** The chain the operation runs on, which is where every route has to land. */
  chainId?: number;
  strategyId?: string;
  /**
   * Read AT UNMOUNT to report where an unconcluded session was left.
   *
   * Supplying it is what ARMS the abandonment guard, and that is the whole reason it is a callback
   * and not a value: the gate hook mounts in all six operation modals on every open and reports only
   * that the gate fired, so it passes nothing here and can never manufacture an abandonment for a
   * route nobody started. The provisioning panel mounts only when a route is actually being funded,
   * so its mount IS the session and its unmount is the exit.
   */
  abandonExit?: () => FundingExit;
}

/** The funnel's emitters. Stable across renders, so a host can call them from an effect. */
export interface ProvisioningFunnel {
  /** The gate decided the operation cannot proceed unfunded. `shortfallUsd` is what is missing. */
  gateTriggered: (shortfallUsd: number) => void;
  /** The funding picker rendered. `count`/`usd` are what can actually be SPENT on this route. */
  sourcesListed: (sources: { count: number; usd: number }) => void;
  /** The user committed to a selection. */
  sourcesSelected: (selection: { count: number; usd: number }) => void;
  /** A plan came back priced. Reported once per quote, including each TTL re-quote. */
  planQuoted: (plan: ProvisioningPlan) => void;
  /** The user approved the route and execution began. NOT a completion ([R3]). */
  planStarted: (plan: ProvisioningPlan) => void;
  /** A leg SETTLED. Reported once per leg however many renders observe it done. */
  legSettled: (plan: ProvisioningPlan, stepKey: string) => void;
  /** Every leg settled. At most once per session ([R3]). */
  planCompleted: (plan: ProvisioningPlan) => void;
  /**
   * A terminal failure ([R4]). Fires every time, because a retry that fails again is a second
   * failure. `plan` is null for a failure raised by the planner, before any route existed.
   */
  planFailed: (
    plan: ProvisioningPlan | null,
    failure: { errorCode?: string; stepKey?: string },
  ) => void;
}

/** Bind the funding funnel to one session. */
export function useProvisioningFunnel(options: ProvisioningFunnelOptions): ProvisioningFunnel {
  const { track } = useAnalytics();
  // Read through a ref so every emitter below is stable: hosts call them from effects, and an
  // emitter that changes identity per render is an effect that re-fires per render.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const firedRef = useRef<Set<string>>(new Set());
  // Whether the session already has a recorded outcome (completed or failed). Only this suppresses
  // the abandonment on the way out; it deliberately does NOT suppress a completion, because a route
  // that failed, was retried and landed did complete.
  const concludedRef = useRef(false);

  const emit = useCallback(
    (event: AnalyticsEvent, params: AnalyticsParams) => {
      const { flow, chainId, strategyId } = optionsRef.current;
      // Context first: `sanitizeParams` drops the undefined ones, and an event's own params win.
      track(event, { flow, chain_id: chainId, strategy_id: strategyId, ...params });
    },
    [track],
  );
  const emitRef = useRef(emit);
  emitRef.current = emit;

  const emitOnce = useCallback(
    (key: string, event: AnalyticsEvent, params: AnalyticsParams) => {
      if (firedRef.current.has(key)) return;
      firedRef.current.add(key);
      emit(event, params);
    },
    [emit],
  );

  // The exit report for a session that concluded neither way. `[]` deps, so the cleanup runs on the
  // real unmount and not on any re-render; the emitter is reached through its ref for the same
  // reason, since a stale closure here would report the wrong operation.
  useEffect(
    () => () => {
      const exit = optionsRef.current.abandonExit?.();
      if (!exit || concludedRef.current || firedRef.current.has("abandoned")) return;
      firedRef.current.add("abandoned");
      emitRef.current("funding_plan_abandoned", { funding_exit: exit });
    },
    [],
  );

  return useMemo<ProvisioningFunnel>(
    () => ({
      gateTriggered: (shortfallUsd) =>
        emit("funding_gate_triggered", { value: shortfallUsd, currency: "USD" }),

      sourcesListed: (sources) =>
        emitOnce("sources-listed", "funding_sources_listed", {
          source_count: sources.count,
          value: sources.usd,
          currency: "USD",
        }),

      sourcesSelected: (selection) =>
        emit("funding_sources_selected", {
          source_count: selection.count,
          value: selection.usd,
          currency: "USD",
        }),

      // Keyed on the quote's own timestamp: the panel re-renders constantly while a plan is on
      // screen, and a TTL re-quote is a genuinely new price the user is about to approve.
      planQuoted: (plan) =>
        emitOnce(`quoted:${plan.quote.quotedAt}`, "funding_plan_quoted", fundingPlanParams(plan)),

      planStarted: (plan) => emit("funding_plan_started", fundingPlanParams(plan)),

      legSettled: (plan, stepKey) => {
        const params = fundingLegParams(plan, stepKey);
        if (!params) return;
        emitOnce(`leg:${stepKey}`, "funding_leg_settled", {
          route_shape: fundingRouteShape(plan),
          ...params,
        });
      },

      planCompleted: (plan) => {
        concludedRef.current = true;
        emitOnce("completed", "funding_plan_completed", fundingPlanParams(plan));
      },

      planFailed: (plan, failure) => {
        concludedRef.current = true;
        const leg = plan && failure.stepKey ? fundingLegParams(plan, failure.stepKey) : null;
        emit("funding_plan_failed", {
          ...(plan ? fundingPlanParams(plan) : {}),
          // The leg's own USD would overwrite the route's total, and the total is the figure that
          // makes a failure comparable with a completion. Only the identity of the leg rides along.
          ...(leg ? { leg_kind: leg.leg_kind, leg_index: leg.leg_index } : {}),
          // A typed code only. Never an error message: upstream text can carry an address, a URL or
          // a signature, and none of that belongs in an analytics payload.
          error_code: failure.errorCode,
        });
      },
    }),
    [emit, emitOnce],
  );
}
