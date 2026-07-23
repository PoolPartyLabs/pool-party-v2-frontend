import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Inbox } from "lucide-react";
import { EmptyState } from "./EmptyState";

const meta = {
  title: "UI/EmptyState",
  component: EmptyState,
  parameters: { layout: "centered" },
} satisfies Meta<typeof EmptyState>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Full state: icon, title, description, and a call-to-action. */
export const WithIconAndAction: Story = {
  args: {
    icon: <Inbox className="size-10" />,
    title: "No positions yet",
    description: "Make your first deposit to start earning yield.",
    action: (
      <button
        type="button"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Deposit
      </button>
    ),
  },
};

/** Title and description only, no icon and no action. */
export const TitleAndDescription: Story = {
  args: {
    title: "No transactions",
    description: "Your transaction history will appear here.",
  },
};

/** Bare minimum: just a title. */
export const TitleOnly: Story = {
  args: {
    title: "Nothing to show",
  },
};

/** Icon plus title, without a description or action. */
export const WithIconOnly: Story = {
  args: {
    icon: <Inbox className="size-10" />,
    title: "Inbox zero",
  },
};
