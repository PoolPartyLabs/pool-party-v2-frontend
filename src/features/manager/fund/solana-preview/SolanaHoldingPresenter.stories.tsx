/**
 * @id PP-MGR-CMP-096
 * @name SolanaHoldingPresenter stories
 * @implements-rules-version v1 (POO-2291)
 * @analytics-events none, isolated harness-only custody/intent fixtures
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import {
  type HoldingMode,
  SolanaHoldingPresenter,
  SolanaJupiterInspector,
} from "./SolanaHoldingPresenter";
import type { HoldingIntent, HoldingOrigin, JupiterQuote } from "./solanaHoldingModel";
import { USDC_MINT, WSOL_MINT } from "./solanaSchemas";

const origin: HoldingOrigin = {
  localId: "fixture-holding-a",
  cluster: "mainnet-beta",
  asset: {
    kind: "spl",
    network: "solana",
    cluster: "mainnet-beta",
    mint: WSOL_MINT,
    decimals: 9,
    symbol: "WSOL",
    unit: "base-units",
  },
  custody: {
    program: "11111111111111111111111111111111",
    account: WSOL_MINT,
    authority: USDC_MINT,
    positionId: null,
  },
};
const usdc = {
  ...origin.asset,
  kind: "spl" as const,
  mint: USDC_MINT,
  decimals: 6,
  symbol: "USDC",
  unit: "base-units" as const,
};
const source = {
  kind: "fixture" as const,
  fixtureId: "holding-quote-math-example",
  sourceAsOf: "2026-10-07T00:00:00Z",
  slot: null,
};
const intent: HoldingIntent = {
  id: "fixture-buy",
  revision: "1",
  origin,
  side: "buy",
  input: { token: usdc, raw: "1000000" },
  outputToken: origin.asset,
  destination: { kind: "holding", account: origin.custody.account },
  wrapPlan: null,
};
const quote: JupiterQuote = {
  intentId: intent.id,
  intentRevision: intent.revision,
  origin,
  status: "available",
  source,
  quoteId: "fixture-quote",
  input: intent.input,
  output: { token: origin.asset, raw: "1000" },
  minimumReceived: { token: origin.asset, raw: "900" },
  route: ["Harness route only"],
  costs: [],
  inspection: {
    mode: "managed-order-execute",
    requestId: "fixture-request",
    inputMint: USDC_MINT,
    outputMint: WSOL_MINT,
    rawInput: intent.input.raw,
    quoteValidity: { status: "available", source, value: { expiresAt: "2026-10-07T00:01:00Z" } },
    transactionValidity: { status: "unavailable", source: null, reason: "not-integrated" },
    execution: { status: "unavailable", reason: "local-preview-only" },
  },
};
const meta = {
  title: "Manager/Solana Preview/Holding",
  component: SolanaHoldingPresenter,
  decorators: [withManagerMessages],
  args: {
    origin: null,
    read: null,
    intent: null,
    quote: null,
    clock: { now: null, blockHeight: null },
    mode: "choice",
    onMode: fn(),
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof SolanaHoldingPresenter>;
export default meta;
type Story = StoryObj<typeof meta>;
function Controlled(args: Parameters<typeof SolanaHoldingPresenter>[0]) {
  const [mode, setMode] = useState<HoldingMode>(args.mode);
  return <SolanaHoldingPresenter {...args} mode={mode} onMode={setMode} />;
}
export const Unavailable: Story = {};
export const Choice: Story = { args: { origin }, render: Controlled };
export const BuyReviewFixture: Story = {
  args: { origin, intent, quote, mode: "review-buy" },
  render: Controlled,
};
export const BypassFixture: Story = {
  args: { origin, intent: { ...intent, input: { token: origin.asset, raw: "1" } }, mode: "buy" },
  render: Controlled,
};
const sell: HoldingIntent = {
  ...intent,
  id: "fixture-sell",
  side: "sell",
  input: { token: origin.asset, raw: "1" },
  outputToken: usdc,
  destination: {
    kind: "idle-output",
    idleId: "fixture-idle",
    account: USDC_MINT,
    principalBridgeId: "fixture-gray-principal",
  },
};
export const SellReviewFixture: Story = {
  args: { origin, intent: sell, mode: "review-sell" },
  render: Controlled,
};
export const StaleQuantityFixture: Story = {
  args: {
    origin,
    read: {
      origin,
      snapshotId: "fixture-read",
      quantity: {
        status: "stale",
        source,
        reason: "illustrative",
        value: { token: origin.asset, raw: "1000" },
      },
      valueUsd: { status: "unavailable", source: null, reason: "not-integrated" },
      allocation: { status: "unavailable", source: null, reason: "not-integrated" },
    },
  },
};
export const JupiterUnavailable: Story = {
  render: (args) => <SolanaJupiterInspector intent={null} quote={null} clock={args.clock} />,
};
export const NarrowFixture: Story = {
  ...BuyReviewFixture,
  decorators: [
    (Story) => (
      <div className="w-[320px] max-w-full">
        <Story />
      </div>
    ),
  ],
};
