import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ErrorState } from "./ErrorState";

const meta = {
  title: "UI/ErrorState",
  component: ErrorState,
  parameters: { layout: "centered" },
  args: {
    title: "Something went wrong",
  },
} satisfies Meta<typeof ErrorState>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Title and description with a retry action. */
export const WithRetry: Story = {
  args: {
    description: "We could not load this content. Please try again.",
    onRetry: () => {},
    retryLabel: "Try again",
  },
};

/** Custom title and description with a retry action. */
export const CustomCopy: Story = {
  args: {
    title: "Failed to load positions",
    description: "We could not reach the network. Check your connection and try again.",
    onRetry: () => {},
    retryLabel: "Try again",
  },
};

/** Title and description with no retry button. */
export const WithoutRetry: Story = {
  args: {
    description: "We could not load this content.",
  },
};
