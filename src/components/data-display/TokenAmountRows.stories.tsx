import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TokenAmountRows } from "./TokenAmountRows";

const meta = {
  title: "Data Display/TokenAmountRows",
  component: TokenAmountRows,
  parameters: { layout: "centered" },
} satisfies Meta<typeof TokenAmountRows>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The token-pair "You receive" payout with per-token USD (POO-483, the Withdraw/Remove case). */
export const PairWithUsd: Story = {
  args: {
    network: undefined,
    rows: [
      { symbol: "ETH", amount: 0.0482, usd: 145.6 },
      { symbol: "USDC", amount: 145.2, usd: 145.2 },
    ],
  },
};

/** Amounts only, no per-token USD (POO-417 R3, the Collect payout list). */
export const AmountsOnly: Story = {
  args: {
    network: undefined,
    rows: [
      { symbol: "ETH", amount: 0.0482 },
      { symbol: "USDC", amount: 145.2 },
    ],
  },
};

/** A single leg. */
export const SingleRow: Story = {
  args: {
    network: undefined,
    rows: [{ symbol: "USDC", amount: 145.2, usd: 145.2 }],
  },
};

/** An unknown symbol has no committed logo, so the symbol-initial chip renders. */
export const FallbackLogo: Story = {
  args: {
    network: undefined,
    rows: [{ symbol: "ZZZ", amount: 12.5 }],
  },
};
