/**
 * @id PP-MGR-CMP-095
 * @name SolanaRangePresenter stories
 * @implements-rules-version v1 (POO-2291)
 * @analytics-events none, unavailable live boundary stories
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import { SolanaRangePresenter } from "./SolanaRangePresenter";
import type { SolanaRangeContext, SolanaRangeDraft } from "./solanaRangeModel";
import { USDC_MINT, WSOL_MINT } from "./solanaSchemas";

/** Explicit Q64 math fixture, never used for production discovery, balances or execution. */
function mathFixture(protocol: "orca" | "raydium"): SolanaRangeContext {
  const token = (mint: string, decimals: number, symbol: string) => ({
    kind: "spl" as const,
    network: "solana" as const,
    cluster: "mainnet-beta" as const,
    mint,
    decimals,
    symbol,
    unit: "base-units" as const,
    tokenProgram: "11111111111111111111111111111111",
    extensions: { status: "unknown" as const },
  });
  const common = {
    cluster: "mainnet-beta" as const,
    program: "11111111111111111111111111111111",
    pool: WSOL_MINT,
    tokenA: token(WSOL_MINT, 9, "WSOL"),
    tokenB: token(USDC_MINT, 6, "USDC"),
    status: "available" as const,
    source: {
      kind: "fixture" as const,
      fixtureId: `${protocol}-q64-math-example`,
      sourceAsOf: "2026-10-07T00:00:00Z",
      slot: null,
    },
    tickSpacing: 64,
    tickCurrent: 0,
    sqrtPriceX64: "18446744073709551616",
    position: null,
  };
  return protocol === "orca"
    ? {
        ...common,
        protocol,
        fee: { kind: "fixed", baseFeeRate: "3000", effectiveFeeRate: null },
        tokenBadge: { status: "unknown" },
      }
    : {
        ...common,
        protocol,
        ammConfig: {
          address: USDC_MINT,
          tickSpacing: 64,
          tradeFeeRate: "100",
          protocolFeeRate: "0",
          fundFeeRate: "0",
        },
        feeOn: "unknown",
        dynamicFee: "unknown",
      };
}
function InteractiveRange(args: Parameters<typeof SolanaRangePresenter>[0]) {
  const [range, setRange] = useState<SolanaRangeDraft | null>(args.range);
  return <SolanaRangePresenter {...args} range={range} onChange={setRange} />;
}

const meta = {
  title: "Manager/Solana Preview/Protocol Range",
  component: SolanaRangePresenter,
  decorators: [withManagerMessages],
  args: { context: null, range: null, onChange: fn() },
  parameters: { layout: "padded" },
} satisfies Meta<typeof SolanaRangePresenter>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LiveUnavailable: Story = {};
export const NarrowUnavailable: Story = {
  decorators: [
    (Story) => (
      <div className="w-[320px] max-w-full">
        <Story />
      </div>
    ),
  ],
};
const exampleRange: SolanaRangeDraft = { tickLower: -128, tickUpper: 128, displayInverted: false };
export const OrcaMathFixture: Story = {
  args: { context: mathFixture("orca"), range: exampleRange },
  render: InteractiveRange,
};
export const RaydiumMathFixture: Story = {
  args: { context: mathFixture("raydium"), range: exampleRange },
  render: InteractiveRange,
};
export const StaleFixture: Story = {
  args: { context: { ...mathFixture("orca"), status: "stale" }, range: exampleRange },
};
export const FullOnlyFixture: Story = {
  args: {
    context: { ...mathFixture("orca"), tickSpacing: 32768 },
    range: { tickLower: -425984, tickUpper: 425984, displayInverted: false },
  },
  render: InteractiveRange,
};
export const InvertedFixture: Story = {
  args: { context: mathFixture("raydium"), range: { ...exampleRange, displayInverted: true } },
  render: InteractiveRange,
};
export const NarrowFixture: Story = {
  ...OrcaMathFixture,
  decorators: [
    (Story) => (
      <div className="w-[320px] max-w-full">
        <Story />
      </div>
    ),
  ],
};
