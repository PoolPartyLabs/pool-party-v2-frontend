/**
 * @id PP-MGR-SCR-002
 * @name buildAnalytics
 * @implements-rules-version v1 (POO-2157 rules v1; the panel events of POO-2187 rules v1)
 * @analytics-events none emitted here: a pure mapping. The Build screen (`BuildScreen.tsx`) and the
 *   builder shell (`FundStrategyBuilderScreen.tsx`) emit through `useAnalytics().track()` what this
 *   module names (builder_block_added, builder_network_added, builder_network_removed,
 *   builder_flow_block_inserted, builder_block_removed, builder_block_configured,
 *   builder_block_applied, builder_block_discarded, builder_block_leave_blocked,
 *   builder_block_limit_hit, builder_build_blocked) and the counts it computes.
 *
 * How the Build canvas reaches GA4 (slice S7, POO-2157, rules AE1 to AE6, coordinator default D20).
 * Rides on PP-MGR-SCR-002 and has no id of its own.
 *
 * - Every value goes through a total `Record` over a DOMAIN union (`PlanBlockReason`, `BlockKind`
 *   and `FlowKind`, `NetworkId`, the Next: Review refusals), into a closed union of `events.ts`. A
 *   reason, a kind or a network added upstream fails to compile here, never reaches the dataLayer
 *   unmapped, and never needs a fallback string.
 * - The plan reasons map to THEMSELVES. A reducer's refusal and its GA4 value are one word, so a
 *   report reads the same as the code.
 * - The canvas controller (`useBuildCanvas`) reports gestures, not reducers; the mapping keeps that:
 *   a Borrow inserted at a port is `builder_block_added` (via `port`), a Swap or a Collect fees
 *   inserted there is `builder_flow_block_inserted`, exactly as the controller says.
 * - The configuration panel (POO-2187) reports through its draft (`usePanelDraft`) and the
 *   Allocation's ceiling; {@link panelEventToAnalytics} and {@link limitHitToAnalytics} map them,
 *   the panel fields and the ceiling reasons through total `Record`s into closed unions too.
 */
import type {
  AnalyticsBuildBlockKind,
  AnalyticsBuildBlockReason,
  AnalyticsBuildLimit,
  AnalyticsBuildNetwork,
  AnalyticsBuildPanelField,
  AnalyticsEvent,
  AnalyticsParams,
} from "@/lib/analytics/events";
import type { NetworkId } from "../mandateDraft";
import type { BuildCanvasEvent } from "./blocks/useBuildCanvas";
import type { ReviewRefusal } from "./buildScreenModel";
import type { PanelDraftEvent, PanelField } from "./panel/usePanelDraft";
import type { AllocationCeilingReason } from "./plan/allocationCeiling";
import type { BlockKind, BuildPlan, FlowKind, PlanBlockReason } from "./plan/buildPlan";
import { chainsWithNetwork } from "./plan/planDerive";

/** A plan reducer's refusal, as `block_reason`. The identity, checked for totality. */
export const PLAN_BLOCK_REASON_EVENT: Readonly<Record<PlanBlockReason, AnalyticsBuildBlockReason>> =
  {
    not_in_mandate: "not_in_mandate",
    coming_soon: "coming_soon",
    borrow_needs_supply: "borrow_needs_supply",
    no_network_left: "no_network_left",
    network_on_canvas: "network_on_canvas",
    slot_not_allowed: "slot_not_allowed",
    share_exceeds_parent: "share_exceeds_parent",
    auto_owned: "auto_owned",
    spoke_not_empty: "spoke_not_empty",
    unknown_target: "unknown_target",
  };

/** [AN4] A Next: Review refusal, as `block_reason`: one value per notice. */
export const REVIEW_REFUSAL_EVENT: Readonly<Record<ReviewRefusal, AnalyticsBuildBlockReason>> = {
  review_empty_plan: "review_empty_plan",
  review_invalid_block: "review_invalid_block",
  review_coming_soon_block: "review_coming_soon_block",
  review_empty_block: "review_empty_block",
  review_over_share: "review_over_share",
  review_incomplete_block: "review_incomplete_block",
  review_zero_share: "review_zero_share",
  review_stacked_positions: "review_stacked_positions",
  review_duplicate_reserve: "review_duplicate_reserve",
  review_unsupported_swap: "review_unsupported_swap",
  review_unavailable: "review_unavailable",
};

/** A block kind, as `block_kind`. */
export const BUILD_BLOCK_KIND_EVENT: Readonly<
  Record<BlockKind | FlowKind, AnalyticsBuildBlockKind>
> = {
  uniswapV4Pool: "uniswapV4Pool",
  aaveSupply: "aaveSupply",
  aaveBorrow: "aaveBorrow",
  uniswapV3Pool: "uniswapV3Pool",
  pendle: "pendle",
  gmxPerp: "gmxPerp",
  swap: "swap",
  collectFees: "collectFees",
};

