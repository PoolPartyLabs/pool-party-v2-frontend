/**
 * @id PP-MGR-CMP-092
 * @name ManageCollectFeesPanel stories
 * @implements-rules-version v1 (POO-2276)
 * @analytics-events none, injected isolated fixtures; no route or wallet operation.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { mockFund } from "@/mocks/data/v2Funds";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import { ManageCollectFeesPanel } from "./ManageCollectFeesPanel";
import type { ManageCollectDetail, ManageCollectRead } from "./manageCollectFees";
import { normalizeManageModel } from "./manageModel";

const selected = normalizeManageModel(mockFund).positions.find((item) => item.kind === "liquidity");
if (!selected) throw new Error("liquidity fixture missing");
const position = {
  ...selected,
  tokens: selected.tokens.map((token, index) => ({
    ...token,
    address:
      index === 0
        ? "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
        : "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
    symbol: index === 0 ? "USDG" : "WETH",
  })),
};
const version = { protocolVersion: "v2" as const };
const amount = (raw: string, decimal: string) => ({ ...version, raw, decimal });
// PP-MOCK: Figma fee amounts only; never used by a production read or executor.
const detail: ManageCollectDetail = {
  chainId: "4663",
  positionKey: position.positionKey,
  status: "open",
  adapterKind: "uniswap-v4",
  tokens: position.tokens.map(({ address, symbol, decimals }) => ({
    ...version,
    address: address ?? "",
    symbol,
    decimals,
  })),
  uniswap: {
    ...version,
    poolKey: {
      ...version,
      currency0: position.tokens[0]?.address ?? "",
      currency1: position.tokens[1]?.address ?? "",
      fee: 3000,
      tickSpacing: 60,
      hooks: `0x${"0".repeat(40)}`,
    },
    tickLower: -120,
    tickUpper: 120,
    currentTick: 0,
    tickSpacing: 60,
    fee: 3000,
    liquidity: "1",
    sqrtPriceX96: "1",
    inRange: true,
    lowerPrice: { ...version, token1PerToken0: "1", token0PerToken1: "1" },
    upperPrice: { ...version, token1PerToken0: "2", token0PerToken1: "0.5" },
    currentPrice: { ...version, token1PerToken0: "1", token0PerToken1: "1" },
  },
  uncollectedIncome: {
    amount0: amount("650000000", "650"),
    amount1: amount("200000000000000000", "0.2"),
  },
};
const read: ManageCollectRead = {
  identity: position.id,
  status: "ready",
  position: detail,
  error: null,
  freshness: "fresh",
};
const meta = {
  title: "Manager/Fund Manage/ManageCollectFeesPanel",
  component: ManageCollectFeesPanel,
  decorators: [
    withManagerMessages,
    (Story) => (
      <div className="w-full max-w-[360px]">
        <Story />
      </div>
    ),
  ],
  args: { position, read, onBack: fn(), onRetry: fn() },
  parameters: { layout: "padded" },
} satisfies Meta<typeof ManageCollectFeesPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
export const Loading: Story = { args: { read: { ...read, status: "loading" } } };
export const ReadError: Story = {
  args: { read: { ...read, status: "error", error: "V2_UNAVAILABLE" } },
};
export const Stale: Story = { args: { read: { ...read, freshness: "stale" } } };
export const Unavailable: Story = { args: { read: { ...read, position: null } } };
export const ConfirmedZero: Story = {
  args: {
    read: {
      ...read,
      position: {
        ...detail,
        uncollectedIncome: { amount0: amount("0", "0"), amount1: amount("0", "0") },
      },
    },
  },
};
export const Partial: Story = {
  args: {
    read: {
      ...read,
      position: {
        ...detail,
        uncollectedIncome: { amount0: amount("650000000", "650"), amount1: null },
      },
    },
  },
};
export const LongExactAmounts: Story = {
  args: {
    read: {
      ...read,
      position: {
        ...detail,
        uncollectedIncome: {
          amount0: amount("9007199254740993123456", "9007199254740993.123456"),
          amount1: amount("1", "0.000000000000000001"),
        },
      },
    },
  },
};
