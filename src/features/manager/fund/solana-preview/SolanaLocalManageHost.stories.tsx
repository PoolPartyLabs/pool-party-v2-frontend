/**
 * @id PP-MGR-CMP-098 (POO-2291)
 * @name SolanaLocalManageHost stories
 * @implements-rules-version v1
 * @analytics-events none, isolated drawing-only harness
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import { SolanaLocalManageHost } from "./SolanaLocalManageHost";

const meta = {
  title: "Manager/Solana Preview/Local Manage Host",
  component: SolanaLocalManageHost,
  decorators: [withManagerMessages],
  args: {
    blocks: [
      { id: "story-a", protocol: "orca", allocationBps: 3000, pair: "SOL / USDC" },
      { id: "story-b", protocol: "orca", allocationBps: 3000, pair: "SOL / USDC" },
    ],
    selectedId: "story-a",
    active: true,
    onClose: fn(),
    onIntent: fn(),
    onDirtyChange: fn(),
    onApplyDrawing: fn(() => true),
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof SolanaLocalManageHost>;
export default meta;
type Story = StoryObj<typeof meta>;
export const UnavailableCurrent: Story = {};
export const Hidden: Story = { args: { active: false } };
export const SecondInstance: Story = { args: { selectedId: "story-b" } };
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div className="w-[320px] max-w-full">
        <Story />
      </div>
    ),
  ],
};
