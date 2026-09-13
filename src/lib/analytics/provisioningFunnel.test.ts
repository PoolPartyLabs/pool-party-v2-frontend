/**
 * @id PP-CORE-LIB-058
 * @name provisioning funnel analytics — tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * POO-1048 [R1]-[R4]. The whole point of this issue is that a funnel which lies is worse than no
 * funnel, so these tests assert the two lies this codebase has already told once each:
 *
 *   [R3] `deposit_completed` fires synchronously on the confirm CLICK (`DepositScreen.tsx:266`),
 *        which reports intent as revenue. Completion here is asserted to fire ONCE and only from a
 *        settlement report.
 *   [R4] `deposit_failed` is declared in the catalog and fired by nothing, so a failed deposit is
 *        indistinguishable from an abandoned one. Failure here is asserted to fire on EVERY terminal
 *        failure, including a second one after a retry.
 *
 * Nothing is mocked: the emitters run through the shipped `useAnalytics` → `sanitizeParams` →
 * `window.dataLayer` path, so the [R2] no-raw-address assertion covers the real scrub rather than a
 * stub of it. The fixture plans carry real token ADDRESSES on every leg, which is exactly the payload
 * a careless derivation would leak.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ProvisioningPlan } from "@/lib/provisioning";
import {
  CROSS_CHAIN_PLAN,
  GAS_TOP_UP_PLAN,
  SAME_CHAIN_PLAN,
} from "@/lib/provisioning/fixtures/pricedPlans";
import type { AnalyticsParams } from "./events";
import {
  fundingLegCount,
  fundingPlanParams,
  fundingRouteShape,
  useProvisioningFunnel,
} from "./provisioningFunnel";

/** Only the bridge into Arbitrum and the op anchor: one leg, one chain hop, no swap. */
const BRIDGE_ONLY_PLAN: ProvisioningPlan = {
  ...CROSS_CHAIN_PLAN,
  steps: CROSS_CHAIN_PLAN.steps.filter((step) => step.type === "op" || step.leg?.kind === "bridge"),
};

/** The key of the fixture's Nth step, so a fixture that loses a step fails loudly, not silently. */
function stepKey(plan: ProvisioningPlan, index: number): string {
  const key = plan.steps[index]?.key;
  if (!key) throw new Error(`fixture plan has no step at ${index}`);
  return key;
}

/** Every event pushed so far, in order. */
function pushed(): Record<string, unknown>[] {
  return (window.dataLayer ?? []) as Record<string, unknown>[];
}

function eventNames(): string[] {
  return pushed().map((entry) => String(entry.event));
}

function eventsNamed(name: string): Record<string, unknown>[] {
  return pushed().filter((entry) => entry.event === name);
}

