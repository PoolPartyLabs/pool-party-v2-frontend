/**
 * @id PP-MGR-CMP-056
 * @name BuildPalette.stories
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @analytics-events none, a story file of a presentational palette
 *
 * The palette of the Build step (POO-2155, handoff v1.2 AN8, D25, I3): the full mandate (595 high
 * with the three groups), a mandate without Aave v3, one without Uniswap v4 (no Collect fees), one
 * with no position protocol (the flow and coming-soon groups only), and a drag in progress (the
 * card at 80% under the pointer, ST10). Models come from `paletteModel` over the S1 test draft.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn } from "storybook/test";
import type { MandateDraft } from "../../mandateDraft";
import { makeTestDraft } from "../plan/planTestKit";
import { BuildPalette } from "./BuildPalette";
import { paletteModel } from "./blockRegistry";
import { makeTestCopy } from "./blockTestKit";

const copy = makeTestCopy();

function withProtocols(protocols: MandateDraft["protocols"]): MandateDraft {
  return { ...makeTestDraft(), protocols };
}

const meta = {
  title: "Manager/Fund builder/Build canvas/BuildPalette",
  component: BuildPalette,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[220px] bg-background">
        <Story />
      </div>
    ),
  ],
  args: {
    model: paletteModel(makeTestDraft(), copy),
    onDragStart: fn(),
    onDrop: fn(),
    onDragCancel: fn(),
  },
} satisfies Meta<typeof BuildPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Uniswap v4 and Aave v3 in the mandate: three cards, Swap and Collect fees, three Soon rows. */
export const FullMandate: Story = {};

/** No Aave v3: the Supply and Borrow cards are gone. */
export const WithoutAave: Story = {
  args: { model: paletteModel(withProtocols(["uniswap-v3-swap", "across", "uniswap-v4"]), copy) },
};

/** No Uniswap v4: no pool card and no Collect fees (D25). */
export const WithoutUniswapV4: Story = {
  args: { model: paletteModel(withProtocols(["uniswap-v3-swap", "across", "aave-v3"]), copy) },
};

/** Only the required protocols: no mandate section; Swap and the coming-soon rows remain. */
export const ComingSoonOnly: Story = {
  args: { model: paletteModel(withProtocols(["uniswap-v3-swap", "across"]), copy) },
};

/** A drag in progress: the card at 80% follows the pointer (ST10). */
export const Dragging: Story = {
  play: async ({ canvasElement, args }) => {
    const card = canvasElement.querySelector<HTMLElement>('[data-palette-item="uniswapV4Pool"]');
    if (!card) throw new Error("no Uniswap v4 card");
    const box = card.getBoundingClientRect();
    const start = { clientX: box.left + 20, clientY: box.top + 20, pointerId: 1, bubbles: true };
    card.dispatchEvent(new PointerEvent("pointerdown", { ...start, button: 0 }));
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        ...start,
        clientX: start.clientX + 160,
        clientY: start.clientY + 60,
      }),
    );
    await expect(args.onDragStart).toHaveBeenCalled();
    await expect(document.querySelector("[data-palette-preview]")).not.toBeNull();
  },
};
