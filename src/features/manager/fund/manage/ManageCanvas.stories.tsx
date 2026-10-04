/**
 * @id PP-MGR-CMP-085
 * @name ManageCanvas stories
 * @implements-rules-version v1 (POO-2226, POO-2232)
 * @analytics-events none, fixture stories.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { mockFund } from "@/mocks/data/v2Funds";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import { ManageCanvas } from "./ManageCanvas";
import { normalizeManageModel } from "./manageModel";

const model = normalizeManageModel(mockFund);
const meta = {
  title: "Manager/Fund Manage/ManageCanvas",
  component: ManageCanvas,
  decorators: [withManagerMessages],
  args: { model, selectedId: null, onSelect: fn() },
  parameters: { layout: "padded" },
} satisfies Meta<typeof ManageCanvas>;
export default meta;
type Story = StoryObj<typeof meta>;
export const NoSelection: Story = {};
export const LiquiditySelected: Story = { args: { selectedId: model.positions[1]?.id ?? null } };
export const SupplySelected: Story = { args: { selectedId: model.positions[0]?.id ?? null } };
function withCurrentRange(inRange: boolean | null) {
  return normalizeManageModel({
    ...mockFund,
    positionsSummary: {
      protocolVersion: "v2",
      positions: (mockFund.positionsSummary?.positions ?? []).map((position) => ({
        ...position,
        uniswap: position.uniswap && inRange !== null ? { ...position.uniswap, inRange } : null,
      })),
    },
  });
}
export const InRange: Story = { args: { model: withCurrentRange(true) } };
export const OutOfRange: Story = {
  args: { model: withCurrentRange(false), selectedId: model.positions[1]?.id ?? null },
};
export const RangeUnavailable: Story = { args: { model: withCurrentRange(null) } };
export const EmptyPositions: Story = {
  args: {
    model: normalizeManageModel({
      ...mockFund,
      positionsSummary: { protocolVersion: "v2", positions: [] },
    }),
  },
};
