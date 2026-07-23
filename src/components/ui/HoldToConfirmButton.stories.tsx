/**
 * @id PP-CORE-CMP-061
 * @name HoldToConfirmButton.stories
 * @implements-rules-version v1
 * Storybook coverage for the press-and-hold confirmation control: a default 3s hold, a shorter hold,
 * and the disabled state. Hold the button (mouse or Space/Enter) to see the fill grow; release early
 * to watch it reset.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { HoldToConfirmButton } from "./HoldToConfirmButton";

const meta = {
  title: "UI/HoldToConfirmButton",
  component: HoldToConfirmButton,
  parameters: { layout: "centered" },
  args: { label: "Hold to reveal", onComplete: () => {} },
} satisfies Meta<typeof HoldToConfirmButton>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Default 3-second hold. The counter increments each time a hold completes. */
export const Default: Story = {
  render: () => {
    const [count, setCount] = useState(0);
    return (
      <div className="flex w-72 flex-col items-center gap-4">
        <HoldToConfirmButton label="Hold to reveal" onComplete={() => setCount((c) => c + 1)} />
        <p className="text-muted-foreground text-sm">Completed: {count}</p>
      </div>
    );
  },
};

/** A shorter 1-second hold for faster iteration. */
export const ShortHold: Story = {
  render: () => {
    const [count, setCount] = useState(0);
    return (
      <div className="flex w-72 flex-col items-center gap-4">
        <HoldToConfirmButton
          label="Hold to confirm"
          durationMs={1000}
          onComplete={() => setCount((c) => c + 1)}
        />
        <p className="text-muted-foreground text-sm">Completed: {count}</p>
      </div>
    );
  },
};

/** Disabled: inert, cannot be held. */
export const Disabled: Story = {
  args: { label: "Hold to reveal", disabled: true, onComplete: () => {} },
  render: (args) => (
    <div className="w-72">
      <HoldToConfirmButton {...args} />
    </div>
  ),
};
