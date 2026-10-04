/**
 * @id PP-MGR-CMP-074 (POO-2188)
 * @name ReviewFeesCard.stories
 * @implements-rules-version v1
 * @analytics-events none: isolated props-only card states.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import { ReviewFeesCard } from "./ReviewFeesCard";
import { reviewStoryKit } from "./reviewStoryKit";

const meta = {
  title: "Manager/Fund builder/Review/Fees",
  component: ReviewFeesCard,
  decorators: [withManagerMessages],
  parameters: { layout: "padded" },
  args: {
    performanceFeeBps: reviewStoryKit.performanceFeeBps,
    managementFeeBps: reviewStoryKit.managementFeeBps,
    onFeePercentChange: () => {},
  },
} satisfies Meta<typeof ReviewFeesCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const MinimumBounds: Story = { args: { performanceFeeBps: 1000, managementFeeBps: 0 } };
export const MaximumBounds: Story = { args: { performanceFeeBps: 9000, managementFeeBps: 500 } };
export const FieldErrors: Story = {
  args: {
    errors: {
      performanceFeeBps: "Set a performance fee from 10% to 90%.",
      managementFeeBps: "Set a management fee from 0% to 5%.",
    },
  },
};
