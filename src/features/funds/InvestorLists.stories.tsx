/**
 * @id PP-STR-CMP-038
 * @name InvestorLists stories
 * @implements-rules-version v1 (POO-2215)
 * @analytics-events none, Storybook fixtures
 */
import type { Meta, StoryObj } from "@storybook/react";
import { PositionCard } from "@/features/portfolio/components/PositionCard";
import { StrategyCard } from "@/features/strategies/components/StrategyCard";
import { mockFund, mockHolder, mockWallet } from "@/mocks/data/v2Funds";
import { projectInvestorFund, projectInvestorHolding } from "./investorListModel";

const meta = {
  title: "Investor/V2/Existing list cards",
  component: StrategyCard,
  args: { strategy: projectInvestorFund(mockFund) },
} satisfies Meta<typeof StrategyCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Strategy: Story = {};
export const MissingMetadata: Story = {
  args: { strategy: projectInvestorFund({ ...mockFund, profile: null }) },
};
export const ClosedPosition: Story = {
  render: () => (
    <PositionCard
      strategy={projectInvestorFund(mockFund)}
      position={{ ...projectInvestorHolding(mockFund, mockHolder, mockWallet), status: "closed" }}
    />
  ),
};
