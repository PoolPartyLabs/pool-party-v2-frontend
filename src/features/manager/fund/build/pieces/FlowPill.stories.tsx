/**
 * @id PP-MGR-CMP-050
 * @name FlowPill.stories
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a story file of a presentational piece
 *
 * The flow pills of the Build canvas (POO-2154, handoff v1.2 [BB3], [C7]): Swap · auto, Swap,
 * Collect fees and Bridge · auto, plus the tooltip opened from the keyboard. Copy from the `flow.*`
 * and `tooltip.*` keys through `storyT`; `{token}` is the network's stable (USDG on Robinhood Chain).
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { FlowPill } from "./FlowPill";
import {
  expectOuterSize,
  storyNetworkNames,
  storyT,
  withCanvasBackground,
} from "./pieceStorySupport";

const meta = {
  title: "Manager/Fund builder/Build canvas/Pieces/FlowPill",
  component: FlowPill,
  parameters: { layout: "padded" },
  decorators: [withCanvasBackground],
  args: {
    content: {
      text: storyT("flow.swapAuto"),
      tooltip: storyT("tooltip.swapAuto", { token: "USDC" }),
      icon: "swap",
    },
  },
  // F8: every story without its own play measures the pill: 176 x 26, and its icon inset 11 from
  // the left, where the Figma pill (8220:2482) draws it (1 px stroke in layout plus 10 of padding).
  play: async ({ canvasElement }) => {
    const pill = canvasElement.querySelector("[data-flow-pill]");
    await expectOuterSize(pill, { width: 176, height: 26 });
    const icon = pill?.querySelector("[data-block-icon]");
    if (!pill || !icon) throw new Error("no pill icon");
    await expect(icon.getBoundingClientRect().left - pill.getBoundingClientRect().left).toBeCloseTo(
      11,
      1,
    );
  },
} satisfies Meta<typeof FlowPill>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Swap · auto: placed by the app before a pool (C13). */
export const SwapAuto: Story = {};

/** Swap: placed by the manager at a port. */
export const Swap: Story = {
  args: { content: { text: storyT("flow.swap"), tooltip: storyT("tooltip.swap"), icon: "swap" } },
};

/** Collect fees: directly after a pool; the coins icon. */
export const CollectFees: Story = {
  args: {
    content: {
      text: storyT("flow.collectFees"),
      tooltip: storyT("tooltip.collectFees"),
      icon: "coins",
    },
  },
};

/** Bridge · auto: the first block of a spoke group; the provider is never named. */
export const BridgeAuto: Story = {
  args: {
    content: {
      text: storyT("flow.bridgeAuto"),
      tooltip: storyT("tooltip.bridgeAuto", {
        token: "USDG",
        network: storyNetworkNames.robinhood,
      }),
      icon: "bridge",
    },
  },
};

/** The tooltip on keyboard focus (C19): a tab stop that is not a button (focus policy). */
export const TooltipOnFocus: Story = {
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.tab();
    await expect(canvasElement.querySelector("[data-flow-pill]")).toHaveFocus();
    await expect(within(canvasElement).queryByRole("button")).toBeNull();
  },
};
