/**
 * @id PP-MGR-CMP-103
 * @name StrategyChartSurface tests
 * @description Widget isolation, lifecycle, keyboard boundaries and retained canvas behavior.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8678-37675
 * @linear https://linear.app/yeildbay/issue/POO-2309
 * @i18n-namespace manager.marketChart
 * @implements-rules-version v1 (POO-2309)
 * @analytics-events none, assertions over the chart host and real analytics sink.
 */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../tests/utils/renderWithProviders";
import type { ChartSelection } from "./chartContext";
import { CHART_WIDGET_ORIGIN, type ChartMarket } from "./chartModel";
import { StrategyChartSurface } from "./StrategyChartSurface";

const market: ChartMarket = {
  id: "eth-usdc",
  symbol: "BINANCE:ETHUSDC",
  pair: "ETH / USDC",
  venue: "Binance",
};
const selected: ChartSelection = {
  identity: "private-fund:position:pool",
  availability: { status: "available", market },
};

function CanvasDraft() {
  const [draft, setDraft] = useState("initial");
  return (
    <div data-canvas-viewport="">
      <input
        aria-label="Canvas draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </div>
  );
}
function surface(selection = selected, active = true) {
  return (
    <StrategyChartSurface selection={selection} context="build" fillContainer active={active}>
      <CanvasDraft />
    </StrategyChartSurface>
  );
}
function frame(): HTMLIFrameElement {
  const element = document.querySelector<HTMLIFrameElement>("[data-tradingview-frame]");
  if (!element) throw new Error("Chart frame was not mounted");
  return element;
}
function post(
  iframe: HTMLIFrameElement,
  name: string,
  options: { origin?: string; source?: MessageEventSource | null; instance?: string } = {},
) {
  const config = JSON.parse(decodeURIComponent(new URL(iframe.src).hash.slice(1)));
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: options.origin ?? CHART_WIDGET_ORIGIN,
        source: options.source === undefined ? iframe.contentWindow : options.source,
        data: JSON.stringify({
          name,
          frameElementId: options.instance ?? config.frameElementId,
          data: { wallet: "must-never-be-read" },
        }),
      }),
    );
  });
}
function events(name: string) {
  return window.dataLayer?.filter((event) => event.event === name) ?? [];
}

