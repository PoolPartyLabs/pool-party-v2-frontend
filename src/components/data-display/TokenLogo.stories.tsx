import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TokenLogo } from "./TokenLogo";

const meta = {
  title: "Data Display/TokenLogo",
  component: TokenLogo,
  parameters: { layout: "centered" },
  args: { className: "size-8 text-xs" },
} satisfies Meta<typeof TokenLogo>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A committed major token → its logo (resolves network-free). */
export const Major: Story = {
  args: { symbol: "ETH" },
};

/** A stablecoin major. */
export const Stable: Story = {
  args: { symbol: "USDC" },
};

/** An unresolved symbol → the symbol-initial chip fallback. */
export const InitialFallback: Story = {
  args: { symbol: "XYZ" },
};
