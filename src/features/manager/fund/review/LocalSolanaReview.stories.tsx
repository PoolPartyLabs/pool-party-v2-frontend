/**
 * @id PP-MGR-CMP-102
 * @name LocalSolanaReview.stories
 * @implements-rules-version v1 (POO-2301)
 * @analytics-events none, a local Review story without persistence or execution.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import { isBlocked, type MandateDraft } from "../mandateDraft";
import { createSolanaBuilderDraft } from "../solana-preview/solanaBuilderRuntime";
import type { UseMandateDraftResult } from "../useMandateDraft";
import { LocalSolanaReview } from "./LocalSolanaReview";

function LocalReviewStory() {
  const [draft, setDraft] = useState<MandateDraft>(() => ({
    ...createSolanaBuilderDraft("2026-10-08T00:00:00Z", "local-review-story"),
    name: "Solana intention",
  }));
  const update: UseMandateDraftResult["update"] = (fn) => {
    setDraft((current) => {
      const next = fn(current);
      return isBlocked(next) ? current : next;
    });
  };
  return (
    <LocalSolanaReview
      draft={draft}
      update={update}
      onBackToBuild={() => {}}
      onEditMandate={() => {}}
    />
  );
}

const meta = {
  title: "Manager/Fund builder/Review/Solana local",
  component: LocalReviewStory,
  decorators: [withManagerMessages],
  parameters: { layout: "padded" },
} satisfies Meta<typeof LocalReviewStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const EditableWithoutExecution: Story = {};