/** A network, as `network`. */
export const BUILD_NETWORK_EVENT: Readonly<Record<NetworkId, AnalyticsBuildNetwork>> = {
  arbitrum: "arbitrum",
  robinhood: "robinhood",
};

/** A panel field, as `fields_changed` names it (POO-2187). The identity, checked for totality. */
export const PANEL_FIELD_EVENT: Readonly<Record<PanelField, AnalyticsBuildPanelField>> = {
  pool: "pool",
  asset: "asset",
  range: "range",
  quote: "quote",
  slippage: "slippage",
  allocation: "allocation",
};

/** [P8] The ceiling that stopped the Allocation slider, as `limit` (POO-2187). */
export const ALLOCATION_LIMIT_EVENT: Readonly<
  Record<AllocationCeilingReason, AnalyticsBuildLimit>
> = {
  protocolCap: "mandate_cap",
  networkCap: "network_cap",
  strategyRoom: "parent_share",
};

/** What a Build event carries about the plan: the cards placed and the spokes on the canvas. */
export interface PlanCounts {
  blocks_count: number;
  spokes_count: number;
}

/**
 * [AE1] The cards a manager placed (position blocks only: the app's Swap · auto and the Collect fees
 * pills are not counted) and the spoke networks on the canvas.
 */
export function planCounts(plan: BuildPlan): PlanCounts {
  const blocks = chainsWithNetwork(plan).reduce(
    (total, { chain }) => total + chain.steps.filter((step) => step.family === "position").length,
    0,
  );
  return { blocks_count: blocks, spokes_count: plan.spokes.length };
}

/** One GA4 event. */
export interface BuildAnalyticsEvent {
  event: AnalyticsEvent;
  params: AnalyticsParams;
}

/** [AE2 to AE6] A canvas event, as the GA4 event it is. */
export function canvasEventToAnalytics(event: BuildCanvasEvent): BuildAnalyticsEvent {
  switch (event.type) {
    case "blockAdded":
      return {
        event: "builder_block_added",
        params: {
          block_kind: BUILD_BLOCK_KIND_EVENT[event.kind],
          network: BUILD_NETWORK_EVENT[event.network],
          via: event.via,
        },
      };
    case "networkAdded":
      return {
        event: "builder_network_added",
        params: { network: BUILD_NETWORK_EVENT[event.network] },
      };
    case "networkRemoved":
      return {
        event: "builder_network_removed",
        params: { network: BUILD_NETWORK_EVENT[event.network] },
      };
    case "flowInserted":
      return {
        event: "builder_flow_block_inserted",
        params: { block_kind: BUILD_BLOCK_KIND_EVENT[event.kind], slot: event.slot },
      };
    case "blockRemoved":
      return {
        event: "builder_block_removed",
        params: {
          block_kind: BUILD_BLOCK_KIND_EVENT[event.kind],
          cascade_count: event.cascadeCount,
        },
      };
    case "blocked":
      return {
        event: "builder_build_blocked",
        params: { block_reason: PLAN_BLOCK_REASON_EVENT[event.reason] },
      };
  }
}

/** [POO-2187] A configuration panel event, as the GA4 event it is. */
export function panelEventToAnalytics(event: PanelDraftEvent): BuildAnalyticsEvent {
  switch (event.type) {
    case "configured":
      return {
        event: "builder_block_configured",
        params: {
          block_kind: BUILD_BLOCK_KIND_EVENT[event.kind],
          network: BUILD_NETWORK_EVENT[event.network],
        },
      };
    case "applied":
      return {
        event: "builder_block_applied",
        params: {
          block_kind: BUILD_BLOCK_KIND_EVENT[event.kind],
          fields_changed: event.fields.map((field) => PANEL_FIELD_EVENT[field]).join(","),
        },
      };
    case "discarded":
      return {
        event: "builder_block_discarded",
        params: { block_kind: BUILD_BLOCK_KIND_EVENT[event.kind] },
      };
    case "leaveBlocked":
      return {
        event: "builder_block_leave_blocked",
        params: { block_kind: BUILD_BLOCK_KIND_EVENT[event.kind] },
      };
    case "blocked":
      return {
        event: "builder_build_blocked",
        params: { block_reason: PLAN_BLOCK_REASON_EVENT[event.reason] },
      };
  }
}

/** [P8, POO-2187] The Allocation slider stopped at its ceiling: which block, which ceiling. */
export function limitHitToAnalytics(
  kind: BlockKind,
  reason: AllocationCeilingReason,
): BuildAnalyticsEvent {
  return {
    event: "builder_block_limit_hit",
    params: { block_kind: BUILD_BLOCK_KIND_EVENT[kind], limit: ALLOCATION_LIMIT_EVENT[reason] },
  };
}
