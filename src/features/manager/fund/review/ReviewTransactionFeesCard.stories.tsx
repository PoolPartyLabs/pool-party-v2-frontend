/**
 * @id PP-MGR-CMP-090 (POO-2289)
 * @name ReviewTransactionFeesCard.stories
 * @implements-rules-version v1
 * @analytics-events none: read-only Storybook source, no wallet or data calls.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NextIntlClientProvider } from "next-intl";
import deManager from "@/i18n/messages/de/manager.json";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import { ReviewTransactionFeesCard } from "./ReviewTransactionFeesCard";

const meta = {
  title: "Manager/Fund builder/Review/Transaction fees",
  component: ReviewTransactionFeesCard,
  decorators: [withManagerMessages],
  parameters: { layout: "padded" },
} satisfies Meta<typeof ReviewTransactionFeesCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Unavailable: Story = {};
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div className="w-[240px] max-w-full">
        <Story />
      </div>
    ),
  ],
};
export const GermanNarrow: Story = {
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="de" messages={{ manager: deManager }}>
        <div className="w-[240px] max-w-full">
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
};
