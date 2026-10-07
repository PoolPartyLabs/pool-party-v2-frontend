/**
 * @id PP-MGR-CMP-070
 * @name PriceRangeField stories
 * @implements-rules-version v1 (POO-2284; extends POO-2189)
 * @analytics-events none (the panel shell emits)
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { PANEL_POOL_FIXTURES, panelPoolAtPrice } from "@/mocks/data/buildPanelFixtures";
import { withManagerMessages } from "../canvas/canvasStorySupport";
import { PriceRangeField } from "./PriceRangeField";
import { toLivePoolGrid, toPanelPoolView } from "./panelCatalogView";
import { fullPoolRange, type PoolRange, presetRange } from "./poolRangeMath";

const fixture = PANEL_POOL_FIXTURES[0];
if (!fixture) throw new Error("Pool fixture required");
const rawPool = fixture.pool;
const pool = toPanelPoolView(rawPool);
const range = presetRange(toLivePoolGrid(pool), 10);
if (!range) throw new Error("Story pool must have a price");
const meta = {
  title: "Manager/Fund builder/Build panel/Price range",
  component: PriceRangeField,
  decorators: [withManagerMessages],
  args: { pool, range, onChange: () => {} },
  render: (args) => {
    const [value, setValue] = useState<PoolRange>(args.range);
    return (
      <div className="w-[328px]">
        <PriceRangeField {...args} range={value} onChange={setValue} />
      </div>
    );
  },
} satisfies Meta<typeof PriceRangeField>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Full: Story = {
  args: { range: { ...range, ...presetRange(toLivePoolGrid(pool), "full") } },
};
export const Custom: Story = {
  args: {
    range: { ...range, tickLower: range.tickLower - 1000, tickUpper: range.tickUpper + 800 },
  },
};
export const OutOfRange: Story = {
  args: { pool: toPanelPoolView(panelPoolAtPrice(rawPool, 2000)) },
};
export const Inverted: Story = { args: { range: { ...range, displayInverted: true } } };
export const ManageTouchTargets: Story = {
  args: { touchTargets: true },
};
export const NarrowManage: Story = {
  args: { touchTargets: true },
  decorators: [
    (Story) => (
      <div className="w-[240px] [&>div]:max-w-full">
        <Story />
      </div>
    ),
  ],
};
export const FullManage: Story = {
  args: { touchTargets: true, range: fullPoolRange(toLivePoolGrid(pool)) },
};
const tinyPool = toPanelPoolView(panelPoolAtPrice(rawPool, 0.00000000000000035));
const tinyRange = presetRange(toLivePoolGrid(tinyPool), 10);
if (!tinyRange) throw new Error("Tiny priced range required");
export const LongPriceManage: Story = {
  args: { touchTargets: true, pool: tinyPool, range: tinyRange },
};
