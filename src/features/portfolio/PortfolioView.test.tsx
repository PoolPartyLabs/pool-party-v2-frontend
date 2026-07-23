import { within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, userEvent } from "../../../tests/utils/renderWithProviders";
import { getClosedStrategiesAction } from "./actions";
import { PortfolioView, type PortfolioViewProps } from "./PortfolioView";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("./actions", () => ({ getClosedStrategiesAction: vi.fn() }));
const mockedClosed = vi.mocked(getClosedStrategiesAction);

const fundedProps: PortfolioViewProps = {
  totalValue: 4532.5,
  totalEarned: 612.5,
  invested: 3920,
  currentValue: 4532.5,
  totalYield: 612.5,
  avgApy: 8.4,
  chartData: [
    { value: 3920, label: "Mon" },
    { value: 4200, label: "Tue" },
    { value: 4532.5, label: "Wed" },
  ],
  allocation: [
    { level: 2, value: 2050 },
    { level: 3, value: 1500 },
    { level: 4, value: 982.5 },
  ],
  positions: [
    {
      position: {
        id: "p1",
        strategyId: "s1",
        invested: 1800,
        currentValue: 2050,
        totalYield: 250,
        available: 120,
        reinvestment: "auto-compound",
        status: "active",
      },
      strategy: {
        id: "s1",
        name: "Stable Yield",
        manager: "Pool Party Labs",
        riskLevel: 2,
        minInvestment: 100,
        tvl: 1_250_000,
        investors: 312,
        estReturn: 7.4,
        rateType: "APY",
        status: "active",
      },
    },
  ],
};

