/**
 * @id PP-CORE-CMP-010
 * @name Button.stories
 * @implements-rules-version v1
 * Storybook coverage for the Button primitive variants, sizes, and states.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "./Button";

const meta = {
  title: "UI/Button",
  component: Button,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { variant: "primary", children: "Deposit" },
};

export const Secondary: Story = {
  args: { variant: "secondary", children: "Cancel" },
};

export const Ghost: Story = {
  args: { variant: "ghost", children: "Learn more" },
};

export const Destructive: Story = {
  args: { variant: "destructive", children: "Withdraw all" },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
};

export const Disabled: Story = {
  args: { disabled: true, children: "Disabled" },
};

export const Loading: Story = {
  args: { loading: true, children: "Submitting" },
};
