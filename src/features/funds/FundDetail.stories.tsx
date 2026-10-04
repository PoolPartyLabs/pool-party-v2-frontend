/**
 * @id PP-STR-SCR-005 (POO-2175)
 * @name FundDetailStories
 * @implements-rules-version v2
 * Mock-mode fund preview behind the existing feature/preference switch.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FundDetail } from "./FundDetail";

const meta = {
  title: "Funds/Detail",
  component: FundDetail,
  parameters: { layout: "padded" },
  args: { core: `0x${"2".repeat(40)}` },
} satisfies Meta<typeof FundDetail>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Preview: Story = {};
