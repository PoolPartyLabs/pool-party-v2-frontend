/**
 * @id PP-DASH-CMP-002 (POO-555, POO-556, POO-367)
 * @name PortfolioChartCard.test
 * Behavior (POO-555 R6, superseded for reachability by POO-896 R4): the earned-today pill is
 * sign-aware. Success tone + upward icon only for positive earnings, neutral tone with no trend icon
 * at zero, destructive tone + downward icon for losses. A zero real-mode day must not render as a
 * positive trend badge. Since POO-896 the value arrives CLAMPED at 0 upstream (homeViewModel R4), so
 * the destructive branch is DEAD DEFENSE - locked here so an unclamped regression still renders sanely.
 * Behavior (POO-556 R3): with no plottable series (real mode before POO-368), the period tabs and
 * the chart area are hidden; with series (mock mode), all five tabs render.
 * Behavior (POO-367 R4): each period tab is shown only when its own series is plottable (>=2 points).
 * A sparse/gappy real series (short windows empty, long windows plottable) shows ONLY the plottable
 * tabs, defaults the active period to the first plottable one, and never paints a blank chart under a
 * live tab. The daily-grain 1D (`day`) period is always empty in real mode, so its tab is never shown.
 */

import { describe, expect, it } from "vitest";
import type { ChartPoint } from "@/components/data-display/PerformanceChart";
import {
  buildPortfolioSeries,
  emptyPortfolioSeries,
  type PortfolioSeries,
} from "@/mocks/data/portfolioSeries";
import {
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { PortfolioChartCard } from "./PortfolioChartCard";

const series = buildPortfolioSeries("en", 4532.5, Date.UTC(2026, 6, 4));

/** Two plottable points (>=2), enough for PerformanceChart to draw. */
const PLOTTABLE: ChartPoint[] = [
  { value: 100, label: "Jun 1", display: "$100.00" },
  { value: 200, label: "Jun 30", display: "$200.00" },
];

/**
 * A sparse real-mode shape: the short windows (`day`/`week`/`month`) hold <2 points, only the long
 * windows (`sixMonth`/`all`) plot. This is the mixed state a real, gappy indexer series produces and
 * is exactly what `buildInvestorPortfolioSeries` can return (POO-367 R4).
 */
function sparseSeries(): PortfolioSeries {
  return { day: [], week: [], month: [], sixMonth: PLOTTABLE, all: PLOTTABLE };
}

function renderCard(earnedToday: number | null) {
  renderWithProviders(
    <PortfolioChartCard totalValue={4532.5} earnedToday={earnedToday} seriesByPeriod={series} />,
  );
}

describe("PortfolioChartCard", () => {
  it("hides the period tabs and chart area when no period has a plottable series (POO-556 R3)", () => {
    renderWithProviders(
      <PortfolioChartCard
        totalValue={15.79}
        earnedToday={0}
        seriesByPeriod={emptyPortfolioSeries()}
      />,
    );
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    // The headline value still renders (POO-556 R4).
    expect(screen.getByText("$15.79")).toBeInTheDocument();
  });

  it("shows all five period tabs when the series is plottable (mock mode)", () => {
    renderCard(12.5);
    expect(screen.getAllByRole("tab")).toHaveLength(5);
  });

  // @rule R4 When 1M plots (mock mode, every period full), it stays the conventional default period.
  it("[R4] defaults the active tab to 1M when it is plottable (mock mode)", () => {
    renderCard(12.5);
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("1M");
  });

  // @rule R4 A tab is shown only when its own window holds >=2 points; short empty windows are omitted.
  it("[R4] shows only the tabs whose period is plottable (sparse real series)", () => {
    renderWithProviders(
      <PortfolioChartCard totalValue={200} earnedToday={0} seriesByPeriod={sparseSeries()} />,
    );
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    // Only the plottable long windows appear; the empty 1D/1W/1M tabs are not rendered.
    expect(tabs).toEqual(["6M", "All"]);
    expect(screen.queryByRole("tab", { name: "1D" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "1W" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "1M" })).not.toBeInTheDocument();
  });

  // @rule R4 The daily grain cannot plot the hourly 1D period, so its tab is never shown in real mode.
  it("[R4] never shows the 1D tab when 1D is empty but other periods plot", () => {
    const withoutDay: PortfolioSeries = {
      day: [],
      week: PLOTTABLE,
      month: PLOTTABLE,
      sixMonth: PLOTTABLE,
      all: PLOTTABLE,
    };
    renderWithProviders(
      <PortfolioChartCard totalValue={200} earnedToday={0} seriesByPeriod={withoutDay} />,
    );
    expect(screen.queryByRole("tab", { name: "1D" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
  });

  // @rule R4 The default active period must be a plottable one, so the chart is never a blank box on
  // first paint under a live tab (the default "month" is empty in the sparse state).
  it("[R4] defaults the active tab to the first plottable period and paints its chart", () => {
    renderWithProviders(
      <PortfolioChartCard totalValue={200} earnedToday={0} seriesByPeriod={sparseSeries()} />,
    );
    const selected = screen.getByRole("tab", { selected: true });
    expect(selected).toHaveTextContent("6M");
    // The chart area renders (PerformanceChart draws its <svg>) rather than a blank reserved box.
    expect(screen.getByRole("img", { name: "Portfolio value" })).toBeInTheDocument();
  });

  // @rule R4 Selecting a plottable tab keeps the chart rendered (no dead tab over a blank box).
  it("[R4] keeps the chart rendered after selecting another plottable tab", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PortfolioChartCard totalValue={200} earnedToday={0} seriesByPeriod={sparseSeries()} />,
    );
    await user.click(screen.getByRole("tab", { name: "All" }));
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("img", { name: "Portfolio value" })).toBeInTheDocument();
  });

  it("renders a positive earned-today pill with success tone and an upward icon", () => {
    renderCard(12.5);
    const pill = screen.getByText("+$12.50 earned today");
    expect(pill).toHaveClass("text-success");
    expect(pill.querySelector("svg.lucide-trending-up")).toBeInTheDocument();
  });

  it("renders a zero earned-today pill neutrally, with no trend icon", () => {
    renderCard(0);
    const pill = screen.getByText("$0.00 earned today");
    expect(pill).not.toHaveClass("text-success");
    expect(pill).not.toHaveClass("text-destructive");
    expect(pill.querySelector("svg")).toBeNull();
  });

  // POO-896 R4: unreachable in production (the sum is clamped at 0 in homeViewModel) - kept as dead
  // defense so a future unclamped feed still renders a sane loss pill instead of a broken positive.
  it("renders a negative earned-today pill with destructive tone and a downward icon (dead defense)", () => {
    renderCard(-8.25);
    const pill = screen.getByText("-$8.25 earned today");
    expect(pill).toHaveClass("text-destructive");
    expect(pill.querySelector("svg.lucide-trending-down")).toBeInTheDocument();
  });

  // POO-936 [R5]: a served-NULL earnedToday (the /financials cutover has not populated this field yet)
  // renders the honest "not available yet" affordance, NEVER a fabricated "+$0.00". The badge must not
  // carry a positive/negative tone or a trend icon.
  it("[R5] renders the honest 'not available yet' affordance for a null earnedToday (never $0)", () => {
    renderCard(null);
    const pill = screen.getByText("Not available yet earned today");
    // Never a fabricated zero-dollar badge.
    expect(screen.queryByText("$0.00 earned today")).not.toBeInTheDocument();
    // Neutral tone, no trend icon (not a positive/negative signal).
    expect(pill).not.toHaveClass("text-success");
    expect(pill).not.toHaveClass("text-destructive");
    expect(pill.querySelector("svg")).toBeNull();
  });

  // POO-716 R1: an "(i)" tooltip on the "Portfolio value" label explains the value is estimated, not
  // real-time. The copy doubles as the trigger's accessible name and reveals on focus (keyboard a11y).
  it("[POO-716] reveals an estimated-value tooltip on the Portfolio value label", async () => {
    renderCard(0);
    const trigger = screen.getByRole("button", { name: /^Estimated\./ });
    fireEvent.focus(trigger);
    const contents = await screen.findAllByText(/not updated in real time/);
    expect(contents.length).toBeGreaterThan(0);
  });
});
