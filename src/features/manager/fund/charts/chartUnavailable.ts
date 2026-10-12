/**
 * @id PP-MGR-LIB-095
 * @name chartUnavailable
 * @description Pure decisions of the Charts unavailable state, its Back action and its load error.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8682-3253
 * @linear https://linear.app/yeildbay/issue/POO-2336
 * @implements-rules-version v1 (POO-2336)
 * @analytics-events none, pure view model; the chart host sends manager_chart_blocked.
 *
 * The selection is never owned here. Back changes only the visible tab, so the parent canvas
 * keeps its selected block and its unapplied panel draft.
 */
import type { ChartBlockReason } from "./chartModel";

/** Every cause that the code has today for a chart that cannot show price history (R4). */
export type ChartUnavailableCause = ChartBlockReason | "no_data";

/** The R4 map: each cause on the left shows the same unavailable state. */
export const CHART_UNAVAILABLE_CAUSES: readonly ChartUnavailableCause[] = [
  "no_data",
  "unconfigured",
  "unsupported_block",
  "lending_reference",
  "unsupported_pair",
  "no_selection",
];

export type ChartTab = "flow" | "charts";

export interface ChartUnavailableView {
  kind: "unavailable";
  titleKey: "unavailableTitle";
  bodyKey: "unavailableBody";
  /** Null when no block is selected. */
  selection: { label: string; noteKey: "selectionPreserved" } | null;
  backKey: "back";
  /** True only for provider no data: a new provider instance can answer with data. */
  retry: boolean;
}

export interface ChartLoadErrorView {
  kind: "loadError";
  messageKey: "loadError";
  retryKey: "retry";
}

/** R1, R2, R4: one state for all causes. The selected block label is shown when it exists. */
export function chartUnavailableView(
  cause: ChartUnavailableCause,
  selectionLabel: string | null | undefined,
): ChartUnavailableView {
  const label = selectionLabel?.trim() ?? "";
  return {
    kind: "unavailable",
    titleKey: "unavailableTitle",
    bodyKey: "unavailableBody",
    selection: label ? { label, noteKey: "selectionPreserved" } : null,
    backKey: "back",
    retry: cause === "no_data",
  };
}

/** R4, R5: provider no data is unavailable; a load timeout keeps its retry action. */
export function chartFailureView(
  failure: "no_data" | "load_timeout",
  selectionLabel: string | null | undefined,
): ChartUnavailableView | ChartLoadErrorView {
  if (failure === "no_data") return chartUnavailableView("no_data", selectionLabel);
  return { kind: "loadError", messageKey: "loadError", retryKey: "retry" };
}

/** R3: Back shows Strategy flow. The selection identity is passed through unchanged. */
export function chartBackTransition<T extends { tab: ChartTab; identity: string | null }>(
  state: T,
): Omit<T, "tab"> & { tab: "flow" } {
  return { ...state, tab: "flow" };
}

/** R6: the blocked event keeps the reason values that the code sends today. */
export function chartBlockedParams(
  context: "build" | "manage" | "solana-local",
  market: "eth-usdc" | "sol-usdc" | "unavailable",
  reason: ChartBlockReason,
) {
  return { chart_context: context, chart_market: market, chart_reason: reason };
}