beforeEach(() => {
  window.dataLayer = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Market chart surface", () => {
  // @rule R1, R6, R7: provider left toolbar, isolation and attribution.
  it("loads on chart intent with the real left toolbar and safe frame attributes", async () => {
    renderWithProviders(surface());
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector('script[src*="tradingview"]')).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "Charts" }));
    const iframe = frame();
    const url = new URL(iframe.src);
    const config = JSON.parse(decodeURIComponent(url.hash.slice(1)));
    expect(url.origin).toBe(CHART_WIDGET_ORIGIN);
    expect(config.hide_side_toolbar).toBe(false);
    expect(config.hide_top_toolbar).toBe(false);
    expect(config.allow_symbol_change).toBe(false);
    expect(config.interval).toBe("D");
    expect(iframe).toHaveAttribute("title", "ETH / USDC market reference chart");
    expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(iframe).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
    expect(screen.getByText("ETH / USDC · Binance")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Chart by TradingView" })).toHaveAttribute(
      "href",
      "https://www.tradingview.com/symbols/ETHUSDC/?exchange=BINANCE",
    );
    expect(JSON.stringify(config)).not.toContain("private-fund");
    expect(events("manager_chart_viewed")).toEqual([
      { event: "manager_chart_viewed", chart_context: "build", chart_market: "eth-usdc" },
    ]);
  });

  // @rule R4, R5, R9: tabs preserve the same draft, canvas dimensions and session drawings.
  it("retains the mounted canvas and frame while switching tabs with keyboard controls", async () => {
    renderWithProviders(surface());
    const input = screen.getByRole("textbox", { name: "Canvas draft" });
    await userEvent.type(input, " edited");
    const flowTab = screen.getByRole("tab", { name: "Strategy flow" });
    flowTab.focus();
    await userEvent.keyboard("{ArrowRight}{Enter}");
    const iframe = frame();
    const flowPanel = input.closest('[role="tabpanel"]');
    expect(flowPanel).toHaveClass("invisible");
    expect(flowPanel).toHaveAttribute("inert");
    expect(flowPanel).not.toHaveAttribute("hidden");
    expect(screen.queryByRole("textbox", { name: "Canvas draft" })).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "Strategy flow" }));
    expect(screen.getByRole("textbox", { name: "Canvas draft" })).toBe(input);
    expect(input).toHaveValue("initial edited");
    expect(frame()).toBe(iframe);
    await userEvent.click(screen.getByRole("tab", { name: "Charts" }));
    expect(frame()).toBe(iframe);
    expect(events("manager_chart_closed")).toHaveLength(1);
    expect(events("manager_chart_viewed")).toHaveLength(2);
  });

  // @rule R4, R9: chart chrome must not invoke the parent canvas keyboard actions.
  it("contains chart removal shortcuts while preserving keys from the canvas", async () => {
    const parentKeys = vi.fn();
    renderWithProviders(
      <div role="application" onKeyDown={parentKeys}>
        {surface()}
      </div>,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Charts" }));
    const chrome = [
      screen.getByRole("tab", { name: "Charts" }),
      screen.getByRole("tabpanel", { name: "Charts" }),
      screen.getByRole("link", { name: "Chart by TradingView" }),
    ];
    for (const target of chrome) {
      for (const key of ["Delete", "Backspace", "Escape"]) fireEvent.keyDown(target, { key });
    }
    post(frame(), "tv-widget-no-data");
    for (const key of ["Delete", "Backspace", "Escape"]) {
      fireEvent.keyDown(screen.getByRole("button", { name: "Try again" }), { key });
    }
    expect(parentKeys).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("tab", { name: "Strategy flow" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Canvas draft" }), { key: "Delete" });
    expect(parentKeys).toHaveBeenCalledOnce();
  });

  // @rule R3: no fallback candles or substitute symbol for unsupported intent.
  it("shows an unavailable reason without a vendor frame for unsupported blocks", async () => {
    renderWithProviders(
      surface({
        identity: "supply-private",
        availability: { status: "unavailable", reason: "lending_reference" },
      }),
    );
    await userEvent.click(screen.getByRole("tab", { name: "Charts" }));
    expect(screen.getByText("Not available")).toBeInTheDocument();
    expect(
      screen.getByText("A market price chart does not show lending APY or account risk."),
    ).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
    expect(events("manager_chart_blocked")).toEqual([
      {
        event: "manager_chart_blocked",
        chart_context: "build",
        chart_market: "unavailable",
        chart_reason: "lending_reference",
      },
    ]);
  });

  // @rule R8: boot is not a certificate of OHLCV or financial execution.
  it("accepts only current-origin messages and keeps provider no-data as a failure", async () => {
    renderWithProviders(surface());
    await userEvent.click(screen.getByRole("tab", { name: "Charts" }));
    const iframe = frame();
    expect(screen.getByRole("status")).toHaveTextContent("Loading chart...");
    post(iframe, "tv-widget-load", { origin: "https://evil.example" });
    post(iframe, "tv-widget-load", { source: window });
    post(iframe, "tv-widget-load", { instance: "other-instance" });
    fireEvent.load(iframe);
    expect(screen.getByRole("status")).toHaveTextContent("Loading chart...");
    post(iframe, "tv-widget-load");
    expect(screen.queryByText("Loading chart...")).toBeNull();
    expect(events("manager_chart_failed")).toHaveLength(0);
    post(iframe, "tv-widget-no-data");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This market reference is unavailable from TradingView.",
    );
    post(iframe, "tv-widget-load");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(events("manager_chart_failed")).toEqual([
      {
        event: "manager_chart_failed",
        chart_context: "build",
        chart_market: "eth-usdc",
        chart_reason: "no_data",
      },
    ]);
  });

  // @rule R5, R8: retry and origin switches isolate listeners and timers.
  it("retries with a new instance and ignores late messages from the previous frame", async () => {
    renderWithProviders(surface());
    await userEvent.click(screen.getByRole("tab", { name: "Charts" }));
    const old = frame();
    post(old, "tv-widget-no-data");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    const current = frame();
    expect(current).not.toBe(old);
    post(old, "tv-widget-load");
    expect(screen.getByRole("status")).toHaveTextContent("Loading chart...");
    post(current, "tv-widget-load");
    expect(screen.queryByRole("status")).toBeNull();
    expect(events("manager_chart_retried")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "Charts" })).toHaveAttribute("aria-selected", "true");
  });

  // @rule R8, R9: timeout offers recovery and preserves the draft.
  it("reports absent provider boot and removes timers/listeners on unmount", async () => {
    vi.useFakeTimers();
    const view = renderWithProviders(surface());
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Charts" }), { button: 0, ctrlKey: false });
    const iframe = frame();
    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.getByRole("alert")).toHaveTextContent("The chart could not load. Try again.");
    expect(events("manager_chart_failed")).toHaveLength(1);
    view.unmount();
    post(iframe, "tv-widget-no-data");
    act(() => vi.advanceTimersByTime(20_000));
    expect(events("manager_chart_failed")).toHaveLength(1);
    expect(events("manager_chart_closed")).toHaveLength(1);
  });

  // @rule R5, R10: different private origin means a different frame; no private data leaves it.
  it("recreates the frame on selection change and reports bounded events without private identity", async () => {
    const view = renderWithProviders(surface());
    await userEvent.click(screen.getByRole("tab", { name: "Charts" }));
    const old = frame();
    view.rerender(
      surface({ ...selected, identity: "0x1234567890123456789012345678901234567890:other-pool" }),
    );
    const current = frame();
    expect(current).not.toBe(old);
    post(old, "tv-widget-no-data");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(events("manager_chart_viewed")).toHaveLength(2);
    expect(JSON.stringify(window.dataLayer)).not.toContain("0x1234");
    expect(current.src).not.toContain("other-pool");
    view.rerender(surface(selected, false));
    expect(events("manager_chart_closed")).toHaveLength(2);
  });
});
