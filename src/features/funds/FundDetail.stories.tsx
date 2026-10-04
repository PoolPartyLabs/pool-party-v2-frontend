/** @id PP-STR-SCR-006 @implements-rules-version v1 (POO-2216); v1 (POO-2220) */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { mockFund, mockHolder, mockWallet } from "@/mocks/data/v2Funds";
import { FundDetailsPresenter } from "./FundDetail";

const meta = {
  title: "Funds/Investor Details",
  component: FundDetailsPresenter,
  parameters: { layout: "padded" },
  args: {
    fund: mockFund,
    personal: {
      status: "ready",
      holder: {
        ...mockHolder,
        shares: "0",
        incomeOwed: "0",
        payout: { ...mockHolder.payout, open: false },
        incomeWithdrawal: ["0", false],
      },
      wallet: mockWallet,
    },
  },
} satisfies Meta<typeof FundDetailsPresenter>;
export default meta;
type Story = StoryObj<typeof meta>;
export const BeforeInvestment: Story = {};
export const Owned: Story = {
  args: { personal: { status: "ready", holder: mockHolder, wallet: mockWallet } },
};
export const HolderError: Story = {
  args: { personal: { status: "error", code: "V2_UNAVAILABLE" } },
};
/** POO-2220: narrow-card fixture with the full manager-address fallback and exact long values. */
export const NarrowLongValues: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 288, maxWidth: "100%" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    fund: {
      ...mockFund,
      profile: {
        ...mockFund.profile,
        protocolVersion: "v2",
        name: "A long fund name with an address-only manager",
        managerDisplayName: "",
        description: `https://example.com/${"a".repeat(120)}`,
      },
      shareAssets: "1234567890123456",
      sharePrice: "123456789012345600000000000000",
    },
  },
};
