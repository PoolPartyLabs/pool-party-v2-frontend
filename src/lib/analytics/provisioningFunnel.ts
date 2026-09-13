/**
 * @id PP-CORE-LIB-058
 * @name provisioning funnel analytics
 * @analytics-events funding_gate_triggered, funding_route_viewed, funding_route_chosen,
 *   funding_route_abandoned, funding_method_viewed, funding_method_chosen,
 *   funding_method_abandoned, funding_method_blocked, funding_method_unavailable,
 *   funding_method_currency_changed,
 *   funding_sources_listed, funding_sources_selected, funding_buffer_consumed,
 *   funding_plan_quoted, funding_plan_started, funding_leg_settled, funding_plan_completed,
 *   funding_plan_failed, funding_plan_abandoned, funding_run_stop_blocked,
 *   funding_slippage_raise_blocked
 * @implements-rules-version v8 (POO-1812 rules v1: `funding_buffer_consumed` reports the slippage
 *   the run allowed and the rate it produced, `rate_bps` an integer by construction because the rate
 *   is quantised to whole percentage points before it is spent) · v7 (POO-1811 rules v1) · v6 (POO-1618 rules v1) · v5 (POO-1576 rules v1) · v4 (POO-1541 rules v1) · v3 (POO-1506 rules v1) · v2 (POO-1507 rules v1) · v1
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
 * Nothing here fires from a click. {@link ProvisioningFunnel.planCompleted} is called by the panel's
 * flow-status effect, which runs only once every leg's `run()` has resolved, and it emits at most
 * once per session.
 *
 * CORRECTED 2026-07-31 (POO-1250). This paragraph used to state flatly that
 * `DepositScreen.confirmFiat` fires `deposit_completed` synchronously on the confirm click. That
 * stopped being true at `d6658aad` (POO-1137): in REAL mode behind the `fiatOnRamp` flag,
 * `completeFiat` now fires on the observed settlement delta, and `DepositScreen.tsx:411` carries a
 * comment forbidding a fire from the confirm handler. **It remains true in mock mode, or with the
 * flag dark**, where `completeFiat(null)` still fires on the click with the pre-purchase estimate.
 * So the defect is now mode-scoped rather than universal, and it is live in any environment where
 * GTM is on and the flag is off. Check the prod flag state before publishing the container.
 *
 * ## [R4] A declared event that never fires is worse than no event
 *
 * CORRECTED 2026-07-31 (POO-1250). This used to say `deposit_failed` "is emitted by nothing". It has
 * had a real emitter since `d6658aad`. The principle below is unchanged and is why this file exists;
 * only the example went stale. Here every terminal outcome emits: a failure on each terminal failure
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
import type { BufferMeasurement } from "@/features/strategies/lib/bufferLedger";
import { isExpectedNonOutage } from "@/lib/observability/expectedFailure";
import type { ProvisioningPlan, ProvisioningStep, ProvisioningStepType } from "@/lib/provisioning";
import type { AnalyticsEvent, AnalyticsFlow, AnalyticsParams } from "./events";
import { useAnalytics } from "./useAnalytics";

/** How a route gets the money there. Typed off the catalog so the two cannot drift. */
export type FundingRouteShape = NonNullable<AnalyticsParams["route_shape"]>;
/** The settlement unit of a plan: every step except its display anchor. */
export type FundingLegKind = NonNullable<AnalyticsParams["leg_kind"]>;
/** Where an unfinished session was when the user left it. */
export type FundingExit = NonNullable<AnalyticsParams["funding_exit"]>;
/** POO-1541: which of screen 1's routes, typed off the catalog so the two cannot drift. */
export type FundingRouteKind = NonNullable<AnalyticsParams["funding_route"]>;
/** POO-1541: a route that can carry the `Recommended` chip, i.e. every one except `deposit`. */
export type RecommendableRouteKind = NonNullable<AnalyticsParams["funding_route_recommended"]>;

/**
 * Step type → the leg kind it is reported as, `null` for the trailing `op` anchor, which is a label
 * for the operation the route funds and never something the rail executes.
 *
 * `satisfies` over the whole {@link ProvisioningStepType} union rather than a lookup with a default:
 * a step type added to the contract has to be classified here, at compile time, instead of silently
 * disappearing from every count and shape in the funnel.
 */
