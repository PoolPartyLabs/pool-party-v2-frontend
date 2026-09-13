/**
 * @id PP-CORE-CMP-050 (POO-514, POO-1568)
 * @name ExplorerTxLink — stories
 * @implements-rules-version v2 (POO-1568 rules v1) · v1
 *
 * Workbench for the shared receipt "View on explorer" link: one story per supported network, plus
 * the empty states (no hash / unsupported network) that render nothing by design, plus the three
 * variants — the last of which only means anything in the position it ships in.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "./Button";
import { ExplorerTxLink } from "./ExplorerTxLink";

const HASH = "0xMOCK00000000000000000000000000000000MOCK";

const meta: Meta<typeof ExplorerTxLink> = {
  title: "UI/ExplorerTxLink",
  component: ExplorerTxLink,
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof ExplorerTxLink>;

/** A Base tx links Basescan at /tx/{hash}. */
export const Base: Story = { args: { network: "base", hash: HASH } };

/** An Arbitrum tx links Arbiscan. */
export const Arbitrum: Story = { args: { network: "arbitrum", hash: HASH } };

/** A Polygon tx links Polygonscan. */
export const Polygon: Story = { args: { network: "polygon", hash: HASH } };

/** No hash (e.g. a real receipt whose flow yielded none): nothing renders, never a home-page link. */
export const NoHash: Story = { args: { network: "base", hash: null } };

/** Unsupported network: nothing renders (no fabricated explorer). */
export const UnsupportedNetwork: Story = { args: { network: "solana", hash: HASH } };

/** POO-1508 [R48]: the quiet inline line the settling screens use, under their own ghost `Close`. */
export const TextVariant: Story = { args: { network: "base", hash: HASH, variant: "text" } };

/**
 * POO-1568 [R1]: the execution screen's link, in the position that is the whole reason the variant
 * exists — directly under the state button, inside the pinned footer. Shown with the button, because
 * "one rank quieter than the CTA above it" is not a property this control has on its own.
 */
export const GhostUnderTheStateButton: Story = {
  args: { network: "base", hash: HASH, variant: "ghost" },
  render: (args) => (
    <div className="flex flex-col gap-2">
      <Button className="w-full" size="lg">
        Done
      </Button>
      <ExplorerTxLink {...args} />
    </div>
  ),
};
