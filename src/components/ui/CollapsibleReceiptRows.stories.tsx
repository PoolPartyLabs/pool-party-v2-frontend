/**
 * @id PP-CORE-CMP-060
 * @name CollapsibleReceiptRows.stories
 * @implements-rules-version v1 (POO-800 rules v1)
 * Storybook coverage for the shared collapsible Review/Receipt card (POO-800 R1) and the ONE
 * canonical fee tooltip it carries (R2/R3): collapsed vs expanded, the Show more / Show less
 * toggle, the Max. slippage "Auto" badge (epic decision #7), the price-impact amber tone, and the
 * canonical DEX · Network · Protocol · Performance · Bridge (coming soon) · Total breakdown.
 * The fee-row builders live in FeeBreakdown (PP-STR-CMP-018); importing them here is story-only
 * composition (the component itself has no feature dependency).
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  buildCanonicalFeeLines,
  buildFeeRow,
  buildMaxSlippageRow,
  buildPriceImpactRow,
} from "@/features/strategies/components/FeeBreakdown";
import { CollapsibleReceiptRows } from "./CollapsibleReceiptRows";

const meta = {
  title: "UI/CollapsibleReceiptRows",
  component: CollapsibleReceiptRows,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CollapsibleReceiptRows>;

export default meta;
type Story = StoryObj<typeof meta>;

const CANONICAL_LABELS = {
  dex: "DEX fee",
  network: "Estimated gas (network fee)",
  protocol: "Protocol fee",
  performance: "Performance fee",
  bridge: "Bridge fee",
  comingSoon: "Coming soon",
};

/** An Invest-style Review: hero figures + the fee detail behind Show more (R1). */
export const Collapsed: Story = {
  args: {
    summary: [
      [
        { label: "You invest", value: "200 USDC ($200.00)" },
        { label: "Est. annual yield", value: "+$16.40", tone: "positive" },
        { label: "You will invest at least", value: "195.5 USDC ($195.50)", tone: "emphasis" },
      ],
    ],
    details: [
      [
        buildFeeRow({
          label: "Est. fee",
          lines: buildCanonicalFeeLines({
            labels: CANONICAL_LABELS,
            networkUsd: 0.31,
            protocolUsd: 0.49,
          }),
          totalLabel: "Total",
        }),
        buildMaxSlippageRow({ label: "Max. slippage", slippagePct: 2, autoLabel: "Auto" }),
        buildPriceImpactRow("Price impact", 0.42),
      ],
    ],
    showMoreLabel: "Show more",
    showLessLabel: "Show less",
  },
};

/** The same card expanded: fee row + Max. slippage (Auto badge) + price impact revealed. */
export const Expanded: Story = {
  args: {
    ...Collapsed.args,
    defaultOpen: true,
  },
};

/**
 * A Collect-style Review with rows below the toggle (Receive as) and the cross-flow caption footer
 * (R6): "after fees & max slippage" + the instant arrival line, always visible.
 */
export const WithReceiveAsAndCaptions: Story = {
  args: {
    summary: [[{ label: "Amount requested", value: "$48.12" }]],
    details: [
      [
        buildFeeRow({
          label: "Est. fee",
          lines: buildCanonicalFeeLines({
            labels: CANONICAL_LABELS,
            networkUsd: 0.28,
            protocolUsd: 0.12,
          }),
          totalLabel: "Total",
        }),
        buildMaxSlippageRow({ label: "Max. slippage", slippagePct: 0.5 }),
        buildPriceImpactRow("Price impact", 0.1),
      ],
    ],
    after: [[{ label: "Receive as", value: "USDC" }]],
    footer: (
      <>
        <p>after fees &amp; max. 2% slippage</p>
        <p>≈ 47.58 USDC · Arrives instantly</p>
      </>
    ),
    showMoreLabel: "Show more",
    showLessLabel: "Show less",
  },
};

/**
 * The ONE canonical fee tooltip, every line (R2/R3): DEX · Network · Protocol · Performance
 * (Collect only, POO-811) · Bridge (cross-chain only, display-only "Coming soon") · Total. The
 * Bridge placeholder never fabricates a figure and stays out of the Total sum. A high price impact
 * (>= 2%) renders amber, never red (POO-613).
 */
export const CanonicalFeeTooltip: Story = {
  args: {
    summary: [[{ label: "Amount received", value: "$1,250.00", tone: "emphasis" }]],
    details: [
      [
        buildFeeRow({
          label: "Fee",
          lines: buildCanonicalFeeLines({
            labels: CANONICAL_LABELS,
            dexUsd: 0.63,
            networkUsd: 0.31,
            protocolUsd: 3.13,
            performanceUsd: 12.5,
            crossChain: true,
          }),
          totalLabel: "Total",
        }),
        buildMaxSlippageRow({ label: "Max. slippage", slippagePct: 5 }),
        buildPriceImpactRow("Price impact", 4.2),
      ],
    ],
    defaultOpen: true,
    showMoreLabel: "Show more",
    showLessLabel: "Show less",
  },
};
