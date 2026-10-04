/**
 * @id PP-MGR-CMP-055
 * @name CanvasTemplate.stories
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a story file of presentational pieces
 *
 * The two templates (POO-2154, handoff v1.2 [BB6], [C15]): the Add protocol circle and the Add
 * network box, default and active, side by side as the empty canvas shows them, and the tooltip
 * opened below the circle from the keyboard. Copy from `tooltip.*` through `storyT`.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { AddNetworkTemplate, AddProtocolTemplate } from "./CanvasTemplate";
import { storyNetworkNames, storyT, withCanvasBackground } from "./pieceStorySupport";

const protocolTooltip = storyT("tooltip.addProtocol", { network: storyNetworkNames.arbitrum });

const meta = {
  title: "Manager/Fund builder/Build canvas/Pieces/CanvasTemplate",
  component: AddProtocolTemplate,
  parameters: { layout: "padded" },
  decorators: [withCanvasBackground],
  args: { tooltip: protocolTooltip, active: false, onActivate: () => {} },
} satisfies Meta<typeof AddProtocolTemplate>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Add protocol: a dashed circle with no fill. */
export const AddProtocol: Story = {};

/** Add protocol, active (its menu is open or it is a valid drop target). */
export const AddProtocolActive: Story = { args: { active: true } };

/** Add network: a dashed box with the spoke group's fill and dash. */
export const AddNetwork: Story = {
  render: ({ onActivate }) => (
    <AddNetworkTemplate
      tooltip={storyT("tooltip.addNetwork")}
      active={false}
      onActivate={onActivate}
    />
  ),
};

/** Add network, active: 1.5 px `primary`. */
export const AddNetworkActive: Story = {
  render: ({ onActivate }) => (
    <AddNetworkTemplate tooltip={storyT("tooltip.addNetwork")} active onActivate={onActivate} />
  ),
};

/** C15: the two shapes side by side, as on the empty canvas (Build state 1, canvas D). */
export const BothShapes: Story = {
  render: ({ onActivate }) => (
    <div className="flex items-start gap-20">
      <AddProtocolTemplate tooltip={protocolTooltip} active={false} onActivate={onActivate} />
      <AddNetworkTemplate
        tooltip={storyT("tooltip.addNetwork")}
        active={false}
        onActivate={onActivate}
      />
    </div>
  ),
};

/** The tooltip opens below the circle (side bottom, offset 8), on keyboard focus. */
export const TooltipBelow: Story = {
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.tab();
    await expect(within(canvasElement).getByRole("button")).toHaveFocus();
  },
};
