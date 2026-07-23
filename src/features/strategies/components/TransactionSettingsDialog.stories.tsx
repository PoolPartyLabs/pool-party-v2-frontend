/**
 * @id PP-STR-MOD-007
 * @name TransactionSettingsDialog — stories
 * @implements-rules-version v3
 *
 * The shared ⚙ transaction-settings sheet (max slippage presets + custom, deadline, receive-as). Each
 * story wires a live state so the presets, the custom-input sanitizer and the High/Very high slippage
 * warnings are all interactive. POO-499 closes the premise-8 Storybook gap for the slippage surface:
 * the slippage-error view itself lives in the host modals (driven by useSlippageAutoRetry at runtime),
 * so this documents the gear the auto-open lands on. POO-525 R2 adds the FIXED receive-as variant
 * (no onReceiveAsChange): a non-interactive USDC-only payout display. POO-547: the custom slippage is
 * uniform (0.1-100%) across every flow — 5% is a manager SEED, not a cap.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { DEFAULT_SLIPPAGE_PCT, MANAGER_DEFAULT_SLIPPAGE_PCT } from "../lib/slippage";
import { TransactionSettingsDialog } from "./TransactionSettingsDialog";

const meta = {
  title: "Strategies/TransactionSettingsDialog",
  component: TransactionSettingsDialog,
  parameters: { layout: "centered" },
  args: { open: true, onOpenChange: () => {} },
} satisfies Meta<typeof TransactionSettingsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function Demo({
  initialSlippage = DEFAULT_SLIPPAGE_PCT,
  slippageMax,
  withReceiveAs = false,
}: {
  initialSlippage?: number;
  slippageMax?: number;
  withReceiveAs?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [slippage, setSlippage] = useState(initialSlippage);
  const [deadlineMins, setDeadlineMins] = useState(30);
  const [receiveAs, setReceiveAs] = useState("USDC");
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open settings</Button>
      <TransactionSettingsDialog
        open={open}
        onOpenChange={setOpen}
        slippage={slippage}
        onSlippageChange={setSlippage}
        slippageMax={slippageMax}
        deadlineMins={deadlineMins}
        onDeadlineChange={setDeadlineMins}
        receiveAs={withReceiveAs ? receiveAs : undefined}
        onReceiveAsChange={withReceiveAs ? setReceiveAs : undefined}
        receiveOptions={withReceiveAs ? ["USDC", "ETH / USDC"] : undefined}
      />
    </>
  );
}

/** Investor default: 2% slippage + deadline, no receive-as (invest zap-in). */
export const InvestorDefault: Story = { render: () => <Demo /> };

/** Collect/Withdraw style: slippage + deadline + a receive-as (USDC or the pool token pair). */
export const WithReceiveAs: Story = { render: () => <Demo withReceiveAs /> };

/**
 * POO-525 R2: fixed receive-as — the flow has no payout choice (e.g. a managed collect without
 * per-token fee data), so the section is a non-interactive USDC-only display with the fixed hint.
 */
export const WithFixedReceiveAs: Story = {
  render: () => (
    <TransactionSettingsDialog
      open
      onOpenChange={() => {}}
      slippage={MANAGER_DEFAULT_SLIPPAGE_PCT}
      onSlippageChange={() => {}}
      deadlineMins={30}
      onDeadlineChange={() => {}}
      receiveAs="USDC"
      receiveOptions={["USDC"]}
    />
  ),
};

/**
 * Manager flows (Move Range / Close / managed Collect): 5% is the DEFAULT SEED. POO-547: the custom
 * input is uniform (0.1-100%), no per-flow cap — raising it past 5% surfaces the High-slippage warning.
 */
export const ManagerSeeded: Story = {
  render: () => <Demo initialSlippage={MANAGER_DEFAULT_SLIPPAGE_PCT} />,
};

/** High-slippage warning (> 5%): the dialog surfaces a "High slippage" caution. */
export const HighSlippageWarning: Story = { render: () => <Demo initialSlippage={8} /> };

/** Very-high-slippage warning (> 20%): the caution escalates to destructive tone. */
export const VeryHighSlippageWarning: Story = { render: () => <Demo initialSlippage={25} /> };
