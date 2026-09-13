/**
 * @id PP-CORE-CMP-039
 * @name GasAmountSelector — stories
 * @implements-rules-version v2
 * The $10/$25/Custom gas selector across its states (preset selected, custom active, errors).
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import type { GasChoice } from "@/lib/provisioning";
import { GasAmountSelector } from "./GasAmountSelector";
import type { GasFundingSource } from "./gasSelection";
import { selectCustom, selectPreset } from "./gasSelection";

const meta = {
  title: "Strategies/Provisioning/GasAmountSelector",
  component: GasAmountSelector,
  parameters: { layout: "centered" },
  args: { value: null, onChange: () => {}, balanceUsd: 1_000 },
} satisfies Meta<typeof GasAmountSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

function Interactive({
  initial,
  balanceUsd = 1_000,
  source = "card",
}: {
  initial: GasChoice | null;
  balanceUsd?: number;
  source?: GasFundingSource;
}) {
  const [value, setValue] = useState<GasChoice | null>(initial);
  return (
    <div className="w-80">
      <GasAmountSelector
        value={value}
        onChange={setValue}
        balanceUsd={balanceUsd}
        source={source}
      />
    </div>
  );
}

/** Default: the $10 preset selected. */
export const Default: Story = { render: () => <Interactive initial={selectPreset(10)} /> };

/** The $25 preset selected. */
export const TwentyFive: Story = { render: () => <Interactive initial={selectPreset(25)} /> };

/** Custom mode active with a valid amount. */
export const CustomValid: Story = { render: () => <Interactive initial={selectCustom("50")} /> };

/** Custom amount below the $10 minimum (below-min error). */
export const CustomBelowMin: Story = { render: () => <Interactive initial={selectCustom("5")} /> };

/** Custom amount above the $200 maximum (over-max error). */
export const CustomOverMax: Story = { render: () => <Interactive initial={selectCustom("300")} /> };

/**
 * POO-1509 [R35]: the on-chain path, where the gas is swapped out of a holding rather than bought.
 * $5 / $10 with a $5 floor, because the $10 is the Paybis FIAT minimum and no card is involved.
 */
export const OnChainSource: Story = {
  render: () => <Interactive initial={selectPreset(5)} source="usdc" />,
};

/** The same path refusing an amount below ITS floor, with the message naming that floor. */
export const OnChainBelowMin: Story = {
  render: () => <Interactive initial={selectCustom("3")} source="usdc" />,
};
