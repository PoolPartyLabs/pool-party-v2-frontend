/**
 * @id PP-STR-SCR-002
 * @name Strategy Detail — tests
 * Behavior: Discovery renders the prospectus + a single Invest action; Owned adds the "Your
 * position" card + Manage actions (Add funds / Collect / Withdraw); a paused strategy swaps Invest
 * for the paused notice + Notify / View-other-strategies.
 * POO-903 (rules v1): the Composition + Investment mandate cards start COLLAPSED in both modes —
 * body assertions expand the card from its header toggle first; state is per-visit only.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChartPoint } from "@/components/data-display/PerformanceChart";
import type { Position, Strategy, StrategyDetail } from "@/lib/schemas";
import { initialsFor } from "@/lib/utils/initials";
import { fireEvent, renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import {
  periodEnabled,
  periodSeries,
  resolveStrategyShareLink,
  StrategyDetailScreen,
} from "./StrategyDetailScreen";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
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

// Mutable so a single test can inject ?invest=; defaults to empty (effect stays a no-op).
let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

const detail: StrategyDetail = {
  lockupDays: 7,
  managerVerified: true,
  about: "A balanced mix of stablecoin yield and staking.",
  composition: [
    { label: "Stablecoin yield", weight: 60 },
    { label: "ETH staking", weight: 40 },
  ],
  mandate: {
    assets: [{ label: "USDC", maxPct: 60 }],
    protocols: [{ label: "Aave v3", maxPct: 40 }],
    networks: ["Ethereum", "Base"],
  },
  riskLimits: {
    maxDrawdown: [{ period: "30D", pct: -4 }],
    leverage: "None",
    rebalancing: "Weekly",
    liquidity: "Instant",
    strategyType: "Balanced",
    benchmark: "60/40 index",
    custody: "Non-custodial",
  },
  fees: { managementPct: 1, performancePct: 10 },
};

const strategy: Strategy = {
  id: "s1",
  name: "Stable Yield",
  manager: "Pool Party Labs",
  riskLevel: 2,
  minInvestment: 100,
  tvl: 1_250_000,
  // Investor-facing Uniswap pool TVL, distinct from the managed value (tvl) — POO-390.
  uniswapPoolTvlUsd: 18_300_000,
  investors: 312,
  estReturn: 7.4,
  rateType: "APY",
  status: "active",
  detail,
};

const position: Position = {
  id: "p1",
  strategyId: "s1",
  invested: 1800,
  currentValue: 2050,
  totalYield: 250,
  available: 120,
  reinvestment: "auto-compound",
  status: "active",
};

const chartData = [
  { value: 100, label: "Mon" },
  { value: 110, label: "Tue" },
  { value: 105, label: "Wed" },
  { value: 120, label: "Thu" },
];

beforeEach(() => {
  window.dataLayer = [];
  mockSearchParams = new URLSearchParams();
});

describe("StrategyDetailScreen (Discovery)", () => {
  it("renders the prospectus sections and a single Invest action", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    expect(screen.getByRole("heading", { name: "Stable Yield", level: 1 })).toBeInTheDocument();
    expect(screen.getByText(detail.about)).toBeInTheDocument();
    for (const section of ["Composition", "Investment mandate", "Risk limits & terms", "Fees"]) {
      expect(screen.getByText(section)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("button", { name: "Invest" }).length).toBeGreaterThanOrEqual(1);
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({
        event: "strategy_detail_viewed",
        strategy_id: "s1",
        risk_level: 2,
      }),
    );
  });

  // POO-843 R1: the performance period tabs are available on mobile — the tablist no longer hides
  // below sm, so a phone user can switch the value window instead of being locked to the default.
  // @rule R1
  it("[R1] exposes the performance period tabs on mobile (tablist not hidden below sm)", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    const tablist = screen.getByRole("tablist", { name: "Pool value" });
    expect(tablist.className).not.toContain("hidden");
    expect(tablist.className).not.toContain("sm:flex");
  });

  // POO-819 R4: the real (v2) mapper carries the lock-up TOP-LEVEL and never fabricates `detail`, so
  // the Lock-up tile must read `strategy.lockupDays` and render the real term (not always "None"). The
  // detail copy is only the mock-parity fallback. @rule R4
  it("[R4] reads the top-level lockupDays (real mode, no detail) instead of always 'None'", () => {
    const { detail: _detail, ...bare } = strategy;
    const realStrategy: Strategy = { ...bare, lockupDays: 30 };
    renderWithProviders(
      <StrategyDetailScreen
        strategy={realStrategy}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    // The Lock-up metric tile renders the real term, not the "None" real-mode used to show.
    expect(screen.getByText("30 days")).toBeInTheDocument();
    expect(screen.queryByText("None")).toBeNull();
  });

  // POO-819 R4: top-level 0 (no lock-up) renders "None"; the detail fallback is NOT consulted. @rule R4
  it("[R4] top-level lockupDays 0 renders 'None' (no fallback to a stale detail value)", () => {
    const realStrategy: Strategy = {
      ...strategy,
      lockupDays: 0,
      detail: { ...detail, lockupDays: 7 },
    };
    renderWithProviders(
      <StrategyDetailScreen
        strategy={realStrategy}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    // Scope to the Lock-up metric tile (the prospectus also carries an unrelated "None" leverage): the
    // tile's value sits in the sibling <p> after its "Lock-up" label. Top-level 0 wins → "None".
    const lockupLabel = screen.getByText("Lock-up");
    const lockupValue = lockupLabel.nextElementSibling;
    expect(lockupValue).toHaveTextContent("None");
    expect(screen.queryByText("7 days")).toBeNull();
  });

  // POO-819 R4: mock parity — a mock strategy with detail.lockupDays and NO top-level value still
  // renders via the detail fallback exactly as before. @rule R4
  it("[R4] falls back to detail.lockupDays when no top-level value (mock parity)", () => {
    // `strategy` has detail.lockupDays = 7 and no top-level lockupDays.
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    expect(screen.getByText("7 days")).toBeInTheDocument();
  });

  // POO-740: the hero shows the manager-uploaded logo (StrategyLogo), not a first-letter monogram.
  // Regression: the hero used to render only strategy.name.charAt(0) and never the logo image.
  // @rule R1
  it("[R1] renders the strategy logo image in the hero when logoUrl is set", () => {
    const withLogo: Strategy = { ...strategy, logoUrl: "https://cdn.example/logo.png" };
    const { container } = renderWithProviders(
      <StrategyDetailScreen
        strategy={withLogo}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    expect(container.querySelector('img[src="https://cdn.example/logo.png"]')).not.toBeNull();
  });

  // @rule R2
  it("[R2] falls back to the initials monogram when there is no logo", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    expect(screen.getAllByText(initialsFor(strategy.name)).length).toBeGreaterThanOrEqual(1);
  });

  it("[POO-390 R2/R5] the TVL tile shows the Uniswap pool TVL (not the managed value), dashing when absent", () => {
    const { unmount } = renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    // The metric tile renders the pool TVL (uniswapPoolTvlUsd), never the managed value ($1.25M).
    expect(screen.getByText("$18.3M")).toBeInTheDocument();
    expect(screen.queryByText("$1.25M")).toBeNull();
    unmount();

    // No pool TVL → a dash, in both Discovery and Owned (single screen).
    const { uniswapPoolTvlUsd: _omitted, ...noPoolTvl } = strategy;
    renderWithProviders(
      <StrategyDetailScreen
        strategy={noPoolTvl}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("shows the pool pair and Uniswap protocol when the strategy has a poolPair (POO-323)", () => {
    const withPool: Strategy = {
      ...strategy,
      detail: { ...detail, poolPair: { token0: "ETH", token1: "USDC" } },
    };
    renderWithProviders(
      <StrategyDetailScreen
        strategy={withPool}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    expect(screen.getByText("ETH / USDC")).toBeInTheDocument();
    expect(screen.getByText("Uniswap v3")).toBeInTheDocument();
  });

  // @rule R1 (POO-235): the manager's own description is the About text, taking precedence over the
  // mock prospectus `detail.about`, so a manager-authored thesis surfaces to investors.
  it("renders strategy.description as About, ahead of detail.about", () => {
    const managerDescription = "Manager thesis: stablecoin carry for idle treasury cash.";
    renderWithProviders(
      <StrategyDetailScreen
        strategy={{ ...strategy, description: managerDescription }}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    expect(screen.getByText(managerDescription)).toBeInTheDocument();
    expect(screen.queryByText(detail.about)).toBeNull();
  });
});

describe("StrategyDetailScreen — manager attribution (POO-794 rules v2)", () => {
  // POO-794 v2: the hero KEEPS its inline "by @handle" text credit + verified badge, but the
  // DUPLICATE manager avatar was removed from the subline (the photo lives in the ManagerCard).
  // `handle` makes the hero render "by Pool Party Labs" as a ManagerLink — the ONLY place that exact
  // string appears (the ManagerCard renders the bare name), so it pins the hero subline.

  // @rule R1
  it("[R1] the hero keeps the 'by {manager}' text attribution", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={{ ...strategy, managerHandle: "poolpartylabs" }}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    // getByText throws if absent — the hero subline is back.
    expect(screen.getByText("by Pool Party Labs")).toBeTruthy();
  });

  // @rule R2
  it("[R2] the hero subline shows the text credit but NOT the manager avatar photo", () => {
    renderWithProviders(
      <StrategyDetailScreen
        // avatarUrl is set so a re-added hero avatar WOULD render an <img> (data-testid); the
        // assertion below then meaningfully proves the photo stays out of the subline.
        strategy={{
          ...strategy,
          managerHandle: "poolpartylabs",
          managerAvatarUrl: "https://cdn.example/pp.png",
        }}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    // Scope to the hero subline <p> (robust to the ManagerCard rendering twice for mobile + desktop).
    const subline = screen.getByText("by Pool Party Labs").closest("p");
    expect(subline).not.toBeNull();
    expect(subline?.querySelector('[data-testid="manager-avatar-image"]')).toBeNull();
  });

  // @rule R3
  it("[R3] the ManagerCard remains a manager surface (name + View profile)", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={{ ...strategy, managerHandle: "poolpartylabs" }}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    // The manager name surfaces via the ManagerCard (rail + mobile) alongside the hero credit.
    expect(screen.getAllByText("Pool Party Labs").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("link", { name: "View profile" }).length).toBeGreaterThanOrEqual(1);
  });
});

describe("StrategyDetailScreen — invest resume (POO-281 R2/R3)", () => {
  it("reopens Invest on the amount step prefilled with the ?invest= amount, then strips the param", () => {
    mockSearchParams = new URLSearchParams("invest=250");
    const replaceState = vi.spyOn(window.history, "replaceState");
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={null}
        balance={1000}
        chartData={chartData}
      />,
    );
    // POO-598 R6: the resume lands on the amount step with the amount prefilled (NOT auto-building —
    // tapping "Invest" starts the approve/permit signatures), so the user taps Invest to continue.
    expect(screen.getByLabelText("Amount to invest")).toHaveValue("250");
    expect(screen.getByRole("button", { name: "Invest" })).toBeInTheDocument();
    // Not on the post-build Review yet.
    expect(screen.queryByRole("button", { name: "Confirm investment" })).not.toBeInTheDocument();
    // The `invest` param is stripped from the URL so a refresh/back doesn't reopen the flow.
    expect(replaceState).toHaveBeenCalled();
    replaceState.mockRestore();
  });
});

describe("StrategyDetailScreen — withdraw deep-link (POO-543 R5)", () => {
  it("auto-opens the Withdraw flow for an owned position, then strips the param", () => {
    mockSearchParams = new URLSearchParams("withdraw=1");
    const replaceState = vi.spyOn(window.history, "replaceState");
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={position}
        balance={50}
        chartData={chartData}
      />,
    );
    // The Withdraw modal opens straight away (its amount step is visible for an active position).
    expect(screen.getByText("Amount to withdraw")).toBeInTheDocument();
    // The `withdraw` param is stripped so a refresh/back doesn't reopen the flow.
    expect(replaceState).toHaveBeenCalled();
    replaceState.mockRestore();
  });

  it("ignores the deep-link on a discovery (non-owned) view", () => {
    mockSearchParams = new URLSearchParams("withdraw=1");
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    // Nothing to withdraw without a position — the flow never opens.
    expect(screen.queryByText("Amount to withdraw")).toBeNull();
  });
});

describe("StrategyDetailScreen — Back route (POO-554)", () => {
  it("Back returns to the Strategies list by default (came from discovery)", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/strategies");
  });

  it("Back returns to the Portfolio when the link carried ?from=portfolio", () => {
    mockSearchParams = new URLSearchParams("from=portfolio");
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={position}
        balance={50}
        chartData={chartData}
      />,
    );
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/portfolio");
  });
});

describe("StrategyDetailScreen (Owned)", () => {
  it("renders the position card and Manage actions", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={position}
        balance={50}
        chartData={chartData}
      />,
    );
    expect(screen.getAllByText("Your position").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("$2,050.00").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: "Invest more" }).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByRole("button", { name: "Collect $250.00" }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: "Compound" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: "Withdraw" }).length).toBeGreaterThanOrEqual(1);
  });

  it("opens the Compound modal from the Manage actions", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={position}
        balance={50}
        chartData={chartData}
      />,
    );
    const [compound] = screen.getAllByRole("button", { name: "Compound" });
    if (!compound) throw new Error("expected a Compound button");
    fireEvent.click(compound);
    expect(screen.getAllByText("Available to compound").length).toBeGreaterThanOrEqual(1);
  });

  it("shows Share when owned with earnings + referral data and opens the share modal", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={position}
        balance={50}
        chartData={chartData}
        earnings={{ "24h": 1.1, "7d": 8.2, "30d": 42.3 }}
        referralLink="app.pool-party.xyz?ref=maria2026"
      />,
    );
    const [share] = screen.getAllByRole("button", { name: "Share" });
    if (!share) throw new Error("expected a Share button");
    fireEvent.click(share);
    expect(screen.getByText("Share performance")).toBeInTheDocument();
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({
        event: "strategy_share_opened",
        strategy_id: "s1",
        position_id: "p1",
      }),
    );
  });

  it("hides Share when the route provided no share data", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={position}
        balance={50}
        chartData={chartData}
      />,
    );
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("closed strategy: banner + final-value card + only the Withdraw action", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={{ ...strategy, status: "closed" }}
        position={{ ...position, status: "closed" }}
        balance={50}
        chartData={chartData}
        earnings={{ "24h": 1.1, "7d": 8.2, "30d": 42.3 }}
        referralLink="app.pool-party.xyz?ref=maria2026"
      />,
    );
    // Banner with the manager's name, between hero and position.
    expect(screen.getByText("Strategy closed")).toBeInTheDocument();
    // POO-570 (via POO-803): the closed banner no longer claims "Instant, no fee." (a closed exit
    // is NOT fee-free: gas + swap slippage + protocol fees), so the body drops that suffix.
    expect(
      screen.getByText("Pool Party Labs closed this strategy. Your funds are ready to withdraw."),
    ).toBeInTheDocument();
    // Final-value position card (no reinvestment row).
    expect(screen.getAllByText("Final value").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Total yield (realized)").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Available to withdraw").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Auto-compound")).toBeNull();
    // Only Withdraw: no Invest more / Collect / Compound.
    expect(screen.getAllByRole("button", { name: "Withdraw" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("button", { name: "Invest more" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Collect $250.00" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compound" })).toBeNull();
    // Share never appears on a closed position, even with share data (POO-185 R4).
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });
});

describe("StrategyDetailScreen (paused)", () => {
  it("shows the paused notice and reopen actions instead of Invest", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={{ ...strategy, status: "paused" }}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    expect(screen.getByText("Stable Yield is paused")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Notify me when it reopens" }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByRole("link", { name: "View other strategies" }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("button", { name: "Invest" })).toBeNull();
  });
});

/** A daily DATED series of `count` points ending at 2026-06-30 (UTC), oldest → newest. */
function dailySeries(count: number): { value: number; label: string; date: string }[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2026, 5, 30) - (count - 1 - index) * 86_400_000);
    return { value: 100 + index, label: `d${index}`, date: date.toISOString() };
  });
}

