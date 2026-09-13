/**
 * @id PP-CORE-CMP-044
 * @name ProvisioningPlanCard, stories
 * @implements-rules-version v5 (POO-1575 rules v2) · v4 (POO-1381 rules v2) · v3 (POO-1088 rules v2) · v2 (POO-1041 rules v1) · v1
 *
 * The one card behind three of the v2 screens: Confirm (`6548:723`), Running (`6550:615`) and Step
 * failed (`6550:703`). Worth a story precisely because the same component plays all three: what
 * separates them is `mode` plus the per-row statuses, and seeing them side by side is how a drift
 * between the two modes gets noticed before a user does.
 *
 * POO-1381: the Confirm story now opens on the COLLAPSED list (a "Show steps" disclosure), which is
 * its new default on a phone. The rows themselves stay on display in the Running and Step-failed
 * stories, which are never collapsed, and one tap on "Show steps" expands the Confirm story to the
 * pre-POO-1381 layout.
 *
 * The route is the epic's flagship, WETH held on Polygon funding a USDC operation on Arbitrum, with
 * the rail's approval rows folded in, so the list is what a wallet would really be asked for. The
 * plan is written out here rather than imported from the test fixture: a story is a design surface,
 * and pointing it at `tests/` would make a rendering everyone looks at depend on a file nobody
 * expects to be load-bearing.
 *
 * Sized to 460px, the desktop dialog width the design is drawn at.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ProvisioningLeg, ProvisioningPlan, ProvisioningStepStatus } from "@/lib/provisioning";
import { mockComputePlan, SCENARIOS } from "@/lib/provisioning";
import { planRailSteps } from "../../lib/buildPlanSteps";
import { ProvisioningPlanCard } from "./ProvisioningPlanCard";
import { buildPlanView } from "./provisioningView";

const WETH_POLYGON = {
  address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
  symbol: "WETH",
  decimals: 18,
  chainId: 137,
} as const;
const USDC_POLYGON = {
  address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  symbol: "USDC",
  decimals: 6,
  chainId: 137,
} as const;
const USDC_ARBITRUM = {
  address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  symbol: "USDC",
  decimals: 6,
  chainId: 42161,
} as const;

/** Leg 0: swap WETH into USDC, on Polygon. Its allowance is what the rail adds a row for. */
const SWAP_LEG: ProvisioningLeg = {
  index: 0,
  kind: "swap-token",
  chainId: 137,
  tokenIn: WETH_POLYGON,
  tokenOut: USDC_POLYGON,
  amountIn: "40000000000000000",
  amountOutQuoted: "120400000",
  minAmountOut: "117992000",
  routing: "CLASSIC",
  gasUsd: 0.02,
  priceImpactPct: 0.11,
  requoteAtExecution: false,
};

/** Leg 1: bridge that USDC to Arbitrum. Fed by leg 0, which is why it carries the same figure. */
const BRIDGE_LEG: ProvisioningLeg = {
  index: 1,
  kind: "bridge",
  chainId: 137,
  tokenIn: USDC_POLYGON,
  tokenOut: USDC_ARBITRUM,
  amountIn: "120400000",
  amountOutQuoted: "120010000",
  minAmountOut: "120010000",
  routing: "BRIDGE",
  gasUsd: 0.01,
  etaSeconds: 180,
  requoteAtExecution: true,
};

const PLAN: ProvisioningPlan = {
  needed: true,
  reason: ["usdc", "network"],
  variant: "multi",
  steps: [
    {
      type: "swap-token",
      key: "swap-token-0",
      labelKey: "provisioning.steps.swapToken",
      fromToken: "WETH",
      toToken: "USDC",
      fromChainId: 137,
      toChainId: 137,
      chainId: 137,
      amountUsd: 120.4,
      amountToken: "0.04",
      method: "SEND_TX",
      leg: SWAP_LEG,
    },
    {
      type: "bridge",
      key: "bridge-1",
      labelKey: "provisioning.steps.bridge",
      fromToken: "USDC",
      toToken: "USDC",
      fromChainId: 137,
      toChainId: 42161,
      chainId: 137,
      amountUsd: 120.4,
      amountToken: "120.4",
      method: "SEND_TX",
      etaSeconds: 180,
      leg: BRIDGE_LEG,
    },
    { type: "op", key: "op", labelKey: "provisioning.steps.op", amountUsd: 120 },
  ],
  quote: {
    shortfallUsd: 120,
    bufferUsd: 2.4,
    feesUsd: 0.43,
    totalPayUsd: 122.83,
    quotedAt: "2026-07-25T12:00:00.000Z",
    ttlMs: 30_000,
  },
  slippagePct: 2,
};

const RAIL = planRailSteps(PLAN);

/** Fixed clock, so the mock-planned buy stories render identically on every rebuild. */
const NOW = "2026-07-25T12:00:00.000Z";

