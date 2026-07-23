import { within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetReferralStateForTests } from "@/features/rewards/useReferral";
import { buildPortfolioSeries } from "@/mocks/data/portfolioSeries";
import { fireEvent, renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { HomeView, type HomeViewProps } from "./HomeView";

// The referral card shares a module-level cache — start each test from a fresh fetch.
beforeEach(() => {
  __resetReferralStateForTests();
});

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

const fundedProps: HomeViewProps = {
  totalValue: 4532.5,
  earnedToday: 36.2,
  invested: 3920,
  totalYield: 612.5,
  thisMonth: 128.4,
  avgApy: 8.4,
  seriesByPeriod: buildPortfolioSeries("en-US", 4532.5, 0),
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
        managerHandle: "pool-party-labs",
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
  discover: [
    {
      id: "s2",
      name: "Degen Rotations",
      manager: "Nova Digital",
      managerHandle: "nova-digital",
      riskLevel: 4,
      minInvestment: 500,
      tvl: 410_000,
      investors: 88,
      estReturn: 16.5,
      rateType: "APR",
      status: "active",
    },
  ],
};

describe("HomeView (funded)", () => {
  it("renders the portfolio hero with value and earned-today", () => {
    renderWithProviders(<HomeView {...fundedProps} />);
    expect(screen.getByText("$4,532.50")).toBeInTheDocument();
    expect(screen.getByText("+$36.20 earned today")).toBeInTheDocument();
  });

  // POO-704: the server-resolved owner displayName is threaded down to the greeting.
  it("[POO-704] greets with the provided owner displayName", () => {
    renderWithProviders(<HomeView {...fundedProps} displayName="Zoe Xyz" />);
    expect(
      screen.getByRole("heading", { name: /Good (morning|afternoon|evening), Zoe Xyz/ }),
    ).toBeInTheDocument();
  });

  it("renders the KPI tiles", () => {
    renderWithProviders(<HomeView {...fundedProps} />);
    expect(screen.getByText("Avg. APR")).toBeInTheDocument();
    expect(screen.getByText("8.4%")).toBeInTheDocument();
    // Total yield appears as a KPI value.
    expect(screen.getAllByText("+$612.50").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the owned position and a discovery strategy", () => {
    renderWithProviders(<HomeView {...fundedProps} />);
    // Each appears in both the mobile and desktop layouts.
    expect(screen.getAllByText("Stable Yield").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Degen Rotations").length).toBeGreaterThanOrEqual(1);
  });

  // The position tag is a rounded pill span; scope text queries to it so they don't collide with the
  // "Invested" KPI tile label and table column header, which carry the same word but aren't pills.
  const tagSelector = { selector: "span.rounded-full" } as const;

  it("tags a managed position 'Managed' (isPoolManager) on its position row", () => {
    const [held] = fundedProps.positions;
    if (!held) throw new Error("fixture: expected a position");
    renderWithProviders(
      <HomeView
        {...fundedProps}
        positions={[{ ...held, position: { ...held.position, isPoolManager: true } }]}
      />,
    );
    // One tag per surface (mobile compact card + desktop table row).
    expect(screen.getAllByText("Managed", tagSelector).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Invested", tagSelector)).toBeNull();
  });

  it("tags a non-manager position 'Invested' on its position row", () => {
    const [held] = fundedProps.positions;
    if (!held) throw new Error("fixture: expected a position");
    renderWithProviders(
      <HomeView
        {...fundedProps}
        positions={[{ ...held, position: { ...held.position, isPoolManager: false } }]}
      />,
    );
    expect(screen.getAllByText("Invested", tagSelector).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Managed", tagSelector)).toBeNull();
  });

  it("links the position name to the strategy detail in both layouts", () => {
    renderWithProviders(<HomeView {...fundedProps} />);
    // Mobile stretched card link (aria-label) + desktop table name link.
    const links = screen.getAllByRole("link", { name: "Stable Yield" });
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/strategies/s1");
    }
  });

  it("links the manager name to their public profile in both layouts", () => {
    renderWithProviders(<HomeView {...fundedProps} />);
    // Mobile compact row + desktop positions table.
    const links = screen.getAllByRole("link", { name: "Pool Party Labs" });
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/m/pool-party-labs");
    }
  });

  it("links the discover strategy name to the strategy detail", () => {
    renderWithProviders(<HomeView {...fundedProps} />);
    const named = screen
      .getAllByRole("link", { name: "Degen Rotations" })
      .filter((link) => link.getAttribute("href") === "/strategies/s2");
    expect(named.length).toBeGreaterThanOrEqual(1);
  });

  it("switches the active period tab", () => {
    renderWithProviders(<HomeView {...fundedProps} />);
    const oneDay = screen.getByRole("tab", { name: "1D" });
    expect(oneDay).toHaveAttribute("aria-selected", "false");
    fireEvent.click(oneDay);
    expect(oneDay).toHaveAttribute("aria-selected", "true");
  });

  it("navigates the discover carousel via its dots", () => {
    const [first] = fundedProps.discover;
    if (!first) throw new Error("fixture: expected a discover strategy");
    const second = { ...first, id: "s3", name: "Blue Chip DeFi" };
    renderWithProviders(<HomeView {...fundedProps} discover={[first, second]} />);
    const dot = screen.getByRole("button", { name: "Blue Chip DeFi" });
    fireEvent.click(dot);
    expect(dot).toHaveAttribute("aria-current", "true");
  });

  // POO-290 R1: the code starts unset → the card routes to the one-time creation flow. The copy /
  // share behavior of the filled card is covered by the rewards-surface tests.
  it("shows the referral create CTA before a code exists", async () => {
    renderWithProviders(<HomeView {...fundedProps} />);
    const cta = await screen.findByRole("link", { name: "Create your referral code" });
    expect(cta).toHaveAttribute("href", "/rewards/referral");
  });

  it("colors yields by sign (losing position is destructive)", () => {
    const [owned] = fundedProps.positions;
    if (!owned) throw new Error("fixture: expected a position");
    renderWithProviders(
      <HomeView
        {...fundedProps}
        totalYield={-50}
        positions={[{ ...owned, position: { ...owned.position, totalYield: -75 } }]}
      />,
    );
    // The losing position's yield renders destructive in both the mobile and desktop layouts.
    const losing = screen.getAllByText("-$75.00");
    expect(losing.length).toBeGreaterThanOrEqual(1);
    for (const cell of losing) {
      expect(cell).toHaveClass("text-destructive");
    }
    // The signed total-yield KPI tile is destructive when negative.
    expect(screen.getByText("-$50.00")).toHaveClass("text-destructive");
  });
});

// The empty state renders a mobile and a desktop layout (the steps card sits between the lead and
// the CTA on mobile, beside them on desktop), so shared copy appears once per layout — query with
// getAllBy and assert the href on every match.
describe("HomeView (empty)", () => {
  it("renders the zero state leading with an Add-funds (deposit) CTA", () => {
    renderWithProviders(<HomeView {...fundedProps} positions={[]} />);
    expect(
      screen.getAllByRole("heading", { name: "Earn yield on your dollars" }).length,
    ).toBeGreaterThanOrEqual(1);
    const cta = screen.getAllByRole("link", { name: "Add funds to start" });
    expect(cta.length).toBeGreaterThanOrEqual(1);
    for (const link of cta) expect(link).toHaveAttribute("href", "/deposit");
  });

  it("offers an 'Explore strategies first' secondary link in the zero state", () => {
    renderWithProviders(<HomeView {...fundedProps} positions={[]} />);
    const explore = screen.getAllByRole("link", { name: "Explore strategies first" });
    expect(explore.length).toBeGreaterThanOrEqual(1);
    for (const link of explore) expect(link).toHaveAttribute("href", "/strategies");
  });

  it("shows the three-step path to earning", () => {
    renderWithProviders(<HomeView {...fundedProps} positions={[]} />);
    expect(screen.getAllByText("Add funds").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Pick a strategy").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Earn").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the funded state with the available balance and a Pick-a-strategy CTA", () => {
    renderWithProviders(<HomeView {...fundedProps} positions={[]} availableToInvest={1250} />);
    expect(screen.getAllByText("Available to invest").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("$1,250.00").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByRole("heading", { name: "You're ready to invest" }).length,
    ).toBeGreaterThanOrEqual(1);
    // The CTA (a link, unlike the step-2 title text) routes to strategies.
    const cta = screen
      .getAllByRole("link", { name: "Pick a strategy" })
      .filter((link) => link.getAttribute("href") === "/strategies");
    expect(cta.length).toBeGreaterThanOrEqual(1);
  });

  it("marks step one done with the funded amount, and links 'See how it works' to help", () => {
    renderWithProviders(<HomeView {...fundedProps} positions={[]} availableToInvest={1250} />);
    expect(screen.getAllByText("Done · $1,250 added").length).toBeGreaterThanOrEqual(1);
    const help = screen.getAllByRole("link", { name: "See how it works" });
    expect(help.length).toBeGreaterThanOrEqual(1);
    for (const link of help) expect(link).toHaveAttribute("href", "/profile/help");
  });

  it("still surfaces discoverable strategies (a path to invest)", () => {
    renderWithProviders(<HomeView {...fundedProps} positions={[]} />);
    expect(screen.getAllByText("Degen Rotations").length).toBeGreaterThan(0);
  });

  it("drops the old deposit-less mascot image", () => {
    const { container } = renderWithProviders(<HomeView {...fundedProps} positions={[]} />);
    expect(container.querySelector('img[src="/brand/duck-body.png"]')).toBeNull();
  });
});

// POO-543 + POO-647: a closed Home position shows only the "Closed" cue (POO-647 dropped the
// redundant "Available to withdraw" pill — the Withdraw action already conveys it) and offers
// Withdraw in place of Manage, deep-linking to the detail's withdraw flow.
describe("HomeView (closed position, POO-543 / POO-647)", () => {
  // The tags are rounded-pill spans; scope text queries to them so "Invested" doesn't collide with
  // the KPI tile label / table column header that carry the same word but aren't pills.
  const tagSelector = { selector: "span.rounded-full" } as const;

  /** A single-closed-position props object derived from the funded fixture. */
  function closedProps(
    positionOverrides?: Partial<HomeViewProps["positions"][number]["position"]>,
  ): HomeViewProps {
    const [held] = fundedProps.positions;
    if (!held) throw new Error("fixture: expected a position");
    return {
      ...fundedProps,
      positions: [
        {
          ...held,
          position: {
            ...held.position,
            status: "closed",
            isPoolManager: false,
            ...positionOverrides,
          },
        },
      ],
    };
  }

  it("[R1] shows the Closed cue (no Available-to-withdraw pill) and drops the Invested tag", () => {
    renderWithProviders(<HomeView {...closedProps()} />);
    // One per surface (mobile compact card + desktop table row).
    expect(screen.getAllByText("Closed", tagSelector).length).toBeGreaterThanOrEqual(1);
    // POO-647: the redundant "Available to withdraw" pill is gone (the Withdraw action conveys it).
    expect(screen.queryByText("Available to withdraw", tagSelector)).toBeNull();
    // The generic Invested tag is replaced by the closed cue.
    expect(screen.queryByText("Invested", tagSelector)).toBeNull();
  });

  it("[R4] keeps the Managed tag for a manager-owned closed position", () => {
    renderWithProviders(<HomeView {...closedProps({ isPoolManager: true })} />);
    expect(screen.getAllByText("Managed", tagSelector).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Closed", tagSelector).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Invested", tagSelector)).toBeNull();
  });

  it("[R2][R3] replaces Manage with a Withdraw deep-link to the detail's withdraw flow", () => {
    renderWithProviders(<HomeView {...closedProps()} />);
    const withdraw = screen.getByRole("link", { name: "Withdraw" });
    expect(withdraw).toHaveAttribute("href", "/strategies/s1?withdraw=1");
    // A closed row carries no Manage action.
    expect(screen.queryByRole("link", { name: "Manage" })).toBeNull();
  });

  it("[R2] keeps Manage (no Withdraw) for a non-closed position", () => {
    renderWithProviders(<HomeView {...fundedProps} />);
    const manage = screen.getByRole("link", { name: "Manage" });
    expect(manage).toHaveAttribute("href", "/strategies/s1");
    expect(screen.queryByRole("link", { name: "Withdraw" })).toBeNull();
  });

  // POO-653 [R1]: a closed position's rate is stale/uninformative, so the desktop Rate column shows
  // the muted em-dash placeholder (same as the Discover empty cells) instead of an APR/APY value.
  it("[R1] hides the rate on a closed desktop row (— placeholder, no percentage)", () => {
    renderWithProviders(<HomeView {...closedProps()} />);
    const [positionsTable] = screen.getAllByRole("table");
    if (!positionsTable) throw new Error("fixture: expected the positions table");
    expect(within(positionsTable).getByText("—")).toBeInTheDocument();
    expect(within(positionsTable).queryByText("7.4%")).toBeNull();
  });

  it("[R1] still shows the APR/APY rate on a non-closed desktop row", () => {
    renderWithProviders(<HomeView {...fundedProps} />);
    const [positionsTable] = screen.getAllByRole("table");
    if (!positionsTable) throw new Error("fixture: expected the positions table");
    expect(within(positionsTable).getByText("7.4%")).toBeInTheDocument();
  });
});
