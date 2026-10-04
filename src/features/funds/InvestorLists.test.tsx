import { describe, expect, it, vi } from "vitest";
import { PositionCard } from "@/features/portfolio/components/PositionCard";
import { PortfolioView } from "@/features/portfolio/PortfolioView";
import { StrategyCard } from "@/features/strategies/components/StrategyCard";
import { StrategiesExploreScreen } from "@/features/strategies/StrategiesExploreScreen";
import { mockFund, mockHolder, mockWallet } from "@/mocks/data/v2Funds";
import { renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { projectInvestorFund, projectInvestorHolding } from "./investorListModel";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
describe("existing investor cards with V2 data", () => {
  // @rule R1 R2 R3
  it("uses the current strategy card with an item V2 badge, honest metrics and Details links", () => {
    renderWithProviders(<StrategyCard strategy={projectInvestorFund(mockFund)} />);
    expect(screen.getByText("V2")).toBeInTheDocument();
    expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Invest" })).toHaveAttribute(
      "href",
      `/funds/${mockFund.coreVault}`,
    );
  });
  // @rule R1 R2 R3
  it("preserves the mobile stretched link without adding a withdraw action", () => {
    const fund = { ...mockFund, state: "Closed" as const };
    renderWithProviders(
      <PositionCard
        strategy={projectInvestorFund(fund)}
        position={projectInvestorHolding(fund, mockHolder, mockWallet)}
      />,
    );
    expect(screen.getByText("V2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Balanced Income" })).toHaveAttribute(
      "href",
      `/funds/${mockFund.coreVault}?from=portfolio`,
    );
    expect(screen.queryByRole("link", { name: "Withdraw" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
  });
  // @rule R1 R2 R3 R6
  it("keeps table columns and routes a closed V2 desktop position without fake aggregate metrics", () => {
    const fund = { ...mockFund, state: "Closed" as const };
    renderWithProviders(
      <PortfolioView
        investorV2
        totalValue={null}
        currentValue={null}
        invested={null}
        totalYield={null}
        totalEarned={null}
        avgApy={null}
        allocation={null}
        chartData={[]}
        positions={[
          {
            strategy: projectInvestorFund(fund),
            position: projectInvestorHolding(fund, mockHolder, mockWallet),
          },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Withdraw" })).toHaveAttribute(
      "href",
      `/funds/${fund.coreVault}?withdraw=1&from=portfolio`,
    );
    expect(screen.getAllByText("Not available").length).toBeGreaterThan(5);
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });
  // @rule R4
  it("keeps unsupported risk control disabled with Not available", () => {
    renderWithProviders(
      <StrategiesExploreScreen
        investorV2
        strategies={[projectInvestorFund(mockFund)]}
        ownedIds={[]}
        investedIds={[]}
        paged={{
          total: 1,
          hasMore: false,
          loading: false,
          onLoadMore: () => {},
          onQueryChange: () => {},
          onRiskChange: () => {},
          onCategoriesChange: () => {},
          onSortChange: () => {},
        }}
      />,
    );
    expect(screen.getByRole("button", { name: /Browse by risk: Not available/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Risk" })).not.toBeInTheDocument();
  });
});
