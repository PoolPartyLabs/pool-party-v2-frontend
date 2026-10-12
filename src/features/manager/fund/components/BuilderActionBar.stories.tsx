/**
 * @id PP-MGR-CMP-040
 * @name BuilderActionBar.stories
 * @implements-rules-version v2 (POO-2122 rules v1, POO-2332 rules v1)
 * @analytics-events none, a presentational bar
 *
 * The shapes the bar takes across the Mandate: no Back on the first step, both buttons in the
 * middle, and the next PHASE on the last one. POO-2332 adds the muted Next with a reason label.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { BuilderActionBar } from "./BuilderActionBar";

const meta = {
  title: "Manager/Fund builder/BuilderActionBar",
  component: BuilderActionBar,
  parameters: { layout: "padded" },
  args: { onBack: () => {}, onNext: () => {} },
} satisfies Meta<typeof BuilderActionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Step 1: there is nowhere to go back to, so there is no Back. */
export const FirstStep: Story = { args: { previous: null, next: "protocols" } };

/** Mid-mandate: both labels name their destination rather than a direction. */
export const MidMandate: Story = { args: { previous: "protocols", next: "pools" } };

/** The last step: Next leaves the Mandate for the Build phase. */
export const LastStep: Story = { args: { previous: "pools", next: null } };

/** POO-2332 R12: an enabled 0% token cap. Next is muted and `aria-disabled`, with the reason beside it, and a press still reaches `onNext`. */
export const CapZero: Story = {
  args: { previous: "pools", next: null, nextBlockedReason: "cap_zero" },
};
