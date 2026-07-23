/**
 * @id PP-CORE-CMP-035
 * @name CollapsibleCard — stories
 * Open by default, start-collapsed, and a header with an aside chip (the manager Range card shape).
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CollapsibleCard } from "./CollapsibleCard";

const meta: Meta<typeof CollapsibleCard> = {
  title: "UI/CollapsibleCard",
  component: CollapsibleCard,
};
export default meta;

type Story = StoryObj<typeof CollapsibleCard>;

const body = (
  <p className="text-muted-foreground text-sm leading-relaxed">
    This body collapses behind the header. Click the title row to toggle it.
  </p>
);

export const Open: Story = {
  args: { title: "About this strategy", children: body },
};

export const StartCollapsed: Story = {
  args: { title: "Recent activity", defaultOpen: false, children: body },
};

export const WithAside: Story = {
  args: {
    title: "Range",
    aside: (
      <span className="rounded-full bg-success/10 px-2 py-0.5 font-medium text-success text-xs">
        In range · earning fees
      </span>
    ),
    children: body,
  },
};
