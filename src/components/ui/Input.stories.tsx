import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Input } from "./Input";

/**
 * @id PP-CORE-CMP-011
 * Storybook coverage for the Input primitive variants, sizes, and disabled state.
 */
const meta = {
  title: "UI/Input",
  component: Input,
  parameters: { layout: "centered" },
  args: {
    placeholder: "Enter amount",
  },
  argTypes: {
    variant: { control: "inline-radio", options: ["default", "error"] },
    size: { control: "inline-radio", options: ["sm", "md", "lg"] },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Input>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="w-72">
      <Input {...args} />
    </div>
  ),
};

export const WithError: Story = {
  args: {
    variant: "error",
    defaultValue: "0x123",
  },
  render: (args) => (
    <div className="w-72">
      <Input {...args} />
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex w-72 flex-col gap-3">
      <Input {...args} size="sm" placeholder="Small" />
      <Input {...args} size="md" placeholder="Medium" />
      <Input {...args} size="lg" placeholder="Large" />
    </div>
  ),
};

export const Disabled: Story = {
  args: {
    disabled: true,
    defaultValue: "Locked value",
  },
  render: (args) => (
    <div className="w-72">
      <Input {...args} />
    </div>
  ),
};
