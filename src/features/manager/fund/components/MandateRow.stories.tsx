/**
 * @id PP-MGR-CMP-041
 * @name MandateRow.stories
 * @implements-rules-version v2 (POO-2142 rules v2)
 *
 * Storybook coverage for the shared Mandate selection row (POO-2123 [R12]).
 *
 * The three shapes side by side is the point: selected against unselected is the R12 rule a reviewer
 * has to be able to check at a glance (raised surface, softened border, primary only on the box),
 * and "Coming soon" has to read as listed-but-not-yet rather than as broken.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { buildMandateCatalog } from "../mandateCatalog";
import { MandateRow } from "./MandateRow";
import { NetworkDots, NetworkLogoWithName } from "./NetworkDots";

const catalog = buildMandateCatalog();

const meta = {
  title: "Manager/MandateRow",
  component: MandateRow,
  parameters: {
    docs: {
      description: {
        component:
          "One row of a Mandate list: selectable, locked (always in the mandate), or listed but not operable yet. A disabled row keeps aria-disabled rather than the native disabled attribute, so the click still reaches its caller as a blocked intent.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 760 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MandateRow>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Not in the mandate: default surface, empty box. */
export const Unselected: Story = {
  args: {
    id: "robinhood",
    ariaLabel: "Robinhood Chain",
    title: "Robinhood Chain",
    logo: <NetworkLogoWithName network="robinhood" catalog={catalog} size={20} />,
  },
};

/** In the mandate: raised surface, primary box. */
export const Selected: Story = {
  args: { ...Unselected.args, selected: true },
};

/** The hub network, which can never leave the mandate (R15). */
export const Locked: Story = {
  args: {
    id: "arbitrum",
    ariaLabel: "Arbitrum",
    title: "Arbitrum",
    caption: "Deposits and withdrawals happen on this network.",
    locked: true,
    logo: <NetworkLogoWithName network="arbitrum" catalog={catalog} size={20} />,
  },
};

/**
 * Listed, not operable yet. Still clickable, so the demand is measurable (R17). No network row
 * reaches this state in the buildathon scope (R17 v2, POO-2142); the row shows the generic disabled
 * state the component keeps.
 */
export const ComingSoon: Story = {
  args: {
    id: "robinhood",
    ariaLabel: "Robinhood Chain",
    title: "Robinhood Chain",
    disabled: true,
    statusLabel: "Coming soon",
    logo: <NetworkLogoWithName network="robinhood" catalog={catalog} size={20} />,
  },
};

/** A protocol row: caption plus the trailing "On" column the Protocols step adds (R20). */
export const WithTrailingNetworks: Story = {
  args: {
    id: "uniswap-v4",
    ariaLabel: "Uniswap v4",
    title: "Uniswap v4",
    caption: "Liquidity positions · earn trading fees in a price range",
    selected: true,
    // biome-ignore lint/performance/noImgElement: a 24 px committed SVG from our own origin, drawn the way ProtocolsStep draws it; next/image in a story would only add a loader.
    logo: <img src="/protocols/uniswap.svg" alt="" aria-hidden="true" width={24} height={24} />,
    trailing: (
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-muted-foreground text-xs">On</span>
        <NetworkDots networks={["arbitrum", "robinhood"]} catalog={catalog} />
      </span>
    ),
  },
};
