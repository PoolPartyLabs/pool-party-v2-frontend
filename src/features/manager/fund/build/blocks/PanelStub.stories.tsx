/**
 * @id PP-MGR-CMP-058
 * @name PanelStub.stories
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @analytics-events none, a story file of a presentational stub
 *
 * The panel stub inside its Configure block frame (POO-2155, handoff v1.2 AN10): nothing selected,
 * an empty block selected (Build state 3), a configured block selected, the sentences of an open
 * Add protocol menu (8130-3408) and of a port menu after a Supply (8181-2110), and the undo toast a
 * remove leaves ("Block removed" with "Undo", on the app's Toast). Heads and sentences come from the
 * registry and the menu models over the S1 test plans, in English.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect } from "react";
import { Toaster, toast } from "@/components/ui/Toast";
import { BuildPanelSlot } from "../canvas/BuildPanelSlot";
import { withManagerMessages } from "../canvas/canvasStorySupport";
import { type BuildPlan, createEmptyPlan } from "../plan/buildPlan";
import { hubPoolPlan, hubSupplyPlan } from "../plan/planTestKit";
import { describePanelHead } from "./blockRegistry";
import { makeDescribeContext, makeTestCopy } from "./blockTestKit";
import { menuOpenSentence } from "./menuModels";
import { PanelStub, type PanelStubProps } from "./PanelStub";

const copy = makeTestCopy();

/** A hub chain with one empty pool, as Add protocol leaves it (Build state 3). */
function emptyPoolPlan(): BuildPlan {
  return {
    ...createEmptyPlan(),
    hub: {
      chains: [
        {
          id: "c",
          sharePct: 0,
          steps: [
            { id: "s", family: "flow", kind: "swap", auto: true },
            { id: "b", family: "position", kind: "uniswapV4Pool", config: null },
          ],
        },
      ],
    },
  };
}

/** The stub in the frame it lives in. */
function InSlot(props: PanelStubProps) {
  return (
    <div className="bg-background p-10">
      <BuildPanelSlot>
        <PanelStub {...props} />
      </BuildPanelSlot>
    </div>
  );
}

const meta = {
  title: "Manager/Fund builder/Build canvas/PanelStub",
  component: InSlot,
  parameters: { layout: "fullscreen" },
  decorators: [withManagerMessages],
  args: {
    head: null,
    nothingTitle: copy.panel.nothingTitle,
    body: copy.panel.nothingBody,
    removeLabel: copy.panel.remove,
    onRemove: () => {},
  },
} satisfies Meta<typeof InSlot>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing selected (Build state 1). */
export const NothingSelected: Story = {};

/** The Add protocol menu is open (Build state 2): the stub says where the block lands. */
export const AddProtocolMenuOpen: Story = {
  args: {
    body: menuOpenSentence(
      { kind: "addProtocol", network: "arbitrum" },
      makeDescribeContext(createEmptyPlan()),
    ),
  },
};

/** The port menu after a Supply is open (8181-2110). */
export const PortMenuOpenAfterASupply: Story = {
  args: {
    body: menuOpenSentence(
      { kind: "port", side: "after", blockId: "hub-supply-supply" },
      makeDescribeContext(hubSupplyPlan()),
    ),
  },
};

/** A block just added: empty and selected (Build state 3, G6). */
export const EmptyBlockSelected: Story = {
  args: { head: describePanelHead("b", makeDescribeContext(emptyPoolPlan())), body: null },
};

/** A configured block selected (only fixtures configure one in this batch). */
export const ConfiguredBlockSelected: Story = {
  args: {
    head: describePanelHead("hub-pool-pool", makeDescribeContext(hubPoolPlan())),
    body: null,
  },
};

/** What a remove leaves: the undo toast on the app's Toast ("Block removed", "Undo"). */
function UndoToastDemo(props: PanelStubProps) {
  useEffect(() => {
    toast(copy.toast.removed, { action: { label: copy.toast.undo, onClick: () => {} } });
  }, []);
  return (
    <>
      <InSlot {...props} />
      <Toaster />
    </>
  );
}

export const UndoToastAfterRemove: Story = {
  render: (args) => <UndoToastDemo {...args} />,
};
