import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { StrategyLogo } from "./StrategyLogo";

const meta = {
  title: "Data Display/StrategyLogo",
  component: StrategyLogo,
  parameters: { layout: "centered" },
  args: { className: "size-10 text-sm" },
} satisfies Meta<typeof StrategyLogo>;

export default meta;

type Story = StoryObj<typeof meta>;

/** With the manager-uploaded logo image (the real POO-701 write path). */
export const WithLogo: Story = {
  args: { url: "/networks/base.png", name: "ETH Steady" },
};

/** No logo → the initials monogram fallback (multi-word name → two letters). */
export const InitialsFallback: Story = {
  args: { url: null, name: "Delta Neutral" },
};

/** Single-word name → first two letters. */
export const SingleWordInitials: Story = {
  args: { url: "", name: "Aerodrome" },
};

/** Larger size, as the manage-detail header renders it. */
export const Large: Story = {
  args: { url: null, name: "ETH Steady", className: "size-16 text-lg" },
};
