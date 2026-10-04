/** @id PP-STR-CMP-040 @implements-rules-version v1 (POO-2223) */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { mockFund } from "@/mocks/data/v2Funds";
import { FundComposition } from "./FundComposition";

const meta = {
  title: "Funds/Composition",
  component: FundComposition,
  args: { fund: mockFund },
  decorators: [
    (Story) => (
      <div className="max-w-2xl rounded-xl bg-surface p-5">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FundComposition>;
export default meta;
type Story = StoryObj<typeof meta>;
export const PartialCoverage: Story = {};
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 288, maxWidth: "100%" }}>
        <Story />
      </div>
    ),
  ],
};
export const NoBreakdown: Story = { args: { fund: { ...mockFund, positionsSummary: undefined } } };
export const UnknownWeights: Story = {
  args: {
    fund: {
      ...mockFund,
      positionsSummary: {
        protocolVersion: "v2",
        positions: (mockFund.positionsSummary?.positions ?? []).map((position) => ({
          ...position,
          shareOfNav: null,
        })),
      },
    },
  },
};
