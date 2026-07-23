/**
 * @id PP-MGR-MOD-002
 * @name ManagerActionModal.stories
 * @implements-rules-version v1
 * Storybook coverage for the manager confirm modal — the five V1 actions: Collect fees, Compound,
 * Pause deposits, Close strategy (destructive) and Launch. Pause and Close are the ready-made
 * variants for the strategy manage detail screen (POO-181) to lift.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ManagerActionModal } from "./ManagerActionModal";

const meta = {
  title: "manager/ManagerActionModal",
  component: ManagerActionModal,
  args: {
    open: true,
    onOpenChange: () => {},
    onConfirm: async (): Promise<string | undefined> => undefined,
  },
} satisfies Meta<typeof ManagerActionModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Collect fees — confirm/success pair (resolves with a message → in-dialog success view). */
export const CollectFees: Story = {
  args: {
    title: "Collect fees?",
    description:
      "Sends this position's uncollected trading fees to your balance. Investor funds stay deployed.",
    details: [{ label: "Uncollected fees", value: "$842.19" }],
    gasCostUsd: 0.42,
    confirmLabel: "Collect fees",
    onConfirm: async () => "Collected $842.19 to your balance.",
  },
};

/** Compound — confirm/success pair. */
export const Compound: Story = {
  args: {
    title: "Compound fees?",
    description:
      "Reinvests this position's uncollected trading fees back into the position to keep earning.",
    details: [{ label: "Uncollected fees", value: "$842.19" }],
    gasCostUsd: 0.42,
    confirmLabel: "Compound",
    onConfirm: async () => "Compounded $842.19 back into the position.",
  },
};

/** Pause deposits — confirm only (the manage detail wires it to managerService.setDepositsPaused). */
export const PauseDeposits: Story = {
  args: {
    title: "Pause deposits?",
    description:
      "Blocks new investments into this strategy until you resume. Current investors keep their position and withdrawals stay open.",
    gasCostUsd: 0.42,
    confirmLabel: "Pause deposits",
  },
};

/** Close strategy — destructive confirm (POO-181 wires it to managerService.closeStrategy). */
export const CloseStrategy: Story = {
  args: {
    title: "Close this strategy?",
    description:
      "Unwinds the position and ends the strategy. Investors keep their funds and withdraw instantly with no fee. This can't be undone.",
    details: [{ label: "Strategy", value: "Yield Plus" }],
    gasCostUsd: 0.42,
    confirmLabel: "Close strategy",
    destructive: true,
  },
};

/** Launch — confirm with the strategy summary; verification runs after (ReviewStep). */
export const Launch: Story = {
  args: {
    title: "Launch strategy?",
    description:
      "We verify the pool and your parameters, then list the strategy publicly. You sign the transaction and pay the network gas.",
    details: [
      { label: "Strategy name", value: "Stable Yield" },
      { label: "Pool", value: "ETH/USDC" },
      { label: "Performance fee", value: "20%" },
    ],
    confirmLabel: "Launch strategy",
  },
};
