/**
 * @id PP-CORE-LIB-056 (POO-1035)
 * @name provisioning cost model tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Rules under test (POO-1035 rules v1):
 *   [R1] a per-source AND an aggregate breakdown: swap cost, bridge fee, gas per on-chain leg,
 *        price impact, slippage allowance, and the total
 *   [R2] `totalPayUsd = shortfallUsd + bufferUsd + feesUsd`, the contract's own definition
 *   [R3] bridge fees come from the bridge quote; slippage does NOT apply to a bridge leg
 *   [R4] a `SIGN_MSG` step incurs no gas and contributes zero to the gas line
 *   [R5] the bridge fee is threaded to the canonical fee tooltip's Bridge line
 *   [R6] no float money math where precision matters
 *   [R7] price impact comes from the live quote; absent on a bridge leg is correct
 *
 * Pure and injectable: every case is a hand-built plan. No network, no clock, no mocks.
 */
import { describe, expect, it } from "vitest";
import { bridgeFeeTooltipInput, buildCostBreakdown, planCostBreakdown } from "./costBreakdown";
import type { ProvisioningLeg, ProvisioningPlan, ProvisioningStep } from "./types";

const ARBITRUM = 42161;
const BASE = 8453;
const POLYGON = 137;

const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const WETH_POLYGON = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
const NATIVE = "0x0000000000000000000000000000000000000000";

/**
 * A USD figure in whole cents.
 *
 * Every identity below is asserted in cents rather than by adding the exposed figures back up:
 * `100 + 1.27 + 0.1` is `101.36999999999999` in IEEE-754, so a float-summed expectation would fail
 * against a model that is exactly right. The model itself accumulates integers for the same reason.
 */
const cents = (usd: number): number => Math.round(usd * 100);

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
const native = (chainId: number) => ({ address: NATIVE, symbol: "ETH", decimals: 18, chainId });

/** One priced step, as `assemblePlan` emits it: display fields plus the executable leg. */
function step(
  over: Pick<ProvisioningLeg, "kind" | "tokenIn" | "tokenOut" | "amountIn" | "amountOutQuoted"> &
    Partial<ProvisioningLeg> & {
      index: number;
      amountUsd: number;
      method?: ProvisioningStep["method"];
    },
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
    routing: over.routing ?? (over.kind === "bridge" ? "BRIDGE" : "CLASSIC"),
    gasUsd: over.gasUsd ?? 0,
    ...(over.priceImpactPct === undefined ? {} : { priceImpactPct: over.priceImpactPct }),
    requoteAtExecution: over.requoteAtExecution ?? false,
  };
  return {
    type: leg.kind,
    key: `${leg.kind}-${over.index}`,
    labelKey: `provisioning.steps.${leg.kind}`,
    fromToken: leg.tokenIn.symbol,
    toToken: leg.tokenOut.symbol,
    fromChainId: leg.tokenIn.chainId,
    toChainId: leg.tokenOut.chainId,
    chainId: leg.chainId,
    amountUsd: over.amountUsd,
    method: over.method ?? "SEND_TX",
    leg,
  };
}

/** The trailing display anchor every plan ends with. It is not a leg and costs nothing. */
const opStep = (amountUsd: number): ProvisioningStep => ({
  type: "op",
  key: "op",
  labelKey: "provisioning.steps.op",
  amountUsd,
});

// --- the three canonical plan shapes ---------------------------------------------------------

/** One source, one same-chain swap: $100 of WETH on Arbitrum buys the 100 USDC the op needs. */
const SINGLE_SOURCE: ProvisioningStep[] = [
  step({
    index: 0,
    kind: "swap-token",
    tokenIn: weth(ARBITRUM, "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"),
    tokenOut: usdc(ARBITRUM, USDC_ARBITRUM),
    amountIn: "40000000000000000",
    amountOutQuoted: "100000000",
    amountUsd: 100.4,
    gasUsd: 0.02,
    priceImpactPct: 0.12,
  }),
  opStep(100),
];

/** Two sources: WETH on Polygon (swap then bridge) plus USDC already on Base (bridge only). */
const MULTI_SOURCE: ProvisioningStep[] = [
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
    gasUsd: 0.02,
  }),
  opStep(100),
];

