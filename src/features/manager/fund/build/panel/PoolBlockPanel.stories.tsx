/**
 * @id PP-MGR-CMP-069
 * @name PoolBlockPanel stories
 * @implements-rules-version v1 (POO-2189)
 * @analytics-events none (the panel shell emits)
 * Real pool body in the panel shell, plus deterministic catalog loading and failure states.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { userEvent, within } from "storybook/test";
import { findPanelPoolFixture } from "@/mocks/data/buildPanelFixtures";
import { withManagerMessages } from "../canvas/canvasStorySupport";
import type { BuildPlan, PoolBlockConfig } from "../plan/buildPlan";
import { hubPoolPlan, makeTestDraft } from "../plan/planTestKit";
import { poolBlockPanel } from "./PoolBlockPanel";
import type { PanelBodies } from "./panelBodies";
import { toLivePoolGrid, toPanelPoolView } from "./panelCatalogView";
import { PanelHarness } from "./panelTestKit";
import { presetRange } from "./poolRangeMath";

const draft = makeTestDraft();
const plan = hubPoolPlan();
for (const chain of plan.hub.chains)
  for (const step of chain.steps)
    if (step.kind === "uniswapV4Pool" && step.config) {
      const pool = findPanelPoolFixture(42161, step.config.poolId);
      if (pool) {
        const view = toPanelPoolView(pool);
        step.config = {
          poolId: step.config.poolId,
          ...presetRange(toLivePoolGrid(view), 10),
          slippagePct: 2,
        };
      }
    }
const bodies: PanelBodies = { uniswapV4Pool: poolBlockPanel };
const selected =
  plan.hub.chains.flatMap((chain) => chain.steps).find((step) => step.kind === "uniswapV4Pool")
    ?.id ?? null;
function empty(): BuildPlan {
  return {
    version: 1,
    hub: {
      chains: [
        {
          id: "c",
          sharePct: 0,
          steps: [{ id: "b", family: "position", kind: "uniswapV4Pool", config: null }],
        },
      ],
    },
    spokes: [],
  };
}
function configured(edit: (config: PoolBlockConfig) => PoolBlockConfig): BuildPlan {
  return {
    ...plan,
    hub: {
      chains: plan.hub.chains.map((chain) => ({
        ...chain,
        steps: chain.steps.map((step) =>
          step.kind === "uniswapV4Pool" && step.config
            ? { ...step, config: edit(step.config) }
            : step,
        ),
      })),
    },
  };
}
const meta = {
  title: "Manager/Fund builder/Build panel/Uniswap v4",
  component: PanelHarness,
  decorators: [withManagerMessages],
  args: { draft, plan, selectedId: selected, bodies },
} satisfies Meta<typeof PanelHarness>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Applied: Story = {};
export const PickAPool: Story = { args: { plan: empty(), selectedId: "b" } };
export const PoolSelectOpen: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "Pool" }));
  },
};
export const MandateCap: Story = {
  args: {
    draft: {
      ...draft,
      caps: {
        ...draft.caps,
        protocols: { ...draft.caps.protocols, "uniswap-v4": { noCap: false, pct: 70 } },
      },
    },
    scenario: { share: 70 },
  },
};
export const ParentLimited: Story = {
  args: {
    plan: {
      ...plan,
      hub: {
        chains: [
          ...plan.hub.chains,
          {
            id: "other",
            sharePct: 55,
            steps: [{ id: "other-block", family: "position", kind: "aaveSupply", config: null }],
          },
        ],
      },
    },
    scenario: { share: 45 },
  },
};
export const Full: Story = {
  args: {
    plan: configured((config) => {
      const raw = findPanelPoolFixture(42161, config.poolId);
      return raw
        ? { ...config, ...presetRange(toLivePoolGrid(toPanelPoolView(raw)), "full") }
        : config;
    }),
  },
};
export const Custom: Story = {
  args: {
    plan: configured((config) => ({
      ...config,
      tickLower: (config.tickLower ?? 0) - 1000,
      tickUpper: (config.tickUpper ?? 0) + 800,
    })),
  },
};
export const OutOfRange: Story = {
  args: {
    plan: configured((config) => ({
      ...config,
      tickLower: (config.tickLower ?? 0) + 6000,
      tickUpper: (config.tickUpper ?? 0) + 6000,
    })),
  },
};
export const Inverted: Story = {
  args: { plan: configured((config) => ({ ...config, displayInverted: true })) },
};
export const CustomSlippage: Story = {
  args: { plan: configured((config) => ({ ...config, slippagePct: 3 })) },
};
export const ChangesNotApplied: Story = { args: { scenario: { share: 35 } } };
export const LeavingWithChanges: Story = { args: { scenario: { share: 35, leave: true } } };
export const RemoveConfirm: Story = { args: { removeConfirmOpen: true } };
export const NoPoolOnNetwork: Story = {
  args: { draft: { ...draft, pools: [] }, plan: empty(), selectedId: "b" },
};
export const FilterWithResults: Story = {
  args: { plan: empty(), selectedId: "b" },
  play: async ({ canvasElement }) => {
    await userEvent.type(
      await within(canvasElement).findByRole("textbox", { name: "Filter by token or address" }),
      "WETH",
    );
  },
};
export const NoMatch: Story = {
  args: { plan: empty(), selectedId: "b" },
  play: async ({ canvasElement }) => {
    await userEvent.type(
      await within(canvasElement).findByRole("textbox", { name: "Filter by token or address" }),
      "not-a-token",
    );
  },
};
export const Loading: Story = {
  args: {
    plan: empty(),
    selectedId: "b",
    bodies: {
      uniswapV4Pool: {
        ...poolBlockPanel,
        usePick: (context) => ({ ...poolBlockPanel.usePick(context), status: "loading", rows: [] }),
      },
    },
  },
};
export const ReadFailed: Story = {
  args: {
    plan: empty(),
    selectedId: "b",
    bodies: {
      uniswapV4Pool: {
        ...poolBlockPanel,
        usePick: (context) => ({ ...poolBlockPanel.usePick(context), status: "error", rows: [] }),
      },
    },
  },
};
