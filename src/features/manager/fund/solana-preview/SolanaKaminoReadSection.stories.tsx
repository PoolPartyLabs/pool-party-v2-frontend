/** @id PP-MGR-CMP-099 @implements-rules-version v1 (POO-2291) @analytics-events none, isolated read harness */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import { SolanaKaminoReadSection } from "./SolanaKaminoReadSection";

const meta = {
  title: "Manager/Solana Preview/Kamino Read",
  component: SolanaKaminoReadSection,
  decorators: [withManagerMessages],
  args: { mode: "configure", origin: null, read: null },
  parameters: { layout: "padded" },
} satisfies Meta<typeof SolanaKaminoReadSection>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ConfigureUnavailable: Story = {};
export const ManageUnavailable: Story = { args: { mode: "manage" } };
export const Narrow: Story = {
  args: { mode: "manage" },
  decorators: [
    (Story) => (
      <div className="w-[300px] max-w-full">
        <Story />
      </div>
    ),
  ],
};
