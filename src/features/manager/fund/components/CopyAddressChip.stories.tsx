/**
 * @id PP-MGR-CMP-043
 * @name CopyAddressChip.stories
 * @implements-rules-version v1
 *
 * Storybook coverage for the Pools step's copy chip (POO-2125 [R11]).
 *
 * The chip has three looks and only one of them survives a screenshot: default and hover differ by a
 * text colour, and "copied" lasts 1.5 s. `Row` is the story that earns its place, because it shows
 * the shape the Pools card actually renders, two chips separated by a slash under a pair name, where
 * the pair of them has to stay quiet enough not to compete with the pool's own numbers.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CopyAddressChip } from "./CopyAddressChip";

/** Real mainnet addresses: WETH and USDC on Arbitrum, the pair every pool list opens on. */
const WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

const meta = {
  title: "Manager/CopyAddressChip",
  component: CopyAddressChip,
  args: { address: USDC },
  parameters: {
    docs: {
      description: {
        component:
          "A token contract address, shortened on screen and copied in full. Click it: the Copy icon becomes a Check for a second and a half and a Copied tooltip opens above it. A browser with no clipboard, or one that refuses the write, says nothing at all rather than claiming a copy that did not happen.",
      },
    },
  },
} satisfies Meta<typeof CopyAddressChip>;

export default meta;

type Story = StoryObj<typeof meta>;

/** One chip. Hover it for the foreground colour, click it for the Check and the tooltip. */
export const Default: Story = {};

/** The pair of chips as a pool card draws them, under the pair name. */
export const Row: Story = {
  render: (args) => (
    <div className="flex flex-col gap-1">
      <span className="font-medium text-foreground text-sm">WETH/USDC</span>
      <span className="flex items-center gap-1 text-muted-foreground text-xs">
        <CopyAddressChip {...args} address={WETH} />
        <span aria-hidden="true">/</span>
        <CopyAddressChip {...args} address={USDC} />
      </span>
    </div>
  ),
};

/** A short string is not shortened: there is nothing to hide, and an ellipsis would be noise. */
export const AlreadyShort: Story = {
  args: { address: "0x1234" },
};
