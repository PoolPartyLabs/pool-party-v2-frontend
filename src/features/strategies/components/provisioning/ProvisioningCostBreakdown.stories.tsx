/**
 * @id PP-STR-CMP-024
 * @name ProvisioningCostBreakdown — stories
 * @implements-rules-version v1 (POO-1040 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The cost table across the three plan shapes the planner can produce, plus the two states the TTL
 * loop puts it in. Every figure is derived by the shared cost model from the shared priced-plan
 * fixtures, so a story cannot show a number the production path could not.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  CROSS_CHAIN_PLAN,
  GAS_TOP_UP_PLAN,
  SAME_CHAIN_PLAN,
} from "@/lib/provisioning/fixtures/pricedPlans";
import { ProvisioningCostBreakdown } from "./ProvisioningCostBreakdown";

const meta = {
  title: "Strategies/Provisioning/ProvisioningCostBreakdown",
  component: ProvisioningCostBreakdown,
  parameters: { layout: "centered" },
  args: { plan: SAME_CHAIN_PLAN, onRequote: () => {} },
  decorators: [
    (Story) => (
      <div className="w-[420px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProvisioningCostBreakdown>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One source, one same-chain swap: a network fee, no bridge line at all. */
export const SameChain: Story = {};

/**
 * Two sources across three chains. The fee tooltip's Bridge line carries a real quoted figure (the
 * placeholder it showed for a year), and the Base leg's $0.0031 gas survives the per-leg precision.
 */
export const CrossChain: Story = { args: { plan: CROSS_CHAIN_PLAN } };

/** A gas top-up: the swap-to-native leg and the funding leg spend the same holding, so one source. */
export const GasTopUp: Story = { args: { plan: GAS_TOP_UP_PLAN } };

/** A re-quote in flight: the figures dim and the card says the price is being refreshed. */
export const Requoting: Story = { args: { plan: CROSS_CHAIN_PLAN, requoting: true } };
