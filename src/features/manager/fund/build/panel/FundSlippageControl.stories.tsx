/**
 * @id PP-MGR-CMP-067
 * @name FundSlippageControl.stories
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, a story file of a presentational control
 *
 * The Max slippage field (handoff P12 with decision D-D) in the 360 frame: the 2% default, a custom
 * value, and a field to try the 5% cap (type 8 and leave the field). Each story owns its value.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { BuildPanelSlot } from "../canvas/BuildPanelSlot";
import { withManagerMessages } from "../canvas/canvasStorySupport";
import { FundSlippageControl } from "./FundSlippageControl";

const COPY = {
  label: "Max slippage",
  help: "Cancels the transaction if the price moves more than this before it confirms.",
  helpLabel: "More about Max slippage",
  custom: "Custom",
  customLabel: "Custom max slippage, in percent",
  max: (pct: string) => `${pct}% is the maximum.`,
};

/** The field, owning its value, in the frame it lives in. */
function Playground({ start }: { start: number }) {
  const [value, setValue] = useState(start);
  return (
    <BuildPanelSlot>
      <FundSlippageControl value={value} onChange={setValue} copy={COPY} />
    </BuildPanelSlot>
  );
}

const meta = {
  title: "Manager/Fund builder/Build panel/FundSlippageControl",
  component: Playground,
  parameters: { layout: "padded" },
  decorators: [withManagerMessages],
  args: { start: 2 },
} satisfies Meta<typeof Playground>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The 2% default preset. Type 8 in Custom and leave the field: it becomes 5, and says so. */
export const Default: Story = {};

/** A custom value: the field active, no preset selected (strip 08). */
export const Custom: Story = { args: { start: 3.5 } };

/** The lowest value a field commits: 0.1%. */
export const Floor: Story = { args: { start: 0.1 } };
