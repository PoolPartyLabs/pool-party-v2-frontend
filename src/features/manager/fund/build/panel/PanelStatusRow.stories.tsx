/**
 * @id PP-MGR-CMP-065
 * @name PanelStatusRow.stories
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, a story file of a presentational row
 *
 * The row above Apply changes (handoff P5) in its three states, and the notice of P6, in the 360
 * frame.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { BuildPanelSlot } from "../canvas/BuildPanelSlot";
import { withManagerMessages } from "../canvas/canvasStorySupport";
import { PanelStatusRow, type PanelStatusRowProps } from "./PanelStatusRow";

/** The row in the frame it lives in. */
function InFrame(props: PanelStatusRowProps) {
  return (
    <BuildPanelSlot>
      <PanelStatusRow {...props} />
    </BuildPanelSlot>
  );
}

const meta = {
  title: "Manager/Fund builder/Build panel/PanelStatusRow",
  component: InFrame,
  parameters: { layout: "padded" },
  decorators: [withManagerMessages],
  args: {
    status: "applied",
    copy: {
      pending: "Changes not applied",
      applied: "All changes applied",
      discard: "Discard",
      leaveTitle: "Changes not applied",
      leaveBody:
        "You changed this block and did not apply. Apply or discard the changes before you move to another block.",
      leaveDiscard: "Discard changes",
    },
    onDiscard: () => {},
  },
} satisfies Meta<typeof InFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Everything applied: the check, and Apply changes disabled under it. */
export const Applied: Story = {};

/** The draft differs from applied (strip 10). */
export const Pending: Story = { args: { status: "pending" } };

/** A way out was refused (strip 11): the notice, an alert that takes focus. */
export const LeaveBlocked: Story = { args: { status: "leaveBlocked", attempt: 1 } };
