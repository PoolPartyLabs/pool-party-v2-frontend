/**
 * @id PP-MGR-CMP-025
 * Stories for TokenSplitBar — the estimated-balance composition bar shared by the strategy builder's
 * Build step and the Move Range modal (POO-387 [R5]).
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TokenSplitBar } from "./TokenSplitBar";

const meta: Meta<typeof TokenSplitBar> = {
  title: "Manager/TokenSplitBar",
  component: TokenSplitBar,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  argTypes: {
    pct0: { control: { type: "range", min: 0, max: 100, step: 1 } },
    pct1: { control: { type: "range", min: 0, max: 100, step: 1 } },
  },
};
export default meta;
type Story = StoryObj<typeof TokenSplitBar>;

export const Balanced: Story = {
  args: { pct0: 48, pct1: 52, token0: "ETH", token1: "USDC" },
};

export const SkewedToToken0: Story = {
  args: { pct0: 82, pct1: 18, token0: "ETH", token1: "USDC" },
};

export const FullRange: Story = {
  args: { pct0: 50, pct1: 50, token0: "WBTC", token1: "USDC" },
};

// POO-501 R1/R2: logos + estimated per-token amount/USD sub-lines (the Move Range legend).
export const WithAmountsAndLogos: Story = {
  args: {
    pct0: 60,
    pct1: 40,
    token0: "ETH",
    token1: "USDC",
    icon0: "/tokens/eth.png",
    icon1: "/tokens/usdc.png",
    sub0: "~20.05 ETH (~$62,591.00)",
    sub1: "~65,997 USDC (~$66,009.00)",
  },
};

// POO-501 R4: no sub-lines → the percent-only legend (the degraded / no-value-block case).
export const PercentOnly: Story = {
  args: { pct0: 60, pct1: 40, token0: "ETH", token1: "USDC" },
};
