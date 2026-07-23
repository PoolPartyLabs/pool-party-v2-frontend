/**
 * @id PP-CORE-CMP-062
 * @name MockBadge.stories
 * @implements-rules-version v1 (POO-807 rules v1)
 *
 * Workbench for the mock-mode "MOCK" chip. Storybook runs in mock mode (NEXT_PUBLIC_MOCK_MODE
 * defaults on), so the chip renders here; in real mode the component renders nothing (R2), which
 * is covered by the unit test rather than a story.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MockBadge } from "./MockBadge";

const meta: Meta<typeof MockBadge> = {
  title: "UI/MockBadge",
  component: MockBadge,
};
export default meta;

type Story = StoryObj<typeof MockBadge>;

/** The chip as mounted next to a modal title / status headline. */
export const Default: Story = {};

/** Alongside text, as it appears in the shared transactional-modal header. */
export const NextToTitle: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <span className="font-semibold text-foreground text-lg">Review</span>
      <MockBadge />
    </div>
  ),
};