describe("PortfolioView (funded)", () => {
  it("leads with total value + unclaimed fees", () => {
    renderWithProviders(<PortfolioView {...fundedProps} />);
    // totalValue === currentValue in this fixture, so the figure appears in the hero + the KPI.
    expect(screen.getAllByText("$4,532.50").length).toBeGreaterThanOrEqual(1);
    // POO-555 R4: the pill is CURRENT claimable fees, not an all-time figure.
    const pill = screen.getByText("+$612.50 unclaimed fees");
    // POO-555 R6: positive amount -> success tone with an upward icon.
    expect(pill).toHaveClass("text-success");
    expect(pill.querySelector("svg.lucide-trending-up")).toBeInTheDocument();
  });

  it("[POO-724] renders the strategy logo in the desktop positions table", () => {
    const withLogo: PortfolioViewProps = {
      ...fundedProps,
      positions: fundedProps.positions.map((entry) => ({
        ...entry,
        strategy: { ...entry.strategy, logoUrl: "https://cdn.example.com/logo.png" },
      })),
    };
    const { container } = renderWithProviders(<PortfolioView {...withLogo} />);
    const table = container.querySelector("table");
    expect(table?.querySelector('img[src="https://cdn.example.com/logo.png"]')).toBeTruthy();
  });

  it("renders the fees pill neutrally at zero and destructively when negative (POO-555 R6)", () => {
    const { unmount } = renderWithProviders(<PortfolioView {...fundedProps} totalEarned={0} />);
    const zeroPill = screen.getByText("$0.00 unclaimed fees");
    expect(zeroPill).not.toHaveClass("text-success");
    expect(zeroPill.querySelector("svg")).toBeNull();
    unmount();
    renderWithProviders(<PortfolioView {...fundedProps} totalEarned={-25} />);
    const negativePill = screen.getByText("-$25.00 unclaimed fees");
    expect(negativePill).toHaveClass("text-destructive");
    expect(negativePill.querySelector("svg.lucide-trending-down")).toBeInTheDocument();
  });

  it("renders the KPI row and allocation legend", () => {
    renderWithProviders(<PortfolioView {...fundedProps} />);
    // "Current value" now appears in both the KPI tile and each position card.
    expect(screen.getAllByText("Current value").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Allocation by risk")).toBeInTheDocument();
    // allocation legend reuses the strategies risk labels
    expect(screen.getByText("Conservative")).toBeInTheDocument();
  });

  it("renders the owned position", () => {
    renderWithProviders(<PortfolioView {...fundedProps} />);
    expect(screen.getAllByText("Stable Yield").length).toBeGreaterThanOrEqual(1);
  });

  it("badges a position the investor manages as 'Managed' (isPoolManager)", () => {
    const base = fundedProps.positions[0] as PortfolioViewProps["positions"][number];
    renderWithProviders(
      <PortfolioView
        {...fundedProps}
        positions={[{ ...base, position: { ...base.position, isPoolManager: true } }]}
      />,
    );
    expect(screen.getAllByText("Managed").length).toBeGreaterThanOrEqual(1);
  });

  it("shows no 'Managed' badge for a plain (non-managed) holding", () => {
    renderWithProviders(<PortfolioView {...fundedProps} />);
    expect(screen.queryByText("Managed")).toBeNull();
  });

  // @rule POO-457 R6b + POO-647 R1/R3: a closed position keeps its "Closed" status on the desktop
  // table but no longer the redundant "Available to withdraw" pill; a Withdraw action replaces the
  // (always-zero) APR/APY in the Rate column, deep-linking to the detail's withdraw flow with the
  // portfolio back-context.
  it("shows Closed + a Withdraw deep-link (no Available-to-withdraw pill) on a closed desktop row", () => {
    const base = fundedProps.positions[0] as PortfolioViewProps["positions"][number];
    renderWithProviders(
      <PortfolioView
        {...fundedProps}
        positions={[{ ...base, position: { ...base.position, status: "closed" } }]}
      />,
    );
    const table = screen.getByRole("table");
    expect(within(table).getByText("Closed")).toBeInTheDocument();
    expect(within(table).queryByText("Available to withdraw")).toBeNull();
    const withdraw = within(table).getByRole("link", { name: "Withdraw" });
    expect(withdraw).toHaveAttribute("href", "/strategies/s1?withdraw=1&from=portfolio");
  });

  // @rule POO-647 R3: a non-closed row keeps its APR/APY in the Rate column and offers no Withdraw.
  it("keeps the APR/APY in the Rate column for a non-closed row (no Withdraw)", () => {
    renderWithProviders(<PortfolioView {...fundedProps} />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("7.4%")).toBeInTheDocument();
    expect(within(table).queryByRole("link", { name: "Withdraw" })).toBeNull();
  });

  // @rule POO-322: the eye masks balances only; yield/this-month/APY stay visible.
  it("masks only the $ balances when the eye is on, leaving yield + APY visible (POO-322)", async () => {
    const user = userEvent.setup();
    // Distinct figures so a masked balance string can never collide with a visible yield/APY string.
    const props: PortfolioViewProps = {
      ...fundedProps,
      totalValue: 12500,
      totalEarned: 2500,
      invested: 10000,
      currentValue: 12500,
      totalYield: 2500,
      avgApy: 14.2,
      positions: [
        {
          ...(fundedProps.positions[0] as PortfolioViewProps["positions"][number]),
          position: {
            ...(fundedProps.positions[0] as PortfolioViewProps["positions"][number]).position,
            invested: 10000,
            currentValue: 12500,
            totalYield: 2500,
          },
          strategy: {
            ...(fundedProps.positions[0] as PortfolioViewProps["positions"][number]).strategy,
            estReturn: 9.8,
          },
        },
      ],
    };
    renderWithProviders(<PortfolioView {...props} />);

    // Visible by default: the balance figure renders, no dots yet.
    expect(screen.getAllByText("$12,500.00").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("••••")).toBeNull();

    // Turn the eye on (visible by default → hide).
    await user.click(screen.getByRole("button", { name: "Hide values" }));

    // Balances are now masked: the dot run appears and the raw $ figures are gone.
    expect(screen.getAllByText("••••").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("$12,500.00")).toBeNull();
    expect(screen.queryByText("$10,000.00")).toBeNull();

    // Yield / this-month (all-time earned) and the APY % stay VISIBLE — the eye does not mask them.
    expect(screen.getAllByText("+$2,500.00").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("+$2,500.00 unclaimed fees")).toBeInTheDocument();
    expect(screen.getAllByText("14.2%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("9.8%").length).toBeGreaterThanOrEqual(1);
  });
});

// @rule POO-829 R2/R6/R7/R8 (rules v2): mock mode sorts EVERY column client-side, defaulting to
// Yield descending, with closed rows PINNED to the top (POO-457 — status is the primary sort key,
// the selected column the secondary). A sort change emits portfolio_sort_changed. The mobile card
// list gets a Sort-by control (dropdown + direction toggle) writing the SAME sort state.
describe("PortfolioView — column sort, mock mode (POO-829)", () => {
  const base = fundedProps.positions[0] as PortfolioViewProps["positions"][number];

  /** An entry with a distinct name + per-column values so every sort order is observable. */
  function entry(
    id: string,
    name: string,
    over: Partial<PortfolioViewProps["positions"][number]["position"]> = {},
    stratOver: Partial<PortfolioViewProps["positions"][number]["strategy"]> = {},
  ): PortfolioViewProps["positions"][number] {
    return {
      position: { ...base.position, id, strategyId: id, ...over },
      strategy: { ...base.strategy, id, name, ...stratOver },
    };
  }

  // Input order is scrambled on purpose: low-yield active first, closed (mid yield) last.
  const positions = [
    entry("low", "Low Yield", { totalYield: 5, invested: 9000 }, { riskLevel: 4, estReturn: 2 }),
    entry("high", "High Yield", { totalYield: 50, invested: 100 }, { riskLevel: 1, estReturn: 9 }),
    entry(
      "gone",
      "Closed Mid",
      { totalYield: 20, invested: 500, status: "closed" },
      { riskLevel: 3, estReturn: 0 },
    ),
  ];

  /** The rendered desktop-table order of the three fixture names. */
  function tableOrder(): string[] {
    const text = screen.getByRole("table").textContent ?? "";
    return ["Low Yield", "High Yield", "Closed Mid"].sort(
      (a, b) => text.indexOf(a) - text.indexOf(b),
    );
  }

  it("[R2][R6] defaults to Yield descending with closed rows pinned to the top", () => {
    renderWithProviders(<PortfolioView {...fundedProps} positions={positions} />);
    // Closed pinned first (primary key), then the actives by yield desc (secondary key).
    expect(tableOrder()).toEqual(["Closed Mid", "High Yield", "Low Yield"]);
  });

  it("[R6] clicking a column header re-sorts client-side (Risk stays interactive in mock mode)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PortfolioView {...fundedProps} positions={positions} />);
    await user.click(screen.getByRole("button", { name: "Risk" }));
    // Risk desc: closed still pinned first, then Low (risk 4) before High (risk 1).
    expect(tableOrder()).toEqual(["Closed Mid", "Low Yield", "High Yield"]);
  });

  it("[R6] clicking the active column flips the direction (yield asc)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PortfolioView {...fundedProps} positions={positions} />);
    await user.click(screen.getByRole("button", { name: "Yield" }));
    // Yield asc: the pin still wins, then Low (5) before High (50).
    expect(tableOrder()).toEqual(["Closed Mid", "Low Yield", "High Yield"]);
  });

  it("[R7] tracks portfolio_sort_changed when a sort header is clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PortfolioView {...fundedProps} positions={positions} />);
    await user.click(screen.getByRole("button", { name: "Invested" }));
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "portfolio_sort_changed" }),
    );
  });

  it("[R8] renders the mobile Sort-by control defaulting to the Yield-descending sort", () => {
    renderWithProviders(<PortfolioView {...fundedProps} positions={positions} />);
    expect(screen.getByRole("button", { name: "Sort by: Yield" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort by: Descending" })).toBeInTheDocument();
  });

  it("[R8] the mobile dropdown drives the SAME sort state as the desktop headers", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PortfolioView {...fundedProps} positions={positions} />);
    await user.click(screen.getByRole("button", { name: "Sort by: Yield" }));
    await user.click(screen.getByRole("option", { name: "Invested" }));
    // The mobile trigger reads the picked metric; the desktop header for it is the active column.
    expect(screen.getByRole("button", { name: "Sort by: Invested" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invested" })).toHaveClass("text-primary");
    // Invested desc: closed pinned, then Low (9000) before High (100).
    expect(tableOrder()).toEqual(["Closed Mid", "Low Yield", "High Yield"]);
  });

  it("[R8] the mobile direction toggle flips the shared sort direction", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PortfolioView {...fundedProps} positions={positions} />);
    expect(screen.getByRole("button", { name: "Sort by: Descending" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sort by: Descending" }));
    expect(screen.getByRole("button", { name: "Sort by: Ascending" })).toBeInTheDocument();
    // Yield asc now: Low (5) before High (50), closed still pinned.
    expect(tableOrder()).toEqual(["Closed Mid", "Low Yield", "High Yield"]);
  });
});

describe("PortfolioView (empty)", () => {
  it("renders the first-run state when there are no positions", () => {
    renderWithProviders(<PortfolioView {...fundedProps} positions={[]} />);
    expect(screen.getByRole("heading", { name: "Start growing your money" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Deposit funds" })).toBeInTheDocument();
  });
});

// @rule POO-460: the already-withdrawn closed strategies are hidden by default and revealed on
// demand as read-only history (no Withdraw — nothing left to withdraw).
describe("PortfolioView — Show closed strategies toggle", () => {
  const base = fundedProps.positions[0] as PortfolioViewProps["positions"][number];

  it("hides closed strategies by default and reveals them on toggle", async () => {
    const user = userEvent.setup();
    mockedClosed.mockResolvedValue([
      {
        position: {
          ...base.position,
          id: "pos-exited",
          strategyId: "s-x",
          currentValue: 0,
          totalYield: 74.2,
          status: "closed",
        },
        strategy: { ...base.strategy, id: "s-x", name: "ETH Momentum", status: "closed" },
      },
    ]);
    renderWithProviders(<PortfolioView {...fundedProps} />);

    expect(screen.queryByText("ETH Momentum")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Closed strategies/i }));
    expect(await screen.findByText("ETH Momentum")).toBeInTheDocument();
  });

  // @rule POO-724: the closed-strategies history row renders the StrategyLogo (mirrors the active
  // desktop table), so a manager-uploaded logo shows instead of a bare initials monogram.
  it("[POO-724] renders the strategy logo in the revealed closed-strategies list", async () => {
    const user = userEvent.setup();
    mockedClosed.mockResolvedValue([
      {
        position: {
          ...base.position,
          id: "pos-exited",
          strategyId: "s-x",
          currentValue: 0,
          totalYield: 74.2,
          status: "closed",
        },
        strategy: {
          ...base.strategy,
          id: "s-x",
          name: "ETH Momentum",
          status: "closed",
          logoUrl: "https://cdn.example.com/logo.png",
        },
      },
    ]);
    renderWithProviders(<PortfolioView {...fundedProps} />);

    await user.click(screen.getByRole("button", { name: /Closed strategies/i }));
    // Scope to the revealed history section so the assertion can never match the active table above.
    const closedList = await screen.findByText("ETH Momentum");
    const section = closedList.closest("#portfolio-closed-strategies");
    expect(section?.querySelector('img[src="https://cdn.example.com/logo.png"]')).toBeTruthy();
  });

  it("shows the empty state when there are no closed strategies", async () => {
    const user = userEvent.setup();
    mockedClosed.mockResolvedValue([]);
    renderWithProviders(<PortfolioView {...fundedProps} />);

    await user.click(screen.getByRole("button", { name: /Closed strategies/i }));
    expect(await screen.findByText("No closed strategies yet")).toBeInTheDocument();
  });

  it("[POO-526] shows a spinner while the on-demand closed-strategies read is in flight", async () => {
    const user = userEvent.setup();
    // Defer the resolution so the loading state is observable before the read completes.
    let resolveClosed!: (v: Awaited<ReturnType<typeof getClosedStrategiesAction>>) => void;
    mockedClosed.mockReturnValue(
      new Promise((resolve) => {
        resolveClosed = resolve;
      }),
    );
    renderWithProviders(<PortfolioView {...fundedProps} />);

    await user.click(screen.getByRole("button", { name: /Closed strategies/i }));
    // The exited history is fetched on demand, so it never loads eagerly; a spinner covers the wait.
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Loading");

    resolveClosed([]);
    expect(await screen.findByText("No closed strategies yet")).toBeInTheDocument();
  });
});