/** The plan view with the given per-key statuses folded in. */
function viewWith(statusByKey: Record<string, ProvisioningStepStatus>) {
  return buildPlanView(PLAN, { railSteps: RAIL, statusByKey });
}

const meta = {
  title: "Strategies/Provisioning/ProvisioningPlanCard",
  component: ProvisioningPlanCard,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-[460px] rounded-2xl border border-border bg-surface p-6">
        <Story />
      </div>
    ),
  ],
  args: {
    opLabel: "Invest in Stable Yield",
    view: buildPlanView(PLAN, { railSteps: RAIL }),
  },
} satisfies Meta<typeof ProvisioningPlanCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Confirm: the route before anyone has agreed to it. POO-1381 opens it COLLAPSED, so on a phone the
 * "You pay" summary (a separate sibling in the panel) and the CTA are reachable without scrolling
 * past five steps. Press "Show steps" to reveal the numbered list, which closes on the fees line.
 */
export const Plan: Story = {};

/**
 * Running (`6550:615`): the first swap settled, the next signature in the wallet, the rest waiting.
 *
 * The badge column is the point of this story. A check for what is done, the step NUMBER inside a
 * spinning ring for what is live, a muted number for what has not run, a cross for what failed: four
 * states told apart by SHAPE, so a row survives a monochrome render and any form of colour blindness.
 * The live row is also the only one carrying the "What am I signing?" disclosure.
 */
export const Running: Story = {
  args: {
    mode: "running",
    view: viewWith({
      "approve:swap-token-0": "done",
      "swap-token-0": "done",
      "approve:bridge-1": "active",
    }),
  },
};

/**
 * Step failed (`6550:703`), the slippage case: the row names the cause with the plan's OWN
 * tolerance. Hardcoding the 2% the design happens to draw would make the line wrong for everyone who
 * changed it in the gear.
 */
export const StepFailed: Story = {
  args: {
    mode: "running",
    execution: { routeFailed: true, errorKind: "slippage", slippagePct: 2 },
    view: viewWith({
      "approve:swap-token-0": "done",
      "swap-token-0": "done",
      "approve:bridge-1": "done",
      "bridge-1": "error",
    }),
  },
};

/**
 * The same failure with no tolerance to quote: the figure is dropped rather than defaulted
 * (POO-1082 [R10]). A plausible number nobody set is worse than no number.
 */
export const StepFailedWithoutAFigure: Story = {
  args: {
    mode: "running",
    execution: { routeFailed: true, errorKind: "slippage" },
    view: viewWith({
      "approve:swap-token-0": "done",
      "swap-token-0": "done",
      "approve:bridge-1": "done",
      "bridge-1": "error",
    }),
  },
};

/**
 * POO-1575 [R1]: the fiat `buy` row names the payment methods that resolved for THIS buyer's
 * currency, at most two, joined in the active locale ("Pay with Credit Card or Pix"). It shipped as
 * the literal "Card or Pix" to every buyer in every country. Note the attribution beside it: it hangs
 * on the caption KEY existing, so it survives both this branch and the neutral one below.
 *
 * A plan that CONTAINS a fiat buy, which the flagship route above does not, so it is built from the
 * mock planner rather than hand-written a second time.
 */
export const BuyMethodsNamed: Story = {
  args: {
    view: buildPlanView(mockComputePlan(SCENARIOS.usdcOnly, { nowIso: NOW }), {
      buyPaymentMethods: {
        names: ["Credit Card", "Pix"],
        listedForCurrency: "BRL",
        // POO-1596: the pair the list was resolved for. The mock plan mints `USDC-BASE`, so this is
        // [R8]'s pass case on BOTH halves.
        listedForPair: "USDC-BASE",
        chargedCurrency: "BRL",
      },
    }),
  },
};

/**
 * POO-1575 [R3]: the same row with nothing resolved (mock mode, the crypto-only cut, a degraded
 * read). The caption promises no specific rail, and "Powered by Paybis" is still there.
 */
export const BuyMethodsPending: Story = {
  args: { view: buildPlanView(mockComputePlan(SCENARIOS.usdcOnly, { nowIso: NOW })) },
};

/**
 * POO-1575 [R8]: the same names, listed for the buyer's own BRL while the leg is pinned to USD (a
 * spend-fixed order, which since POO-1573 is the DEGRADED gas-first path). The widget will open on
 * the USD method set, so the row renders the neutral caption rather than naming rails that will not
 * be there. Visually identical to `BuyMethodsPending`, which is the point: the honest state of not
 * being able to say has exactly one rendering.
 */
export const BuyMethodsCurrencyMismatch: Story = {
  args: {
    view: buildPlanView(mockComputePlan(SCENARIOS.usdcOnly, { nowIso: NOW }), {
      buyPaymentMethods: {
        names: ["Credit Card", "Pix"],
        listedForCurrency: "BRL",
        listedForPair: "USDC-BASE",
        chargedCurrency: "USD",
      },
    }),
  },
};
