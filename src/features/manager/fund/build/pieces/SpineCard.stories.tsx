/**
 * @id PP-MGR-CMP-048
 * @name SpineCard.stories
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a story file of a presentational piece
 *
 * The fixed blocks of the hub's spine (POO-2154, handoff v1.2 [BB2]): one story per role, and the
 * lock's tooltip opened from the keyboard. Copy from the `spine.*` keys through `storyT`.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { storyT, withCanvasBackground } from "./pieceStorySupport";
import { SpineCard } from "./SpineCard";

const meta = {
  title: "Manager/Fund builder/Build canvas/Pieces/SpineCard",
  component: SpineCard,
  parameters: { layout: "padded" },
  decorators: [withCanvasBackground],
  args: {
    title: storyT("spine.deposit.title"),
    caption: storyT("spine.deposit.caption"),
    icon: "depositIn",
    locked: true,
    lockTooltip: storyT("spine.lockTooltip"),
  },
} satisfies Meta<typeof SpineCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Deposit: locked, arrow into tray. */
export const Deposit: Story = {};

/** Idle input: USDC waiting on the hub, hourglass, no lock. */
export const IdleInput: Story = {
  args: {
    title: storyT("spine.idleInput.title"),
    caption: storyT("spine.idleInput.caption"),
    icon: "hourglass",
    locked: false,
    lockTooltip: undefined,
  },
};

/** Idle output: USDC back on the hub, hourglass, no lock. */
export const IdleOutput: Story = {
  args: {
    title: storyT("spine.idleOutput.title"),
    caption: storyT("spine.idleOutput.caption"),
    icon: "hourglass",
    locked: false,
    lockTooltip: undefined,
  },
};

/** Income (fees): only when a Collect fees exists (C10); coins, no lock. */
export const Income: Story = {
  args: {
    title: storyT("spine.income.title"),
    caption: storyT("spine.income.caption"),
    icon: "coins",
    locked: false,
    lockTooltip: undefined,
  },
};

/** Withdraw: locked, arrow out of tray. */
export const Withdraw: Story = {
  args: {
    title: storyT("spine.withdraw.title"),
    caption: storyT("spine.withdraw.caption"),
    icon: "withdrawOut",
  },
};

/** The lock's tooltip, reached from the keyboard (C19): side top, offset 4, one line. */
export const LockTooltip: Story = {
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.tab();
    await expect(
      within(canvasElement).getByRole("button", { name: storyT("spine.lockTooltip") }),
    ).toHaveFocus();
  },
};
