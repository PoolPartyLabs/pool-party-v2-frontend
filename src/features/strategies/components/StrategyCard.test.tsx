import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/schemas";
import { renderWithProviders, screen, within } from "../../../../tests/utils/renderWithProviders";
import { StrategyCard } from "./StrategyCard";

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

const strategy: Strategy = {
  id: "strat-test",
  name: "Test Strategy",
  manager: "Acme Capital",
  riskLevel: 3,
  minInvestment: 250,
  tvl: 500_000,
  investors: 100,
  estReturn: 9.6,
  rateType: "APY",
  status: "active",
};

describe("StrategyCard", () => {
  it("renders the strategy identity, risk and return", () => {
    renderWithProviders(<StrategyCard strategy={strategy} />);
    expect(screen.getByRole("heading", { name: "Test Strategy" })).toBeInTheDocument();
    expect(screen.getByText("by Acme Capital")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Risk level 3 of 5" })).toBeInTheDocument();
    expect(screen.getByText("$250.00")).toBeInTheDocument();
    expect(screen.getByText("9.6%")).toBeInTheDocument();
    expect(screen.getByText("APY")).toBeInTheDocument();
  });

  it("links both actions to the strategy detail", () => {
    renderWithProviders(<StrategyCard strategy={strategy} />);
    const details = screen.getByRole("link", { name: "View details" });
    const invest = screen.getByRole("link", { name: "Invest" });
    expect(details).toHaveAttribute("href", "/strategies/strat-test");
    expect(invest).toHaveAttribute("href", "/strategies/strat-test");
  });

  // POO-771 R6: the verified badge is gated on the backend-derived top-level `strategy.managerVerified`
  // (embedded via POO-758), NOT the prospectus `detail.managerVerified` — so it renders in real mode.
  const detailBase = {
    lockupDays: 0,
    about: "x",
    composition: [],
    mandate: { assets: [], protocols: [], networks: [] },
    riskLimits: {
      maxDrawdown: [],
      leverage: "",
      rebalancing: "",
      liquidity: "",
      strategyType: "",
      benchmark: "",
      custody: "",
    },
    fees: { managementPct: 0, performancePct: 0 },
  };

  // @rule R6
  it("[R6] marks the manager as verified when managerVerified is true", () => {
    renderWithProviders(<StrategyCard strategy={{ ...strategy, managerVerified: true }} />);
    const byline = screen.getByText("by Acme Capital").parentElement as HTMLElement;
    expect(within(byline).getByLabelText("Verified manager")).toBeInTheDocument();
  });

  // @rule R6
  it("[R6] hides the verified badge when managerVerified is false", () => {
    renderWithProviders(<StrategyCard strategy={{ ...strategy, managerVerified: false }} />);
    expect(screen.queryByLabelText("Verified manager")).toBeNull();
  });

  it("[R6] hides the verified badge on a lean strategy with no managerVerified", () => {
    renderWithProviders(<StrategyCard strategy={strategy} />);
    expect(screen.queryByLabelText("Verified manager")).toBeNull();
  });

  // @rule R6: the source is the embedded flag, NOT the prospectus — a verified `detail` alone must not
  // light the badge (the old gate), and top-level managerVerified alone must (the new gate).
  it("[R6] gates on managerVerified, not detail.managerVerified", () => {
    const { unmount } = renderWithProviders(
      <StrategyCard strategy={{ ...strategy, detail: { ...detailBase, managerVerified: true } }} />,
    );
    // detail says verified but the embedded flag is absent → NO badge (source changed).
    expect(screen.queryByLabelText("Verified manager")).toBeNull();
    unmount();

    renderWithProviders(
      <StrategyCard
        strategy={{
          ...strategy,
          managerVerified: true,
          detail: { ...detailBase, managerVerified: false },
        }}
      />,
    );
    // embedded flag verified even though detail says unverified → badge shows.
    expect(screen.getByLabelText("Verified manager")).toBeInTheDocument();
  });

  // @rule R3 (POO-235): the manager's description is the card subtitle when present.
  it("renders the description as a subtitle when present", () => {
    renderWithProviders(
      <StrategyCard
        strategy={{ ...strategy, description: "Delta-neutral stablecoin carry for idle cash." }}
      />,
    );
    expect(screen.getByText("Delta-neutral stablecoin carry for idle cash.")).toBeInTheDocument();
  });

  // @rule R2 (POO-235): the description is optional — no subtitle when absent.
  it("renders no description subtitle when the strategy has none", () => {
    renderWithProviders(<StrategyCard strategy={strategy} />);
    expect(screen.queryByText(/Delta-neutral stablecoin carry/)).toBeNull();
  });
});
