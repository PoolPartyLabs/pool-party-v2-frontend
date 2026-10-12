/**
 * @id PP-MGR-CMP-103
 * @name StrategyChartSurface stories
 * @description Charts unavailable state, with and without a selected block.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8682-3253
 * @linear https://linear.app/yeildbay/issue/POO-2336
 * @linear https://linear.app/yeildbay/issue/POO-2338
 * @implements-rules-version v1 (POO-2336), v1 (POO-2338)
 * @analytics-events manager_chart_viewed, manager_chart_blocked (harness only, no remote widget)
 *
 * The stories show only unavailable states. They do not load the DEX Screener frame.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { userEvent, within } from "storybook/test";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import type { ChartSelection } from "./chartContext";
import type { ChartBlockReason } from "./chartModel";
import { StrategyChartSurface } from "./StrategyChartSurface";

// Story fixture only. BuildScreen and ManageScreen pass the real selection and its label.
const blocked = (reason: ChartBlockReason): ChartSelection => ({
  identity: "fixture-block",
  availability: { status: "unavailable", reason },
});

const meta = {
  title: "Manager/Charts/Strategy chart surface",
  component: StrategyChartSurface,
  decorators: [withManagerMessages],
  args: {
    context: "manage",
    selection: blocked("unsupported_block"),
    selectionLabel: "Swap · USDC / WETH",
    fillContainer: false,
    children: <div className="p-4 text-sm text-muted-foreground">Strategy flow canvas</div>,
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("tab", { name: "Charts" }));
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof StrategyChartSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A block with no chart (Swap) shows the unavailable state with its label (POO-2338 R5). */
export const UnavailableWithSelection: Story = {};

/** An unsupported pair shows the same state (R4). */
export const UnavailableUnsupportedPair: Story = {
  args: { selection: blocked("unsupported_pair"), selectionLabel: "USDG / WETH" },
};

/** A mock pool with no real address or PoolId is unconfigured (POO-2338 R5). */
export const UnavailableUnconfiguredPool: Story = {
  args: { selection: blocked("unconfigured"), selectionLabel: "Uniswap v4 · WETH / USDC" },
};

/** No selected block: the state shows no preserved selection box. */
export const UnavailableNoSelection: Story = {
  args: {
    selection: { identity: null, availability: { status: "unavailable", reason: "no_selection" } },
    selectionLabel: null,
  },
};