/** A TOP_UP chain: the gas swap comes first, off the SAME WETH holding the funding leg spends. */
const GAS_TOP_UP: ProvisioningStep[] = [
  step({
    index: 0,
    kind: "swap-gas",
    tokenIn: weth(POLYGON, WETH_POLYGON),
    tokenOut: native(POLYGON),
    amountIn: "4000000000000000",
    amountOutQuoted: "10000000000000000000",
    amountUsd: 10,
    gasUsd: 0.01,
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
    requoteAtExecution: true,
  }),
  opStep(100),
];

// --- [R2] the contract's own definition, on all three shapes ----------------------------------

describe("buildCostBreakdown: the total identity [R2]", () => {
  it.each([
    ["single source", SINGLE_SOURCE],
    ["multi source", MULTI_SOURCE],
    ["gas top-up", GAS_TOP_UP],
  ])("obeys totalPay = shortfall + buffer + fees (%s)", (_name, steps) => {
    const { quote } = buildCostBreakdown({ steps, shortfallUsd: 100, slippagePct: 2 });

    expect(cents(quote.totalPayUsd)).toBe(
      cents(quote.shortfallUsd) + cents(quote.bufferUsd) + cents(quote.feesUsd),
    );
    expect(quote.shortfallUsd).toBe(100);
    // Not merely consistent: the figures have to be REAL. A model that returned zeros would pass
    // an identity check and tell the user nothing.
    expect(quote.bufferUsd).toBeGreaterThan(0);
    expect(quote.totalPayUsd).toBeGreaterThan(100);
  });

  // The buffer is the contract's own: the provisioning transactions' gas plus the slippage
  // allowance. The fee line is the bridge, and nothing else.
  it("splits buffer into gas + slippage and fees into the bridge spread", () => {
    const { quote, totals } = buildCostBreakdown({
      steps: MULTI_SOURCE,
      shortfallUsd: 100,
      slippagePct: 2,
    });

    expect(cents(quote.bufferUsd)).toBe(cents(totals.gasUsd) + cents(totals.slippageUsd));
    expect(quote.feesUsd).toBe(totals.bridgeFeeUsd);
  });

  // A quote with no legs is not a cost: an op that needs no provisioning pays only itself.
  it("prices an empty plan as the shortfall alone", () => {
    const { quote, sources, gas } = buildCostBreakdown({
      steps: [opStep(0)],
      shortfallUsd: 0,
      slippagePct: 2,
    });

    expect(quote).toEqual({ shortfallUsd: 0, bufferUsd: 0, feesUsd: 0, totalPayUsd: 0 });
    expect(sources).toEqual([]);
    expect(gas).toEqual([]);
  });
});

// --- [R1] per source AND aggregate --------------------------------------------------------------

