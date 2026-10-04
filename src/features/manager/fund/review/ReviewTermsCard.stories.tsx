/**
 * @id PP-MGR-CMP-075 (POO-2188)
 * @name ReviewTermsCard.stories
 * @implements-rules-version v1
 * @analytics-events none: isolated props-only card states.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import { ReviewTermsCard } from "./ReviewTermsCard";
import { reviewStoryKit } from "./reviewStoryKit";

const meta = {
  title: "Manager/Fund builder/Review/Terms",
  component: ReviewTermsCard,
  decorators: [withManagerMessages],
  parameters: { layout: "padded" },
  args: {
    minimum: reviewStoryKit.minimum,
    payoutFeeBps: reviewStoryKit.payoutFeeBps,
    feeConfiguration: { flowFeeBps: 25, flowSource: "fallback" },
    onMinimumChange: () => {},
    onFeePercentChange: () => {},
  },
} satisfies Meta<typeof ReviewTermsCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const EstimatedProtocolFee: Story = {};
export const ConfirmedProtocolFee: Story = {
  args: { feeConfiguration: { flowFeeBps: 40, flowSource: "fund-detail" } },
};
export const MinimumFee: Story = { args: { payoutFeeBps: 0 } };
export const MaximumFee: Story = { args: { payoutFeeBps: 1000 } };
export const InvalidMinimum: Story = {
  args: { minimum: "0", minimumError: "Enter a minimum first deposit greater than zero." },
};
