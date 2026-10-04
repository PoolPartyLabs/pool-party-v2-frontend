import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { mockFund } from "@/mocks/data/v2Funds";
import { FundListCard } from "./FundListCard";

const meta = {
  title: "Funds/List card",
  component: FundListCard,
  parameters: { layout: "padded" },
  args: { fund: mockFund },
} satisfies Meta<typeof FundListCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Available: Story = {};
export const UnavailableMetrics: Story = {
  args: {
    fund: {
      ...mockFund,
      sharePrice: undefined,
      shareAssets: undefined,
      positionsSummary: undefined,
      limitsUsage: undefined,
    },
  },
};
export const ZeroAssets: Story = { args: { fund: { ...mockFund, shareAssets: "0" } } };
