/** @id PP-MGR-SCR-001 @name ManagerOverviewV2 stories @implements-rules-version v1 (POO-2245) */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { managerOverviewDemo } from "@/mocks/data/managerOverviewV2";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import { ManagerOverviewV2 } from "./ManagerOverviewV2";

const meta = {
  title: "Manager/Fund Overview/Overview V2",
  component: ManagerOverviewV2,
  decorators: [withManagerMessages],
  args: { demo: managerOverviewDemo },
  parameters: { layout: "padded", nextjs: { appDirectory: true } },
} satisfies Meta<typeof ManagerOverviewV2>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
export const Loading: Story = { args: { demo: { ...managerOverviewDemo, state: "loading" } } };
export const Empty: Story = {
  args: {
    demo: {
      ...managerOverviewDemo,
      state: "empty",
      funds: [],
      setup: { ...managerOverviewDemo.setup, drafts: [], journeys: [] },
    },
  },
};
export const ReadError: Story = { args: { demo: { ...managerOverviewDemo, state: "error" } } };
