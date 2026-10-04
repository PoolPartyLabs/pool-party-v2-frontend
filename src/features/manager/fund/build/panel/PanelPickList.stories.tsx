/**
 * @id PP-MGR-CMP-068
 * @name PanelPickList.stories
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, a story file of a presentational list
 *
 * Modes 2 and 3 of the configuration panel, in the 360 frame: pools (no TVL and no APR, decision
 * A3), assets with their rate, the no-match box, a pasted address, the empty mandate, loading and a
 * failed read (P13). Fixture copy in English, as the bodies will pass it.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { BuildPanelSlot } from "../canvas/BuildPanelSlot";
import { withManagerMessages } from "../canvas/canvasStorySupport";
import { type PanelPickItem, PanelPickList, type PanelPickListProps } from "./PanelPickList";

const POOLS: PanelPickItem[] = [
  {
    id: "weth-usdc",
    title: "WETH / USDC",
    subtitle: "0.05%",
    logos: [{ symbol: "WETH" }, { symbol: "USDC" }],
    searchText: "Wrapped Ether USD Coin",
  },
  {
    id: "wbtc-usdc",
    title: "WBTC / USDC",
    subtitle: "0.30%",
    logos: [{ symbol: "WBTC" }, { symbol: "USDC" }],
    searchText: "Wrapped Bitcoin USD Coin",
  },
];

const ASSETS: PanelPickItem[] = [
  {
    id: "usdc",
    title: "USDC",
    subtitle: "USD Coin",
    logos: [{ symbol: "USDC" }],
    metric: { label: "Supply APY", value: "4.1%", tone: "success" },
    searchText: "",
  },
  {
    id: "weth",
    title: "WETH",
    subtitle: "Wrapped Ether",
    logos: [{ symbol: "WETH" }],
    metric: { label: "Supply APY", value: "1.9%", tone: "success" },
    searchText: "",
  },
];

const noop = () => {};

/** The list in the frame it lives in. */
function InFrame(props: PanelPickListProps) {
  return (
    <BuildPanelSlot>
      <PanelPickList {...props} />
    </BuildPanelSlot>
  );
}

const meta = {
  title: "Manager/Fund builder/Build panel/PanelPickList",
  component: InFrame,
  parameters: { layout: "padded" },
  decorators: [withManagerMessages],
  args: {
    heading: "Pools in your mandate",
    count: 2,
    filterPlaceholder: "Filter by token or address",
    items: POOLS,
    useLabel: "Use",
    rowLabel: (title: string) => `Use ${title}`,
    onUse: noop,
    caption:
      "Only the Uniswap v4 pools on Arbitrum that you chose in the mandate (step 4). Pools are fixed at launch.",
    link: { prompt: "Need another pool?", label: "Edit mandate · Pools", onClick: noop },
    noMatch: {
      title: (typed: string) => `No pool in your mandate has ${typed}`,
      caption: "Pools are chosen in the mandate, step 4. Your build stays saved while you edit it.",
    },
    emptyTitle: "No pool of your mandate is on Arbitrum",
  },
} satisfies Meta<typeof InFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Mode 2, pools: no metric stack (A3). */
export const Pools: Story = {};

/** Mode 2, assets: the rate in `success`. */
export const Assets: Story = {
  args: {
    heading: "Assets in your mandate",
    filterPlaceholder: "Filter by token",
    items: ASSETS,
    caption: "Only the tokens of your mandate that Aave v3 lists on Arbitrum (step 3).",
    link: { prompt: "Need another asset?", label: "Edit mandate · Tokens", onClick: noop },
  },
};

/** Mode 3: the filter matches nothing. */
export const NoMatch: Story = { args: { defaultFilter: "PEPE" } };

/** Mode 3 with a pasted address, shortened in the middle. */
export const NoMatchAddress: Story = {
  args: { defaultFilter: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1" },
};

/** The mandate holds no pool of this protocol on this network. */
export const EmptyMandate: Story = { args: { items: [], count: 0 } };

/** P13: the live read is loading. */
export const Loading: Story = { args: { status: "loading" } };

/** P13: the live read failed, with the inline retry. */
export const ReadFailed: Story = {
  args: {
    status: "error",
    error: { text: "The v2 catalog is unavailable.", retryLabel: "Retry", onRetry: noop },
  },
};
