/**
 * @id PP-MGR-CMP-045
 * @name BuildStepLayout.stories
 * @implements-rules-version v1 (POO-2152 rules v1)
 * @analytics-events none, a story file of a presentational layout
 *
 * The frame of the Build step (POO-2152, handoff v1.2 [AN2], [AN3], [AN4]) with its three columns:
 * a placeholder palette (S5 builds the real one), the canvas container with a stand-in graph, and
 * the empty panel slot. Two states of the bar: without a notice, and with one.
 *
 * The page header, Save & exit and the phase stepper belong to the shell and are absent here.
 * The 1232 wide wrapper is the app's content cap: the canvas column comes out about 604 wide
 * against 656 in the Figma frames (D23, decided before wave 4).
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { BuildPanelSlot } from "./BuildPanelSlot";
import { BuildStepLayout } from "./BuildStepLayout";
import { CanvasViewport } from "./CanvasViewport";
import { CANVAS_C_SIZE, PlaceholderGraph, withManagerMessages } from "./canvasStorySupport";

/** A stand-in for the palette column: outlined slots with no text. */
function PlaceholderPalette() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2, 3, 4].map((slot) => (
        <div key={slot} className="h-[57px] rounded-lg border border-border border-dashed" />
      ))}
    </div>
  );
}

const meta = {
  title: "Manager/Fund builder/Build canvas/BuildStepLayout",
  component: BuildStepLayout,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[1232px] max-w-full">
        <Story />
      </div>
    ),
    withManagerMessages,
  ],
  args: {
    palette: <PlaceholderPalette />,
    canvas: (
      <CanvasViewport graphSize={CANVAS_C_SIZE}>
        <PlaceholderGraph {...CANVAS_C_SIZE} />
      </CanvasViewport>
    ),
    panel: <BuildPanelSlot />,
    onBack: () => {},
    onNext: () => {},
  },
} satisfies Meta<typeof BuildStepLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The three columns with placeholders, and the bar with Back: Mandate and Next: Review. */
export const ThreeColumns: Story = {};

/**
 * Next: Review refused: the press landed (Next is never disabled) and the bar says why, inline.
 * The sentence is the coordinator's proposal for an empty plan; its key lands with slice S7.
 */
export const WithNotice: Story = {
  args: { notice: "Add a block before Review." },
};