describe("buildCostBreakdown: the itemization [R1]", () => {
  it("groups the legs by the holding they spend, in route order", () => {
    const { sources } = buildCostBreakdown({
      steps: MULTI_SOURCE,
      shortfallUsd: 100,
      slippagePct: 2,
    });

    expect(sources.map((source) => source.key)).toEqual([
      `${POLYGON}:${WETH_POLYGON.toLowerCase()}`,
      `${BASE}:${USDC_BASE.toLowerCase()}`,
    ]);
    expect(sources[0]?.symbol).toBe("WETH");
    expect(sources[0]?.chainId).toBe(POLYGON);
    // The WETH source pays for its own swap AND for the bridge that carries its output.
    expect(sources[0]?.stepKeys).toEqual(["swap-token-0", "bridge-1"]);
    expect(sources[1]?.stepKeys).toEqual(["bridge-2"]);
    // What the user hands over, per source: only the legs that spend a real holding.
    expect(sources[0]?.spendUsd).toBe(60.5);
    expect(sources[1]?.spendUsd).toBe(40);
  });

  // The gas top-up spends the same WETH the funding leg does. Two rows for one holding would read
  // as two sources the user never picked.
  it("merges a gas top-up into the source holding it is bought with", () => {
    const { sources } = buildCostBreakdown({
      steps: GAS_TOP_UP,
      shortfallUsd: 100,
      slippagePct: 2,
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]?.key).toBe(`${POLYGON}:${WETH_POLYGON.toLowerCase()}`);
    expect(sources[0]?.stepKeys).toEqual(["swap-gas-0", "swap-token-1", "bridge-2"]);
    expect(sources[0]?.spendUsd).toBe(110.4);
  });

  it("lists every on-chain leg's own gas, in execution order", () => {
    const { gas, totals } = buildCostBreakdown({
      steps: MULTI_SOURCE,
      shortfallUsd: 100,
      slippagePct: 2,
    });

    expect(gas).toEqual([
      { stepKey: "swap-token-0", chainId: POLYGON, kind: "swap-token", usd: 0.01 },
      { stepKey: "bridge-1", chainId: POLYGON, kind: "bridge", usd: 0.03 },
      { stepKey: "bridge-2", chainId: BASE, kind: "bridge", usd: 0.02 },
    ]);
    expect(totals.gasUsd).toBe(0.06);
  });

  // A breakdown a user reads must add up: the aggregate is the sum of the rows above it.
  it("aggregates exactly what the per-source rows say", () => {
    const { sources, totals } = buildCostBreakdown({
      steps: MULTI_SOURCE,
      shortfallUsd: 100,
      slippagePct: 2,
    });

    const sum = (pick: (s: (typeof sources)[number]) => number) =>
      sources.reduce((total, source) => total + cents(pick(source)), 0);
    expect(cents(totals.gasUsd)).toBe(sum((s) => s.lines.gasUsd));
    expect(cents(totals.slippageUsd)).toBe(sum((s) => s.lines.slippageUsd));
    expect(cents(totals.bridgeFeeUsd)).toBe(sum((s) => s.lines.bridgeFeeUsd));
    expect(cents(totals.swapCostUsd)).toBe(sum((s) => s.lines.swapCostUsd));
    expect(cents(totals.totalUsd)).toBe(sum((s) => s.lines.totalUsd));
  });
});

// --- [R3] slippage does not govern a bridge leg --------------------------------------------------

describe("buildCostBreakdown: bridge legs [R3]", () => {
  it("charges no slippage allowance on a bridge leg", () => {
    const bridgeOnly = [MULTI_SOURCE[2] as ProvisioningStep, opStep(40)];
    const { totals } = buildCostBreakdown({
      steps: bridgeOnly,
      shortfallUsd: 40,
      slippagePct: 2,
    });

    expect(totals.slippageUsd).toBe(0);
    // …and the leg is still costed: its gas and the bridge's own take are both real.
    expect(totals.gasUsd).toBe(0.02);
    expect(totals.bridgeFeeUsd).toBe(0.04);
  });

  it("takes the bridge fee from the quote as amountIn - amountOut", () => {
    const { totals } = buildCostBreakdown({
      steps: MULTI_SOURCE,
      shortfallUsd: 100,
      slippagePct: 2,
    });

    // 60.000000 - 59.940000 = 0.06 and 40.000000 - 39.960000 = 0.04.
    expect(totals.bridgeFeeUsd).toBe(0.1);
  });

  // The AMM legs alone carry the allowance, so raising Max slippage moves the buffer and nothing
  // else. A bridge-only plan is therefore indifferent to it.
  it("scales the allowance with the AMM notional only", () => {
    const at2 = buildCostBreakdown({ steps: MULTI_SOURCE, shortfallUsd: 100, slippagePct: 2 });
    const at05 = buildCostBreakdown({ steps: MULTI_SOURCE, shortfallUsd: 100, slippagePct: 0.5 });

    // Only the $60.50 swap leg carries the allowance; the two bridge legs contribute nothing.
    expect(at2.totals.slippageUsd).toBe(1.21);
    expect(at05.totals.slippageUsd).toBe(0.3);
    expect(at2.quote.feesUsd).toBe(at05.quote.feesUsd);
  });

  // An unrecorded slippage is not a licence to invent the default: the plan was not quoted with one.
  it("claims no allowance when the plan recorded no slippage", () => {
    const { totals } = buildCostBreakdown({ steps: MULTI_SOURCE, shortfallUsd: 100 });

    expect(totals.slippageUsd).toBe(0);
  });
});

