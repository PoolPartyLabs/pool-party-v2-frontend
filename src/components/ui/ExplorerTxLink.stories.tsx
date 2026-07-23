/**
 * @id PP-CORE-CMP-050 (POO-514)
 * @name ExplorerTxLink — stories
 * @implements-rules-version v1
 *
 * Workbench for the shared receipt "View on explorer" link: one story per supported network, plus
 * the empty states (no hash / unsupported network) that render nothing by design.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
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