describe("periodSeries — date-based windows (POO-557 R2)", () => {
  it("windows a dated daily series by calendar days: 1W on 16 points = the last 7 days", () => {
    const series = dailySeries(16);
    expect(periodSeries(series, 0)).toEqual(series.slice(-7));
  });

  it("a window wider than the history returns the full series (never padded)", () => {
    const series = dailySeries(16);
    expect(periodSeries(series, 1)).toEqual(series); // 1M window ⊇ 16 days
    expect(periodSeries(series, 3)).toEqual(series); // 1Y window ⊇ 16 days
  });

  it("returns the full series for the 'all' period", () => {
    const series = dailySeries(40);
    expect(periodSeries(series, 4)).toEqual(series);
  });

  it("anchors the window at the LAST point's date, not at now (stale series still windows)", () => {
    // 10 daily points ending 2026-06-30: the 1W window counts back from Jun 30 regardless of today.
    const series = dailySeries(10);
    expect(periodSeries(series, 0)).toEqual(series.slice(-7));
  });

  // R4: mock chart data carries no ISO dates; the trailing-point tail keeps mock mode's current look.
  it("falls back to trailing-point slicing for a DATE-LESS (mock) series", () => {
    const dateless: ChartPoint[] = Array.from({ length: 15 }, (_, i) => ({
      value: i,
      label: `p${i}`,
    }));
    expect(periodSeries(dateless, 0)).toEqual(dateless.slice(-5));
    expect(periodSeries(dateless, 1)).toEqual(dateless.slice(-8));
    expect(periodSeries(dateless, 4)).toEqual(dateless);
    expect(periodSeries(dateless.slice(0, 2), 1)).toEqual(dateless.slice(0, 2));
  });
});

