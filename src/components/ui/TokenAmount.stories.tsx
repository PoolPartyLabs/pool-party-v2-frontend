/**
 * @id PP-CORE-CMP-045
 * @name TokenAmount — stories
 * Covers the magnitude branches: large/grouped, normal, sub-1 significant figures, and the
 * ultra-tiny subscript-zero (DEX-style) notation that fixes the vanishing tiny-amount bug.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TokenAmount } from "./TokenAmount";

const meta: Meta<typeof TokenAmount> = {
  title: "UI/TokenAmount",
  component: TokenAmount,
  parameters: { layout: "centered" },
  args: { symbol: "USDC" },
};
export default meta;

type Story = StoryObj<typeof TokenAmount>;

export const Normal: Story = { args: { value: 12.85, symbol: "USDC" } };

export const Large: Story = { args: { value: 1_250_000.5, symbol: "USDC" } };

export const SubOne: Story = { args: { value: 0.0001234, symbol: "USDC" } };

/** Ultra-tiny: subscript-zero compresses the leading-zero run; hover for the exact value. */
export const UltraTiny: Story = { args: { value: 1.234e-16, symbol: "TKN" } };

/** The original bug case: `1e-16` used to render as `0`. */
export const TinyBugCase: Story = { args: { value: 1e-16, symbol: "TKN" } };

export const AllMagnitudes: Story = {
  render: () => (
    <div className="flex flex-col gap-2 text-foreground text-lg">
      <TokenAmount value={1_250_000.5} symbol="USDC" />
      <TokenAmount value={12.85} symbol="USDC" />
      <TokenAmount value={0.5} symbol="USDC" />
      <TokenAmount value={0.0001234} symbol="USDC" />
      <TokenAmount value={0.00001234} symbol="TKN" />
      <TokenAmount value={1.234e-16} symbol="TKN" />
    </div>
  ),
};
