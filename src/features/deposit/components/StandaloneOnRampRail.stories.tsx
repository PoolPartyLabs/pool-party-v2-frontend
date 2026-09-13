/**
 * @id PP-DEP-CMP-004
 * @name StandaloneOnRampRail — stories
 * @implements-rules-version v3 (POO-1129 rules v3)
 *
 * The rail's own non-widget captions. The live rail runs a wallet flow and mounts the Paybis SDK, so
 * the stories drive the presentational {@link StandaloneOnRampRailView} directly (the widget phase is
 * covered by the PaybisWidgetFrame stories).
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { StandaloneOnRampRailView } from "./StandaloneOnRampRail";

const meta = {
  title: "Deposit/StandaloneOnRampRail",
  component: StandaloneOnRampRailView,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StandaloneOnRampRailView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Preparing the purchase: minting the requestId before the widget opens. */
export const Connecting: Story = { args: { status: "connecting" } };

/** The ETH-first purchase settled; converting the funding share to USDC on Base ([R1]/[R3]). */
export const Swapping: Story = { args: { status: "swapping" } };
