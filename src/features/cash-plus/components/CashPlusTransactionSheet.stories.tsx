/** @id PP-CP-MOD-001 @name Cash+ transaction states @implements-rules-version v1 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/i18n/messages/en/cashPlus.json";
import type { CashPlusController, CashPlusTransaction } from "@/lib/cash-plus/types";
import { CASH_PLUS_PREVIEW_SNAPSHOT } from "@/mocks/data/cashPlus";
import { CashPlusTransactionSheet } from "./CashPlusTransactionSheet";

const hash = `0x${"1".repeat(64)}` as const;
const base: CashPlusController = {
  snapshot: CASH_PLUS_PREVIEW_SNAPSHOT,
  status: "ready",
  wallet: { connected: true, correctChain: true, balanceAssets: BigInt("100000000000") },
  transaction: {
    phase: "review",
    kind: "deposit",
    amountAssets: BigInt("1000000000"),
    minShares: BigInt("999000000000000000000"),
  },
  review: async () => {},
  confirm: async () => {},
  resetTransaction: () => {},
  refresh: async () => {},
  connect: () => {},
  switchNetwork: async () => {},
};
const meta = {
  title: "Cash+/Transaction sheet",
  component: CashPlusTransactionSheet,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Synthetic component fixtures. They do not execute transactions or claim actual onchain receipts.",
      },
    },
  },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="en" messages={{ cashPlus: messages }}>
        <Story />
      </NextIntlClientProvider>
    ),
  ],
  args: { controller: base, open: true, onOpenChange: () => {} },
} satisfies Meta<typeof CashPlusTransactionSheet>;
export default meta;
type Story = StoryObj<typeof meta>;
const withTransaction = (transaction: CashPlusTransaction) => ({ ...base, transaction });
export const InvestmentReview: Story = {};
export const Approval: Story = {
  args: { controller: withTransaction({ ...base.transaction, phase: "approval" }) },
};
export const Pending: Story = {
  args: { controller: withTransaction({ ...base.transaction, phase: "pending", hash }) },
};
export const ConfirmedReceipt: Story = {
  args: {
    controller: withTransaction({
      phase: "success",
      kind: "deposit",
      receipt: {
        hash,
        blockNumber: BigInt(20),
        kind: "deposit",
        assets: BigInt("1000000000"),
        shares: BigInt("1000000000000000000000"),
        tokens: [],
      },
    }),
  },
};
export const Rejected: Story = {
  args: {
    controller: withTransaction({ phase: "error", kind: "deposit", errorCode: "USER_REJECTED" }),
  },
};
export const InsufficientLiquidity: Story = {
  args: {
    controller: withTransaction({
      phase: "error",
      kind: "redeem",
      errorCode: "LIQUIDITY_INSUFFICIENT",
    }),
  },
};
export const ProportionalExit: Story = {
  args: {
    controller: withTransaction({
      phase: "review",
      kind: "proportional",
      outputs: [
        {
          address: "0x1000000000000000000000000000000000000001",
          symbol: "aUSDC",
          decimals: 6,
          amount: BigInt("9999954321"),
        },
        {
          address: "0x2000000000000000000000000000000000000002",
          symbol: "USD₮0",
          decimals: 6,
          amount: BigInt("1250400000"),
        },
      ],
    }),
  },
};