describe("provisioning funnel analytics (POO-1048)", () => {
  beforeEach(() => {
    window.dataLayer = [];
  });

  describe("[R2] route shape, leg count and USD magnitude", () => {
    it("classifies a swap with no chain hop as same-chain", () => {
      expect(fundingRouteShape(SAME_CHAIN_PLAN)).toBe("same-chain");
    });

    it("classifies a bridge with no swap as cross-chain", () => {
      expect(fundingRouteShape(BRIDGE_ONLY_PLAN)).toBe("cross-chain");
    });

    it("classifies a swap feeding a bridge as decomposed", () => {
      // The flagship: a different-token cross-chain pair the API answers 404 to, which our planner
      // splits into swap-then-bridge. The shape is the whole reason this epic exists.
      expect(fundingRouteShape(CROSS_CHAIN_PLAN)).toBe("decomposed");
    });

    it("does not let a gas top-up change the shape of the route it precedes", () => {
      // A `swap-gas` leg is a prerequisite for transacting on a chain, not a route to the operation.
      expect(fundingRouteShape(GAS_TOP_UP_PLAN)).toBe("decomposed");
    });

    it("counts every executable step and never the op anchor", () => {
      expect(fundingLegCount(SAME_CHAIN_PLAN)).toBe(1);
      expect(fundingLegCount(CROSS_CHAIN_PLAN)).toBe(3);
      expect(fundingLegCount(GAS_TOP_UP_PLAN)).toBe(3);
    });

    it("carries the quote's own You-pay total as the USD magnitude, with a currency", () => {
      expect(fundingPlanParams(CROSS_CHAIN_PLAN)).toMatchObject({
        route_shape: "decomposed",
        leg_count: 3,
        value: CROSS_CHAIN_PLAN.quote.totalPayUsd,
        currency: "USD",
      });
    });
  });

  describe("[R1] the funnel emits its ten typed events", () => {
    it("emits gate, sources, quote, start, leg, completion", () => {
      const { result } = renderHook(() =>
        useProvisioningFunnel({ flow: "invest", chainId: 42161 }),
      );
      act(() => {
        result.current.gateTriggered(120.5);
        result.current.sourcesListed({ count: 3, usd: 900 });
        result.current.sourcesSelected({ count: 2, usd: 140 });
        result.current.planQuoted(CROSS_CHAIN_PLAN);
        result.current.planStarted(CROSS_CHAIN_PLAN);
        result.current.legSettled(CROSS_CHAIN_PLAN, stepKey(CROSS_CHAIN_PLAN, 0));
        result.current.planCompleted(CROSS_CHAIN_PLAN);
      });

      expect(eventNames()).toEqual([
        "funding_gate_triggered",
        "funding_sources_listed",
        "funding_sources_selected",
        "funding_plan_quoted",
        "funding_plan_started",
        "funding_leg_settled",
        "funding_plan_completed",
      ]);
    });

    it("carries the operation and its chain on every event, so the funnel segments", () => {
      const { result } = renderHook(() =>
        useProvisioningFunnel({ flow: "withdraw", chainId: 8453 }),
      );
      act(() => {
        result.current.gateTriggered(4);
        result.current.planQuoted(SAME_CHAIN_PLAN);
      });
      for (const entry of pushed()) {
        expect(entry).toMatchObject({ flow: "withdraw", chain_id: 8453 });
      }
    });

    it("identifies the settled leg by kind and position", () => {
      const { result } = renderHook(() => useProvisioningFunnel({}));
      act(() => {
        result.current.legSettled(CROSS_CHAIN_PLAN, stepKey(CROSS_CHAIN_PLAN, 1));
      });
      expect(eventsNamed("funding_leg_settled")[0]).toMatchObject({
        leg_kind: "bridge",
        leg_index: 1,
        value: 60,
        currency: "USD",
      });
    });

    it("ignores a settlement report for the op anchor, which is not a leg", () => {
      const { result } = renderHook(() => useProvisioningFunnel({}));
      const opStep = CROSS_CHAIN_PLAN.steps.at(-1);
      act(() => {
        result.current.legSettled(CROSS_CHAIN_PLAN, opStep?.key ?? "op");
      });
      expect(eventsNamed("funding_leg_settled")).toHaveLength(0);
    });

    it("reports each leg once however many times it is observed settled", () => {
      // The panel reads step statuses out of a render, so the same "done" is seen on every re-render.
      const { result } = renderHook(() => useProvisioningFunnel({}));
      const key = stepKey(CROSS_CHAIN_PLAN, 0);
      act(() => {
        result.current.legSettled(CROSS_CHAIN_PLAN, key);
        result.current.legSettled(CROSS_CHAIN_PLAN, key);
        result.current.legSettled(CROSS_CHAIN_PLAN, stepKey(CROSS_CHAIN_PLAN, 1));
      });
      expect(eventsNamed("funding_leg_settled")).toHaveLength(2);
    });

    it("reports one quote per quote, not one per render", () => {
      const { result } = renderHook(() => useProvisioningFunnel({}));
      act(() => {
        result.current.planQuoted(SAME_CHAIN_PLAN);
        result.current.planQuoted(SAME_CHAIN_PLAN);
      });
      expect(eventsNamed("funding_plan_quoted")).toHaveLength(1);

      // A TTL re-quote is a NEW quote and must be reported: it is the price the user then approves.
      const requoted: ProvisioningPlan = {
        ...SAME_CHAIN_PLAN,
        quote: { ...SAME_CHAIN_PLAN.quote, quotedAt: "2026-07-24T12:00:30.000Z", totalPayUsd: 104 },
      };
      act(() => {
        result.current.planQuoted(requoted);
      });
      expect(eventsNamed("funding_plan_quoted")).toHaveLength(2);
    });
  });

  describe("[R3] completion fires once, and only on settlement", () => {
    it("does not fire on the start of a route", () => {
      const { result } = renderHook(() => useProvisioningFunnel({}));
      act(() => {
        result.current.planStarted(CROSS_CHAIN_PLAN);
      });
      expect(eventsNamed("funding_plan_completed")).toHaveLength(0);
    });

    it("fires exactly once however many settlement reports arrive", () => {
      const { result } = renderHook(() => useProvisioningFunnel({}));
      act(() => {
        result.current.planCompleted(CROSS_CHAIN_PLAN);
        result.current.planCompleted(CROSS_CHAIN_PLAN);
        result.current.planCompleted(CROSS_CHAIN_PLAN);
      });
      expect(eventsNamed("funding_plan_completed")).toHaveLength(1);
    });

    it("still fires after a failure the user retried out of", () => {
      // A route that fails, is retried and lands IS a completion. A hard one-shot terminal guard
      // would have swallowed it, which is the mirror image of the bug in [R3].
      const { result } = renderHook(() => useProvisioningFunnel({}));
      act(() => {
        result.current.planFailed(CROSS_CHAIN_PLAN, { errorCode: "PROVISIONING_FAILED" });
        result.current.planCompleted(CROSS_CHAIN_PLAN);
      });
      expect(eventsNamed("funding_plan_completed")).toHaveLength(1);
    });
  });

  describe("[R4] failure fires on every terminal failure", () => {
    it("reports a second failure after a retry", () => {
      const { result } = renderHook(() => useProvisioningFunnel({}));
      act(() => {
        result.current.planFailed(CROSS_CHAIN_PLAN, { errorCode: "USER_REJECTED" });
        result.current.planFailed(CROSS_CHAIN_PLAN, { errorCode: "PROVISIONING_FAILED" });
      });
      expect(eventsNamed("funding_plan_failed")).toHaveLength(2);
    });

    it("carries the typed error code and the leg it died on, and no error text", () => {
      const { result } = renderHook(() => useProvisioningFunnel({}));
      act(() => {
        result.current.planFailed(CROSS_CHAIN_PLAN, {
          errorCode: "WRONG_CHAIN",
          stepKey: stepKey(CROSS_CHAIN_PLAN, 1),
        });
      });
      expect(eventsNamed("funding_plan_failed")[0]).toMatchObject({
        error_code: "WRONG_CHAIN",
        leg_kind: "bridge",
        leg_index: 1,
        route_shape: "decomposed",
      });
    });

    /**
     * POO-1212 [4]: the funnel suppresses exactly what the log rail suppresses, through the same
     * imported predicate, so the two systems cannot report different failure counts for one period.
     *
     * Only the CODE-shaped non-outages are reachable from here: `planFailed` hands
     * `isExpectedNonOutage` a `{ code: failure.errorCode }`, so the status-shaped members of the
     * rule (404 / 429) cannot arrive through this API at all.
     */
    it("stays silent for an expected non-outage", () => {
      const { result } = renderHook(() => useProvisioningFunnel({ flow: "invest" }));
      act(() => {
        // Mock mode, which should produce no funnel rows whatsoever.
        result.current.planFailed(CROSS_CHAIN_PLAN, { errorCode: "SYSTEM_NOT_CONFIGURED" });
        // A wallet with no data yet, raised before any plan existed.
        result.current.planFailed(null, { errorCode: "WALLET_NOT_FOUND" });
      });
      expect(eventsNamed("funding_plan_failed")).toHaveLength(0);
    });

    it("does not turn a suppressed failure into an abandonment on the way out", () => {
      // The session concluded, silently. Reporting it as an abandonment instead would convert one
      // silent non-outage into a loud wrong row, which is worse than the missing failure.
      const { result, unmount } = renderHook(() =>
        useProvisioningFunnel({ abandonExit: () => "error" }),
      );
      act(() => {
        result.current.planFailed(CROSS_CHAIN_PLAN, { errorCode: "SYSTEM_NOT_CONFIGURED" });
      });
      unmount();
      expect(eventNames()).toEqual([]);
    });

    it("still reports a failure whose code is a real one", () => {
      const { result } = renderHook(() => useProvisioningFunnel({ flow: "invest" }));
      act(() => {
        result.current.planFailed(CROSS_CHAIN_PLAN, { errorCode: "TX_SLIPPAGE_EXCEEDED" });
      });
      expect(eventsNamed("funding_plan_failed")).toHaveLength(1);
      expect(eventsNamed("funding_plan_failed")[0]).toMatchObject({
        error_code: "TX_SLIPPAGE_EXCEEDED",
      });
    });

    it("reports a failure that happened before any plan was quoted", () => {
      // A blocked gas chain fails in the PLANNER: there is no plan, and the funnel still has to
      // record that the route died rather than leaving a started-and-never-finished hole.
      const { result } = renderHook(() => useProvisioningFunnel({ chainId: 137 }));
      act(() => {
        result.current.planFailed(null, { errorCode: "PROVISIONING_GAS_BLOCKED" });
      });
      expect(eventsNamed("funding_plan_failed")[0]).toMatchObject({
        error_code: "PROVISIONING_GAS_BLOCKED",
        chain_id: 137,
      });
    });
  });

  describe("[R29 · POO-1507] the mid-run stop confirmation is a blocked-intent event", () => {
    it("reports which step the user tried to interrupt", () => {
      const { result } = renderHook(() =>
        useProvisioningFunnel({ flow: "invest", chainId: 42161 }),
      );
      act(() => {
        result.current.runStopBlocked({ legIndex: 3, legCount: 4 });
      });
      expect(eventsNamed("funding_run_stop_blocked")[0]).toMatchObject({
        flow: "invest",
        chain_id: 42161,
        leg_index: 3,
        leg_count: 4,
      });
    });

    it("fires every time the run is interrupted, not only the first (Keep going can be followed by a second attempt)", () => {
      const { result } = renderHook(() => useProvisioningFunnel({}));
      act(() => {
        result.current.runStopBlocked({ legIndex: 1, legCount: 3 });
        result.current.runStopBlocked({ legIndex: 2, legCount: 3 });
      });
      expect(eventsNamed("funding_run_stop_blocked")).toHaveLength(2);
    });
  });

  describe("[R40 · POO-1506] the mid-run raise prompt is a blocked-intent event", () => {
    it("emits when 8b has something to ask", () => {
      const { result } = renderHook(() =>
        useProvisioningFunnel({ flow: "invest", chainId: 42161 }),
      );
      act(() => {
        result.current.slippageRaiseBlocked();
      });
      expect(eventsNamed("funding_slippage_raise_blocked")).toHaveLength(1);
      expect(eventsNamed("funding_slippage_raise_blocked")[0]).toMatchObject({
        flow: "invest",
        chain_id: 42161,
      });
    });
  });

  describe("[POO-1541] screen 1's route events join the shared funnel", () => {
    // Moved from `FundingRoutePicker.analytics.test.tsx` (POO-1501): the component no longer emits
    // these itself, so the payload shapes it used to assert now belong to the funnel that owns them.

    it("carries flow, chain_id and strategy_id, same as every other event in this funnel", () => {
      const { result } = renderHook(() =>
        useProvisioningFunnel({ flow: "invest", chainId: 42161, strategyId: "strat-1" }),
      );
      act(() => {
        result.current.routeViewed({ entry: 1, count: 2, recommended: "tokens", gasNeeded: true });
        result.current.routeChosen({
          kind: "buy",
          recommended: "tokens",
          followedRecommendation: false,
        });
        result.current.routeAbandoned(2);
      });
      for (const entry of pushed()) {
        expect(entry).toMatchObject({ flow: "invest", chain_id: 42161, strategy_id: "strat-1" });
      }
    });

    it("[view] reports the card count, the recommendation and whether gas was needed", () => {
      const { result } = renderHook(() => useProvisioningFunnel({}));
      act(() => {
        result.current.routeViewed({ entry: 1, count: 2, recommended: "tokens", gasNeeded: true });
      });
      expect(eventsNamed("funding_route_viewed")[0]).toMatchObject({
        funding_route_count: 2,
        funding_route_recommended: "tokens",
        funding_gas_needed: true,
      });
    });

    // @rule D1 (POO-1501) — the view fires once per ENTRY to screen 1, keyed like `planQuoted`: a
    // re-render while the picker is still on screen repeats the entry and is not a second view.
    it("[view] fires once however many renders observe the same entry still open", () => {
      const { result } = renderHook(() => useProvisioningFunnel({}));
      act(() => {
        result.current.routeViewed({ entry: 1, count: 2, recommended: "tokens", gasNeeded: true });
        result.current.routeViewed({ entry: 1, count: 2, recommended: "tokens", gasNeeded: false });
      });
      expect(eventsNamed("funding_route_viewed")).toHaveLength(1);
    });

    // POO-1541: per ENTRY, deliberately not per session. The [R20] back chevron and the buy-route
    // ghost back both return to screen 1 mid-session; each return used to be a fresh per-mount view
    // and must stay one, or the live series silently shifts meaning and chosen/viewed can exceed 1.
    it("[view] a re-entry to screen 1 is a fresh view, not a swallowed duplicate", () => {
      const { result } = renderHook(() => useProvisioningFunnel({}));
      act(() => {
        result.current.routeViewed({ entry: 1, count: 2, recommended: "tokens", gasNeeded: true });
        result.current.routeViewed({ entry: 2, count: 2, recommended: "tokens", gasNeeded: true });
      });
      expect(eventsNamed("funding_route_viewed")).toHaveLength(2);
    });

    // @rule R6 (POO-1501) — the pair's whole point: without both fields we could count route choices
    // forever and never learn whether the `Recommended` chip changes any of them.
    it("[funnel] reports the chosen route and whether it was the recommended one", () => {
      const { result } = renderHook(() => useProvisioningFunnel({}));
      act(() => {
        result.current.routeChosen({
          kind: "tokens",
          recommended: "tokens",
          followedRecommendation: true,
        });
      });
      expect(eventsNamed("funding_route_chosen")[0]).toMatchObject({
        funding_route: "tokens",
        funding_route_recommended: "tokens",
        funding_route_followed_recommendation: true,
      });
    });

    it("[funnel] reports a choice made against the recommendation", () => {
      const { result } = renderHook(() => useProvisioningFunnel({}));
      act(() => {
        result.current.routeChosen({
          kind: "buy",
          recommended: "tokens",
          followedRecommendation: false,
        });
      });
      expect(eventsNamed("funding_route_chosen")[0]).toMatchObject({
        funding_route: "buy",
        funding_route_recommended: "tokens",
        funding_route_followed_recommendation: false,
      });
    });

    // @rule R29 (POO-1541 work item 2) — `routeChosen`/`routeAbandoned` are NOT `emitOnce`.
    // Multi-choice sessions are routine, not hypothetical: the [R20] back chevron and the buy-route
    // ghost back both return the user to screen 1, and each re-entry can end in another tap. Every
    // tap is a real choice the emitter must report; only the VIEW dedupes, and per entry, not per
    // session.
    it("[funnel] a second choice in the same session is not swallowed", () => {
      const { result } = renderHook(() => useProvisioningFunnel({}));
      act(() => {
        result.current.routeChosen({
          kind: "tokens",
          recommended: "tokens",
          followedRecommendation: true,
        });
        result.current.routeChosen({
          kind: "buy",
          recommended: "tokens",
          followedRecommendation: false,
        });
      });
      expect(eventsNamed("funding_route_chosen")).toHaveLength(2);
    });

    // Premise 11: leaving without choosing is this screen's abandonment signal. The count says what
    // was on offer when the user walked away.
    it("[abandonment] reports the cancel, with the card count that was on offer", () => {
      const { result } = renderHook(() => useProvisioningFunnel({}));
      act(() => {
        result.current.routeAbandoned(2);
      });
      expect(eventsNamed("funding_route_abandoned")[0]).toMatchObject({ funding_route_count: 2 });
    });
  });

  describe("abandonment closes the funnel", () => {
    it("reports the phase the user left from when nothing else concluded the route", () => {
      const { unmount } = renderHook(() => useProvisioningFunnel({ abandonExit: () => "sources" }));
      unmount();
      expect(eventsNamed("funding_plan_abandoned")[0]).toMatchObject({ funding_exit: "sources" });
    });

    it("does not fire after a completion", () => {
      const { result, unmount } = renderHook(() =>
        useProvisioningFunnel({ abandonExit: () => "pending" }),
      );
      act(() => {
        result.current.planCompleted(CROSS_CHAIN_PLAN);
      });
      unmount();
      expect(eventsNamed("funding_plan_abandoned")).toHaveLength(0);
    });

    it("does not fire after a terminal failure", () => {
      const { result, unmount } = renderHook(() =>
        useProvisioningFunnel({ abandonExit: () => "error" }),
      );
      act(() => {
        result.current.planFailed(CROSS_CHAIN_PLAN, { errorCode: "USER_REJECTED" });
      });
      unmount();
      expect(eventsNamed("funding_plan_abandoned")).toHaveLength(0);
    });

    it("stays silent for a host that never entered the funnel", () => {
      // The gate hook mounts in all six operation modals, always. It reports the gate and nothing
      // else, so its unmount must not manufacture an abandonment for a route nobody started.
      const { result, unmount } = renderHook(() => useProvisioningFunnel({ flow: "collect" }));
      act(() => {
        result.current.gateTriggered(0.42);
      });
      unmount();
      expect(eventsNamed("funding_plan_abandoned")).toHaveLength(0);
    });
  });

  describe("[R2] no wallet address, ever", () => {
    it("leaks no raw address from a plan whose every leg carries token addresses", () => {
      const { result, unmount } = renderHook(() =>
        useProvisioningFunnel({ flow: "invest", chainId: 42161, abandonExit: () => "plan" }),
      );
      act(() => {
        result.current.gateTriggered(100);
        result.current.sourcesListed({ count: 2, usd: 900 });
        result.current.sourcesSelected({ count: 2, usd: 140 });
        result.current.planQuoted(CROSS_CHAIN_PLAN);
        result.current.planStarted(CROSS_CHAIN_PLAN);
        for (const step of CROSS_CHAIN_PLAN.steps) {
          result.current.legSettled(CROSS_CHAIN_PLAN, step.key);
        }
        result.current.planFailed(CROSS_CHAIN_PLAN, { errorCode: "USER_REJECTED" });
      });
      unmount();

      const serialized = JSON.stringify(pushed());
      expect(serialized).not.toMatch(/0x[a-fA-F0-9]{40}/);
      // And nothing hex-shaped at all: a token address truncated or lower-cased is still an address.
      expect(serialized).not.toMatch(/0x[a-fA-F0-9]{8}/);
    });
  });
});

