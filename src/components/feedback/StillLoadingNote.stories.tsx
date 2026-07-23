import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { StillLoadingNote } from "./StillLoadingNote";

const meta = {
  title: "Feedback/StillLoadingNote",
  component: StillLoadingNote,
  parameters: { layout: "centered" },
} satisfies Meta<typeof StillLoadingNote>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Block variant: the centered "still loading" note shown beneath a first-load skeleton ([R6]). */
export const Block: Story = {
  args: { variant: "block", messageKey: "stillLoading" },
};

/**
 * Inline variant: the compact "updating" affordance shown above an already-populated view while a
 * background refresh is being retried ([R7]). Unobtrusive, never a blocking overlay.
 */
export const InlineUpdating: Story = {
  args: { variant: "inline", messageKey: "updating" },
};
