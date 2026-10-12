/**
 * @id PP-MGR-CMP-103
 * @name StrategyChartSurface tests
 * @description DEX Screener frame isolation, lifecycle, keyboard boundaries and retained canvas behavior.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8678-37675
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8682-3253
 * @linear https://linear.app/yeildbay/issue/POO-2309
 * @linear https://linear.app/yeildbay/issue/POO-2336
 * @linear https://linear.app/yeildbay/issue/POO-2338
 * @i18n-namespace manager.marketChart
 * @implements-rules-version v1 (POO-2309), v1 (POO-2336), v1 (POO-2338)
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
import { CHART_EMBED_ORIGIN, type ChartMarket } from "./chartModel";
import { StrategyChartSurface } from "./StrategyChartSurface";

const POOL_ID = `0x${"d4".repeat(32)}`;
const market: ChartMarket = {
  kind: "pool",
  chain: "arbitrum",
  address: POOL_ID,
  label: "WETH / USDC",
  venue: "Uniswap v4",
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
  const element = document.querySelector<HTMLIFrameElement>("[data-chart-frame]");
  if (!element) throw new Error("Chart frame was not mounted");
  return element;
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
  // @rule R1, R4, R7, R9, R11 (POO-2338): DEX Screener pool embed, isolation and attribution.
  it("loads the exact pool on chart intent with the left toolbar and safe frame attributes", async () => {
    renderWithProviders(surface());
    expect(document.querySelector("iframe")).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "Charts" }));
    const iframe = frame();
    const url = new URL(iframe.src);
    expect(url.origin).toBe(CHART_EMBED_ORIGIN);
    expect(url.pathname).toBe(`/arbitrum/${POOL_ID}`);
    expect(url.searchParams.get("chartLeftToolbar")).toBe("1");
    expect(url.searchParams.has("info")).toBe(false);
    expect(iframe).toHaveAttribute("title", "WETH / USDC price chart");
    expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(iframe).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
    expect(screen.getByText("Pool chart")).toBeInTheDocument();
    expect(screen.getByText("WETH / USDC · Uniswap v4")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Chart by DEX Screener" })).toHaveAttribute(
      "href",
      `https://dexscreener.com/arbitrum/${POOL_ID}`,
    );
    expect(iframe.src).not.toContain("private-fund");
    expect(events("manager_chart_viewed")).toEqual([
      { event: "manager_chart_viewed", chart_context: "build", chart_market: "pool" },
    ]);
  });

  // @rule R3, R11 (POO-2338): a lending block shows the asset chart header.
  it("names the asset for a token chart", async () => {
    renderWithProviders(
      surface({
        identity: "supply-private",
        availability: {
          status: "available",
          market: {
            kind: "token",
            chain: "arbitrum",
            address: `0x${"af".repeat(20)}`,
            label: "USDC",
            venue: "Arbitrum",
          },
        },
      }),
    );
    await userEvent.click(screen.getByRole("tab", { name: "Charts" }));
    expect(screen.getByText("Asset chart")).toBeInTheDocument();
    expect(screen.getByText("USDC · Arbitrum")).toBeInTheDocument();
    expect(frame()).toHaveAttribute("title", "USDC price chart");
    expect(events("manager_chart_viewed")).toEqual([
      { event: "manager_chart_viewed", chart_context: "build", chart_market: "token" },
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
      screen.getByRole("link", { name: "Chart by DEX Screener" }),
    ];
    for (const target of chrome) {
      for (const key of ["Delete", "Backspace", "Escape"]) fireEvent.keyDown(target, { key });
    }
    expect(parentKeys).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("tab", { name: "Strategy flow" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Canvas draft" }), { key: "Delete" });
    expect(parentKeys).toHaveBeenCalledOnce();
  });

  // @rule R3: no fallback candles or substitute symbol for unsupported intent.
  // @rule R6 (POO-2336): the blocked event keeps its reason.
  it("shows an unavailable reason without a vendor frame for unsupported blocks", async () => {
    renderWithProviders(
      surface({
        identity: "supply-private",
        availability: { status: "unavailable", reason: "unsupported_block" },
      }),
    );
    await userEvent.click(screen.getByRole("tab", { name: "Charts" }));
    expect(screen.getByText("Charts are unavailable.")).toBeInTheDocument();
    expect(
      screen.getByText("Price history is unavailable for this selection."),
    ).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
    expect(events("manager_chart_blocked")).toEqual([
      {
        event: "manager_chart_blocked",
        chart_context: "build",
        chart_market: "unavailable",
        chart_reason: "unsupported_block",
      },
    ]);
  });

  // @rule R3 (POO-2336): Back shows Strategy flow, focuses its tab and keeps the selection.
  it("returns to Strategy flow with the same selection and draft", async () => {
    const unavailable: ChartSelection = {
      identity: "supply-private",
      availability: { status: "unavailable", reason: "unsupported_block" },
    };
    renderWithProviders(
      <StrategyChartSurface selection={unavailable} selectionLabel="Swap USDC" context="build">
        <CanvasDraft />
      </StrategyChartSurface>,
    );
    const input = screen.getByRole("textbox", { name: "Canvas draft" });
    await userEvent.type(input, " edited");
    await userEvent.click(screen.getByRole("tab", { name: "Charts" }));
    expect(screen.getByText("Swap USDC")).toBeInTheDocument();
    expect(screen.getByText("The selection is preserved.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back to Strategy flow" }));
    const flowTab = screen.getByRole("tab", { name: "Strategy flow" });
    expect(flowTab).toHaveAttribute("aria-selected", "true");
    expect(flowTab).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Canvas draft" })).toBe(input);
    expect(input).toHaveValue("initial edited");
    expect(events("manager_chart_closed")).toHaveLength(1);
  });

  // @rule R10 (POO-2338): the iframe load is the only load signal. No message is read.
  it("clears the loading state on iframe load and ignores window messages", async () => {
    renderWithProviders(surface());
    await userEvent.click(screen.getByRole("tab", { name: "Charts" }));
    const iframe = frame();
    expect(screen.getByRole("status")).toHaveTextContent("Loading chart...");
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: CHART_EMBED_ORIGIN,
          source: iframe.contentWindow,
          data: JSON.stringify({ name: "no-data", data: { wallet: "must-never-be-read" } }),
        }),
      );
    });
    expect(screen.getByRole("status")).toHaveTextContent("Loading chart...");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.load(iframe);
    expect(screen.queryByText("Loading chart...")).toBeNull();
    expect(events("manager_chart_failed")).toHaveLength(0);
  });

  // @rule R10 (POO-2338): retry makes a new frame with its own timer.
  // @rule R5 (POO-2336): the load error keeps its retry.
  it("retries with a new frame and ignores a late load of the previous frame", () => {
    vi.useFakeTimers();
    renderWithProviders(surface());
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Charts" }), { button: 0, ctrlKey: false });
    const old = frame();
    act(() => vi.advanceTimersByTime(20_000));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    const current = frame();
    expect(current).not.toBe(old);
    fireEvent.load(old);
    expect(screen.getByRole("status")).toHaveTextContent("Loading chart...");
    fireEvent.load(current);
    expect(screen.queryByRole("status")).toBeNull();
    expect(events("manager_chart_retried")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "Charts" })).toHaveAttribute("aria-selected", "true");
  });

  // @rule R10 (POO-2338): the 20 s timeout offers recovery and the timer stops on unmount.
  it("reports a load timeout and removes the timer on unmount", () => {
    vi.useFakeTimers();
    const view = renderWithProviders(surface());
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Charts" }), { button: 0, ctrlKey: false });
    const iframe = frame();
    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.getByRole("alert")).toHaveTextContent("The chart could not load. Try again.");
    fireEvent.load(iframe);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(events("manager_chart_failed")).toEqual([
      {
        event: "manager_chart_failed",
        chart_context: "build",
        chart_market: "pool",
        chart_reason: "load_timeout",
      },
    ]);
    view.unmount();
    act(() => vi.advanceTimersByTime(20_000));
    expect(events("manager_chart_failed")).toHaveLength(1);
    expect(events("manager_chart_closed")).toHaveLength(1);
  });

  // @rule R7, R9 (POO-2338): a new selection makes a new frame; no private data leaves it.
  it("recreates the frame on selection change and reports bounded events without private identity", async () => {
    const view = renderWithProviders(surface());
    await userEvent.click(screen.getByRole("tab", { name: "Charts" }));
    const old = frame();
    view.rerender(
      surface({ ...selected, identity: "0x1234567890123456789012345678901234567890:other-pool" }),
    );
    const current = frame();
    expect(current).not.toBe(old);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(events("manager_chart_viewed")).toHaveLength(2);
    expect(JSON.stringify(window.dataLayer)).not.toContain("0x1234");
    expect(JSON.stringify(window.dataLayer)).not.toContain(POOL_ID);
    expect(current.src).not.toContain("other-pool");
    view.rerender(surface(selected, false));
    expect(events("manager_chart_closed")).toHaveLength(2);
  });
});
