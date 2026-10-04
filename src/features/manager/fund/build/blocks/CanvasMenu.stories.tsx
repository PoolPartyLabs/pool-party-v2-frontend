/**
 * @id PP-MGR-CMP-057
 * @name CanvasMenu.stories
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @analytics-events none, a story file of a presentational menu
 *
 * The three canvas menus (POO-2155, handoff v1.2 BB9, I1, I2, I4), each opened beside a stand-in
 * anchor: Add protocol on the hub (Build state 2: the disabled Borrow and the three coming-soon rows),
 * on Robinhood Chain (no Borrow), with nothing available; Add network with one network left and with
 * none; the port menus before a card, after a pool and after a Supply (8181-2110). Every model comes
 * from `menuModels` over the S1 test draft, with the English copy, so the stories show real strings.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, within } from "storybook/test";
import type { MandateDraft } from "../../mandateDraft";
import { createEmptyPlan } from "../plan/buildPlan";
import {
  emptySpokePlan,
  hubPoolPlan,
  hubSupplyPlan,
  makeTestDraft,
  supplyBorrowPlan,
} from "../plan/planTestKit";
import { makeDescribeContext } from "./blockTestKit";
import { CanvasMenu } from "./CanvasMenu";
import { type MenuModel, networkMenuModel, portMenuModel, protocolMenuModel } from "./menuModels";

/** A dashed circle standing for the template or port the menu opened from. */
function OpenMenu({ model }: { model: MenuModel }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <div className="flex h-[520px] items-start bg-background p-10">
      <button
        type="button"
        ref={setAnchor}
        aria-label="anchor"
        className="size-10 rounded-full border border-primary border-dashed"
      />
      <CanvasMenu
        menu={anchor ? { anchor, model } : null}
        onChoose={() => {}}
        onLink={() => {}}
        onClose={() => {}}
      />
    </div>
  );
}

const meta = {
  title: "Manager/Fund builder/Build canvas/CanvasMenu",
  component: OpenMenu,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof OpenMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

const REQUIRED_ONLY: MandateDraft = {
  ...makeTestDraft(),
  protocols: ["uniswap-v3-swap", "across"],
};

/** Build state 2: Uniswap v4 and Aave v3 Supply enabled, Borrow and the coming-soon rows disabled. */
export const AddProtocolOnTheHub: Story = {
  args: { model: protocolMenuModel("arbitrum", makeDescribeContext(createEmptyPlan())) },
  play: async () => {
    const menu = within(document.body).getByRole("menu", { name: "Protocols on Arbitrum" });
    await expect(within(menu).getAllByRole("menuitem")).toHaveLength(7);
  },
};

/** Robinhood Chain: Aave v3 is not offered there, so neither Supply nor the Borrow row shows. */
export const AddProtocolOnRobinhoodChain: Story = {
  args: { model: protocolMenuModel("robinhood", makeDescribeContext(emptySpokePlan())) },
};

/** Nothing of the mandate is available on the row: the sentence and the link only. */
export const AddProtocolNothingAvailable: Story = {
  args: {
    model: protocolMenuModel("arbitrum", makeDescribeContext(createEmptyPlan(), REQUIRED_ONLY)),
  },
};

/** Add network with Robinhood Chain left to add. */
export const AddNetworkOneLeft: Story = {
  args: { model: networkMenuModel(makeDescribeContext(createEmptyPlan())) },
};

/** Add network with every mandate network on the canvas: the footer and the link (D4). */
export const AddNetworkNoneLeft: Story = {
  args: { model: networkMenuModel(makeDescribeContext(emptySpokePlan())) },
};

/** The top port of a configured Supply: Swap. */
export const PortBeforeACard: Story = {
  args: {
    model: portMenuModel(
      { side: "before", blockId: "hub-supply-supply" },
      makeDescribeContext(hubSupplyPlan()),
    ),
  },
};

/** The bottom port of a configured pool: Collect fees. */
export const PortAfterAPool: Story = {
  args: {
    model: portMenuModel(
      { side: "after", blockId: "hub-pool-pool" },
      makeDescribeContext(hubPoolPlan()),
    ),
  },
};

/** The bottom port of a configured Supply (8181-2110): Borrow against this supply, then Swap. */
export const PortAfterASupply: Story = {
  args: {
    model: portMenuModel(
      { side: "after", blockId: "hub-supply-supply" },
      makeDescribeContext(hubSupplyPlan()),
    ),
  },
};

/** The bottom port of a configured Borrow: Swap. */
export const PortAfterABorrow: Story = {
  args: {
    model: portMenuModel(
      { side: "after", blockId: "hub-aave-borrow" },
      makeDescribeContext(supplyBorrowPlan()),
    ),
  },
};
