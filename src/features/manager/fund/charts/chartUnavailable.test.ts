/**
 * @id PP-MGR-LIB-095
 * @name chartUnavailable tests
 * @description Pure decisions of the Charts unavailable state and the kept load error retry.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8682-3253
 * @linear https://linear.app/yeildbay/issue/POO-2336
 * @implements-rules-version v1 (POO-2336)
 * @analytics-events none, pure view model assertions.
 *
 * R3 (Back keeps the selection and moves focus) and R6 (blocked event reasons) need the mounted
 * surface. Their tests are in StrategyChartSurface.test.tsx.
 */
import { describe, expect, it } from "vitest";
import de from "@/i18n/messages/de/manager.json";
import en from "@/i18n/messages/en/manager.json";
import es from "@/i18n/messages/es/manager.json";
import fr from "@/i18n/messages/fr/manager.json";
import ja from "@/i18n/messages/ja/manager.json";
import ko from "@/i18n/messages/ko/manager.json";
import nl from "@/i18n/messages/nl/manager.json";
import ptBR from "@/i18n/messages/pt-BR/manager.json";
import vi from "@/i18n/messages/vi/manager.json";
import zhCN from "@/i18n/messages/zh-CN/manager.json";
import zhTW from "@/i18n/messages/zh-TW/manager.json";
import type { ChartAvailability, ChartBlockReason, ChartMarket } from "./chartModel";
import {
  CHART_UNAVAILABLE_CAUSES,
  type ChartUnavailableCause,
  chartPanelState,
  chartUnavailableView,
} from "./chartUnavailable";

const copy = en.marketChart as Record<string, string>;
const market: ChartMarket = {
  id: "eth-usdc",
  symbol: "BINANCE:ETHUSDC",
  pair: "ETH / USDC",
  venue: "Binance",
};
const available: ChartAvailability = { status: "available", market };

/** Each cause as the surface receives it: a blocked availability or a provider failure. */
function stateFor(cause: ChartUnavailableCause, label: string | null) {
  return cause === "no_data"
    ? chartPanelState(available, "no_data", label)
    : chartPanelState({ status: "unavailable", reason: cause as ChartBlockReason }, null, label);
}

describe("Charts unavailable state", () => {
  // @rule R1
  it("uses the Figma title and text for an unavailable chart", () => {
    const view = chartUnavailableView("Supply USDC");
    expect(copy[view.titleKey]).toBe("Charts are unavailable.");
    expect(copy[view.bodyKey]).toBe("Price history is unavailable for this selection.");
    expect(copy[view.backKey]).toBe("Back to Strategy flow");
  });

  // @rule R2
  it("shows the selected block with the preserved selection line", () => {
    const view = chartUnavailableView("  USDG / WETH  ");
    expect(view.selection).toEqual({ label: "USDG / WETH", noteKey: "selectionPreserved" });
    expect(copy[view.selection?.noteKey ?? ""]).toBe("The selection is preserved.");
    expect(chartUnavailableView(null).selection).toBeNull();
    expect(chartUnavailableView("   ").selection).toBeNull();
  });

  // @rule R4
  it("maps every unavailable cause to the same full panel state with Back only", () => {
    const causes = Object.keys(CHART_UNAVAILABLE_CAUSES) as ChartUnavailableCause[];
    expect(causes).toHaveLength(6);
    for (const cause of causes) {
      const state = stateFor(cause, "Swap input");
      expect(state, cause).toEqual(chartUnavailableView("Swap input"));
      expect(Object.keys(state), cause).not.toContain("retry");
    }
    expect(chartPanelState(available, null, "Swap input")).toEqual({
      kind: "chart",
      market,
      loadError: null,
    });
  });

  // @rule R5
  it("keeps the chart panel and its retry action on a load error", () => {
    const state = chartPanelState(available, "load_timeout", "USDG / WETH");
    expect(state).toEqual({
      kind: "chart",
      market,
      loadError: { messageKey: "loadError", retryKey: "retry" },
    });
    expect(state.kind === "chart" ? copy[state.loadError?.retryKey ?? ""] : null).toBe("Try again");
  });

  // @rule R7
  it("has the new copy in all 11 locales with no em dash", () => {
    const locales = { de, en, es, fr, ja, ko, nl, ptBR, vi, zhCN, zhTW };
    const view = chartUnavailableView("Swap fees");
    const keys = [view.titleKey, view.bodyKey, view.backKey, "selectionPreserved"];
    for (const [locale, messages] of Object.entries(locales)) {
      const chart = messages.marketChart as Record<string, string>;
      for (const key of keys) {
        expect(chart[key], `${locale}.${key}`).toMatch(/\S/);
        expect(chart[key], `${locale}.${key}`).not.toContain(String.fromCodePoint(0x2014));
      }
    }
  });
});
