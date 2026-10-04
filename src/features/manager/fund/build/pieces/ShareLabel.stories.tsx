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
import { expectOuterSize, storyT, withCanvasBackground } from "./pieceStorySupport";
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
  // F8: every story without its own play measures the label: 20 high, its text inset 8 from the
  // left and 2 from the top, as the Figma label (8220:2556), highlighted or not.
  play: async ({ canvasElement }) => {
    const label = canvasElement.querySelector("[data-share-label]");
    await expectOuterSize(label, { height: 20 });
    const text = label?.querySelector("span:not([data-piece-stroke])");
    if (!label || !text) throw new Error("no label text");
    const outer = label.getBoundingClientRect();
    const inner = text.getBoundingClientRect();
    await expect(inner.left - outer.left).toBeCloseTo(8, 1);
    await expect(inner.top - outer.top).toBeCloseTo(2, 1);
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

/** A spoke's share (D26): selects nothing, so it is a tab stop for its tooltip, not a button. */
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
