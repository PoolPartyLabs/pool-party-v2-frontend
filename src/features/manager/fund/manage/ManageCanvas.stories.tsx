/**
 * @id PP-MGR-CMP-085
 * @name ManageCanvas stories
 * @implements-rules-version v2 (POO-2270, POO-2271; extends POO-2226, POO-2232)
 * @analytics-events none, fixture stories.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { mockFund } from "@/mocks/data/v2Funds";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import { ManageCanvas } from "./ManageCanvas";
import { available, normalizeManageModel } from "./manageModel";

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

function withCash(price: boolean) {
  return {
    ...model,
    chains: model.chains.map((chain) => ({
      ...chain,
      cash: chain.cash.map((token) => ({
        ...token,
        amount: available(
          {
            chainId: token.chainId,
            address: null,
            symbol: token.symbol,
            decimals: token.decimals,
            raw: "25000000000000000",
            decimal: "0.025",
          },
          "story-native",
        ),
        ...(price ? { valueUsd: available("75", "story-price") } : {}),
      })),
    })),
  };
}
export const NativeAndUsd: Story = { args: { model: withCash(true) } };
export const NativeWithoutUsd: Story = { args: { model: withCash(false) } };
export const HubOnly: Story = {
  args: {
    model: {
      ...model,
      chains: model.chains.filter((chain) => chain.hub),
      positions: model.positions.filter((position) => position.chainId === model.hubChainId),
    },
  },
};
export const LongAmounts: Story = {
  args: {
    model: {
      ...withCash(false),
      income: {
        ...model.income,
        amount: available(
          {
            chainId: model.income.chainId,
            address: model.income.address,
            symbol: model.income.symbol,
            decimals: model.income.decimals,
            raw: "123456789012345678901234567890",
            decimal: "123456789012345678901234.567890",
          },
          "story-income",
        ),
      },
    },
  },
};
