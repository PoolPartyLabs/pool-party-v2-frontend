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

  describe("[R1] the funnel emits its nine typed events", () => {
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
        result.current.legSettled(CROSS_CHAIN_PLAN, CROSS_CHAIN_PLAN.steps[0].key);
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
        result.current.legSettled(CROSS_CHAIN_PLAN, CROSS_CHAIN_PLAN.steps[1].key);
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
      const key = CROSS_CHAIN_PLAN.steps[0].key;
      act(() => {
        result.current.legSettled(CROSS_CHAIN_PLAN, key);
        result.current.legSettled(CROSS_CHAIN_PLAN, key);
        result.current.legSettled(CROSS_CHAIN_PLAN, CROSS_CHAIN_PLAN.steps[1].key);
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
          stepKey: CROSS_CHAIN_PLAN.steps[1].key,
        });
      });
      expect(eventsNamed("funding_plan_failed")[0]).toMatchObject({
        error_code: "WRONG_CHAIN",
        leg_kind: "bridge",
        leg_index: 1,
        route_shape: "decomposed",
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
