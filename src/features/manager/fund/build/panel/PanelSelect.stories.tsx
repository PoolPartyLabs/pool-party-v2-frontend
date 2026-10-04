/**
 * @id PP-MGR-CMP-063
 * @name PanelSelect.stories
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, a story file of a presentational control
 *
 * The select of the panels (handoff P11) in the 360 frame: closed, and open (strip 01) with the
 * selected row checked and the footer link row; pool rows carry no metric (A3), asset rows their
 * rate. Each story owns its value.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { BuildPanelSlot } from "../canvas/BuildPanelSlot";
import { withManagerMessages } from "../canvas/canvasStorySupport";
import { PanelFieldLabel } from "./PanelFieldLabel";
import { PanelSelect, type PanelSelectOption } from "./PanelSelect";

const POOLS: PanelSelectOption[] = [
  {
    id: "weth-usdc",
    label: "WETH / USDC · 0.05%",
    logos: [{ symbol: "WETH" }, { symbol: "USDC" }],
  },
  {
    id: "wbtc-usdc",
    label: "WBTC / USDC · 0.30%",
    logos: [{ symbol: "WBTC" }, { symbol: "USDC" }],
  },
];

const ASSETS: PanelSelectOption[] = [
  {
    id: "usdc",
    label: "USDC",
    logos: [{ symbol: "USDC" }],
    metric: { label: "Supply APY", value: "4.1%" },
  },
  {
    id: "weth",
    label: "WETH",
    logos: [{ symbol: "WETH" }],
    metric: { label: "Supply APY", value: "1.9%" },
  },
];

/** The field with its label, owning its value, in the frame it lives in. */
function Playground({
  label,
  options,
  open,
}: {
  label: string;
  options: PanelSelectOption[];
  open: boolean;
}) {
  const [value, setValue] = useState(options[0]?.id ?? null);
  return (
    <BuildPanelSlot>
      <div className="flex min-h-[260px] flex-col gap-2">
        <PanelFieldLabel
          label={label}
          help="Of your mandate, on Arbitrum."
          helpLabel={`More about ${label}`}
          labelId="story-select-label"
        />
        <PanelSelect
          labelId="story-select-label"
          options={options}
          value={value}
          onChange={setValue}
          defaultOpen={open}
          footer={{
            prompt: label === "Pool" ? "Need another pool?" : "Need another asset?",
            label: label === "Pool" ? "Edit mandate · Pools" : "Edit mandate · Tokens",
            onClick: () => {},
          }}
        />
      </div>
    </BuildPanelSlot>
  );
}

const meta = {
  title: "Manager/Fund builder/Build panel/PanelSelect",
  component: Playground,
  parameters: { layout: "padded" },
  decorators: [withManagerMessages],
  args: { label: "Pool", options: POOLS, open: false },
} satisfies Meta<typeof Playground>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The Pool select, closed. */
export const Closed: Story = {};

/** The Pool select, open (strip 01). */
export const OpenPools: Story = { args: { open: true } };

/** The Asset select, open, with the supply rate. */
export const OpenAssets: Story = { args: { label: "Asset", options: ASSETS, open: true } };
