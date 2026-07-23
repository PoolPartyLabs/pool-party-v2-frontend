/**
 * @id PP-STR-MOD-009
 * @name ShareYieldModal.stories
 * @implements-rules-version v2 (POO-906 rules v1)
 * Storybook coverage for the share-yield modal: a gain position (default 30d), a position
 * whose 24h window is negative (switch to 24H to see the LOSS card, POO-275 R6), and a
 * pool-scoped referral link with a 42-char strategy address (the card renders the SHORTENED
 * display form on a single line, POO-906 R1).
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ShareYieldModal } from "./ShareYieldModal";

const noop = () => {};

const meta = {
  title: "Strategies/ShareYieldModal",
  component: ShareYieldModal,
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    onOpenChange: noop,
    strategyId: "strat-delta-neutral",
    strategyName: "Delta-Neutral Farming",
    riskLabel: "Moderate",
    referralLink: "app.pool-party.xyz?ref=maria2026",
  },
} satisfies Meta<typeof ShareYieldModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A healthy position: every window is a gain. */
export const Gain: Story = {
  args: {
    earnings: { "24h": 3.21, "7d": 21.74, "30d": 86.52 },
  },
};

/** An aggressive position whose 24h window is negative: pick 24H for the LOSS card [R6]. */
export const LossWindow: Story = {
  args: {
    strategyId: "strat-degen-rotations",
    strategyName: "Degen Rotations",
    riskLabel: "Aggressive",
    earnings: { "24h": -4.12, "7d": 9.83, "30d": 42.31 },
  },
};

/**
 * A pool-scoped referral deep link (host + 42-char strategy address + ref code): the card shows
 * the SHORTENED display form on a single line (POO-906 [R1]); copy still carries the full url.
 */
export const LongStrategyLink: Story = {
  args: {
    earnings: { "24h": 3.21, "7d": 21.74, "30d": 86.52 },
    referralLink:
      "v2.dev.pool-party.xyz/strategies/0x357d1E34aBcD9915ef33CAdd8888ffFF00001111?ref=Surfista",
  },
};
