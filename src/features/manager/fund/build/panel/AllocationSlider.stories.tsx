/**
 * @id PP-MGR-CMP-064
 * @name AllocationSlider.stories
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, a story file of a presentational control
 *
 * The Allocation field (handoff P8, P9) in the 360 frame: free to 100, at a mandate cap with the
 * Limits link, at the strategy's room with no link, and a ceiling off the 5% grid. Each story owns
 * its value, so the slider moves.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { BuildPanelSlot } from "../canvas/BuildPanelSlot";
import { withManagerMessages } from "../canvas/canvasStorySupport";
import { AllocationSlider } from "./AllocationSlider";

const COPY = {
  label: "Allocation",
  help: "Of the strategy's capital. The share shows on the line that feeds this block.",
  helpLabel: "More about Allocation",
};

interface SliderStoryProps {
  start: number;
  ceiling: number;
  sentence: string | null;
  withLink: boolean;
}

/** The field, owning its value, in the frame it lives in. */
function Playground({ start, ceiling, sentence, withLink }: SliderStoryProps) {
  const [value, setValue] = useState(start);
  return (
    <BuildPanelSlot>
      <AllocationSlider
        value={value}
        ceiling={ceiling}
        onChange={setValue}
        copy={COPY}
        ceilingSentence={sentence}
        ceilingLink={
          withLink
            ? { prompt: "Need more?", label: "Edit mandate · Limits", onClick: () => {} }
            : null
        }
      />
    </BuildPanelSlot>
  );
}

const meta = {
  title: "Manager/Fund builder/Build panel/AllocationSlider",
  component: Playground,
  parameters: { layout: "padded" },
  decorators: [withManagerMessages],
  args: { start: 40, ceiling: 100, sentence: null, withLink: false },
} satisfies Meta<typeof Playground>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No ceiling under 100. */
export const Free: Story = {};

/** At a mandate cap (strip 02): the tick, the dimmed part, the sentence and its link. */
export const AtMandateCap: Story = {
  args: {
    start: 70,
    ceiling: 70,
    sentence: "Maximum reached. Your mandate caps Uniswap v4 at 70%.",
    withLink: true,
  },
};

/** At the strategy's room (strip 03): the sentence, no link. */
export const AtStrategyRoom: Story = {
  args: {
    start: 45,
    ceiling: 45,
    sentence: "Maximum reached. The other blocks under Idle input already take 55%.",
  },
};

/** A ceiling off the 5% grid is a stop of its own. */
export const OffGridCeiling: Story = {
  args: {
    start: 45,
    ceiling: 47,
    sentence: "Maximum reached. Your mandate caps Robinhood Chain at 47%.",
    withLink: true,
  },
};
