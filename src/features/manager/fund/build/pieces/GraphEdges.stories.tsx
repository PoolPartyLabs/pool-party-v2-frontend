/**
 * @id PP-MGR-CMP-054
 * @name GraphEdges.stories
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, a story file of a presentational piece
 *
 * The lines of reference canvas C (worked example 1 of handoff v1.2, 608 x 674) without the blocks:
 * the spine links, the Idle input bus and its stubs, the template stubs, the principal and income
 * return lines (the income line crosses the principal line at x 124, with no junction dot), and the
 * merge into Withdraw. Points are centre lines: a handoff horizontal at y is drawn at y + 0.75.
 * Stories: all lines, the 60% stub highlighted, an income line highlighted, and hover driving the
 * highlight. The real coordinates come from the layout (S3); these are transcribed from the table.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { GraphEdges } from "./GraphEdges";
import { withCanvasBackground } from "./pieceStorySupport";
import type { PieceEdge } from "./pieceTypes";

/** A handoff horizontal at y (its top edge) as a centre line. */
const h = (y: number) => y + 0.75;

const CANVAS_C_EDGES: PieceEdge[] = [
  {
    id: "spine:deposit",
    tone: "muted",
    points: [
      { x: 304, y: 86 },
      { x: 304, y: 110 },
    ],
  },
  {
    id: "spine:idleInput",
    tone: "muted",
    points: [
      { x: 304, y: 172 },
      { x: 304, y: h(196) },
    ],
  },
  {
    id: "bus:idleInput",
    tone: "muted",
    points: [
      { x: 112, y: h(196) },
      { x: 552, y: h(196) },
    ],
  },
  {
    id: "stub:chain60",
    tone: "muted",
    points: [
      { x: 112, y: h(196) },
      { x: 112, y: 244 },
    ],
  },
  {
    id: "stub:chain40",
    tone: "muted",
    points: [
      { x: 320, y: h(196) },
      { x: 320, y: 244 },
    ],
  },
  {
    id: "stub:addProtocol",
    tone: "muted",
    points: [
      { x: 460, y: h(196) },
      { x: 460, y: 244 },
    ],
  },
  {
    id: "stub:addNetwork",
    tone: "muted",
    points: [
      { x: 552, y: h(196) },
      { x: 552, y: 228 },
    ],
  },
  {
    id: "link:swapToPool",
    tone: "muted",
    points: [
      { x: 112, y: 270 },
      { x: 112, y: 294 },
    ],
  },
  {
    id: "link:poolToFees",
    tone: "muted",
    points: [
      { x: 112, y: 356 },
      { x: 112, y: 380 },
    ],
  },
  {
    id: "principal:pool",
    tone: "muted",
    points: [
      { x: 100, y: 406 },
      { x: 100, y: h(430) },
    ],
  },
  {
    id: "principal:supply",
    tone: "muted",
    points: [
      { x: 320, y: 306 },
      { x: 320, y: h(430) },
    ],
  },
  {
    id: "principal:line",
    tone: "muted",
    points: [
      { x: 100, y: h(430) },
      { x: 320, y: h(430) },
    ],
  },
  {
    id: "principal:toIdleOutput",
    tone: "muted",
    points: [
      { x: 170, y: h(430) },
      { x: 170, y: 478 },
    ],
  },
  {
    id: "income:pool",
    tone: "income",
    points: [
      { x: 124, y: 406 },
      { x: 124, y: h(454) },
      { x: 438, y: h(454) },
      { x: 438, y: 478 },
    ],
  },
  {
    id: "merge:idleOutput",
    tone: "muted",
    points: [
      { x: 170, y: 540 },
      { x: 170, y: h(564) },
    ],
  },
  {
    id: "merge:income",
    tone: "income",
    points: [
      { x: 438, y: 540 },
      { x: 438, y: h(564) },
    ],
  },
  {
    id: "merge:line",
    tone: "muted",
    points: [
      { x: 170, y: h(564) },
      { x: 438, y: h(564) },
    ],
  },
  {
    id: "merge:toWithdraw",
    tone: "muted",
    points: [
      { x: 304, y: h(564) },
      { x: 304, y: 588 },
    ],
  },
];

const meta = {
  title: "Manager/Fund builder/Build canvas/Pieces/GraphEdges",
  component: GraphEdges,
  parameters: { layout: "padded" },
  decorators: [withCanvasBackground],
  args: { width: 608, height: 674, edges: CANVAS_C_EDGES, highlightedId: null },
} satisfies Meta<typeof GraphEdges>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every line of canvas C: principal and structural in grey, income in green, crossing plainly. */
export const CanvasCLines: Story = {};

/** The 60% stub highlighted, as when its share label is hovered: 2 px `primary`, on top. */
export const HighlightedStub: Story = { args: { highlightedId: "stub:chain60" } };

/** The income line highlighted: it turns `primary` too. */
export const HighlightedIncome: Story = { args: { highlightedId: "income:pool" } };

/** Hover a line: the hit lines report it and the story lights it, as the renderer (S6) will. */
export const HoverLightsTheLine: Story = {
  render: function HoverLightsTheLine(args) {
    const [hovered, setHovered] = useState<string | null>(null);
    return <GraphEdges {...args} highlightedId={hovered} onEdgeHoverChange={setHovered} />;
  },
};
