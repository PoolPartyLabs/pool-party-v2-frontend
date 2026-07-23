/**
 * @id PP-CORE-CMP-015
 * @name Tooltip.stories
 * @implements-rules-version v1
 * Storybook coverage for the Tooltip primitive: default, placement variants, long content.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./Tooltip";

const meta = {
  title: "UI/Tooltip",
  component: TooltipContent,
  parameters: { layout: "centered" },
} satisfies Meta<typeof TooltipContent>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A button with a tooltip; hover or focus the trigger to reveal the hint. */
export const Default: Story = {
  render: () => (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Hover or focus me
        </TooltipTrigger>
        <TooltipContent>Your funds stay non-custodial</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
};

/** Placement is controlled by the `side` prop forwarded to Radix. */
export const SideRight: Story = {
  render: () => (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger className="rounded-md bg-secondary px-4 py-2 text-sm text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Tooltip on the right
        </TooltipTrigger>
        <TooltipContent side="right">Shown beside the trigger</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
};

/** Longer copy wraps within the content's max width. */
export const LongContent: Story = {
  render: () => (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger className="rounded-md bg-muted px-4 py-2 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Slippage
        </TooltipTrigger>
        <TooltipContent side="top" align="start">
          The maximum price movement you will accept before the swap is cancelled.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
};
