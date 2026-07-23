/**
 * @id PP-CORE-CMP-055
 * @name NoCopy.stories
 * @implements-rules-version v1
 * Storybook coverage for the NoCopy region: try to select or right-click the protected block.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NoCopy } from "./NoCopy";

const meta = {
  title: "UI/NoCopy",
  component: NoCopy,
  parameters: { layout: "centered" },
} satisfies Meta<typeof NoCopy>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Protected: Story = {
  render: () => (
    <div className="max-w-md space-y-4">
      <NoCopy className="rounded-md border border-border p-4 text-muted-foreground text-sm leading-relaxed">
        This block is wrapped in NoCopy. Try to select the text, copy it, or open the right-click
        menu: all are blocked. This is a deterrent, not a guarantee.
      </NoCopy>
      <p className="text-muted-foreground text-xs">
        For contrast, this line sits outside NoCopy and can be selected normally.
      </p>
    </div>
  ),
};
