/**
 * @id PP-MGR-SCR-002
 * @name buildAnalytics tests
 * @implements-rules-version v1 (POO-2157 rules v1)
 * @analytics-events none, the names and params are ASSERTED here; a test is never an emitter
 *
 * The mapping between what happened on the Build canvas and what GA4 receives (slice S7, POO-2157,
 * rules AE1 to AE6, default D20). Every mapping is a total `Record` over a domain union, so a reason,
 * a kind or a network added upstream fails to compile rather than reaching the dataLayer unmapped;
 * these tests pin the values themselves and the shape of every event.
 */
import { describe, expect, it } from "vitest";
import {
  ANALYTICS_BUILD_BLOCK_KINDS,
  ANALYTICS_BUILD_BLOCK_REASONS,
  ANALYTICS_BUILD_NETWORKS,
  ANALYTICS_EVENTS,
} from "@/lib/analytics/events";
import {
  BUILD_BLOCK_KIND_EVENT,
  BUILD_NETWORK_EVENT,
  canvasEventToAnalytics,
  PLAN_BLOCK_REASON_EVENT,
  planCounts,
  REVIEW_REFUSAL_EVENT,
} from "./buildAnalytics";
import { REVIEW_REFUSALS } from "./buildScreenModel";
import { emptyPlan, emptySpokePlan, hubPoolWithFeesPlan, spokePoolPlan } from "./plan/planTestKit";

describe("buildAnalytics: the Build events are declared (AE1 to AE6, D20)", () => {
  it("[AE1] declares the Build events and retires the landing view", () => {
    // @rule AE1
    for (const name of [
      "builder_build_viewed",
      "builder_build_started",
      "builder_block_added",
      "builder_network_added",
      "builder_network_removed",
      "builder_flow_block_inserted",
      "builder_block_removed",
      "builder_block_restored",
      "builder_build_blocked",
      "builder_build_abandoned",
      "builder_build_error",
    ]) {
      expect(ANALYTICS_EVENTS).toContain(name);
      expect(name.length).toBeLessThanOrEqual(40);
    }
    expect(ANALYTICS_EVENTS).not.toContain("builder_build_landing_viewed");
    // D20: submitted and completed are declared with the Review handoff, never ahead of it.
    expect(ANALYTICS_EVENTS).not.toContain("builder_build_submitted");
    expect(ANALYTICS_EVENTS).not.toContain("builder_build_completed");
  });

  it("[AE6] the block reason union holds every plan reason and the six Next: Review reasons", () => {
    // @rule AE6
    expect([...ANALYTICS_BUILD_BLOCK_REASONS].sort()).toEqual(
      [
        "not_in_mandate",
        "coming_soon",
        "borrow_needs_supply",
        "no_network_left",
        "network_on_canvas",
        "slot_not_allowed",
        "share_exceeds_parent",
        "auto_owned",
        "spoke_not_empty",
        "unknown_target",
        "review_empty_plan",
        "review_invalid_block",
        "review_coming_soon_block",
        "review_empty_block",
        "review_over_share",
        "review_unavailable",
      ].sort(),
    );
  });

  it("[AE6] maps every plan reason to itself, so one value means one thing across the canvas", () => {
    // @rule AE6
    for (const [reason, value] of Object.entries(PLAN_BLOCK_REASON_EVENT)) {
      expect(value).toBe(reason);
      expect(ANALYTICS_BUILD_BLOCK_REASONS).toContain(value);
    }
  });

  it("[AE6, AN4] maps each Next: Review refusal to exactly one reason of the closed union", () => {
    // @rule AE6
    // @rule AN4
    expect(Object.keys(REVIEW_REFUSAL_EVENT).sort()).toEqual([...REVIEW_REFUSALS].sort());
    const values = Object.values(REVIEW_REFUSAL_EVENT);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) expect(ANALYTICS_BUILD_BLOCK_REASONS).toContain(value);
  });

  it("[AE2] names kinds and networks by their plan ids, from closed unions", () => {
    // @rule AE2
    expect(Object.keys(BUILD_BLOCK_KIND_EVENT).sort()).toEqual(
      [...ANALYTICS_BUILD_BLOCK_KINDS].sort(),
    );
    expect(Object.keys(BUILD_NETWORK_EVENT).sort()).toEqual([...ANALYTICS_BUILD_NETWORKS].sort());
  });
});

describe("canvasEventToAnalytics: one canvas event, one GA4 event (AE2 to AE6)", () => {
  it.each([
    [
      { type: "blockAdded", kind: "uniswapV4Pool", network: "arbitrum", via: "template" },
      "builder_block_added",
      { block_kind: "uniswapV4Pool", network: "arbitrum", via: "template" },
    ],
    [
      { type: "blockAdded", kind: "aaveBorrow", network: "arbitrum", via: "port" },
      "builder_block_added",
      { block_kind: "aaveBorrow", network: "arbitrum", via: "port" },
    ],
    [
      { type: "networkAdded", network: "robinhood" },
      "builder_network_added",
      { network: "robinhood" },
    ],
    [
      { type: "networkRemoved", network: "robinhood" },
      "builder_network_removed",
      { network: "robinhood" },
    ],
    [
      { type: "flowInserted", kind: "collectFees", slot: "after" },
      "builder_flow_block_inserted",
      { block_kind: "collectFees", slot: "after" },
    ],
    [
      { type: "blockRemoved", kind: "aaveSupply" },
      "builder_block_removed",
      { block_kind: "aaveSupply" },
    ],
    [
      { type: "blockRestored", kind: "aaveSupply" },
      "builder_block_restored",
      { block_kind: "aaveSupply" },
    ],
    [
      { type: "blocked", reason: "borrow_needs_supply" },
      "builder_build_blocked",
      { block_reason: "borrow_needs_supply" },
    ],
  ] as const)("[AE2-AE6] %j is %s", (event, name, params) => {
    // @rule AE2
    // @rule AE3
    // @rule AE4
    // @rule AE5
    // @rule AE6
    expect(canvasEventToAnalytics(event)).toEqual({ event: name, params });
  });
});

describe("planCounts: what the view and the abandonment carry (AE1)", () => {
  it("[AE1] counts the cards placed and the spokes on the canvas", () => {
    // @rule AE1
    expect(planCounts(emptyPlan())).toEqual({ blocks_count: 0, spokes_count: 0 });
    expect(planCounts(emptySpokePlan())).toEqual({ blocks_count: 0, spokes_count: 1 });
    // Pills are not blocks a manager placed: Swap · auto and Collect fees are not counted.
    expect(planCounts(hubPoolWithFeesPlan())).toEqual({ blocks_count: 1, spokes_count: 0 });
    expect(planCounts(spokePoolPlan())).toEqual({ blocks_count: 1, spokes_count: 1 });
  });
});