// --- [R4] a signature costs no gas ---------------------------------------------------------------

describe("buildCostBreakdown: gas lines [R4]", () => {
  it("contributes zero gas for a SIGN_MSG step", () => {
    const permit = step({
      index: 0,
      kind: "swap-token",
      tokenIn: weth(ARBITRUM, "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"),
      tokenOut: usdc(ARBITRUM, USDC_ARBITRUM),
      amountIn: "40000000000000000",
      amountOutQuoted: "100000000",
      amountUsd: 100,
      // A stale gas figure riding on a signature step must not reach the gas line.
      gasUsd: 0.9,
      method: "SIGN_MSG",
    });

    const { totals, gas } = buildCostBreakdown({
      steps: [permit, opStep(100)],
      shortfallUsd: 100,
      slippagePct: 2,
    });

    expect(totals.gasUsd).toBe(0);
    // The step still appears, priced at zero: a missing row reads as a missing step.
    expect(gas).toEqual([
      { stepKey: "swap-token-0", chainId: ARBITRUM, kind: "swap-token", usd: 0 },
    ]);
  });
});

// --- [R7] price impact ---------------------------------------------------------------------------

describe("buildCostBreakdown: price impact [R7]", () => {
  it("reports the worst price impact across the AMM legs", () => {
    const { totals, sources } = buildCostBreakdown({
      steps: GAS_TOP_UP,
      shortfallUsd: 100,
      slippagePct: 2,
    });

    expect(totals.priceImpactPct).toBe(0.05);
    expect(sources[0]?.lines.priceImpactPct).toBe(0.05);
  });

  it("leaves price impact absent on a bridge-only plan", () => {
    const { totals } = buildCostBreakdown({
      steps: [MULTI_SOURCE[2] as ProvisioningStep, opStep(40)],
      shortfallUsd: 40,
      slippagePct: 2,
    });

    expect(totals.priceImpactPct).toBeUndefined();
  });
});

// --- the double count the model must not reintroduce ---------------------------------------------

describe("buildCostBreakdown: the swap cost is not a fee line", () => {
  // The quoted output is already net of the swap's fee and spread, so the route is sized against a
  // number that has paid it. Adding it to the total charges the user for it twice.
  it("reports the swap cost but never adds it to any total", () => {
    const { totals, quote } = buildCostBreakdown({
      steps: SINGLE_SOURCE,
      shortfallUsd: 100,
      slippagePct: 2,
    });

    // $100.40 of WETH in, 100 USDC out.
    expect(totals.swapCostUsd).toBe(0.4);
    expect(quote.feesUsd).toBe(0);
    expect(cents(quote.bufferUsd)).toBe(cents(totals.gasUsd) + cents(totals.slippageUsd));
    // The $0.40 is nowhere in what the user pays: the quoted output already carries it.
    expect(cents(quote.totalPayUsd)).toBe(cents(100) + cents(quote.bufferUsd));
    expect(cents(totals.totalUsd)).toBe(
      cents(totals.gasUsd) + cents(totals.slippageUsd) + cents(totals.bridgeFeeUsd),
    );
  });

  // Two price bases disagreeing (the holdings feed vs the route) is not a rebate. A negative cost
  // line would read as one.
  it("never reports a negative swap cost", () => {
    const cheap = step({
      index: 0,
      kind: "swap-token",
      tokenIn: weth(ARBITRUM, "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"),
      tokenOut: usdc(ARBITRUM, USDC_ARBITRUM),
      amountIn: "40000000000000000",
      amountOutQuoted: "101000000",
      amountUsd: 100,
    });

    const { totals } = buildCostBreakdown({
      steps: [cheap, opStep(100)],
      shortfallUsd: 100,
      slippagePct: 2,
    });

    expect(totals.swapCostUsd).toBe(0);
  });
});

// --- [R6] money math ------------------------------------------------------------------------------

