/**
 * @id PP-CORE-MOD-010
 * @name BuyGasModal — stories
 * @implements-rules-version v2
 * The buy-gas sheet at the amount phase. Resize the viewport to see the mobile bottom-sheet vs the
 * centered desktop card. Pending/success/error are driven by the in-component flow at runtime.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { BuyGasModal } from "./BuyGasModal";

const meta = {
  title: "Strategies/BuyGasModal",
  component: BuyGasModal,
  parameters: { layout: "centered" },
  args: { open: true, onOpenChange: () => {} },
} satisfies Meta<typeof BuyGasModal>;

export default meta;
type Story = StoryObj<typeof meta>;

function Demo({
  defaultPresetUsd,
  balanceUsd,
}: {
  defaultPresetUsd?: 10 | 25;
  balanceUsd?: number;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open buy-gas</Button>
      <BuyGasModal
        open={open}
        onOpenChange={setOpen}
        defaultPresetUsd={defaultPresetUsd}
        balanceUsd={balanceUsd}
      />
    </>
  );
}

/** Default: $10 preset selected, full balance. */
export const Default: Story = { render: () => <Demo /> };

/** $25 preset selected by default. */
export const TwentyFiveDefault: Story = { render: () => <Demo defaultPresetUsd={25} /> };

/** Low USDC balance: amounts above it are topped up via Paybis (the rail on-ramps the shortfall). */
export const LowBalance: Story = { render: () => <Demo balanceUsd={8} /> };
