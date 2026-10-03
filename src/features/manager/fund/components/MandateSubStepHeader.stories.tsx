/**
 * @id PP-MGR-CMP-028
 * @name MandateSubStepHeader.stories
 * @implements-rules-version v1 (POO-2122 rules v1)
 * @analytics-events none, a presentational header
 *
 * The four states worth looking at side by side: the collapsed default, the expanded map, the
 * first step (nothing passed, nothing to jump back to) and the 4-segment variant a draft with no
 * position protocol gets (R29).
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MandateSubStepHeader } from "./MandateSubStepHeader";

const FIVE = ["networks", "protocols", "tokens", "pools", "limits"] as const;

const meta = {
  title: "Manager/Fund builder/MandateSubStepHeader",
  component: MandateSubStepHeader,
  parameters: { layout: "padded" },
  args: { onNavigate: () => {} },
} satisfies Meta<typeof MandateSubStepHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Collapsed, mid-mandate. Hover the row or click the title to expand it in place. */
export const Collapsed: Story = {
  args: {
    steps: FIVE,
    current: "tokens",
    passed: ["networks", "protocols"],
    reachable: ["networks", "protocols", "tokens"],
  },
};

/** The first step: nothing is passed, so no segment is navigation yet. */
export const FirstStep: Story = {
  args: { steps: FIVE, current: "networks", passed: [], reachable: ["networks"] },
};

/** The last step, where the right edge points at the next PHASE rather than the next step. */
export const LastStep: Story = {
  args: {
    steps: FIVE,
    current: "limits",
    passed: ["networks", "protocols", "tokens", "pools"],
    reachable: [...FIVE],
  },
};

/** R29: no position protocol was chosen, so Pools is not part of this mandate at all. */
export const PoolsSkipped: Story = {
  args: {
    steps: ["networks", "protocols", "tokens", "limits"],
    current: "limits",
    passed: ["networks", "protocols", "tokens"],
    reachable: ["networks", "protocols", "tokens", "limits"],
  },
};
