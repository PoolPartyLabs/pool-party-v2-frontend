/**
 * @id PP-MGR-LIB-095
 * @name chartUnavailable
 * @description Pure decisions of the Charts panel: the unavailable state (Back only) or the chart with its load error retry.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8682-3253
 * @linear https://linear.app/yeildbay/issue/POO-2336
 * @linear https://linear.app/yeildbay/issue/POO-2338
 * @implements-rules-version v1 (POO-2336 and POO-2338 rules v1)
 * @analytics-events none, pure view model; the chart host sends manager_chart_blocked.
 *
 * The selection is never owned here. Back changes only the visible tab, so the parent canvas
 * keeps its selected block and its unapplied panel draft.
 *
 * POO-2338 R10: the DEX Screener iframe sends no data message, so the `no_data` cause is gone. The
 * only provider failure is the load timeout. R5: `lending_reference` is gone, because lending blocks
 * now show the token chart of their asset.
 */
import type { ChartAvailability, ChartBlockReason, ChartMarket } from "./chartModel";

/** Every cause that the code has today for a chart that cannot show price history (R4). */
export type ChartUnavailableCause = ChartBlockReason;

/** A provider failure after the chart frame mounts. POO-2338 R10: only the load timeout. */
export type ChartFailure = "load_timeout";

export type ChartTab = "flow" | "charts";

/**
 * The R4 map: each cause, with the module that sets it. The `satisfies` check fails the type
 * check when a new block reason is added and not mapped here.
 */
export const CHART_UNAVAILABLE_CAUSES = {
  no_selection: "chartContext",
  unconfigured: "chartModel",
  unsupported_block: "chartContext",
  unsupported_pair: "chartModel",
} as const satisfies Record<ChartUnavailableCause, string>;

export interface ChartUnavailableView {
  kind: "unavailable";
  titleKey: "unavailableTitle";
  bodyKey: "unavailableBody";
  /** Null when no block is selected. */
  selection: { label: string; noteKey: "selectionPreserved" } | null;
  backKey: "back";
}

export interface ChartView {
  kind: "chart";
  market: ChartMarket;
  /** R5: only a load timeout keeps the chart panel with a retry action. */
  loadError: { messageKey: "loadError"; retryKey: "retry" } | null;
}

export type ChartPanelState = ChartUnavailableView | ChartView;

/** R1, R2: one state for all causes. The selected block label is shown when it exists. */
export function chartUnavailableView(
  selectionLabel: string | null | undefined,
): ChartUnavailableView {
  const label = selectionLabel?.trim() ?? "";
  return {
    kind: "unavailable",
    titleKey: "unavailableTitle",
    bodyKey: "unavailableBody",
    selection: label ? { label, noteKey: "selectionPreserved" } : null,
    backKey: "back",
  };
}

/** R4, R5: a blocked selection is unavailable; a load timeout keeps the chart with retry. */
export function chartPanelState(
  availability: ChartAvailability,
  failure: ChartFailure | null,
  selectionLabel: string | null | undefined,
): ChartPanelState {
  if (availability.status === "unavailable") {
    return chartUnavailableView(selectionLabel);
  }
  return {
    kind: "chart",
    market: availability.market,
    loadError: failure === "load_timeout" ? { messageKey: "loadError", retryKey: "retry" } : null,
  };
}
