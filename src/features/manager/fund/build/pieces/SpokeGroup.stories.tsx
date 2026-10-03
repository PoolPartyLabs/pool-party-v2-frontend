/**
 * @id PP-MGR-CMP-053
 * @name SpokeGroup.stories
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a story file of a presentational piece
 *
 * The spoke group and its network chip (POO-2154, handoff v1.2 [BB5], [I7], D5): a group with
 * chains (canvas A's Robinhood Chain box, 488 x 292), a new spoke with no chain and its close
 * control, an invalid network, and the chip's tooltip on hover. The blocks inside a group are placed
 * by the renderer (S6), so the boxes here are empty. Copy from the keys through `storyT`.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { within } from "storybook/test";
import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import { storyNetworkNames, storyT, withCanvasBackground } from "./pieceStorySupport";
import { SpokeGroup } from "./SpokeGroup";

const robinhood = storyNetworkNames.robinhood;
const robinhoodLogo = <NetworkLogo network="robinhood" name={robinhood} size={12} />;

/** A new spoke with no chain: its Bridge and centred circle, 176 wide inside 16 of padding. */
const EMPTY_SPOKE = { width: 208, height: 170 };

const meta = {
  title: "Manager/Fund builder/Build canvas/Pieces/SpokeGroup",
  component: SpokeGroup,
  parameters: { layout: "padded" },
  decorators: [withCanvasBackground],
  args: {
    width: 488,
    height: 292,
    networkName: robinhood,
    networkLogo: robinhoodLogo,
    chipTooltip: robinhood,
  },
} satisfies Meta<typeof SpokeGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A spoke with two chains (canvas A): no close control, a spoke with chains cannot be removed. */
export const WithChains: Story = {};

/** A new spoke with no chain yet: the close control on its chip (I7, D5). */
export const EmptyWithClose: Story = {
  args: {
    ...EMPTY_SPOKE,
    onRemove: () => {},
    removeLabel: storyT("network.remove", { network: robinhood }),
  },
};

/** The same empty spoke without the close control. */
export const EmptyWithoutClose: Story = { args: EMPTY_SPOKE };

/** D6: the network is no longer in the mandate; the reason is read and shown in the tooltip (F3). */
export const Invalid: Story = {
  args: { invalid: true, invalidLabel: storyT("card.invalid") },
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.hover(within(canvasElement).getByText(robinhood, { ignore: "[hidden]" }));
  },
};

/** The chip names its network on hover: tooltip on top, offset 4, plus the title attribute. */
export const ChipTooltip: Story = {
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.hover(within(canvasElement).getByText(robinhood, { ignore: "[hidden]" }));
  },
};
