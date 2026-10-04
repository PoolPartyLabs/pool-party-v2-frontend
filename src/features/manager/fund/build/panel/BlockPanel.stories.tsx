/**
 * @id PP-MGR-CMP-061
 * @name BlockPanel.stories
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, a story file; the harness hands panel events to nobody
 *
 * The configuration panel shell in each mode (handoff "Panel shell"), through `PanelHarness`: the
 * real plan hook, selection and draft over the S1 test mandate (Arbitrum and Robinhood Chain), with
 * the FIXTURE pool and Supply bodies of `panelFixtures.tsx` (the real bodies are their own slices).
 * Mode 1 with its three bodies; Mode 2 for a pool and an asset; Mode 3; the empty mandate; Mode 4
 * clean, with changes not applied, leaving blocked, at a mandate cap, at the strategy's room; the
 * remove confirm; and a kind with no body yet (the head and Remove block).
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { withManagerMessages } from "../canvas/canvasStorySupport";
import type { BuildPlan } from "../plan/buildPlan";
import {
  hubPoolPlan,
  hubPoolWithFeesPlan,
  makeTestDraft,
  supplyBorrowPlan,
  withCompletePools,
} from "../plan/planTestKit";
import { fixtureHeldPoolBody, fixtureLimitedSupplyBody } from "./panelFixtures";
import { PanelHarness } from "./panelTestKit";

/** A hub chain with one empty block, as Add protocol leaves it. */
function emptyBlockPlan(kind: "uniswapV4Pool" | "aaveSupply"): BuildPlan {
  return {
    version: 1,
    hub: {
      chains: [
        {
          id: "c",
          sharePct: 0,
          steps: [
            ...(kind === "uniswapV4Pool"
              ? [{ id: "s", family: "flow" as const, kind: "swap" as const, auto: true }]
              : []),
            { id: "b", family: "position" as const, kind, config: null },
          ],
        },
      ],
    },
    spokes: [],
  };
}

/** The configured pool at 60%, next to another chain holding 35%. */
function crowdedPlan(): BuildPlan {
  const plan = withCompletePools(hubPoolPlan());
  plan.hub.chains.push({
    id: "other",
    sharePct: 35,
    steps: [{ id: "o", family: "position", kind: "aaveSupply", config: null }],
  });
  return plan;
}

const draft = makeTestDraft();

const meta = {
  title: "Manager/Fund builder/Build panel/BlockPanel",
  component: PanelHarness,
  parameters: { layout: "padded" },
  decorators: [withManagerMessages],
  args: { draft, plan: withCompletePools(hubPoolPlan()), selectedId: null },
} satisfies Meta<typeof PanelHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Mode 1: nothing selected. */
export const NothingSelected: Story = {};

/** Mode 1 while the Add protocol menu is open on the canvas. */
export const NothingSelectedAddProtocol: Story = {
  args: {
    menuSentence: "Choose a protocol in the menu. The block is added on Arbitrum and opens here.",
  },
};

/** Mode 1 while the menu of the port under a Supply is open. */
export const NothingSelectedPortUnderSupply: Story = {
  args: {
    plan: supplyBorrowPlan(),
    menuSentence:
      "Choose what comes after Supply WETH. A Borrow block uses that supply as its collateral.",
  },
};

/** Mode 2: an empty pool block picks from the mandate's pools on its network. */
export const PickPool: Story = {
  args: { plan: emptyBlockPlan("uniswapV4Pool"), selectedId: "b" },
};

/** Mode 2: an empty Supply block picks from the mandate's tokens, with their rate. */
export const PickAsset: Story = {
  args: { plan: emptyBlockPlan("aaveSupply"), selectedId: "b" },
};

/** Mode 4: a configured pool, everything applied. */
export const Configured: Story = {
  args: { selectedId: "hub-pool-pool" },
};

/** Mode 4 with the Allocation moved: Changes not applied, Apply changes enabled (P5). */
export const ChangesNotApplied: Story = {
  args: { selectedId: "hub-pool-pool", scenario: { share: 45 } },
};

/** P6: a way out was refused while changes were not applied: the notice. */
export const LeaveBlocked: Story = {
  args: { selectedId: "hub-pool-pool", scenario: { share: 45, leave: true } },
};

/** P8: the other chain already takes 35%, so this one stops at 65%. */
export const StrategyRoom: Story = {
  args: { plan: crowdedPlan(), selectedId: "hub-pool-pool", scenario: { share: 65 } },
};

/** P8: a mandate cap on Uniswap v4 of 70% stops the slider, with the Limits link. */
export const MandateCap: Story = {
  args: {
    draft: {
      ...draft,
      caps: {
        ...draft.caps,
        protocols: { ...draft.caps.protocols, "uniswap-v4": { noCap: false, pct: 70 } },
      },
    },
    selectedId: "hub-pool-pool",
    scenario: { share: 70 },
  },
};

/** P10: Remove block asks, naming the share and the steps that go with it. */
export const RemoveConfirm: Story = {
  args: {
    plan: withCompletePools(hubPoolWithFeesPlan()),
    selectedId: "hub-pool-pool",
    removeConfirmOpen: true,
  },
};

/** P10: an empty block's confirm asks only "Remove this block?". */
export const RemoveConfirmEmpty: Story = {
  args: { plan: emptyBlockPlan("aaveSupply"), selectedId: "b", removeConfirmOpen: true },
};

/** A kind with no body yet (the Borrow): the head and Remove block, as the stub did. */
export const NoBodyYet: Story = {
  args: { plan: supplyBorrowPlan(), selectedId: "hub-aave-borrow" },
};

/** M1, P13: the body's apply gate holds Apply changes, and the status row says why. */
export const ApplyHeld: Story = {
  args: {
    selectedId: "hub-pool-pool",
    scenario: { share: 45 },
    bodies: { uniswapV4Pool: fixtureHeldPoolBody },
  },
};

/** M2: an asset that cannot be used says why, and its Use is disabled. */
export const PickAssetNotUsable: Story = {
  args: {
    plan: emptyBlockPlan("aaveSupply"),
    selectedId: "b",
    bodies: { aaveSupply: fixtureLimitedSupplyBody },
  },
};
