/**
 * @id PP-MGR-CMP-046
 * @name CanvasViewport.stories
 * @implements-rules-version v1 (POO-2152 rules v1)
 * @analytics-events none, a story file of a presentational container
 *
 * The Build canvas container (POO-2152, handoff v1.2 [AN5], [AN6], [AN7], [I8]) around a stand-in
 * graph: the real pieces arrive with slices S4 and S6. Each story is one viewport state the issue
 * lists: at fit, zoomed in, zoomed out to 25%, panning, the readout at 87%, 30%, 25% and 100%, and
 * the A7 check that a graph far wider than the canvas never makes the page scroll sideways.
 *
 * The stories drive the canvas the way a manager does (the controls, a pointer drag), so the
 * readout a reviewer sees is the one the code computed, not an argument passed in.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { CanvasViewport } from "./CanvasViewport";
import {
  CANVAS_A_SIZE,
  CANVAS_C_SIZE,
  CANVAS_D_SIZE,
  PlaceholderGraph,
  withManagerMessages,
} from "./canvasStorySupport";

const meta = {
  title: "Manager/Fund builder/Build canvas/CanvasViewport",
  component: CanvasViewport,
  parameters: { layout: "padded" },
  decorators: [
    // The Build frames' canvas column is 656 wide; the app's content cap makes it about 604 (D23).
    (Story) => (
      <div className="w-[656px] max-w-full">
        <Story />
      </div>
    ),
    withManagerMessages,
  ],
  args: {
    graphSize: CANVAS_C_SIZE,
    onBackgroundClick: () => {},
    children: <PlaceholderGraph {...CANVAS_C_SIZE} />,
  },
} satisfies Meta<typeof CanvasViewport>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opens at fit: worked example 1 (608 x 674) reads 87%. */
export const AtFit: Story = {
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("87%")).toBeInTheDocument();
  },
};

/** Zoomed in twice from the fit: 87% to 90% to 100%, around the centre of the canvas. */
export const ZoomedIn: Story = {
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Zoom in" }));
    await userEvent.click(canvas.getByRole("button", { name: "Zoom in" }));
    await expect(canvas.getByText("100%")).toBeInTheDocument();
  },
};

/** Reference canvas A fits at 30% (below the floor is allowed for fit); zoom out stops at 25%. */
export const ZoomedOutToFloor: Story = {
  args: { graphSize: CANVAS_A_SIZE, children: <PlaceholderGraph {...CANVAS_A_SIZE} /> },
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("30%")).toBeInTheDocument();
    const zoomOut = canvas.getByRole("button", { name: "Zoom out" });
    await userEvent.click(zoomOut);
    await userEvent.click(zoomOut);
    await expect(canvas.getByText("25%")).toBeInTheDocument();
  },
};

/** Reference canvas D: small enough to show at its real size, so the readout says 100%. */
export const SmallGraphAtFullSize: Story = {
  args: { graphSize: CANVAS_D_SIZE, children: <PlaceholderGraph {...CANVAS_D_SIZE} /> },
};

/** Mid-pan: the button is still down after a drag on the background, so the cursor grabs. */
export const Panning: Story = {
  play: async ({ canvasElement }) => {
    const viewport = canvasElement.querySelector<HTMLElement>("[data-canvas-viewport]");
    if (!viewport) throw new Error("no canvas");
    const box = viewport.getBoundingClientRect();
    const at = (dx: number, dy: number) => ({
      bubbles: true,
      button: 0,
      pointerId: 1,
      clientX: box.left + 40 + dx,
      clientY: box.top + 40 + dy,
    });
    viewport.dispatchEvent(new PointerEvent("pointerdown", at(0, 0)));
    viewport.dispatchEvent(new PointerEvent("pointermove", at(60, 30)));
    await expect(viewport.className).toContain("cursor-grabbing");
  },
};

/** No graph yet: the canvas, the controls at 100% and the hint, waiting for the layout. */
export const WaitingForTheGraph: Story = {
  args: { graphSize: null, children: null },
};

/**
 * A7: reference canvas A (2080 wide) in a 360 wide column. The canvas clips the graph and the page
 * itself never gains a horizontal scroll. The play function asserts it in a real browser, which is
 * where layout exists (jsdom has none, so no unit test can).
 */
export const WideGraphNoPageScroll: Story = {
  args: { graphSize: CANVAS_A_SIZE, children: <PlaceholderGraph {...CANVAS_A_SIZE} /> },
  decorators: [
    (Story) => (
      <div className="w-[360px]">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const viewport = canvasElement.querySelector<HTMLElement>("[data-canvas-viewport]");
    if (!viewport) throw new Error("no canvas");
    const page = canvasElement.ownerDocument.documentElement;
    await expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth);
    await expect(viewport.getBoundingClientRect().width).toBeLessThanOrEqual(360);
  },
};
