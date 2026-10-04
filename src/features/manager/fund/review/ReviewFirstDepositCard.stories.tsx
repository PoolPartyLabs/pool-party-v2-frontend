/**
 * @id PP-MGR-CMP-076 (POO-2188)
 * @name ReviewFirstDepositCard.stories
 * @implements-rules-version v1
 * @analytics-events none: isolated props-only card states.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import { previewSeed, rawUsdc } from "../launch/review";
import { ReviewFirstDepositCard } from "./ReviewFirstDepositCard";
import { reviewStoryBalance, reviewStoryKit, reviewStoryPreview } from "./reviewStoryKit";

const meta = {
  title: "Manager/Fund builder/Review/First deposit",
  component: ReviewFirstDepositCard,
  decorators: [withManagerMessages],
  parameters: { layout: "padded" },
  args: {
    seed: reviewStoryKit.seed,
    minimum: reviewStoryKit.minimum,
    balance: reviewStoryBalance,
    preview: reviewStoryPreview,
    onSeedChange: () => {},
    onMax: () => {},
  },
} satisfies Meta<typeof ReviewFirstDepositCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
export const BalanceUnread: Story = { args: { balance: null, preview: null } };
export const Empty: Story = { args: { seed: "", preview: null } };
export const UnderMinimum: Story = { args: { seed: "50", preview: previewSeed(rawUsdc("50")) } };
export const OverBalance: Story = {
  args: { seed: "15000", preview: previewSeed(rawUsdc("15000")) },
};
export const NoWholeShare: Story = {
  args: { seed: "1.001", minimum: "1", preview: previewSeed(rawUsdc("1.001")) },
};
