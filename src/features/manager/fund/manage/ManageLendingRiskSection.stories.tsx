/**
 * @id PP-MGR-CMP-094 (POO-2290)
 * @name ManageLendingRiskSection stories
 * @implements-rules-version v1
 * @analytics-events none, explicit isolated story fixtures only.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import { ManageLendingRiskSection } from "./ManageLendingRiskSection";
import type {
  LendingRiskRead,
  LendingRiskSnapshot,
  LendingRiskToken,
  ManageLendingRiskOrigin,
} from "./manageLendingRisk";

// PP-MOCK: illustrative account results only, not market discovery, live account facts or a protocol formula.
const addr = (digit: string) => `0x${digit.repeat(40)}`;
const identity = {
  protocol: "aave-v3" as const,
  chainId: 42161,
  core: addr("a"),
  account: addr("b"),
  market: addr("c"),
};
const origin: ManageLendingRiskOrigin = {
  identity,
  preview: { id: "draft-7", baseSnapshotId: "account-1" },
};
const collateral: LendingRiskToken = {
  network: "evm",
  chainId: 42161,
  address: addr("d"),
  symbol: "WETH",
  decimals: 18,
};
const debt: LendingRiskToken = {
  network: "evm",
  chainId: 42161,
  address: addr("e"),
  symbol: "USDC",
  decimals: 6,
};
function snapshot(preview = false): LendingRiskSnapshot {
  const id = preview ? "preview-7" : "account-1",
    scenarioId = preview ? "draft-7" : "current-1";
  const source = {
    kind: "fixture" as const,
    reference: "story:illustrative-account-risk",
    asOf: "2026-10-07T21:00:00Z",
    blockOrSlot: null,
    freshness: "fresh" as const,
  };
  return {
    identity,
    snapshotId: id,
    source,
    complete: true,
    debt: { status: "confirmed", total: { decimal: "5000", currency: "USD" } },
    scenario: preview
      ? { kind: "preview", id: scenarioId, baseSnapshotId: "account-1", valid: true }
      : { kind: "current", id: scenarioId },
    context: {
      snapshotId: id,
      scenarioId,
      method: "Illustrative supplied account result",
      assumptions: [
        "Only WETH quote varies in this illustrative scenario",
        "Debt USD quotes held fixed; market thresholds supplied",
      ],
      collateral: [{ token: collateral, raw: "5000000000000000000" }],
      debt: [{ token: debt, raw: "5000000000" }],
      oracles: [collateral, debt].map((token) => ({
        token,
        decimal: token.symbol === "WETH" ? "3000" : "1",
        unit: "USD-per-token",
        provider: "Illustrative oracle",
        snapshotId: id,
        source,
      })),
      parameters: [
        { token: collateral, liquidationThresholdRatio: "0.8", borrowFactorRatio: null },
        { token: debt, liquidationThresholdRatio: null, borrowFactorRatio: null },
      ],
    },
    healthFactor: { decimal: preview ? "2.7" : "2.4", unit: "ratio", scenarioId },
    liquidationPrice: {
      status: "available",
      decimal: preview ? "1250.123456789" : "1400.123456789",
      unit: "USD-per-token",
      asset: collateral,
      scenarioId,
    },
  };
}
const read = (value: LendingRiskSnapshot): LendingRiskRead => ({
  status: "ready",
  snapshot: value,
});
const unavailable: LendingRiskRead = { status: "unavailable", snapshot: null };
const current = snapshot(),
  after = snapshot(true);
const meta = {
  title: "Manager/Fund Manage/ManageLendingRiskSection",
  component: ManageLendingRiskSection,
  decorators: [
    withManagerMessages,
    (Story) => (
      <div className="w-[326px] max-w-full rounded-xl bg-surface p-4">
        <Story />
      </div>
    ),
  ],
  args: { origin, current: read(current), after: read(after) },
  parameters: { layout: "padded" },
} satisfies Meta<typeof ManageLendingRiskSection>;
export default meta;
type Story = StoryObj<typeof meta>;
export const CurrentAndAfter: Story = {};
export const DebtAssetLiquidationScenario: Story = {
  args: {
    current: read({
      ...current,
      context: current.context
        ? {
            ...current.context,
            assumptions: ["Only USDC debt quote varies; WETH quote and quantities held fixed"],
          }
        : null,
      liquidationPrice: {
        status: "available",
        decimal: "2.400000000000000001",
        unit: "USD-per-token",
        asset: debt,
        scenarioId: current.scenario.id,
      },
    }),
    after: unavailable,
  },
};
export const AccountUnavailable: Story = {
  args: { origin: { identity: null, preview: null }, current: unavailable, after: unavailable },
};
export const AfterUnavailable: Story = { args: { after: unavailable } };
export const ConfirmedNoDebt: Story = {
  args: {
    current: read({
      ...current,
      debt: { status: "confirmed", total: { decimal: "0", currency: "USD" } },
      context: null,
    }),
    after: unavailable,
  },
};
export const Stale: Story = {
  args: {
    current: read({ ...current, source: { ...current.source, freshness: "stale" } }),
    after: unavailable,
  },
};
export const PartialDebt: Story = {
  args: {
    current: read({ ...current, debt: { ...current.debt, status: "partial" } }),
    after: unavailable,
  },
};
export const MissingOracle: Story = {
  args: {
    current: read({
      ...current,
      context: current.context ? { ...current.context, oracles: [] } : null,
    }),
    after: unavailable,
  },
};
export const NoPositiveRoot: Story = {
  args: {
    current: read({
      ...current,
      liquidationPrice: { status: "no-positive-root", scenarioId: current.scenario.id },
    }),
    after: unavailable,
  },
};
export const InvalidPreview: Story = {
  args: {
    after: read({
      ...after,
      scenario: { kind: "preview", id: "old-draft", baseSnapshotId: "old-account", valid: false },
    }),
  },
};
export const Loading: Story = {
  args: { current: { status: "loading", snapshot: null }, after: unavailable },
};
export const ReadError: Story = {
  args: { current: { status: "error", snapshot: null }, after: unavailable },
};
const kamino = {
  protocol: "kamino-lend" as const,
  cluster: "mainnet-beta" as const,
  program: "So11111111111111111111111111111111111111112",
  account: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  market: "11111111111111111111111111111111",
  obligation: "So11111111111111111111111111111111111111112",
};
export const KaminoConfirmedNoDebt: Story = {
  args: {
    origin: { identity: kamino, preview: null },
    current: read({
      ...current,
      identity: kamino,
      debt: { status: "confirmed", total: { decimal: "0", currency: "USD" } },
      context: null,
    }),
    after: unavailable,
  },
};
export const TinyExactPrice: Story = {
  args: {
    current: read({
      ...current,
      liquidationPrice: {
        status: "available",
        decimal: "0.000000000000000001",
        unit: "USD-per-token",
        asset: collateral,
        scenarioId: current.scenario.id,
      },
    }),
    after: unavailable,
  },
};
