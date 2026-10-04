/**
 * @id PP-MGR-CMP-066
 * @name RemoveBlockConfirm.stories
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, a story file of a presentational confirm
 *
 * The remove confirm (handoff P10) in the 360 frame. The words come from `removalText` over the S1
 * test plans, so each story shows what `describeRemoval` really finds: a pool with its Swap · auto
 * and Collect fees (strip 13), a Supply of the arriving token (strip 09), a Supply with a Borrow
 * under it (strip 10), and an empty block.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { describeBlock } from "../blocks/blockRegistry";
import { makeDescribeContext, makeTestCopy } from "../blocks/blockTestKit";
import { BuildPanelSlot } from "../canvas/BuildPanelSlot";
import { withManagerMessages } from "../canvas/canvasStorySupport";
import type { BuildPlan } from "../plan/buildPlan";
import { describeRemoval } from "../plan/planReducers";
import {
  hubPoolWithFeesPlan,
  hubSupplyPlan,
  makeTestContext,
  supplyBorrowPlan,
} from "../plan/planTestKit";
import { makeTestPanelCopy } from "./panelFixtures";
import { RemoveBlockConfirm, removalText } from "./RemoveBlockConfirm";

const panelCopy = makeTestPanelCopy();
const blockCopy = makeTestCopy();

/** The confirm for a block of a plan, as the panel builds it. */
function Confirm({ plan, blockId }: { plan: BuildPlan; blockId: string }) {
  const description = describeRemoval(plan, makeTestContext(), blockId);
  const ctx = makeDescribeContext(plan);
  const text = description
    ? removalText({
        description,
        blockTitle: describeBlock(blockId, ctx).title,
        stepTitle: (step) => describeBlock(step.id, ctx).title,
        copy: panelCopy.confirm,
        listNames: blockCopy.listNames,
        locale: "en",
      })
    : { title: panelCopy.confirm.titleEmpty, sentence: null };
  return (
    <BuildPanelSlot>
      <RemoveBlockConfirm
        title={text.title}
        sentence={text.sentence}
        cancelLabel={panelCopy.confirm.cancel}
        removeLabel={blockCopy.panel.remove}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    </BuildPanelSlot>
  );
}

const meta = {
  title: "Manager/Fund builder/Build panel/RemoveBlockConfirm",
  component: Confirm,
  parameters: { layout: "padded" },
  decorators: [withManagerMessages],
  args: { plan: hubPoolWithFeesPlan(), blockId: "hub-pool-pool" },
} satisfies Meta<typeof Confirm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A pool: its share, its Swap · auto and its Collect fees (strip 13). */
export const Pool: Story = {};

/** A Supply of the arriving token: only its share (strip 09). */
export const Supply: Story = { args: { plan: hubSupplyPlan(), blockId: "hub-supply-supply" } };

/** A Supply with a Borrow under it (strip 10). */
export const SupplyWithBorrow: Story = {
  args: { plan: supplyBorrowPlan(), blockId: "hub-aave-supply" },
};

/** An empty block: "Remove this block?" alone. */
export const EmptyBlock: Story = {
  args: {
    plan: {
      version: 1,
      hub: {
        chains: [
          {
            id: "c",
            sharePct: 0,
            steps: [{ id: "b", family: "position", kind: "aaveSupply", config: null }],
          },
        ],
      },
      spokes: [],
    },
    blockId: "b",
  },
};