describe("periodEnabled — tab gating (POO-557 R2)", () => {
  it("16 daily points: 1W and 1M enabled; 3M and 1Y disabled (duplicates of 1M); All always on", () => {
    const series = dailySeries(16);
    expect([0, 1, 2, 3, 4].map((p) => periodEnabled(series, p))).toEqual([
      true,
      true,
      false,
      false,
      true,
    ]);
  });

  it("disables a tab whose window would contain fewer than 2 points (never silently widened)", () => {
    // Two points 60 days apart: 1W and 1M windows hold only the anchor point.
    const sparse = [
      { value: 1, label: "a", date: "2026-05-01T00:00:00.000Z" },
      { value: 2, label: "b", date: "2026-06-30T00:00:00.000Z" },
    ];
    expect([0, 1, 2, 3, 4].map((p) => periodEnabled(sparse, p))).toEqual([
      false,
      false,
      true, // 3M holds both points and is not a duplicate of the (dead) 1M
      false, // 1Y duplicates 3M
      true,
    ]);
  });

  it("keeps a wider tab enabled while it still adds points over the previous tab", () => {
    // 8 daily points span 7 days: 1W shows 7 of 8, 1M shows all 8 → both distinct, both enabled.
    const series = dailySeries(8);
    expect(periodEnabled(series, 0)).toBe(true);
    expect(periodEnabled(series, 1)).toBe(true);
    expect(periodEnabled(series, 2)).toBe(false);
  });

  it("keeps every tab enabled for a DATE-LESS (mock) series (R4: mock behavior unchanged)", () => {
    const dateless: ChartPoint[] = Array.from({ length: 9 }, (_, i) => ({
      value: i,
      label: `p${i}`,
    }));
    expect([0, 1, 2, 3, 4].every((p) => periodEnabled(dateless, p))).toBe(true);
  });
});

