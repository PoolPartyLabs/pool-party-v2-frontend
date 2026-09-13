/**
 * @id PP-STR-CMP-024
 * @name ProvisioningCostBreakdown — stories
 * @implements-rules-version v2 (POO-1575 rules v2) · v1 (POO-1040 rules v1) · v1 (POO-1380 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The cost table across the three plan shapes the planner can produce, plus the two states the TTL
 * loop puts it in, plus the two the buy-crypto peer CTA has (POO-1380: named amount vs the degraded
 * plain wording). Every figure is derived by the shared cost model from the shared priced-plan
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

/**
 * POO-1380 [R1]: the buy-crypto peer names the amount once the received-fixed on-ramp quote resolves,
 * so the CTA reads "Buy $101.02" instead of the bare wording.
 */
export const BuyAmountNamed: Story = { args: { plan: CROSS_CHAIN_PLAN, buyAmountUsd: 101.02 } };

/**
 * POO-1380 [R3]: the degraded default. With no resolved amount (the crypto-only cut and mock mode
 * never price the quote) the CTA keeps its plain wording rather than showing a broken interpolation.
 */
export const BuyAmountPending: Story = {
  args: { plan: CROSS_CHAIN_PLAN, buyAmountUsd: undefined },
};

/**
 * POO-1575 [R1]: the hint names the methods that resolved for THIS buyer's currency, at most two,
 * joined in the active locale. The shipped copy said "a card or Pix" to every buyer in every country.
 */
export const BuyMethodsNamed: Story = {
  args: {
    plan: CROSS_CHAIN_PLAN,
    buyAmountUsd: 101.02,
    buyMethodNames: ["Credit Card", "Pix"],
  },
};

/**
 * POO-1575 [R3]: nothing resolved (mock mode, the crypto-only cut, a degraded read). The hint keeps
 * the half of the claim that is always true and names no payment method at all.
 */
export const BuyMethodsPending: Story = {
  args: { plan: CROSS_CHAIN_PLAN, buyMethodNames: [] },
};
