/**
 * @id PP-CORE-CMP-070
 * @name GasTopUpBody — stories
 * @implements-rules-version v1 (POO-1509 rules v1)
 *
 * The auxiliary `Not enough gas` body (Figma `6550:569`) across the states its two hosts produce.
 * The chrome is deliberately absent: it belongs to the host, which is why this is a body.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import type { GasChoice } from "@/lib/provisioning";
import { GasTopUpBody } from "./GasTopUpBody";
import { selectCustom, selectPreset } from "./gasSelection";

const meta = {
  title: "Strategies/Provisioning/GasTopUpBody",
  component: GasTopUpBody,
  parameters: { layout: "centered" },
  args: {
    value: selectPreset(10),
    onChange: () => {},
    balanceUsd: 1_000,
    onConfirm: () => {},
    onDismiss: () => {},
  },
} satisfies Meta<typeof GasTopUpBody>;

export default meta;
type Story = StoryObj<typeof meta>;

function Interactive({
  initial,
  source = "card",
  balanceUsd = 1_000,
  confirmDisabled = false,
}: {
  initial: GasChoice | null;
  source?: "usdc" | "card";
  balanceUsd?: number;
  confirmDisabled?: boolean;
}) {
  const [value, setValue] = useState<GasChoice | null>(initial);
  return (
    <div className="w-96">
      <GasTopUpBody
        value={value}
        onChange={setValue}
        balanceUsd={balanceUsd}
        source={source}
        confirmDisabled={confirmDisabled}
        onConfirm={() => {}}
        onDismiss={() => {}}
      />
    </div>
  );
}

/** The standalone modal's entry point: the card path, $10 / $25. */
export const CardPath: Story = { render: () => <Interactive initial={selectPreset(10)} /> };

/**
 * The panel's gas-only branch, where the wallet holds something routable on the operation's chain:
 * $5 / $10 with a $5 floor ([R35]).
 */
export const OnChainPath: Story = {
  render: () => <Interactive initial={selectPreset(5)} source="usdc" />,
};

/** An amount below the source's floor: the CTA is shut and the message names that floor. */
export const BelowSourceFloor: Story = {
  render: () => <Interactive initial={selectCustom("3")} source="usdc" />,
};

/**
 * The host holding the CTA shut for its own reason. Today that is the POO-1047 price-impact
 * acknowledgement: auxiliary does not mean ungated, since this screen signs a real swap.
 */
export const BlockedByHost: Story = {
  render: () => <Interactive initial={selectPreset(10)} confirmDisabled={true} />,
};
