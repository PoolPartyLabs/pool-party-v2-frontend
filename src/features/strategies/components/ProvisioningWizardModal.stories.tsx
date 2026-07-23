/**
 * @id PP-CORE-MOD-011
 * @name ProvisioningWizardModal — stories
 * @implements-rules-version v1
 * The provisioning wizard Plan state across the canonical scenarios, bound to the mock SCENARIOS.
 * Execution is driven by the in-component flow at runtime; resize the viewport for the mobile sheet.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { SCENARIOS } from "@/lib/provisioning";
import { ProvisioningWizardModal } from "./ProvisioningWizardModal";

const meta = {
  title: "Strategies/ProvisioningWizardModal",
  component: ProvisioningWizardModal,
  parameters: { layout: "centered" },
  args: {
    open: true,
    onOpenChange: () => {},
    input: SCENARIOS.usdcBridgeGas,
    opLabel: "Invest in Stable Yield",
  },
} satisfies Meta<typeof ProvisioningWizardModal>;

export default meta;
type Story = StoryObj<typeof meta>;

function Demo({ scenario, opLabel }: { scenario: keyof typeof SCENARIOS; opLabel: string }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open wizard</Button>
      <ProvisioningWizardModal
        open={open}
        onOpenChange={setOpen}
        input={SCENARIOS[scenario]}
        opLabel={opLabel}
      />
    </>
  );
}

/** Worst case: buy USDC → bridge → add gas → invest (4 steps, inline gas selector). */
export const Full: Story = {
  render: () => <Demo scenario="usdcBridgeGas" opLabel="Invest in Stable Yield" />,
};

/** USDC shortfall only, same network: buy USDC → invest. */
export const UsdcOnly: Story = {
  render: () => <Demo scenario="usdcOnly" opLabel="Invest in Stable Yield" />,
};

/** Wrong network: bridge → invest. */
export const Bridge: Story = {
  render: () => <Demo scenario="usdcBridge" opLabel="Invest in Stable Yield" />,
};

/** Gas-only (no USDC): buy USDC → add gas → withdraw. Normally the buy-gas modal handles this case. */
export const GasOnly: Story = {
  render: () => <Demo scenario="gasOnlyNoUsdc" opLabel="Withdraw from Stable Yield" />,
};
