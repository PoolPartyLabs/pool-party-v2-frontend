import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AprTooltip } from "./AprTooltip";

const meta: Meta<typeof AprTooltip> = {
  title: "UI/AprTooltip",
  component: AprTooltip,
};
export default meta;

type Story = StoryObj<typeof AprTooltip>;

/** The bare rate unit, as it appears next to a percentage. Hover, focus, or tap to reveal. */
export const Default: Story = { args: { children: "APR" } };

/** An APY unit token: the expansion tracks the unit and reveals "Annual Percentage Yield". */
export const Apy: Story = { args: { children: "APY" } };

/** Inline next to a percentage, matching an investor card's muted uppercase unit. */
export const InlineWithPercent: Story = {
  render: () => (
    <p className="text-foreground text-sm">
      12.5% <AprTooltip className="text-muted-foreground uppercase">APR</AprTooltip>
    </p>
  ),
};

/** As a named KPI label (e.g. the manager dashboard). */
export const NamedLabel: Story = { args: { children: "Avg APR" } };

/** The manager's Net APR metric: the APR expansion reveals the after-fees "Net" wording. */
export const Net: Story = { args: { net: true, children: "Net APR" } };
