import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { WalletSignModal } from "./WalletSignModal";

/**
 * Generic multistep wallet-signing modal (PP-CORE-MOD-009). The step count adapts to the spec, so the
 * same modal covers a 1-step collect, a 2-step deposit and a 4-step add-liquidity (approve ×2 +
 * permit + confirm) without callers ever hand-building the list.
 */
const meta = {
  title: "UI/WalletSignModal",
  component: WalletSignModal,
  parameters: { layout: "centered" },
  args: { open: true, onOpenChange: () => {}, stepMs: 1500 },
} satisfies Meta<typeof WalletSignModal>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Single confirm step (e.g. collecting fees). */
export const Collect: Story = {
  args: { title: "Collecting fees", spec: { confirm: "collect" } },
};

/** Two steps: approve the token, then confirm the deposit. */
export const Deposit: Story = {
  args: { title: "Confirming your deposit", spec: { approvals: ["USDC"], confirm: "invest" } },
};

/** Four steps: approve each token, sign the Permit2, then confirm add-liquidity. */
export const AddLiquidity: Story = {
  args: {
    title: "Adding liquidity",
    spec: { approvals: ["USDC", "WETH"], permit2: true, confirm: "addLiquidity" },
  },
};
