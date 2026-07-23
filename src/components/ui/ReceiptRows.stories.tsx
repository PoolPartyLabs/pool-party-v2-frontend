/**
 * @id PP-CORE-CMP-027
 * @name ReceiptRows.stories
 * @implements-rules-version v1
 * Storybook coverage for the shared receipt: every tone variant, group dividers, Action rows,
 * and the info (ⓘ) tooltip on a label (POO-384 R3).
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ReceiptRows } from "./ReceiptRows";

const meta = {
  title: "UI/ReceiptRows",
  component: ReceiptRows,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReceiptRows>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A collect-style confirm: breakdown / total / metadata groups (POO-279 R5/R6). */
export const ConfirmBreakdown: Story = {
  args: {
    groups: [
      [
        { label: "Yield earned", value: "$120.00", tone: "positive" },
        { label: "Performance fee (10%)", value: "-$12.00", tone: "negative" },
      ],
      [{ label: "You receive", value: "$108.00", tone: "emphasis" }],
      [
        { label: "Network fee", value: "$0.30" },
        { label: "Max slippage", value: "0.5%", onAction: () => {} },
      ],
    ],
  },
};

/**
 * A row with an info (ⓘ) tooltip on its label (POO-384 R3): the combined Fees line breaks down
 * into DEX fee + Protocol fee (0.25%) + Total. The object form keeps a flat accessible name while
 * the body renders the 3-line breakdown.
 */
export const WithTooltip: Story = {
  args: {
    groups: [
      [
        { label: "Amount", value: "$250.00", tone: "positive" },
        {
          label: "Fees",
          value: "-$1.20",
          tone: "negative",
          tooltip: {
            label: "DEX fee $0.58 · Protocol fee (0.25%) $0.63 · Total $1.20",
            body: (
              <div className="flex flex-col gap-1">
                <div className="flex justify-between gap-6">
                  <span>DEX fee</span>
                  <span>$0.58</span>
                </div>
                <div className="flex justify-between gap-6">
                  <span>Protocol fee (0.25%)</span>
                  <span>$0.63</span>
                </div>
                <div className="flex justify-between gap-6 border-border border-t pt-1 font-medium">
                  <span>Total</span>
                  <span>$1.20</span>
                </div>
              </div>
            ),
          },
        },
      ],
      [{ label: "You receive", value: "250 USDC ($250.00)", tone: "emphasis" }],
    ],
  },
};

/**
 * A high price-impact swap (POO-613): the `warning` tone renders the impact in amber (not red) so
 * it reads as a caution to weigh, not an error. Rounds out the tone coverage this file demonstrates.
 */
export const HighPriceImpact: Story = {
  args: {
    groups: [
      [
        { label: "You pay", value: "$5,000.00" },
        { label: "Price impact", value: "-4.2%", tone: "warning" },
      ],
      [{ label: "You receive", value: "4,790 USDC ($4,790.00)", tone: "emphasis" }],
    ],
  },
};

/** A confirmed-state receipt: details + meta groups, incl. the tx hash (R8). */
export const SuccessReceipt: Story = {
  args: {
    groups: [
      [
        { label: "Strategy", value: "Stable Yield" },
        { label: "Amount", value: "$200.00" },
        { label: "Network fee", value: "$0.30" },
      ],
      [
        { label: "Date", value: "May 27, 2026 · 14:32" },
        { label: "Transaction", value: "0xMOCK…MOCK" },
      ],
    ],
  },
};