describe("resolveStrategyShareLink (POO-853 R4)", () => {
  // @rule R4: an explicit prop wins; else the pool-id referral link when a code exists; else the plain
  // strategy URL so the yield receipt is still shareable without a code (attribution stays account-wide).
  it("prefers the prop, then the pool-id referral link, then the plain strategy URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.pool-party.xyz");

    expect(resolveStrategyShareLink("override-link", "CODE12", "strat-x")).toBe("override-link");
    expect(resolveStrategyShareLink(null, "Maria2026", "strat-x")).toBe(
      "app.pool-party.xyz/strategies/strat-x?ref=Maria2026",
    );
    expect(resolveStrategyShareLink(null, null, "strat-x")).toBe(
      "app.pool-party.xyz/strategies/strat-x",
    );

    vi.unstubAllEnvs();
  });
});

describe("StrategyDetailScreen — performance period selector", () => {
  it("is a live tablist that re-selects on click (default = month)", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    const [week, month] = screen.getAllByRole("tab");
    if (!week || !month) throw new Error("expected the period tabs to render");
    // Default selection is the 2nd period (month, index 1).
    expect(month).toHaveAttribute("aria-selected", "true");
    expect(week).toHaveAttribute("aria-selected", "false");
    fireEvent.click(week);
    expect(week).toHaveAttribute("aria-selected", "true");
    expect(month).toHaveAttribute("aria-selected", "false");
  });

  // @rule R2 (POO-557): a tab whose date window exceeds the available history is disabled with an
  // accessible affordance, never silently rendered identical to a smaller tab.
  it("disables the 3M and 1Y tabs on 16 days of dated history (aria-disabled + disabled)", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={null}
        balance={50}
        chartData={dailySeries(16)}
      />,
    );
    const [week, month, quarter, year, all] = screen.getAllByRole("tab");
    if (!week || !month || !quarter || !year || !all) throw new Error("expected 5 period tabs");
    expect(week).toBeEnabled();
    expect(month).toBeEnabled();
    expect(quarter).toBeDisabled();
    expect(quarter).toHaveAttribute("aria-disabled", "true");
    expect(year).toBeDisabled();
    expect(year).toHaveAttribute("aria-disabled", "true");
    expect(all).toBeEnabled();
    // Clicking a disabled tab never selects it.
    fireEvent.click(quarter);
    expect(quarter).toHaveAttribute("aria-selected", "false");
    expect(month).toHaveAttribute("aria-selected", "true");
  });

  it("coerces the default (1M) selection to All when 1M is disabled for a short history", () => {
    // 5 daily points: only 1W adds a distinct window, so the default month tab is disabled.
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={null}
        balance={50}
        chartData={dailySeries(5)}
      />,
    );
    const [_week, month, _quarter, _year, all] = screen.getAllByRole("tab");
    if (!month || !all) throw new Error("expected the period tabs to render");
    expect(month).toBeDisabled();
    expect(month).toHaveAttribute("aria-selected", "false");
    expect(all).toHaveAttribute("aria-selected", "true");
  });
});