const LEG_KIND_BY_STEP_TYPE = {
  // [R9] KEY renamed with the step type (`satisfies` forces it); VALUE stays the pre-rename wire
  // string `"buy-usdc"` so the GA4 funnel does not split into two series with no historical bridge.
  // `events.ts` keeps `"buy-usdc"` in its `leg_kind` union to match. Do NOT "fix" the mismatch.
  buy: "buy-usdc",
  bridge: "bridge",
  // Counted as a leg: it is a broadcast the user has to get through, and a funnel that omitted it
  // would report a shorter route than the one they actually walked (POO-1075).
  "bridge-gas": "bridge-gas",
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
  flow?: AnalyticsFlow;
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
  /**
   * The funding picker rendered. `count`/`usd` are the sources the picker offered; the caller decides
   * what qualifies (today: REACHABLE to the operation's chain, see `ProvisioningPanel.reachableSources`
   * and docs/ANALYTICS_EVENTS.md). This emitter is definition-agnostic: it reports what it is handed.
   */
  sourcesListed: (sources: { count: number; usd: number }) => void;
  /** The user committed to a selection. */
  sourcesSelected: (selection: { count: number; usd: number }) => void;
  /** A plan came back priced. Reported once per quote, including each TTL re-quote. */
  planQuoted: (plan: ProvisioningPlan) => void;
  /** The user approved the route and execution began. NOT a completion ([R3]). */
  planStarted: (plan: ProvisioningPlan) => void;
  /**
   * POO-1811 [R1]: one leg asked the run's shared price-move buffer to absorb a worse re-quote.
   *
   * Fires on EVERY ask, held or refused, because the refusals are the tail the 5%-versus-3%
   * argument turns on and a series of holds with no refusals is itself the answer. [R2]: reporting
   * only, the decision is made before this is called and is not influenced by it.
   */
  bufferConsumed: (
    plan: ProvisioningPlan | null,
    measurement: BufferMeasurement,
    /**
     * POO-1812 [R6]: the slippage in force when the ask happened, and the rate it implies. Without
     * them the consumption figures cannot be read against the budget that generated them, which is
     * the whole question `FU-006` leaves open: is the 5% floor over-asking, and by how much?
     *
     * `rateBps` is an INTEGER: the panel derives it once with `Math.round(rate * 10_000)` off a rate
     * already quantised to whole percentage points, so no float residue reaches the rail.
     * `measurement.budgetBps` stays pinned to the rate the run was SEEDED with ([R4]), so a mid-run
     * raise reads here as `rateBps` above the budget rather than as a budget that moved under the
     * reader.
     */
    rate?: { slippagePct?: number; rateBps: number },
  ) => void;
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
  /**
   * POO-1507 [R29]: the mid-run `Stop here?` confirmation opened — the user tried to close the panel
   * (ESC / overlay / native X) and the product intercepted it instead of letting them leave silently.
   * The blocked-intent event premise 11 asks for; `Keep going` / `Stop anyway` are the two ways the
   * question resolves and neither is itself a fresh intent, so neither gets its own event.
   */
  runStopBlocked: (position: { legIndex: number; legCount: number }) => void;
  /**
   * POO-1506 [R40]: the mid-run `8b` prompt appeared — the SECOND slippage failure of this run, where
   * the product asks whether to raise the tolerance instead of retrying silently or failing outright.
   * The blocked-intent event premise 11 asks for; `Raise to {pct}% and retry` / `Stop here` are the
   * two ways the question resolves and neither is itself a fresh intent, so neither gets its own event.
   */
  slippageRaiseBlocked: () => void;
  /**
   * POO-1541: screen 1, "Where from", rendered (POO-1501). Fires on the OPEN rather than on the
   * arrival of the figures, so a session that left while the quote was still in flight is counted
   * (D1). Once per ENTRY to screen 1, not once per session: the [R20] back chevron and the
   * buy-route ghost back both return here mid-session, and each return is a fresh view — the
   * picker's old per-mount semantics, which is what the live series has always meant. Within one
   * entry a re-render is still not a second view: `entry` keys the dedupe, exactly as `planQuoted`
   * is keyed on its quote's own `quotedAt`.
   */
  routeViewed: (info: {
    /** Which visit to screen 1 this is (1-based). The host advances it each time the screen re-appears. */
    entry: number;
    count: number;
    recommended: RecommendableRouteKind;
    gasNeeded: boolean;
  }) => void;
  /**
   * POO-1541: the user tapped a route (POO-1501 [R6]). One tap is the whole interaction, so this is
   * the choice and the commitment at once. `deposit` reports as its own route and never as followed,
   * since it can never carry the `Recommended` chip.
   */
  routeChosen: (info: {
    kind: FundingRouteKind;
    recommended: RecommendableRouteKind;
    followedRecommendation: boolean;
  }) => void;
  /** POO-1541: the user left screen 1 without choosing (Cancel). `count` is what they walked away from. */
  routeAbandoned: (count: number) => void;
  /**
   * POO-1576: the "Choose how to pay" step appeared, between the buy amount and the vendor checkout.
   *
   * The VIEW class and the step's start at once, deliberately, and on the same reasoning
   * {@link routeViewed} already carries: the screen opens with its list and there is no separate
   * starting gesture to report, so a second event would be a duplicate with another name. Fires on
   * the OPEN rather than on the arrival of the figures, so a buyer who left while the quote was
   * still in flight is counted.
   *
   * Once per ENTRY to the step, not per render. There is one entry per run today (the buy step runs
   * once), and the key is still the entry rather than the session so a future retry counts as the
   * fresh view it would be.
   */
  methodViewed: (info: { entry: number; count: number }) => void;
  /**
   * POO-1576: the buyer pressed `Continue`. The step's SUBMITTED event.
   *
   * `method` is absent when the provider returned nothing and the buyer continued on the prefill,
   * which is a real and expected outcome (Q3) rather than a gap: it is the count of buyers who were
   * never actually offered the choice this step exists to give them.
   */
  methodChosen: (info: { method?: string; count: number }) => void;
  /** POO-1576: the buyer left the step without choosing (Cancel, or the host's own dismissal). */
  methodAbandoned: (count: number) => void;
  /**
   * POO-1618: the buyer changed the currency they are paying in.
   *
   * A money decision they made about their own purchase, and the only way to answer whether the
   * control is used at all - which decides whether the 44-fiat set is worth the reads it costs, and
   * whether POO-1512's resolution chain is landing where buyers would have chosen anyway.
   *
   * `currency` is what they ASKED for. The server may refuse it (POO-1618 [R2]), and that refusal is
   * a server-side signal (`onramp.currency_override_rejected`) rather than a GA4 event: the two
   * answer different questions, and an intent the product declined still belongs in the funnel.
   */
  methodCurrencyChanged: (currencyCode: string) => void;
  /**
   * POO-1576: the buyer picked a method the provider would not price for this order, which is
   * premise 11's blocked intent in its purest form: they wanted to pay that way and the product said
   * no. `value`/`currency` carry the method's own floor, in the method's OWN currency (POO-1512:
   * this is not necessarily dollars).
   *
   * Not `emitOnce` HERE: the meaningful unit is one refusal per method, which is a fact about the
   * caller's own selection state rather than about this session, so the host dedupes on (entry,
   * method) and this emitter stays a plain report. Keying it here would need a key this file cannot
   * construct without learning what a payment method is.
   */
  methodBlocked: (info: { method: string; minimum: number; currency: string }) => void;
  /**
   * POO-1576: the step rendered with no methods at all. The ERROR class for this screen.
   *
   * It reports the DEGRADE, not an outage: an unsupported pair, a throttled list and a list still in
   * flight all land here, which is the honest limit of what the screen can distinguish
   * (`useBuyRouteQuote` publishes no loading discriminator, by design). The upstream cause is
   * reported separately and with its code, by the hook, through `onramp.methods_unavailable`.
   */
  methodUnavailable: (entry: number) => void;
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

      // POO-1811 [R1]. Not `emitOnce`: a run legitimately asks several times, and a leg that asks
      // twice after a retry is two separate market moves rather than one duplicated render.
      // The ordinal rides as `buffer_ask_index` and NOT as `leg_index`: this counts ASKS, and only
      // legs whose re-quote came back materially worse ever ask, so it is not the route position
      // `funding_leg_settled` reports under that name.
      bufferConsumed: (plan, measurement, rate) =>
        emit("funding_buffer_consumed", {
          ...(plan ? fundingPlanParams(plan) : {}),
          buffer_ask_index: measurement.askIndex,
          buffer_asked_bps: measurement.askedBps,
          buffer_cumulative_bps: measurement.cumulativeBps,
          buffer_budget_bps: measurement.budgetBps,
          buffer_headroom_bps: measurement.headroomBps,
          buffer_held: measurement.held,
          // POO-1812 [R6]: omitted rather than defaulted when the caller has not opted in, so a row
          // without them is legibly "not reported" rather than a fabricated zero.
          ...(rate?.slippagePct === undefined ? {} : { slippage_pct: rate.slippagePct }),
          ...(rate === undefined ? {} : { rate_bps: rate.rateBps }),
        }),

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
        // The session concluded either way. Set BEFORE the suppression check on purpose: a
        // suppressed failure must not then be reported as an abandonment on unmount, which would
        // turn one silent non-outage into a loud wrong row.
        concludedRef.current = true;
        /**
         * POO-1212 [4]: the same suppression rule as the log rail, applied through the same
         * predicate rather than a copy of it. `isExpectedNonOutage` duck-types `{status, code}`,
         * and `errorCode` is that `code`.
         *
         * Suppressed here: mock mode (`SYSTEM_NOT_CONFIGURED`), a wallet with no data yet, and our
         * own throttle answering. If GA4 counted those, its failure count would disagree with the
         * log rail's for the same period, and two numbers that disagree end up trusted equally: not
         * at all.
         *
         * KNOWN CONSEQUENCE, stated rather than discovered later: a suppressed failure means
         * `funding_plan_started` has no terminal partner, so `started = completed + failed +
         * abandoned` does not close for that session. That is the correct trade for mock mode,
         * which should produce no funnel rows at all, and it is the reason decision F (POO-1169)
         * keeps preview and mock off the production property. It is arguable for the 429 case; if
         * throttled sessions turn out to matter, the fix is a distinct terminal event, never
         * counting them as failures.
         */
        if (isExpectedNonOutage({ code: failure.errorCode })) return;
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

      // POO-1507 [R29]: not `emitOnce` — a run stopped, resumed via `Keep going`, and interrupted a
      // second time is two separate blocked attempts, not a repeat of the first.
      runStopBlocked: (position) =>
        emit("funding_run_stop_blocked", {
          leg_index: position.legIndex,
          leg_count: position.legCount,
        }),

      slippageRaiseBlocked: () => emit("funding_slippage_raise_blocked", {}),

      // POO-1541: once per ENTRY to screen 1, keyed like `planQuoted` above — the host names the
      // visit, a re-render inside it repeats the key and is dropped, and a back-navigation return
      // gets the next key and counts as the fresh view it is. NOT once per session: `chosen` and
      // `abandoned` are per-action, so a session-keyed view would let chosen/viewed exceed 1.
      routeViewed: (info) =>
        emitOnce(`route-viewed:${info.entry}`, "funding_route_viewed", {
          funding_route_count: info.count,
          funding_route_recommended: info.recommended,
          funding_gas_needed: info.gasNeeded,
        }),

      routeChosen: (info) =>
        emit("funding_route_chosen", {
          funding_route: info.kind,
          funding_route_recommended: info.recommended,
          funding_route_followed_recommendation: info.followedRecommendation,
        }),

      routeAbandoned: (count) => emit("funding_route_abandoned", { funding_route_count: count }),

      // POO-1576: keyed on the entry, exactly like `routeViewed` above.
      methodViewed: (info) =>
        emitOnce(`method-viewed:${info.entry}`, "funding_method_viewed", {
          funding_method_count: info.count,
        }),

      // POO-1129 D1: `funding_method_best_price` came out with the pill it reported on. It was a
      // PARAM here and never an event of its own, so no census count moves; what must not survive is
      // a field measuring whether a claim this product no longer makes moved the buyer's money.
      methodChosen: (info) =>
        emit("funding_method_chosen", {
          funding_method: info.method,
          funding_method_count: info.count,
        }),

      methodAbandoned: (count) => emit("funding_method_abandoned", { funding_method_count: count }),

      // Deliberately NOT `emitOnce`: changing currency twice is two decisions, and the sequence is
      // the interesting part (a buyer hunting for a currency that has Pix is a different signal from
      // one who set theirs once).
      methodCurrencyChanged: (currencyCode) =>
        emit("funding_method_currency_changed", { funding_method_currency: currencyCode }),

      methodBlocked: (info) =>
        emit("funding_method_blocked", {
          funding_method: info.method,
          // The floor, in the method's OWN currency (POO-1512): the buyer is not billed in dollars.
          value: info.minimum,
          currency: info.currency,
        }),

      // Once per entry, for the same reason the view is: the step re-renders while the list is
      // resolving, and an empty list is one degrade rather than one per commit.
      methodUnavailable: (entry) =>
        emitOnce(`method-unavailable:${entry}`, "funding_method_unavailable", {}),
    }),
    [emit, emitOnce],
  );
}
