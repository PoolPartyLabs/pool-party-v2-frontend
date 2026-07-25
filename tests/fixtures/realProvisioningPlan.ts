/**
 * @id PP-CORE-LIB-016 (POO-1041)
 * @name real provisioning plan fixture
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * A plan in the shape the REAL planner emits (`src/lib/provisioning/buildPlan.ts`), which the mock
 * fixture deliberately cannot produce: every step carries a {@link ProvisioningLeg} with addresses,
 * base-unit amounts and a route class. The plan card's real-step rendering (POO-1041) only differs
 * from its mock rendering on those fields, so a mock plan cannot exercise it at all.
 *
 * The route is the epic's flagship: WETH held on Polygon funding a USDC operation on Arbitrum. It
 * decomposes into a same-chain swap then a same-token bridge, because a cross-chain different-token
 * quote is not routable (POO-1034 [R1]).
 *
 * Lives under `tests/` rather than `src/` because it is test-only data, alongside the existing
 * `tests/virtualizationLayout.ts` helper.
 */
import type { ProvisioningLeg, ProvisioningPlan, ProvisioningStep } from "@/lib/provisioning";

/** Polygon 137. */
export const WETH_POLYGON = {
  address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
  symbol: "WETH",
  decimals: 18,
  chainId: 137,
} as const;

/** Polygon 137. */
export const USDC_POLYGON = {
  address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  symbol: "USDC",
  decimals: 6,
  chainId: 137,
} as const;

/** Arbitrum 42161, the operation's chain. */
export const USDC_ARBITRUM = {
  address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  symbol: "USDC",
  decimals: 6,
  chainId: 42161,
} as const;

/** Leg 0: swap WETH into USDC, on Polygon. */
export const SWAP_LEG: ProvisioningLeg = {
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

/** Leg 1: bridge that USDC to Arbitrum. Fed by leg 0, so it is re-sized at execution time. */
export const BRIDGE_LEG: ProvisioningLeg = {
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

/** The steps `buildPlan` assembles around those legs, keys and all. */
export const REAL_STEPS: ProvisioningStep[] = [
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
  {
    type: "op",
    key: "op",
    labelKey: "provisioning.steps.op",
    amountUsd: 120,
  },
];

/** A priced, real-shaped plan: swap on Polygon, bridge to Arbitrum, then the operation. */
export function realProvisioningPlan(overrides: Partial<ProvisioningPlan> = {}): ProvisioningPlan {
  return {
    needed: true,
    reason: ["usdc", "network"],
    variant: "multi",
    steps: REAL_STEPS,
    quote: {
      shortfallUsd: 120,
      bufferUsd: 2.4,
      feesUsd: 0.43,
      totalPayUsd: 122.83,
      quotedAt: "2026-07-25T12:00:00.000Z",
      ttlMs: 30_000,
    },
    slippagePct: 2,
    ...overrides,
  };
}
