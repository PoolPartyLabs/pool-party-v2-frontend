/**
 * @id PP-MGR-CMP-051
 * @name ShareLabel.stories
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a story file of a presentational piece
 *
 * The share label (POO-2154, handoff v1.2 [BB4]): default, highlighted, 0%, a spoke's label with no
 * action, and the tooltip on keyboard focus. Copy from `tooltip.share` through `storyT`.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { formatPercent } from "@/lib/utils/format";
import { storyT, withCanvasBackground } from "./pieceStorySupport";
import { ShareLabel } from "./ShareLabel";

const meta = {
  title: "Manager/Fund builder/Build canvas/Pieces/ShareLabel",
  component: ShareLabel,
  parameters: { layout: "padded" },
  decorators: [withCanvasBackground],
  args: {
    text: formatPercent(60, 0),
    tooltip: storyT("tooltip.share", { pct: 60 }),
    highlighted: false,
    onActivate: () => {},
    onHoverChange: () => {},
  },
} satisfies Meta<typeof ShareLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A hub chain's share: a button that selects the block it feeds. */
export const Default: Story = {};

/** Its edge (or the label) is hovered: 1.5 px `primary`, `primary` text, same size. */
export const Highlighted: Story = { args: { highlighted: true } };

/** An empty block shows 0%. */
export const ZeroPercent: Story = {
  args: { text: formatPercent(0, 0), tooltip: storyT("tooltip.share", { pct: 0 }) },
};

/** A spoke's share (D26): selects nothing, so it is not a button. */
export const NoAction: Story = {
  args: {
    text: formatPercent(35, 0),
    tooltip: storyT("tooltip.share", { pct: 35 }),
    onActivate: undefined,
  },
};

/** The tooltip on keyboard focus (C19). */
export const TooltipOnFocus: Story = {
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.tab();
    await expect(within(canvasElement).getByRole("button")).toHaveFocus();
  },
};
