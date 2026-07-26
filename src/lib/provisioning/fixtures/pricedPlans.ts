/**
 * @id PP-CORE-LIB-056 (POO-1040)
 * @name priced provisioning plan fixtures
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The three canonical shapes a real (leg-bearing) plan takes, priced end to end: a same-chain swap,
 * a two-source cross-chain route, and a gas top-up. They exist so the cost table (POO-1040) can be
 * tested and storyboarded against plans that behave exactly like the planner's output, without a
 * network, a key or a clock.
 *
 * **Each plan's `quote` is DERIVED, not hand-written.** `buildCostBreakdown` fills it from the same
 * steps the table itemizes, which is what `assemblePlan` (PP-CORE-LIB-055) does in production. A
 * hand-tuned quote would be a fourth place the arithmetic could disagree, and the whole point of
 * POO-1035 is that there is exactly one.
 *
 * Figures are deliberately realistic: L2 gas is routinely sub-cent (the Base leg costs $0.0031),
 * which is the case the per-leg gas rows have to render without rounding away to nothing ([R8]).
 *
 * Test/story-only. Nothing in the application imports it; mock MODE is served by `mockPlan.ts`.
 */
import { buildCostBreakdown } from "../costBreakdown";
import type {
  ProvisioningLeg,
  ProvisioningLegKind,
  ProvisioningPlan,
  ProvisioningStep,
} from "../types";
import { isBridgeLegKind } from "../types";

/**
 * The i18n key segment for each leg kind. A `Record` rather than a ternary chain, so a kind added to
 * the contract fails to compile here instead of silently falling through to the bridge label, which
 * is what the ternary did to `bridge-gas`.
 */
const LABEL_SEGMENT: Record<ProvisioningLegKind, string> = {
  "swap-token": "swapToken",
  "swap-gas": "swapGas",
  bridge: "bridge",
  "bridge-gas": "bridgeGas",
};

const ARBITRUM = 42161;
const BASE = 8453;
const POLYGON = 137;

const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const WETH_ARBITRUM = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const WETH_POLYGON = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
const NATIVE = "0x0000000000000000000000000000000000000000";

/** A fixed instant, so a story or a snapshot never depends on when it ran. */
export const FIXTURE_QUOTED_AT = "2026-07-24T12:00:00.000Z";
/** The quote window these fixtures carry, ms. Long enough that a test opts INTO expiry. */
export const FIXTURE_TTL_MS = 15_000;

/** The investor default Max slippage these plans were quoted with (POO-523 R2). */
export const FIXTURE_SLIPPAGE_PCT = 2;

const usdc = (chainId: number, address: string) => ({
  address,
  symbol: "USDC",
  decimals: 6,
  chainId,
});
const weth = (chainId: number, address: string) => ({
  address,
  symbol: "WETH",
  decimals: 18,
  chainId,
});
const native = (chainId: number, symbol: string) => ({
  address: NATIVE,
  symbol,
  decimals: 18,
  chainId,
});

/** One priced step, shaped exactly as `assemblePlan` emits it: display fields plus the leg. */
function step(
  over: Pick<ProvisioningLeg, "kind" | "tokenIn" | "tokenOut" | "amountIn" | "amountOutQuoted"> &
    Partial<ProvisioningLeg> & { index: number; amountUsd: number },
): ProvisioningStep {
  const leg: ProvisioningLeg = {
    index: over.index,
    kind: over.kind,
    chainId: over.chainId ?? over.tokenIn.chainId,
    tokenIn: over.tokenIn,
    tokenOut: over.tokenOut,
    amountIn: over.amountIn,
    amountOutQuoted: over.amountOutQuoted,
    minAmountOut: over.minAmountOut ?? over.amountOutQuoted,
    routing: over.routing ?? (isBridgeLegKind(over.kind) ? "BRIDGE" : "CLASSIC"),
    gasUsd: over.gasUsd ?? 0,
    ...(over.priceImpactPct === undefined ? {} : { priceImpactPct: over.priceImpactPct }),
    ...(over.etaSeconds === undefined ? {} : { etaSeconds: over.etaSeconds }),
    requoteAtExecution: over.requoteAtExecution ?? false,
  };
  return {
    type: leg.kind,
    key: `${leg.kind}-${over.index}`,
    labelKey: `provisioning.steps.${LABEL_SEGMENT[leg.kind]}`,
    fromToken: leg.tokenIn.symbol,
    toToken: leg.tokenOut.symbol,
    fromChainId: leg.tokenIn.chainId,
    toChainId: leg.tokenOut.chainId,
    chainId: leg.chainId,
    amountUsd: over.amountUsd,
    method: "SEND_TX",
    leg,
  };
}

/** The trailing display anchor every plan ends with. Not a leg, and it costs nothing. */
const opStep = (amountUsd: number): ProvisioningStep => ({
  type: "op",
  key: "op",
  labelKey: "provisioning.steps.op",
  amountUsd,
});

