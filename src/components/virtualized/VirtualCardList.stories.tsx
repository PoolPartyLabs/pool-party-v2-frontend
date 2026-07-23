/**
 * @name VirtualCardList — stories
 *
 * Short story = the plain `.map()` baseline. The 600-item stories force the `virtualize` override on:
 * `Windowed600` is a single column; `WindowedGrid600` is a responsive grid (chunk-then-virtualize-
 * rows) that re-chunks as you resize across the sm/lg breakpoints.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useEffect } from "react";
import { clearOverrides, setOverride } from "@/lib/features/devOverrides";
import { VirtualCardList } from "./VirtualCardList";

interface Strategy {
  id: string;
  name: string;
  apy: string;
}

function makeStrategies(n: number): Strategy[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `strategy-${i}`,
    name: `Strategy ${i}`,
    apy: `${(2 + ((i * 7) % 38)).toFixed(1)}%`,
  }));
}

/** Force the `virtualize` flag on for the duration of a story (cleared on unmount). */
function ForceVirtualize({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    setOverride("virtualize", true);
    return () => clearOverrides();
  }, []);
  return <>{children}</>;
}

function Card({ s }: { s: Strategy }) {
  return (
    <div
      style={{
        margin: 6,
        padding: 16,
        height: 120,
        boxSizing: "border-box",
        border: "1px solid #2a2a2a",
        borderRadius: 12,
        background: "#1f1f1f",
        color: "#efefef",
      }}
    >
      <div style={{ fontWeight: 600 }}>{s.name}</div>
      <div style={{ color: "#a3a3a3", marginTop: 8 }}>APY {s.apy}</div>
    </div>
  );
}

const meta = {
  title: "Virtualized/VirtualCardList",
  component: VirtualCardList<Strategy>,
  parameters: { layout: "padded" },
} satisfies Meta<typeof VirtualCardList<Strategy>>;

export default meta;

type Story = StoryObj<typeof meta>;

const BOX: React.CSSProperties = { height: 520, border: "1px solid #333", borderRadius: 8 };

/** Short list (below the 500 threshold): renders every card via the plain `.map()` baseline. */
export const Short: Story = {
  args: {
    items: makeStrategies(10),
    estimateSize: 132,
    ariaLabel: "Strategies",
    getItemKey: (s) => s.id,
    renderItem: (s) => <Card s={s} />,
    className: undefined,
  },
};

/** 600 single-column cards with `virtualize` forced on: absolute-<li> + translateY windowing. */
export const Windowed600: Story = {
  args: {
    items: makeStrategies(600),
    estimateSize: 132,
    ariaLabel: "Strategies",
    getItemKey: (s) => s.id,
    renderItem: (s) => <Card s={s} />,
  },
  render: (args) => (
    <ForceVirtualize>
      <VirtualCardList {...args} className="virtualized-story-box" />
    </ForceVirtualize>
  ),
  decorators: [
    (Story) => (
      <div style={BOX}>
        <style>{`.virtualized-story-box{height:100%;}`}</style>
        <Story />
      </div>
    ),
  ],
};

/** 600 cards in a responsive grid: 3 columns >= 1024px, 2 >= 640px, else 1. Resize to re-chunk. */
export const WindowedGrid600: Story = {
  args: {
    items: makeStrategies(600),
    estimateSize: 132,
    ariaLabel: "Strategies grid",
    getItemKey: (s) => s.id,
    renderItem: (s) => <Card s={s} />,
    laneBreakpoints: [
      { query: "(min-width: 1024px)", lanes: 3 },
      { query: "(min-width: 640px)", lanes: 2 },
    ],
    fallbackLanes: 1,
  },
  render: (args) => (
    <ForceVirtualize>
      <VirtualCardList {...args} className="virtualized-story-box" />
    </ForceVirtualize>
  ),
  decorators: [
    (Story) => (
      <div style={BOX}>
        <style>{`.virtualized-story-box{height:100%;}`}</style>
        <Story />
      </div>
    ),
  ],
};