describe("StrategyDetailScreen — insufficient history (POO-557 R3/R5)", () => {
  it("renders the explicit no-history state (no chart, no tabs) when the series has <2 points", () => {
    renderWithProviders(
      <StrategyDetailScreen strategy={strategy} position={null} balance={50} chartData={[]} />,
    );
    expect(screen.getByText("No history yet")).toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("never shows the no-history state when a plottable series is provided", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    expect(screen.queryByText("No history yet")).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(5);
  });
});

// POO-902 (rules v1): the metrics grid shows the strategy's Performance fee where the Investors
// count used to render — on every variant of this single screen (discovery, owned, paused, closed).
describe("StrategyDetailScreen: performance fee metric tile (POO-902)", () => {
  // @rule R1: the Investors tile is gone from the metrics grid on ALL variants (the grid renders
  // unconditionally in the central column, so each state pins the same removal).
  it("[R1] no longer renders the Investors tile on any variant", () => {
    const variants: { s: Strategy; p: Position | null }[] = [
      { s: strategy, p: null }, // discovery
      { s: strategy, p: position }, // owned
      { s: { ...strategy, status: "paused" }, p: null }, // paused
      { s: { ...strategy, status: "closed" }, p: { ...position, status: "closed" } }, // closed
    ];
    for (const { s, p } of variants) {
      const { unmount } = renderWithProviders(
        <StrategyDetailScreen strategy={s} position={p} balance={50} chartData={chartData} />,
      );
      expect(screen.queryByText("Investors")).toBeNull();
      expect(screen.queryByText("312")).toBeNull();
      unmount();
    }
  });

  // @rule R1/R2 (mock path): detail.fees.performancePct feeds the tile (fixture: 10 → "10%").
  it("[R1][R2] renders the Performance fee tile from detail.fees.performancePct (mock mode)", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    const label = screen.getByText("Performance fee");
    expect(label.nextElementSibling).toHaveTextContent("10%");
  });

  // @rule R2 (real path): the mapped top-level performanceFeePct (bps → %) feeds the tile, with no
  // mock prospectus present; it also wins over a stale detail value when both exist.
  it("[R2] renders the top-level performanceFeePct in real mode (no detail), ahead of detail", () => {
    const { detail: _detail, ...bare } = strategy;
    const { unmount } = renderWithProviders(
      <StrategyDetailScreen
        strategy={{ ...bare, performanceFeePct: 12.5 }}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    // A fractional fee keeps its precision — never rounded into a fabricated whole figure.
    expect(screen.getByText("Performance fee").nextElementSibling).toHaveTextContent("12.5%");
    unmount();

    renderWithProviders(
      <StrategyDetailScreen
        strategy={{ ...strategy, performanceFeePct: 15 }}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    expect(screen.getByText("Performance fee").nextElementSibling).toHaveTextContent("15%");
    expect(screen.queryByText("10%")).toBeNull();
  });

  // @rule R2: a genuinely zero fee renders "0%" — zero is a real figure, not an absence.
  it("[R2] renders '0%' for a genuinely zero fee (top-level 0 wins over detail)", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={{ ...strategy, performanceFeePct: 0 }}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    expect(screen.getByText("Performance fee").nextElementSibling).toHaveTextContent("0%");
  });

  // @rule R3: no fee source at all (v1 fallback: no top-level value, no detail) → the tile is
  // omitted entirely; the grid never shows a fabricated figure (POO-799).
  it("[R3] omits the tile entirely when the fee is absent (never fabricated)", () => {
    const { detail: _detail, ...bare } = strategy;
    renderWithProviders(
      <StrategyDetailScreen strategy={bare} position={null} balance={50} chartData={chartData} />,
    );
    expect(screen.queryByText("Performance fee")).toBeNull();
    // The rest of the metrics grid still renders.
    expect(screen.getByText("TVL")).toBeInTheDocument();
  });
});

/** POO-903: the prospectus cards start collapsed — expand from the header before body assertions. */
function expand(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

// POO-897 (rules v1): the Composition card shows the per-token proportion on all three variants.
// The invested/non-invested variants are covered here; the managed variant lives in
// StrategyManageView.test.tsx (it passes the already-computed allocation split).
describe("StrategyDetailScreen: composition per-token split (POO-897)", () => {
  // Real-mode (no mock prospectus) strategy carrying the raw onchain block: equal-decimals pair at
  // tick 0 (price 1), 100 vs 300 units -> 25/75 by value.
  const realStrategy: Strategy = {
    ...strategy,
    detail: undefined,
    poolPair: { token0: "ETH", token1: "USDC" },
    network: "arbitrum",
    onchain: {
      totalSupply0: "100000000",
      totalSupply1: "300000000",
      tickCurrent: 0,
      tickLower: -1000,
      tickUpper: 1000,
      decimals0: 6,
      decimals1: 6,
    },
  };

  // @rule R1/R2: the non-invested (Discovery) variant splits from the strategy's pool reserves.
  it("[R1][R2] shows the per-token split for a non-invested strategy from strategy.onchain", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={realStrategy}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    expand(/Composition/);
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.queryByText("Liquidity pool")).toBeNull();
  });

  // @rule R2: the invested variant reads the position's own reserve block (same pool -> same split).
  it("[R2] shows the per-token split for an invested strategy from the position reserves", () => {
    const investedPosition: Position = {
      ...position,
      totalSupply0: "100000000",
      totalSupply1: "300000000",
      tickCurrent: 0,
      decimals0: 6,
      decimals1: 6,
    };
    renderWithProviders(
      <StrategyDetailScreen
        strategy={{ ...realStrategy, onchain: undefined }}
        position={investedPosition}
        balance={50}
        chartData={chartData}
      />,
    );
    expand(/Composition/);
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  // @rule R4: nothing to split honestly -> today's single "Liquidity pool 100%" row.
  it("[R4] degrades to the single 'Liquidity pool 100%' row when no split source resolves", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={{ ...realStrategy, onchain: undefined }}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    expand(/Composition/);
    expect(screen.getByText("Liquidity pool")).toBeInTheDocument();
  });

  // @rule R8: the mock narrative multi-slice composition branch stays untouched.
  it("[R8] keeps the narrative detail.composition slices in mock mode (detail present)", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    expand(/Composition/);
    expand(/Investment mandate/);
    expect(screen.getByText("Stablecoin yield")).toBeInTheDocument();
    expect(screen.getByText("ETH staking")).toBeInTheDocument();
    // "60%"/"40%" also appear in the mock mandate card, so assert presence (not uniqueness).
    expect(screen.getAllByText("60%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("40%").length).toBeGreaterThanOrEqual(1);
  });
});

// POO-903 (rules v1): the Composition + Investment mandate cards start collapsed on Strategy
// Details. Real mode ([R1]) is covered in SinglePoolProspectus.test.tsx; here the mock/multi-pool
// variant's converted sections ([R2]) plus the per-visit state ([R3]) and aria semantics ([R4]).
describe("StrategyDetailScreen: prospectus cards collapsed by default (POO-903)", () => {
  // @rule R2: in mock mode (detail present) both cards render as collapsed toggles; their bodies
  // (slices bar, mandate rows) stay hidden while the OTHER prospectus sections keep their plain,
  // always-open card (scope guard).
  it("[R2] renders mock-mode Composition + Investment mandate collapsed, other sections untouched", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    expect(screen.getByRole("button", { name: /Composition/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: /Investment mandate/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    // Bodies hidden until expanded.
    expect(screen.queryByText("Stablecoin yield")).toBeNull();
    expect(screen.queryByText("Aave v3")).toBeNull();
    // Scope guard: Risk limits & terms and Fees stay plain sections (no collapse toggle), open.
    expect(screen.queryByRole("button", { name: /Risk limits & terms/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Fees/ })).toBeNull();
    expect(screen.getByText("Non-custodial")).toBeInTheDocument();
  });

  // @rule R2/R4: expanding keeps the same body content (incl. the POO-897 proportions bar and the
  // mandate rows) behind the primitive's aria-expanded toggle.
  it("[R2][R4] expanding reveals the unchanged mock bodies with aria-expanded semantics", () => {
    const { container } = renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    const composition = screen.getByRole("button", { name: /Composition/ });
    fireEvent.click(composition);
    expect(composition).toHaveAttribute("aria-expanded", "true");
    // The proportions bar (weights as widths) + slice rows are intact.
    expect(container.querySelector('[style*="width: 60%"]')).not.toBeNull();
    expect(container.querySelector('[style*="width: 40%"]')).not.toBeNull();
    expect(screen.getByText("Stablecoin yield")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Investment mandate/ }));
    expect(screen.getByText("Aave v3")).toBeInTheDocument();
    expect(screen.getByText("Ethereum")).toBeInTheDocument();
  });

  // @rule R3: per-visit local state — a fresh mount starts collapsed again (no persistence).
  it("[R3] does not persist the expanded state across mounts", () => {
    const view = renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    expand(/Composition/);
    expect(screen.getByText("Stablecoin yield")).toBeInTheDocument();
    view.unmount();
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={null}
        balance={50}
        chartData={chartData}
      />,
    );
    expect(screen.getByRole("button", { name: /Composition/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("Stablecoin yield")).toBeNull();
  });
});