/** Assemble a plan around priced steps, deriving the quote the way the planner does. */
function pricedPlan(args: {
  steps: ProvisioningStep[];
  shortfallUsd: number;
  reason: ProvisioningPlan["reason"];
  variant: ProvisioningPlan["variant"];
}): ProvisioningPlan {
  const { quote } = buildCostBreakdown({
    steps: args.steps,
    shortfallUsd: args.shortfallUsd,
    slippagePct: FIXTURE_SLIPPAGE_PCT,
  });
  return {
    needed: true,
    reason: args.reason,
    variant: args.variant,
    steps: args.steps,
    slippagePct: FIXTURE_SLIPPAGE_PCT,
    quote: { ...quote, quotedAt: FIXTURE_QUOTED_AT, ttlMs: FIXTURE_TTL_MS },
  };
}

/**
 * One source, one same-chain swap: $100.40 of WETH on Arbitrum buys the 100 USDC the op needs.
 * No bridge, so the fee tooltip shows a network line and no Bridge line at all.
 */
export const SAME_CHAIN_PLAN: ProvisioningPlan = pricedPlan({
  shortfallUsd: 100,
  reason: ["usdc"],
  variant: "multi",
  steps: [
    step({
      index: 0,
      kind: "swap-token",
      tokenIn: weth(ARBITRUM, WETH_ARBITRUM),
      tokenOut: usdc(ARBITRUM, USDC_ARBITRUM),
      amountIn: "40000000000000000",
      amountOutQuoted: "100000000",
      amountUsd: 100.4,
      gasUsd: 0.02,
      priceImpactPct: 0.12,
    }),
    opStep(100),
  ],
});

/**
 * Two sources funding one op on Arbitrum: WETH on Polygon (swap, then bridge its proceeds) plus
 * USDC already sitting on Base (bridge only). The Base leg's $0.0031 gas is the sub-cent L2 case.
 */
export const CROSS_CHAIN_PLAN: ProvisioningPlan = pricedPlan({
  shortfallUsd: 100,
  reason: ["usdc", "network"],
  variant: "multi",
  steps: [
    step({
      index: 0,
      kind: "swap-token",
      tokenIn: weth(POLYGON, WETH_POLYGON),
      tokenOut: usdc(POLYGON, USDC_POLYGON),
      amountIn: "24000000000000000",
      amountOutQuoted: "60000000",
      amountUsd: 60.5,
      gasUsd: 0.01,
      priceImpactPct: 0.3,
    }),
    step({
      index: 1,
      kind: "bridge",
      tokenIn: usdc(POLYGON, USDC_POLYGON),
      tokenOut: usdc(ARBITRUM, USDC_ARBITRUM),
      amountIn: "60000000",
      amountOutQuoted: "59940000",
      amountUsd: 60,
      gasUsd: 0.03,
      etaSeconds: 180,
      requoteAtExecution: true,
    }),
    step({
      index: 2,
      kind: "bridge",
      tokenIn: usdc(BASE, USDC_BASE),
      tokenOut: usdc(ARBITRUM, USDC_ARBITRUM),
      amountIn: "40000000",
      amountOutQuoted: "39960000",
      amountUsd: 40,
      gasUsd: 0.0031,
      etaSeconds: 120,
    }),
    opStep(100),
  ],
});

/**
 * A gas top-up chain on Polygon: swap a little WETH into POL for gas, then fund the op and bridge
 * it over. Both legs spend the SAME WETH holding, so the table shows one source, not two.
 */
export const GAS_TOP_UP_PLAN: ProvisioningPlan = pricedPlan({
  shortfallUsd: 100,
  reason: ["gas", "usdc", "network"],
  variant: "multi",
  steps: [
    step({
      index: 0,
      kind: "swap-gas",
      tokenIn: weth(POLYGON, WETH_POLYGON),
      tokenOut: native(POLYGON, "POL"),
      amountIn: "4000000000000000",
      amountOutQuoted: "10000000000000000000",
      amountUsd: 10,
      gasUsd: 0.0042,
      priceImpactPct: 0.05,
    }),
    step({
      index: 1,
      kind: "swap-token",
      tokenIn: weth(POLYGON, WETH_POLYGON),
      tokenOut: usdc(POLYGON, USDC_POLYGON),
      amountIn: "40000000000000000",
      amountOutQuoted: "100000000",
      amountUsd: 100.4,
      gasUsd: 0.02,
      priceImpactPct: 0.18,
    }),
    step({
      index: 2,
      kind: "bridge",
      tokenIn: usdc(POLYGON, USDC_POLYGON),
      tokenOut: usdc(ARBITRUM, USDC_ARBITRUM),
      amountIn: "100000000",
      amountOutQuoted: "99900000",
      amountUsd: 100,
      gasUsd: 0.03,
      etaSeconds: 150,
      requoteAtExecution: true,
    }),
    opStep(100),
  ],
});