describe("buildCostBreakdown: precision [R6]", () => {
  // 18-decimal base units run far past Number.MAX_SAFE_INTEGER. The spread is a BigInt difference
  // over decimal strings, so the figure survives the scale.
  it("derives the bridge fee from base units at 18 decimals", () => {
    const big = step({
      index: 0,
      kind: "bridge",
      // A hypothetical 18-decimal bridge asset priced at parity by its own notional.
      tokenIn: { address: USDC_POLYGON, symbol: "USDC", decimals: 18, chainId: POLYGON },
      tokenOut: { address: USDC_ARBITRUM, symbol: "USDC", decimals: 18, chainId: ARBITRUM },
      amountIn: "1234567890123456789012",
      amountOutQuoted: "1233567890123456789012",
      amountUsd: 1234.57,
    });

    const { totals } = buildCostBreakdown({
      steps: [big, opStep(1234)],
      shortfallUsd: 1234,
      slippagePct: 2,
    });

    // Exactly 1e18 base units of spread = 1.00 unit at parity.
    expect(totals.bridgeFeeUsd).toBe(1);
  });

  it("contributes zero, never NaN, for an unreadable amount", () => {
    const broken = step({
      index: 0,
      kind: "bridge",
      tokenIn: usdc(POLYGON, USDC_POLYGON),
      tokenOut: usdc(ARBITRUM, USDC_ARBITRUM),
      amountIn: "not-a-number",
      amountOutQuoted: "39960000",
      amountUsd: 40,
      gasUsd: Number.NaN,
    });

    const { totals, quote } = buildCostBreakdown({
      steps: [broken, opStep(40)],
      shortfallUsd: 40,
      slippagePct: 2,
    });

    expect(totals.bridgeFeeUsd).toBe(0);
    expect(totals.gasUsd).toBe(0);
    expect(Number.isFinite(quote.totalPayUsd)).toBe(true);
    expect(quote.totalPayUsd).toBe(40);
  });
});

// --- [R5] threading the bridge fee into the canonical fee tooltip ---------------------------------

describe("bridgeFeeTooltipInput [R5]", () => {
  it("hands the canonical tooltip a real bridge figure on a cross-chain plan", () => {
    const model = buildCostBreakdown({ steps: MULTI_SOURCE, shortfallUsd: 100, slippagePct: 2 });

    expect(bridgeFeeTooltipInput(model)).toEqual({ crossChain: true, bridgeUsd: 0.1 });
  });

  it("marks a same-chain plan as not cross-chain", () => {
    const model = buildCostBreakdown({ steps: SINGLE_SOURCE, shortfallUsd: 100, slippagePct: 2 });

    expect(bridgeFeeTooltipInput(model)).toEqual({ crossChain: false });
  });

  // A bridge leg whose quote showed no spread has not told us the bridge is free. Reporting $0.00
  // would claim it is; the placeholder is the honest answer.
  it("withholds the figure when the quote priced no spread", () => {
    const free = step({
      index: 0,
      kind: "bridge",
      tokenIn: usdc(POLYGON, USDC_POLYGON),
      tokenOut: usdc(ARBITRUM, USDC_ARBITRUM),
      amountIn: "40000000",
      amountOutQuoted: "40000000",
      amountUsd: 40,
    });
    const model = buildCostBreakdown({
      steps: [free, opStep(40)],
      shortfallUsd: 40,
      slippagePct: 2,
    });

    expect(bridgeFeeTooltipInput(model)).toEqual({ crossChain: true });
  });
});

// --- the anti-drift guard -------------------------------------------------------------------------

describe("planCostBreakdown", () => {
  // The planner and the UI must never disagree about what the plan costs, so they run the same
  // function over the same steps. This pins that they do.
  it("reproduces a plan's own quote figures from its steps", () => {
    const model = buildCostBreakdown({ steps: MULTI_SOURCE, shortfallUsd: 100, slippagePct: 2 });
    const plan: ProvisioningPlan = {
      needed: true,
      reason: ["usdc", "network"],
      variant: "multi",
      steps: MULTI_SOURCE,
      quote: { ...model.quote, quotedAt: "2026-07-25T12:00:00.000Z", ttlMs: 30_000 },
      slippagePct: 2,
    };

    expect(planCostBreakdown(plan)).toEqual(model);
  });
});
