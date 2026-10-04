/**
 * @id PP-MGR-CMP-073 (POO-2188)
 * @name reviewStoryKit
 * @implements-rules-version v1
 * @analytics-events none: deterministic Storybook and test fixtures only.
 */
import type { ReviewDraft } from "../launch/review";
import { previewSeed, rawUsdc } from "../launch/review";
export const reviewStoryKit: ReviewDraft = {
  name: "Arbitrum stable strategy",
  description: "A USDC strategy using the selected mandate and applied Build plan.",
  imageUrl: "/tokens/usdc.png",
  performanceFeeBps: 2000,
  managementFeeBps: 100,
  payoutFeeBps: 200,
  minimum: "100",
  seed: "2500",
};
export const reviewStoryBalance = rawUsdc("12840.75");
export const reviewStoryPreview = previewSeed(rawUsdc(reviewStoryKit.seed));
