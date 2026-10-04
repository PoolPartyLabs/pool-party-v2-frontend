/** @id PP-STR-SCR-006 @implements-rules-version v1 (POO-2216) */
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