/**
 * POO-1811 [R1]: the buffer measurement reaches the dataLayer, held or refused.
 *
 * `bufferLedger.test.ts` proves the DECISION is byte-identical to the shipped callback; this proves
 * the measurement is actually emitted, with the fields a 5%-versus-3% argument would need and none
 * of the fields it must not carry.
 */
describe("funding_buffer_consumed carries the rate that produced the budget (POO-1812 [R6])", () => {
  beforeEach(() => {
    window.dataLayer = [];
  });

  const MEASUREMENT = {
    askedBps: 120,
    cumulativeBps: 200,
    budgetBps: 600,
    headroomBps: 400,
    held: true,
    askIndex: 1,
  };

  // @rule R6 -- without these two, the consumption figures cannot be read against the budget that
  // generated them, which is exactly the question `FU-006` leaves open for measured data.
  it("[R6] reports the slippage and the computed rate beside the measurement", () => {
    const { result } = renderHook(() => useProvisioningFunnel({ flow: "invest", chainId: 42161 }));
    act(() => {
      result.current.bufferConsumed(CROSS_CHAIN_PLAN, MEASUREMENT, {
        slippagePct: 5,
        rateBps: 600,
      });
    });

    expect(pushed()).toContainEqual(
      expect.objectContaining({
        event: "funding_buffer_consumed",
        slippage_pct: 5,
        rate_bps: 600,
        buffer_budget_bps: 600,
      }),
    );
  });

  // @rule R6 -- a TYPE-level pin, and the only place the omission it guards is visible. An object
  // SPREAD is not subject to excess-property checking, so `emit` accepted both params happily while
  // `AnalyticsParams`, the contract that is supposed to declare every GA4 dimension this app sends,
  // had never heard of either. `Pick` does not compile if a key is undeclared, so `pnpm typecheck`
  // now fails the moment the emit and the contract disagree again.
  it("[R6] declares both params on the analytics contract, not only inside the emit", () => {
    const declared: Pick<AnalyticsParams, "slippage_pct" | "rate_bps"> = {
      slippage_pct: 5,
      rate_bps: 600,
    };
    expect(declared).toEqual({ slippage_pct: 5, rate_bps: 600 });
  });

  // @rule R4 -- the pair is not a restatement of the budget. POO-1812 [R4] pins `buffer_budget_bps`
  // to the rate the run was SEEDED with, so a mid-run raise has to be legible as a rate ABOVE that
  // budget. Collapsing the two into one number would hide exactly the case `FU-006` needs to read.
  it("[R4] reports a raised rate ABOVE the budget the run is still held to", () => {
    const { result } = renderHook(() => useProvisioningFunnel({ flow: "invest", chainId: 42161 }));
    act(() => {
      result.current.bufferConsumed(CROSS_CHAIN_PLAN, MEASUREMENT, {
        slippagePct: 6,
        rateBps: 700,
      });
    });

    const [row] = eventsNamed("funding_buffer_consumed");
    expect(row).toMatchObject({ buffer_budget_bps: 600, rate_bps: 700, slippage_pct: 6 });
  });

  // @rule R6 -- omitted rather than defaulted, so a row without them reads as "not reported" and
  // never as a fabricated zero. That distinction is the whole point of the measurement.
  it("[R6] omits both when the caller has not opted in", () => {
    const { result } = renderHook(() => useProvisioningFunnel({ flow: "invest", chainId: 42161 }));
    act(() => {
      result.current.bufferConsumed(CROSS_CHAIN_PLAN, MEASUREMENT);
    });

    const [row] = pushed().filter(
      (e) => (e as { event?: string }).event === "funding_buffer_consumed",
    );
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("slippage_pct");
    expect(row).not.toHaveProperty("rate_bps");
  });

  // @rule R6 -- a run with no slippage figure still reports the rate it used.
  it("[R6] reports the rate even when the slippage is unknown", () => {
    const { result } = renderHook(() => useProvisioningFunnel({ flow: "invest", chainId: 42161 }));
    act(() => {
      result.current.bufferConsumed(CROSS_CHAIN_PLAN, MEASUREMENT, { rateBps: 500 });
    });

    const [row] = pushed().filter(
      (e) => (e as { event?: string }).event === "funding_buffer_consumed",
    );
    expect(row).toMatchObject({ rate_bps: 500 });
    expect(row).not.toHaveProperty("slippage_pct");
  });
});

