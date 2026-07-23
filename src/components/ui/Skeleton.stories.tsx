import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Skeleton } from "./Skeleton";

const meta = {
  title: "UI/Skeleton",
  component: Skeleton,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Skeleton>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A single text-line placeholder using width and a short height. */
export const Line: Story = {
  args: { width: 240, height: 12 },
};

/** A block placeholder for a card or image, with a larger radius. */
export const Box: Story = {
  args: { width: 240, height: 120, radius: "12px" },
};

/** A circular placeholder for an avatar, using equal dimensions and a pill radius. */
export const Circle: Story = {
  args: { width: 48, height: 48, radius: "9999px" },
};

/** A composed loading skeleton: avatar circle beside two stacked text lines. */
export const ProfileRow: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Skeleton width={48} height={48} radius="9999px" />
      <div className="flex flex-col gap-2">
        <Skeleton width={160} height={12} />
        <Skeleton width={100} height={12} />
      </div>
    </div>
  ),
};
