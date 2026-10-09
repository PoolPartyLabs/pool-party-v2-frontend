/**
 * @id PP-MGR-CMP-078 (POO-2195)
 * @name ReviewSummary.stories
 * @implements-rules-version v1
 * @analytics-events none: props-only Review summary states.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import { hubSupplyPlan, makeTestDraft } from "../build/plan/planTestKit";
import { assertLaunchPlan, getLaunchSteps } from "../launch/journey";
import { ReviewInvestorPreview } from "./ReviewInvestorPreview";
import { ReviewLaunchPreview } from "./ReviewLaunchPreview";
import { ReviewPlanSummary } from "./ReviewPlanSummary";
import { reviewStoryKit } from "./reviewStoryKit";

const draft = {
  ...makeTestDraft(),
  plan: hubSupplyPlan(),
  review: reviewStoryKit,
};
const meta = {
  title: "Manager/Fund builder/Review/Summaries",
  component: ReviewInvestorPreview,
  decorators: [withManagerMessages],
  args: { review: reviewStoryKit },
} satisfies Meta<typeof ReviewInvestorPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Investor: Story = {};
export const InvalidInvestor: Story = { args: { review: { ...reviewStoryKit, name: "Short" } } };
export const MandateAndBuild: Story = {
  render: () => <ReviewPlanSummary draft={draft} onEditMandate={() => {}} onEditBuild={() => {}} />,
};
export const Launch: Story = {
  render: () => {
    const plan = draft.plan;
    assertLaunchPlan(plan);
    return <ReviewLaunchPreview steps={getLaunchSteps({ ...draft, plan })} />;
  },
};
export const LaunchBlocked: Story = { render: () => <ReviewLaunchPreview steps={[]} /> };
