/**
 * @id PP-MGR-CMP-042
 * @name NetworkDots.stories
 * @implements-rules-version v1
 *
 * Storybook coverage for the network logos that carry their name (POO-2123 [R10]).
 *
 * Hover or tab to a dot in the canvas: the tooltip is the rule. A reviewer who cannot name the
 * circles from the picture alone is looking at the exact failure R10 exists to prevent, and the
 * addon-a11y panel is where the `title` and the accessible name show up.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { buildMandateCatalog } from "../mandateCatalog";
import { NetworkDots } from "./NetworkDots";

const catalog = buildMandateCatalog({ robinhoodChain: true });

const meta = {
  title: "Manager/NetworkDots",
  component: NetworkDots,
  args: { catalog },
  parameters: {
    docs: {
      description: {
        component:
          "Small overlapping network logos, each with a tooltip (side top, offset 4), a title attribute and an accessible name. Brand colours come from the mandate catalog, so a network with no committed mark falls back to its own colour instead of grey.",
      },
    },
  },
} satisfies Meta<typeof NetworkDots>;

export default meta;

type Story = StoryObj<typeof meta>;

/** What a protocol's "On" column shows for a hub-only mandate. */
export const HubOnly: Story = {
  args: { networks: ["arbitrum"] },
};

/** Hub plus the one spoke that exists on chain today. */
export const HubAndSpoke: Story = {
  args: { networks: ["arbitrum", "robinhood"] },
};

/** Every network, including Unichain, which has no committed mark and renders as a monogram. */
export const EveryNetwork: Story = {
  args: { networks: ["arbitrum", "robinhood", "base", "polygon", "unichain"] },
};

/** Row-logo size: the same component the step uses beside a network name. */
export const Large: Story = {
  args: { networks: ["arbitrum", "robinhood", "base"], size: 24 },
};
