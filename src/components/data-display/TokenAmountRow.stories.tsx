import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TokenAmountRow } from "./TokenAmountRow";

const meta = {
  title: "Data Display/TokenAmountRow",
  component: TokenAmountRow,
  parameters: { layout: "centered" },
} satisfies Meta<typeof TokenAmountRow>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Amounts-only, the collect payout case (POO-417 R3): symbol initial avatar + amount. */
export const AmountsOnly: Story = {
  args: { symbol: "ETH", amount: 0.0482 },
};

/** A sub-cent crypto amount keeps full precision (no 4dp truncation). */
export const TinyAmount: Story = {
  args: { symbol: "WBTC", amount: 0.00131 },
};

/** With a de-emphasized USD value in parentheses (POO-324, the Remove case). */
export const WithUsd: Story = {
  args: { symbol: "USDC", amount: 145.2, usd: "$145.20" },
};

/** A stack of two legs, as the "You receive" token-pair breakdown renders them. */
export const Pair: Story = {
  args: { symbol: "ETH", amount: 0.0482 },
  render: () => (
    <div className="flex flex-col items-end gap-1">
      <TokenAmountRow symbol="ETH" amount={0.0482} />
      <TokenAmountRow symbol="USDC" amount={145.2} />
    </div>
  ),
};

/** With the real committed token logo (POO-482): iconUrl replaces the initial chip. */
export const WithLogo: Story = {
  args: { symbol: "ETH", amount: 0.0482, iconUrl: "/tokens/eth.png" },
};

/** The logo-bearing pair stack, as Collect/Remove render it after POO-482. */
export const PairWithLogos: Story = {
  args: { symbol: "ETH", amount: 0.0482 },
  render: () => (
    <div className="flex flex-col items-end gap-1">
      <TokenAmountRow symbol="ETH" amount={0.0482} iconUrl="/tokens/eth.png" />
      <TokenAmountRow symbol="USDC" amount={145.2} iconUrl="/tokens/usdc.png" />
    </div>
  ),
};