describe("funding_buffer_consumed (POO-1811)", () => {
  beforeEach(() => {
    window.dataLayer = [];
  });

  // @rule R1
  it("[R1] emits the whole measurement in basis points, with the plan it belongs to", () => {
    const { result } = renderHook(() => useProvisioningFunnel({ flow: "invest", chainId: 42161 }));
    act(() => {
      result.current.bufferConsumed(CROSS_CHAIN_PLAN, {
        askedBps: 120,
        cumulativeBps: 200,
        budgetBps: 500,
        headroomBps: 300,
        held: true,
        askIndex: 1,
      });
    });

    expect(pushed()).toContainEqual(
      expect.objectContaining({
        event: "funding_buffer_consumed",
        buffer_asked_bps: 120,
        buffer_cumulative_bps: 200,
        buffer_budget_bps: 500,
        buffer_headroom_bps: 300,
        buffer_held: true,
        buffer_ask_index: 1,
        // The plan identity the rest of the funnel already uses, so the series joins to it.
        route_shape: "decomposed",
      }),
    );
  });

  // @rule R1
  it("[R1] reports the ordinal as buffer_ask_index and never as leg_index", () => {
    // `leg_index` is the leg's position in the ROUTE (`funding_leg_settled` fills it from
    // `step.leg?.index`). This counts ASKS, and only a leg whose re-quote came back materially worse
    // ever asks, so writing the ask ordinal into that name would put two different quantities in one
    // GA4 column.
    const { result } = renderHook(() => useProvisioningFunnel({ flow: "invest", chainId: 42161 }));
    act(() => {
      result.current.bufferConsumed(CROSS_CHAIN_PLAN, {
        askedBps: 150,
        cumulativeBps: 150,
        budgetBps: 500,
        headroomBps: 350,
        held: true,
        askIndex: 2,
      });
    });

    const [event] = eventsNamed("funding_buffer_consumed");
    expect(event).toMatchObject({ buffer_ask_index: 2 });
    expect(event).not.toHaveProperty("leg_index");
  });

  // @rule R1
  it("[R1] emits the REFUSED ask too, which is the tail the argument turns on", () => {
    // A series of holds with no refusals is itself the answer; dropping the refusals would leave
    // exactly the datapoint that decides whether 5% can become 3% unrecorded.
    const { result } = renderHook(() => useProvisioningFunnel({ flow: "invest", chainId: 42161 }));
    act(() => {
      result.current.bufferConsumed(CROSS_CHAIN_PLAN, {
        askedBps: 1030,
        cumulativeBps: 0,
        budgetBps: 500,
        headroomBps: 500,
        held: false,
        askIndex: 0,
      });
    });

    expect(pushed()).toContainEqual(
      expect.objectContaining({ event: "funding_buffer_consumed", buffer_held: false }),
    );
  });

  // @rule R1
  it("[R1] emits every ask, never deduplicated: a retry is a second market move", () => {
    const { result } = renderHook(() => useProvisioningFunnel({ flow: "invest", chainId: 42161 }));
    const ask = {
      askedBps: 50,
      cumulativeBps: 50,
      budgetBps: 500,
      headroomBps: 450,
      held: true,
      askIndex: 0,
    };
    act(() => {
      result.current.bufferConsumed(CROSS_CHAIN_PLAN, ask);
      result.current.bufferConsumed(CROSS_CHAIN_PLAN, ask);
    });

    expect(eventNames().filter((name) => name === "funding_buffer_consumed")).toHaveLength(2);
  });

  it("survives a null plan rather than dropping the measurement", () => {
    // The gate can be asked before a plan is in the ref; the ask still happened.
    const { result } = renderHook(() => useProvisioningFunnel({ flow: "invest", chainId: 42161 }));
    act(() => {
      result.current.bufferConsumed(null, {
        askedBps: 10,
        cumulativeBps: 10,
        budgetBps: 500,
        headroomBps: 490,
        held: true,
        askIndex: 0,
      });
    });

    expect(eventNames()).toContain("funding_buffer_consumed");
  });
});
