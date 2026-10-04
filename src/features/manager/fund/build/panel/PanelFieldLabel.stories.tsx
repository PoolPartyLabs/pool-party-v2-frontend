/**
 * @id PP-MGR-CMP-062
 * @name PanelFieldLabel.stories
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, a story file of a presentational label
 *
 * The label row of a panel field (handoff "Field label row") in the 360 frame: a label with its
 * (i), a value at the right end, and the (i) tooltip open.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { BuildPanelSlot } from "../canvas/BuildPanelSlot";
import { withManagerMessages } from "../canvas/canvasStorySupport";
import { PanelFieldLabel, type PanelFieldLabelProps } from "./PanelFieldLabel";

/** The row in the frame it lives in, with room above for the tooltip. */
function InFrame(props: PanelFieldLabelProps) {
  return (
    <div className="pt-16">
      <BuildPanelSlot>
        <PanelFieldLabel {...props} />
      </BuildPanelSlot>
    </div>
  );
}

const meta = {
  title: "Manager/Fund builder/Build panel/PanelFieldLabel",
  component: InFrame,
  parameters: { layout: "padded" },
  decorators: [withManagerMessages],
  args: {
    label: "Pool",
    help: "Uniswap v4 pools of your mandate on Arbitrum.",
    helpLabel: "More about Pool",
  },
} satisfies Meta<typeof InFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A label and its (i). */
export const Label: Story = {};

/** With the value at the right end, in the Numeric style (the Allocation's). */
export const WithValue: Story = {
  args: {
    label: "Allocation",
    help: "Of the strategy's capital. The share shows on the line that feeds this block.",
    helpLabel: "More about Allocation",
    value: <span className="font-medium text-sm lining-nums tabular-nums">45%</span>,
  },
};

/** The (i) tooltip open: the help lives here, never under the field. */
export const HelpOpen: Story = { args: { helpOpen: true } };
