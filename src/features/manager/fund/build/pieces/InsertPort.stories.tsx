/**
 * @id PP-MGR-CMP-052
 * @name InsertPort.stories
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a story file of a presentational piece
 *
 * The insert port (POO-2154, handoff v1.2 [BB7]): default, active, and the tooltip on keyboard
 * focus. The tooltip copy is one of the four D13 variants, from `tooltip.port*` through `storyT`.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { InsertPort } from "./InsertPort";
import { storyT, withCanvasBackground } from "./pieceStorySupport";

const meta = {
  title: "Manager/Fund builder/Build canvas/Pieces/InsertPort",
  component: InsertPort,
  parameters: { layout: "padded" },
  decorators: [withCanvasBackground],
  args: { tooltip: storyT("tooltip.portBefore"), active: false, onActivate: () => {} },
} satisfies Meta<typeof InsertPort>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Grey dashed 3 3, plus 8: always visible on a configured card's edge (C17). */
export const Default: Story = {};

/** Its menu is open, or it is a valid drop target while dragging: `primary`. */
export const Active: Story = { args: { active: true } };

/** After an Aave Supply: the menu offers Borrow and Swap (D13 wording). */
export const AfterSupply: Story = { args: { tooltip: storyT("tooltip.portAfterSupply") } };

/** The tooltip on keyboard focus (C19): side top, offset 4. */
export const TooltipOnFocus: Story = {
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.tab();
    await expect(within(canvasElement).getByRole("button")).toHaveFocus();
  },
};
