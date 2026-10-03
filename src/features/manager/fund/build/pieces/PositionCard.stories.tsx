/**
 * @id PP-MGR-CMP-049
 * @name PositionCard.stories
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a story file of a presentational piece
 *
 * The position card of the Build canvas (POO-2154, handoff v1.2 [BB1], [A3], D11, D27): default,
 * selected, empty (not selected and selected), invalid, coming soon, a long caption, an Aave Supply
 * and Borrow, and the hover and focus looks driven by a pointer and the keyboard. Every string comes
 * from the canvas keys through `storyT`.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { PositionCard } from "./PositionCard";
import { storyNetworkNames, storyT, withCanvasBackground } from "./pieceStorySupport";
import type { BlockContent } from "./pieceTypes";

const poolTitle = storyT("card.poolTitle", { token0: "WETH", token1: "USDC" });
const poolCaption = storyT("card.poolCaption", {
  protocol: storyT("blocks.uniswapV4Pool.protocol"),
  fee: "0.05",
});

/** A block's accessible name (I10), as S5 builds it. */
function nameOf(title: string, caption: string, pct: number): string {
  return storyT("card.accessibleName", {
    title,
    caption,
    network: storyNetworkNames.arbitrum,
    pct,
  });
}

const configuredPool: BlockContent = {
  title: poolTitle,
  caption: poolCaption,
  icon: "layers",
  state: "default",
  accessibleName: nameOf(poolTitle, poolCaption, 60),
};

const emptyPool: BlockContent = {
  title: storyT("blocks.uniswapV4Pool.protocol"),
  caption: storyT("card.pickPool"),
  icon: "layers",
  state: "empty",
  accessibleName: nameOf(storyT("blocks.uniswapV4Pool.protocol"), storyT("card.pickPool"), 0),
};

const meta = {
  title: "Manager/Fund builder/Build canvas/Pieces/PositionCard",
  component: PositionCard,
  parameters: { layout: "padded" },
  decorators: [withCanvasBackground],
  args: { content: configuredPool, selected: false, onSelect: () => {} },
} satisfies Meta<typeof PositionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A configured Uniswap v4 pool: 1 px `border`, muted icon. */
export const Default: Story = {};

/** Selected: 2 px `primary`, the icon in `primary`. Same 176 x 62 box. */
export const Selected: Story = { args: { selected: true } };

/** Just added and not selected: dashed 6 6 in `border`, "Pick a pool" in `primary`. */
export const EmptyNotSelected: Story = { args: { content: emptyPool } };

/** Just added: a new block arrives selected, so its dashes are `primary` (Build state 3). */
export const EmptySelected: Story = { args: { content: emptyPool, selected: true } };

/** D27: the pool left the mandate. 1 px `destructive`, the caption says so. */
export const Invalid: Story = {
  args: {
    content: {
      ...configuredPool,
      caption: storyT("card.invalid"),
      state: "invalid",
      accessibleName: nameOf(poolTitle, storyT("card.invalid"), 60),
    },
  },
};

/** D27: a coming-soon kind loaded from a draft: the normal card plus the Soon tag. */
export const ComingSoon: Story = {
  args: {
    content: {
      ...configuredPool,
      caption: storyT("card.poolCaption", {
        protocol: storyT("blocks.uniswapV3Pool.protocol"),
        fee: "0.05",
      }),
      state: "comingSoon",
      soonTag: storyT("palette.soon"),
    },
  },
};

const longCaption = storyT("card.aaveCaptionOnNetwork", { network: storyNetworkNames.robinhood });

/** D11: "Aave v3 · Robinhood Chain" is wider than the text column: one line, ellipsis, tooltip. */
export const LongCaption: Story = {
  args: {
    content: {
      title: storyT("card.supplyTitle", { symbol: "USDG" }),
      caption: longCaption,
      fullCaption: longCaption,
      icon: "bank",
      state: "default",
      accessibleName: nameOf(storyT("card.supplyTitle", { symbol: "USDG" }), longCaption, 25),
    },
  },
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.hover(within(canvasElement).getByRole("button"));
  },
};

/** An Aave v3 Supply on the hub (canvas C). */
export const AaveSupply: Story = {
  args: {
    content: {
      title: storyT("card.supplyTitle", { symbol: "USDC" }),
      caption: storyT("card.aaveCaption"),
      icon: "bank",
      state: "default",
      accessibleName: nameOf(
        storyT("card.supplyTitle", { symbol: "USDC" }),
        storyT("card.aaveCaption"),
        40,
      ),
    },
  },
};

/** An empty Aave v3 Borrow: "Aave v3 Borrow", "Pick an asset". */
export const AaveBorrowEmpty: Story = {
  args: {
    content: {
      title: storyT("card.emptyBorrow"),
      caption: storyT("card.pickAsset"),
      icon: "bank",
      state: "empty",
      accessibleName: nameOf(storyT("card.emptyBorrow"), storyT("card.pickAsset"), 0),
    },
  },
};

/** Hover raises the border to `muted-foreground`. */
export const Hover: Story = {
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.hover(within(canvasElement).getByRole("button"));
  },
};

/** Keyboard focus: the app focus ring, outside the 176 x 62 box. */
export const Focus: Story = {
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.tab();
    await expect(within(canvasElement).getByRole("button")).toHaveFocus();
  },
};
