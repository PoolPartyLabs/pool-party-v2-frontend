/**
 * @id PP-MGR-LIB-095
 * @name chartUnavailable tests
 * @description Pure decisions of the Charts unavailable state, its Back action and its load error.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8682-3253
 * @linear https://linear.app/yeildbay/issue/POO-2336
 * @implements-rules-version v1 (POO-2336)
 * @analytics-events none, pure view model assertions.
 */
import { describe, expect, it } from "vitest";
import enManager from "@/i18n/messages/en/manager.json";
import type { ChartBlockReason } from "./chartModel";
import {
  CHART_UNAVAILABLE_CAUSES,
  chartBackTransition,
  chartBlockedParams,
  chartFailureView,
  chartUnavailableView,
} from "./chartUnavailable";

const copy = enManager.marketChart as Record<string, string>;
const reasons: ChartBlockReason[] = [
  "no_selection",
  "unconfigured",
  "unsupported_block",
  "lending_reference",
  "unsupported_pair",
];

describe("Charts unavailable state", () => {
  // @rule R1
  it("uses the Figma title and text for an unavailable chart", () => {
    const view = chartUnavailableView("lending_reference", "Supply USDC");
    expect(copy[view.titleKey]).toBe("Charts are unavailable.");
    expect(copy[view.bodyKey]).toBe("Price history is unavailable for this selection.");
  });

  // @rule R2
  it("shows the selected block with the preserved selection line", () => {
    const view = chartUnavailableView("unsupported_pair", "  USDG / WETH  ");
    expect(view.selection).toEqual({ label: "USDG / WETH", noteKey: "selectionPreserved" });
    expect(copy[view.selection?.noteKey ?? ""]).toBe("The selection is preserved.");
    expect(chartUnavailableView("no_selection", null).selection).toBeNull();
    expect(chartUnavailableView("unconfigured", "   ").selection).toBeNull();
  });

  // @rule R3
  it("returns to the Strategy flow tab and keeps the selected block", () => {
    const state = { tab: "charts", identity: "private-selection" } as const;
    const next = chartBackTransition(state);
    expect(next).toEqual({ tab: "flow", identity: "private-selection" });
    expect(next.identity).toBe(state.identity);
    const view = chartUnavailableView("unsupported_block", "Deposit");
    expect(copy[view.backKey]).toBe("Back to Strategy flow");
  });

  // @rule R4
  it("maps every unavailable reason of the code today to the same state", () => {
    expect([...CHART_UNAVAILABLE_CAUSES].sort()).toEqual([...reasons, "no_data"].sort());
    const reference = chartUnavailableView("no_selection", "Swap input");
    for (const cause of CHART_UNAVAILABLE_CAUSES) {
      const view = chartUnavailableView(cause, "Swap input");
      expect(view.kind).toBe("unavailable");
      expect(view.titleKey).toBe(reference.titleKey);
      expect(view.bodyKey).toBe(reference.bodyKey);
      expect(view.backKey).toBe(reference.backKey);
    }
    expect(chartFailureView("no_data", "Swap input").kind).toBe("unavailable");
    // Only a provider no data answer can change on a new instance, so only it offers retry.
    const retry = CHART_UNAVAILABLE_CAUSES.filter(
      (cause) => chartUnavailableView(cause, null).retry,
    );
    expect(retry).toEqual(["no_data"]);
  });

  // @rule R5
  it("keeps the retry action on a load error", () => {
    const view = chartFailureView("load_timeout", "USDG / WETH");
    expect(view).toEqual({ kind: "loadError", messageKey: "loadError", retryKey: "retry" });
    expect(copy[view.kind === "loadError" ? view.retryKey : ""]).toBe("Try again");
  });

  // @rule R6
  it("keeps the current manager_chart_blocked reason values", () => {
    for (const reason of reasons) {
      expect(chartBlockedParams("manage", "unavailable", reason)).toEqual({
        chart_context: "manage",
        chart_market: "unavailable",
        chart_reason: reason,
      });
    }
  });

  // @rule R7
  it("has no em dash in the new English copy", () => {
    const view = chartUnavailableView("unsupported_pair", "Swap fees");
    const keys = [view.titleKey, view.bodyKey, view.backKey, "selectionPreserved"];
    for (const key of keys) expect(copy[key]).not.toContain("\u2014");
  });
});
