/**
 * @id PP-MGR-CMP-059
 * @name BuildGraph.stories
 * @implements-rules-version v1 (POO-2156 rules v1)
 * @analytics-events none, a story file of a controlled renderer
 *
 * The graph of the Build canvas (POO-2156, handoff v1.2 [ST1], [ST5] to [ST9]) drawn from the
 * reference canvases of `buildCanvasFixtures.ts` at 100% zoom, the scale the Figma reference
 * canvases are measured at: canvas D (empty, Build state 1), Build state 3 (a block just added,
 * empty and selected), Build state 5 (one chain, Collect fees, one return level), canvases A, B and C,
 * worked example 2, a new spoke with no chain, a hub with no chain beside a spoke, a selected block,
 * an invalid block, an invalid network, a coming-soon block, a drag in progress (active targets),
 * and the graph inside the canvas viewport at fit.
 *
 * In the app the block copy comes from the registry (slice S5); here it comes from the fixtures
 * through `fixtureGraphProps`. Side-by-side parity with Figma is slice S8's; the size checks of the
 * play functions only pin the graph's outer box.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";
import {
  type BuildCanvasFixture,
  buildState3,
  buildState5,
  canvasA,
  canvasB,
  canvasC,
  canvasD,
  hubEmptyWithSpoke,
  newSpokeNoChain,
  workedExample2,
} from "@/mocks/data/buildCanvasFixtures";
import { CanvasViewport } from "../canvas/CanvasViewport";
import { withManagerMessages } from "../canvas/canvasStorySupport";
import { targetKey } from "../layout/graphTypes";
import { BuildGraph, type BuildGraphProps } from "./BuildGraph";
import { type FixtureGraphOptions, fixtureGraphProps, fixtureT } from "./graphFixtureKit";

const NO_KEYS: ReadonlySet<string> = new Set();

function argsOf(fixture: BuildCanvasFixture, options?: FixtureGraphOptions): BuildGraphProps {
  return {
    ...fixtureGraphProps(fixture, options),
    activeTargetKeys: NO_KEYS,
    onTarget: fn(),
    onRemoveSpoke: fn(),
  };
}

/** Checks the graph's drawn outer box against the layout's size (the A2 measure of S8). */
async function expectGraphSize(canvasElement: HTMLElement, width: number, height: number) {
  const graph = canvasElement.querySelector("[data-build-graph]");
  if (!graph) throw new Error("no graph");
  const box = graph.getBoundingClientRect();
  await expect(box.width).toBeCloseTo(width, 1);
  await expect(box.height).toBeCloseTo(height, 1);
}

const meta = {
  title: "Manager/Fund builder/Build canvas/BuildGraph",
  component: BuildGraph,
  parameters: { layout: "padded" },
  decorators: [
    // At 100%, on the canvas fill; a wide graph scrolls inside the frame, never the page.
    (Story) => (
      <div className="max-w-full overflow-auto rounded-xl bg-background">
        <Story />
      </div>
    ),
    withManagerMessages,
  ],
  args: argsOf(canvasC),
} satisfies Meta<typeof BuildGraph>;

export default meta;
type Story = StoryObj<typeof meta>;

/** ST1, Build state 1, canvas D: the empty canvas, 468 x 572 with the English sentence. */
export const EmptyCanvas: Story = {
  args: argsOf(canvasD),
  play: async ({ canvasElement }) => expectGraphSize(canvasElement, 468, 572),
};

/** ST5, Build state 3: a pool block just added, empty, selected, with its Swap · auto. */
export const BlockJustAdded: Story = { args: argsOf(buildState3) };

/** ST6, Build state 5: one chain ending in Collect fees, both returns at one level (C11). */
export const OneChainCollectFees: Story = {
  args: argsOf(buildState5),
  play: async ({ canvasElement }) => expectGraphSize(canvasElement, 552, 650),
};

/** ST7, canvas A: three networks, ten positions, two return levels. 2080 x 772 as a plan. */
export const CanvasA: Story = {
  args: argsOf(canvasA),
  play: async ({ canvasElement }) => expectGraphSize(canvasElement, 2080, 772),
};

/** ST8, canvas B: Aave on three networks, no pool, so no Income (fees). */
export const CanvasB: Story = { args: argsOf(canvasB) };

/** Canvas C, worked example 1: 608 x 674. */
export const CanvasC: Story = {
  play: async ({ canvasElement }) => expectGraphSize(canvasElement, 608, 674),
};

/** Worked example 2 (computed from the rules): one hub chain and one spoke, 928 x 772. */
export const WorkedExample2: Story = {
  args: argsOf(workedExample2),
  play: async ({ canvasElement }) => expectGraphSize(canvasElement, 928, 772),
};

/** ST9: a network just added: its Bridge, its centred circle, the close control on its chip. */
export const NewSpokeNoChain: Story = { args: argsOf(newSpokeNoChain) };

/** Open point 10, default D10: no hub chain beside a spoke; the hub circle at the row's left end. */
export const HubEmptyWithSpoke: Story = { args: argsOf(hubEmptyWithSpoke) };

/** I5: a configured block selected (2 px primary stroke, primary icon). */
export const SelectedBlock: Story = { args: { selectedId: "c-pool-pool" } };

/** D6: a block whose asset left the mandate draws the invalid card. */
export const InvalidBlock: Story = {
  args: argsOf(canvasC, {
    overrides: { "c-supply-supply": { caption: fixtureT("card.invalid"), state: "invalid" } },
  }),
};

/** D6: a spoke whose network left the mandate (Polygon is out of the buildathon scope). */
export const InvalidNetwork: Story = {
  args: { ...argsOf(canvasB), invalidNetworks: new Set(["polygon"]) },
};

/** C22, D27: a coming-soon kind loaded from a draft draws the normal card with the Soon tag. */
export const ComingSoonBlock: Story = {
  args: argsOf(canvasC, {
    overrides: { "c-pool-pool": { caption: "Uniswap v3 · 0.05%", state: "comingSoon" } },
  }),
};

/** I3: a Swap dragged from the palette lights the two slots a Swap fits on canvas C. */
export const DragInProgress: Story = {
  args: {
    activeTargetKeys: new Set([
      targetKey({ kind: "port", side: "before", blockId: "c-supply-supply" }),
      targetKey({ kind: "port", side: "after", blockId: "c-supply-supply" }),
    ]),
  },
};

/** The graph inside the canvas viewport (S2), opened at fit: canvas A fits at about 30%. */
export const InViewportAtFit: Story = {
  args: argsOf(canvasA),
  decorators: [
    (Story) => (
      <div className="w-[656px] max-w-full">
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <CanvasViewport graphSize={args.layout}>
      <BuildGraph {...args} />
    </CanvasViewport>
  ),
};
