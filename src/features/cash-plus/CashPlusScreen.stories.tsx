/** @id PP-CP-SCR-001 @name Cash+ investor page states @implements-rules-version v1 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NextIntlClientProvider } from "next-intl";
import en from "@/i18n/messages/en/cashPlus.json";
import pt from "@/i18n/messages/pt-BR/cashPlus.json";
import type { CashPlusController } from "@/lib/cash-plus/types";
import { CASH_PLUS_PREVIEW_OWNER, CASH_PLUS_PREVIEW_SNAPSHOT } from "@/mocks/data/cashPlus";
import { CashPlusView } from "./components/CashPlusView";

const base: CashPlusController = {
  snapshot: CASH_PLUS_PREVIEW_SNAPSHOT,
  status: "ready",
  wallet: {
    connected: true,
    address: CASH_PLUS_PREVIEW_OWNER,
    correctChain: true,
    balanceAssets: BigInt("25000543210"),
  },
  transaction: { phase: "idle", kind: "deposit" },
  review: async () => {},
  confirm: async () => {},
  resetTransaction: () => {},
  refresh: async () => {},
  connect: () => {},
  switchNetwork: async () => {},
};
const meta = {
  title: "Cash+/Investor page",
  component: CashPlusView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="en" messages={{ cashPlus: en }}>
        <div className="mx-auto max-w-7xl bg-background p-4 lg:p-6">
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
  args: { controller: base },
} satisfies Meta<typeof CashPlusView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ActiveInvestment: Story = {};
export const NewInvestor: Story = {
  args: {
    controller: {
      ...base,
      snapshot: {
        ...CASH_PLUS_PREVIEW_SNAPSHOT,
        accountShares: BigInt(0),
        accountAssets: BigInt(0),
        investedAssets: BigInt(0),
        resultAssets: BigInt(0),
        withdrawableAssets: BigInt(0),
      },
    },
  },
};
export const Disconnected: Story = {
  args: {
    controller: {
      ...base,
      wallet: { connected: false, correctChain: true, balanceAssets: null },
      snapshot: {
        ...CASH_PLUS_PREVIEW_SNAPSHOT,
        accountShares: BigInt(0),
        accountAssets: null,
        investedAssets: BigInt(0),
        resultAssets: null,
        withdrawableAssets: null,
      },
    },
  },
};
export const ShortHistory: Story = {
  args: {
    controller: {
      ...base,
      snapshot: {
        ...CASH_PLUS_PREVIEW_SNAPSHOT,
        history: CASH_PLUS_PREVIEW_SNAPSHOT.history.slice(0, 1),
        attributionComplete: false,
        interestAssets: null,
        conversionAssets: null,
      },
    },
  },
};
export const LimitedLiquidity: Story = {
  args: {
    controller: {
      ...base,
      snapshot: {
        ...CASH_PLUS_PREVIEW_SNAPSHOT,
        withdrawableAssets: BigInt("2500000000"),
        tradingPaused: true,
      },
    },
  },
};
export const StaleRead: Story = { args: { controller: { ...base, status: "stale" } } };
export const Loading: Story = {
  args: { controller: { ...base, snapshot: null, status: "loading" } },
};
export const ReadError: Story = {
  args: { controller: { ...base, snapshot: null, status: "error" } },
};
export const Portuguese: Story = {
  render: (args) => (
    <NextIntlClientProvider locale="pt-BR" messages={{ cashPlus: pt }}>
      <CashPlusView {...args} />
    </NextIntlClientProvider>
  ),
};
