/**
 * @id PP-CORE-LIB-055 (POO-1034)
 * @name buildPlan tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Rules under test (POO-1034 rules v1):
 *   [R1] a requirement decomposes into ordered legs of SUPPORTED routes only; the flagship
 *        WETH(Polygon) → USDC(Arbitrum) becomes swap-then-bridge, never one cross-chain quote
 *   [R2] steps are ordered and only-what-is-needed; the LAST step is always the `op` anchor
 *   [R3] a BLOCKED chain is never planned from; a TOP_UP chain's gas leg comes FIRST
 *   [R4] selection order is route order
 *   [R5] gas comes from the live quote, never a constant
 *   [R7] the plan's TTL is the quote's, not the mock's hardcoded 60 s
 *   [R8] a leg fed by a previous leg's output is flagged for re-quote at execution time
 *
 * ([R6] is a schema fix, locked in `src/lib/uniswap/schemas.test.ts`; [R9] is the server boundary,
 * locked in `serverBoundary.test.ts`.)
 *
 * No network. `quoteSwap` is mocked and answers from a routing table of RECORDED quote shapes
 * (`fixtures/uniswapQuotes.ts`, shaped after the live probe in `01_UNISWAP_INTEGRATION.md` §1.1).
 * The table computes both directions from an exact BigInt rate, so an EXACT_OUTPUT question gets an
 * answer consistent with the EXACT_INPUT one, exactly as the real API's would be.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import type { UniswapQuoteResponse, UniswapRouting } from "@/lib/uniswap/schemas";
import { planCostBreakdown } from "./costBreakdown";
import { quoteFixture } from "./fixtures/uniswapQuotes";
import type { GasFeasibility, GasTopUpPlan } from "./gasFeasibility";
import type { ProvisioningLeg, ProvisioningStepType } from "./types";

const mocks = vi.hoisted(() => ({ quoteSwap: vi.fn() }));
vi.mock("@/lib/uniswap/actions", () => ({
  quoteSwap: (...args: unknown[]) => mocks.quoteSwap(...args),
}));

import { buildPlan, NATIVE_TOKEN_ADDRESS, UNISWAP_QUOTE_TTL_MS } from "./buildPlan";

const ARBITRUM = 42161;
const BASE = 8453;
const POLYGON = 137;

const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const WETH_ARBITRUM = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const WETH_POLYGON = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";

const NOW = "2026-07-25T12:00:00.000Z";
const ONE_ETH = BigInt(10) ** BigInt(18);
/** 100 USDC in base units. The requirement in most cases below. */
const HUNDRED_USDC = "100000000";

// --- the recorded routing table ------------------------------------------------------------------

interface Route {
  routing: UniswapRouting;
  /** `out = in * rateNum / rateDen`, exact BigInt both ways. */
  rateNum: bigint;
  rateDen: bigint;
  gasFeeUSD?: string;
  estimatedFillTimeMs?: number;
  permitDeadline?: number;
}

type QuoteCall = {
  tokenIn: string;
  tokenOut: string;
  tokenInChainId: number;
  tokenOutChainId: number;
  amount: string;
  type?: "EXACT_INPUT" | "EXACT_OUTPUT";
};

const routes = new Map<string, Route>();

function routeKey(
  tokenIn: string,
  tokenInChainId: number,
  tokenOut: string,
  tokenOutChainId: number,
): string {
  return `${tokenIn.toLowerCase()}@${tokenInChainId}>${tokenOut.toLowerCase()}@${tokenOutChainId}`;
}

function route(
  tokenIn: string,
  tokenInChainId: number,
  tokenOut: string,
  tokenOutChainId: number,
  spec: Route,
): void {
  routes.set(routeKey(tokenIn, tokenInChainId, tokenOut, tokenOutChainId), spec);
}

/** ETH → USDC at $2,500: 1e18 wei buys 2,500e6 USDC. */
const ETH_TO_USDC: Pick<Route, "rateNum" | "rateDen"> = {
  rateNum: BigInt(2_500) * BigInt(10) ** BigInt(6),
  rateDen: ONE_ETH,
};
/** WETH → the chain's native coin: 1:1, which is what unwrapping is. */
const PARITY: Pick<Route, "rateNum" | "rateDen"> = { rateNum: BigInt(1), rateDen: BigInt(1) };
/** Across takes 0.1% on a USDC bridge leg. */
const BRIDGE_RATE: Pick<Route, "rateNum" | "rateDen"> = {
  rateNum: BigInt(999),
  rateDen: BigInt(1000),
};

/** The mocked `quoteSwap`: answers from {@link routes}, or a 404 when the pair is not in it. */
function answerQuote(call: QuoteCall) {
  const spec = routes.get(
    routeKey(call.tokenIn, call.tokenInChainId, call.tokenOut, call.tokenOutChainId),
  );
  if (!spec) {
    return { ok: false as const, code: "NOT_FOUND", message: "ResourceNotFound" };
  }

  const requested = BigInt(call.amount);
  const exactOutput = call.type === "EXACT_OUTPUT";
  // EXACT_OUTPUT asks the inverse question, and rounds UP so the input is never a hair short.
  const amountIn = exactOutput
    ? (requested * spec.rateDen + spec.rateNum - BigInt(1)) / spec.rateNum
    : requested;
  const amountOut = exactOutput ? requested : (requested * spec.rateNum) / spec.rateDen;

  const quote: UniswapQuoteResponse = quoteFixture({
    routing: spec.routing,
    tokenIn: call.tokenIn,
    tokenInChainId: call.tokenInChainId,
    tokenOut: call.tokenOut,
    tokenOutChainId: call.tokenOutChainId,
    amountIn: amountIn.toString(),
    amountOut: amountOut.toString(),
    ...(spec.gasFeeUSD === undefined ? {} : { gasFeeUSD: spec.gasFeeUSD }),
    ...(spec.estimatedFillTimeMs === undefined
      ? {}
      : { estimatedFillTimeMs: spec.estimatedFillTimeMs }),
    ...(spec.permitDeadline === undefined ? {} : { permitDeadline: spec.permitDeadline }),
  });
  return { ok: true as const, quote };
}

// --- request builders ----------------------------------------------------------------------------

function source(over: Partial<FundingSource> & Pick<FundingSource, "address" | "chainId">) {
  return {
    symbol: "TKN",
    decimals: 18,
    amount: ONE_ETH.toString(),
    usd: 2_500,
    reachableChainIds: [ARBITRUM, BASE, POLYGON],
    isNative: false,
    logoUrl: "",
    ...over,
  } satisfies FundingSource;
}

const WETH_ON_POLYGON = source({
  address: WETH_POLYGON,
  chainId: POLYGON,
  symbol: "WETH",
  decimals: 18,
  amount: ONE_ETH.toString(),
  usd: 2_500,
});

const WETH_ON_ARBITRUM = source({
  address: WETH_ARBITRUM,
  chainId: ARBITRUM,
  symbol: "WETH",
  decimals: 18,
  amount: ONE_ETH.toString(),
  usd: 2_500,
});

const USDC_ON_BASE = source({
  address: USDC_BASE,
  chainId: BASE,
  symbol: "USDC",
  decimals: 6,
  amount: "500000000",
  usd: 500,
});

function verdict(chainId: number, over: Partial<GasFeasibility> = {}): GasFeasibility {
  return {
    chainId,
    verdict: "OK",
    quotedGasUsd: 0.02,
    requiredGasUsd: 0.075,
    shortfallUsd: 0,
    surplusUsd: 5,
    reasonKey: "provisioning.gasVerdict.ok",
    ...over,
  };
}

function topUp(over: Partial<GasTopUpPlan> = {}): GasTopUpPlan {
  return {
    token: {
      symbol: "WETH",
      address: WETH_POLYGON,
      decimals: 18,
      balanceRaw: ONE_ETH.toString(),
      balanceUsd: 2_500,
    },
    // 0.004 WETH ≈ $10 at the table's $2,500 rate.
    amountRaw: "4000000000000000",
    amountUsd: 10,
    buyNativeUsd: 10,
    ...over,
  };
}

/** The plan's ordered step types (the shape assertion the whole suite leans on). */
function stepTypes(steps: { type: ProvisioningStepType }[]): ProvisioningStepType[] {
  return steps.map((step) => step.type);
}

/** Every leg carried on the plan, in step order. */
function legsOf(plan: { steps: { leg?: ProvisioningLeg }[] }): ProvisioningLeg[] {
  return plan.steps.flatMap((step) => (step.leg ? [step.leg] : []));
}

/** Every `quoteSwap` call, in order. */
function quoteCalls(): QuoteCall[] {
  return mocks.quoteSwap.mock.calls.map((call) => call[0] as QuoteCall);
}

/**
 * The ASSET behind an address. Cross-chain routability is a property of the asset, not of the
 * address: USDC is a different contract on every chain, so an address comparison cannot express
 * "same token, two chains".
 */
function assetOf(address: string): string {
  const assets: Record<string, string> = {
    [USDC_ARBITRUM.toLowerCase()]: "USDC",
    [USDC_BASE.toLowerCase()]: "USDC",
    [USDC_POLYGON.toLowerCase()]: "USDC",
    [WETH_ARBITRUM.toLowerCase()]: "WETH",
    [WETH_POLYGON.toLowerCase()]: "WETH",
    [NATIVE_TOKEN_ADDRESS.toLowerCase()]: "NATIVE",
  };
  return assets[address.toLowerCase()] ?? address.toLowerCase();
}

beforeEach(() => {
  routes.clear();
  mocks.quoteSwap.mockReset();
  mocks.quoteSwap.mockImplementation((call: QuoteCall) => Promise.resolve(answerQuote(call)));
});

// --------------------------------------------------------------------------------------------------

describe("buildPlan: same-chain swap", () => {
  beforeEach(() => {
    route(WETH_ARBITRUM, ARBITRUM, USDC_ARBITRUM, ARBITRUM, {
      routing: "CLASSIC",
      ...ETH_TO_USDC,
      gasFeeUSD: "0.02",
      permitDeadline: Math.floor(Date.parse(NOW) / 1000) + 1800,
    });
  });

  // @rule R1, R2 — one CLASSIC leg, then the op anchor. Nothing else is needed, so nothing else is
  // planned.
  it("plans a single CLASSIC swap leg and the op anchor", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [WETH_ON_ARBITRUM],
        gasByChain: { [ARBITRUM]: verdict(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stepTypes(result.plan.steps)).toEqual(["swap-token", "op"]);
    expect(result.plan.variant).toBe("multi");

    const [leg] = legsOf(result.plan);
    expect(leg?.routing).toBe("CLASSIC");
    expect(leg?.chainId).toBe(ARBITRUM);
    expect(leg?.tokenOut.address.toLowerCase()).toBe(USDC_ARBITRUM.toLowerCase());
    // 100 USDC at $2,500/ETH = 0.04 ETH, sized backwards with EXACT_OUTPUT.
    expect(leg?.amountIn).toBe("40000000000000000");
    expect(leg?.amountOutQuoted).toBe(HUNDRED_USDC);
    // @rule R8 — the FIRST leg spends a balance that already exists, so it needs no re-quote.
    expect(leg?.requoteAtExecution).toBe(false);
  });

  // @rule R1 — the requirement is "land exactly this much on the target chain", which is an
  // exact-output question. [R6] removed the schema guard that made it unaskable.
  it("sizes the leg backwards with an EXACT_OUTPUT quote", async () => {
    await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [WETH_ON_ARBITRUM],
        gasByChain: { [ARBITRUM]: verdict(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    expect(quoteCalls()[0]).toMatchObject({ type: "EXACT_OUTPUT", amount: HUNDRED_USDC });
  });

  // @rule R5 — the number is the quote's, not a constant. Change the quote, the plan changes.
  it("takes the step's gas from the quote, not a constant", async () => {
    const cheap = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [WETH_ON_ARBITRUM],
        gasByChain: { [ARBITRUM]: verdict(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    route(WETH_ARBITRUM, ARBITRUM, USDC_ARBITRUM, ARBITRUM, {
      routing: "CLASSIC",
      ...ETH_TO_USDC,
      gasFeeUSD: "3.50",
    });
    const dear = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [WETH_ON_ARBITRUM],
        gasByChain: { [ARBITRUM]: verdict(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    expect(cheap.ok && legsOf(cheap.plan)[0]?.gasUsd).toBe(0.02);
    expect(dear.ok && legsOf(dear.plan)[0]?.gasUsd).toBe(3.5);
    // …and it reaches the cost breakdown, which is what the user actually sees.
    expect(dear.ok && dear.plan.quote.bufferUsd).toBeGreaterThan(
      (cheap.ok && cheap.plan.quote.bufferUsd) || 0,
    );
  });

  // @rule R7 — a real TTL. The mock's hardcoded 60 s is gone; a permit deadline TIGHTENS it.
  it("honours the quote's TTL and lets a permit deadline tighten it", async () => {
    const plain = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [WETH_ON_ARBITRUM],
        gasByChain: { [ARBITRUM]: verdict(ARBITRUM) },
      },
      { nowIso: NOW },
    );
    expect(plain.ok && plain.plan.quote.quotedAt).toBe(NOW);
    expect(plain.ok && plain.plan.quote.ttlMs).toBe(UNISWAP_QUOTE_TTL_MS);
    expect(plain.ok && plain.plan.quote.ttlMs).not.toBe(60_000);

    // A permit that expires in 8 seconds binds before the quote's own window does.
    route(WETH_ARBITRUM, ARBITRUM, USDC_ARBITRUM, ARBITRUM, {
      routing: "CLASSIC",
      ...ETH_TO_USDC,
      gasFeeUSD: "0.02",
      permitDeadline: Math.floor(Date.parse(NOW) / 1000) + 8,
    });
    const tight = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [WETH_ON_ARBITRUM],
        gasByChain: { [ARBITRUM]: verdict(ARBITRUM) },
      },
      { nowIso: NOW },
    );
    expect(tight.ok && tight.plan.quote.ttlMs).toBe(8_000);
  });
});

describe("buildPlan: cross-chain same-token bridge", () => {
  beforeEach(() => {
    route(USDC_BASE, BASE, USDC_ARBITRUM, ARBITRUM, {
      routing: "BRIDGE",
      ...BRIDGE_RATE,
      gasFeeUSD: "0.01",
      estimatedFillTimeMs: 1_000,
    });
  });

  // @rule R1 — same token across two chains is ONE supported route (`routing: "BRIDGE"`), so it is
  // one leg and not a decomposition.
  it("plans a single BRIDGE leg carrying the quote's real ETA", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [USDC_ON_BASE],
        gasByChain: { [BASE]: verdict(BASE), [ARBITRUM]: verdict(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stepTypes(result.plan.steps)).toEqual(["bridge", "op"]);

    const [leg] = legsOf(result.plan);
    expect(leg?.routing).toBe("BRIDGE");
    expect(leg?.chainId).toBe(BASE);
    expect(leg?.tokenOut.chainId).toBe(ARBITRUM);
    expect(leg?.etaSeconds).toBe(1);
    // Sized backwards: enough USDC leaves Base that exactly 100 lands on Arbitrum after the fee.
    expect(BigInt(leg?.amountIn ?? "0")).toBeGreaterThan(BigInt(HUNDRED_USDC));
    expect(leg?.amountOutQuoted).toBe(HUNDRED_USDC);
    // @rule R7 / §1.4 — slippage does not govern a bridge leg, so it must not shave its floor.
    expect(leg?.minAmountOut).toBe(leg?.amountOutQuoted);
    expect(result.plan.reason).toContain("network");
  });
});

describe("buildPlan: the flagship decomposition", () => {
  beforeEach(() => {
    route(WETH_POLYGON, POLYGON, USDC_POLYGON, POLYGON, {
      routing: "CLASSIC",
      ...ETH_TO_USDC,
      gasFeeUSD: "0.03",
    });
    route(USDC_POLYGON, POLYGON, USDC_ARBITRUM, ARBITRUM, {
      routing: "BRIDGE",
      ...BRIDGE_RATE,
      gasFeeUSD: "0.02",
      estimatedFillTimeMs: 1_000,
    });
  });

  // @rule R1 — the whole reason this issue exists. WETH(Polygon) → USDC(Arbitrum) is NOT routable in
  // one call (live probe P1: 404 ResourceNotFound), so it becomes swap-on-Polygon then bridge.
  it("becomes swap-then-bridge, at least two legs", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [WETH_ON_POLYGON],
        gasByChain: { [POLYGON]: verdict(POLYGON), [ARBITRUM]: verdict(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const legs = legsOf(result.plan);
    expect(legs.length).toBeGreaterThanOrEqual(2);
    expect(stepTypes(result.plan.steps)).toEqual(["swap-token", "bridge", "op"]);

    expect(legs[0]).toMatchObject({ kind: "swap-token", chainId: POLYGON, routing: "CLASSIC" });
    expect(legs[0]?.tokenOut.address.toLowerCase()).toBe(USDC_POLYGON.toLowerCase());
    expect(legs[1]).toMatchObject({ kind: "bridge", chainId: POLYGON, routing: "BRIDGE" });
    expect(legs[1]?.tokenOut.chainId).toBe(ARBITRUM);
    // The middle is USDC on the source chain, which is what makes the bridge leg same-token.
    expect(legs[1]?.tokenIn.address.toLowerCase()).toBe(USDC_POLYGON.toLowerCase());
  });

  // @rule R1 — the negative half, and the one that actually protects us: the planner must never ASK
  // for the cross-chain different-ASSET quote. Asking is a guaranteed 404 that strands the route.
  //
  // "Same token" across chains means the same ASSET, never the same address: USDC has a different
  // contract on every chain, so an address comparison would flag the one route that does work.
  it("never asks for a single cross-chain different-asset quote", async () => {
    await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [WETH_ON_POLYGON],
        gasByChain: { [POLYGON]: verdict(POLYGON), [ARBITRUM]: verdict(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    const crossChainCalls = quoteCalls().filter(
      (call) => call.tokenInChainId !== call.tokenOutChainId,
    );
    expect(crossChainCalls.length).toBeGreaterThan(0);
    for (const call of crossChainCalls) {
      expect([assetOf(call.tokenIn), assetOf(call.tokenOut)]).toEqual(["USDC", "USDC"]);
    }
  });

  // @rule R8 — a bridge never delivers exactly its quoted amount, so leg 2's input is an ESTIMATE
  // and must be re-derived from the balance leg 1 really produced. The plan says so per leg.
  it("flags every leg fed by a previous leg for re-quote at execution time", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [WETH_ON_POLYGON],
        gasByChain: { [POLYGON]: verdict(POLYGON), [ARBITRUM]: verdict(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    const legs = result.ok ? legsOf(result.plan) : [];
    expect(legs[0]?.requoteAtExecution).toBe(false);
    expect(legs[1]?.requoteAtExecution).toBe(true);
    // Leg 1's quoted output is exactly what leg 2 is sized from, and it is an estimate.
    expect(legs[1]?.amountIn).toBe(legs[0]?.amountOutQuoted);
  });

  // The backward and the forward pass ask the SAME question whenever the source covers the whole
  // requirement, and `/quote` is rate-limited on one shared API key. Asking it twice is a wasted
  // call on the primary happy path, not a second opinion.
  it("never asks the same quote question twice on the fully-covered path", async () => {
    await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [WETH_ON_POLYGON],
        gasByChain: { [POLYGON]: verdict(POLYGON), [ARBITRUM]: verdict(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    const asked = quoteCalls().map(
      (call) =>
        `${call.type}:${call.tokenIn}@${call.tokenInChainId}>${call.tokenOut}@${call.tokenOutChainId}:${call.amount}`,
    );
    expect(new Set(asked).size).toBe(asked.length);
    // Backward bridge (sizes the swap), the swap itself, then the bridge from the swap's output.
    expect(asked).toHaveLength(3);
  });
});

describe("buildPlan: gas feasibility", () => {
  beforeEach(() => {
    route(WETH_POLYGON, POLYGON, USDC_POLYGON, POLYGON, {
      routing: "CLASSIC",
      ...ETH_TO_USDC,
      gasFeeUSD: "0.03",
    });
    route(USDC_POLYGON, POLYGON, USDC_ARBITRUM, ARBITRUM, {
      routing: "BRIDGE",
      ...BRIDGE_RATE,
      gasFeeUSD: "0.02",
      estimatedFillTimeMs: 1_000,
    });
    route(WETH_POLYGON, POLYGON, NATIVE_TOKEN_ADDRESS, POLYGON, {
      routing: "CLASSIC",
      ...PARITY,
      gasFeeUSD: "0.03",
    });
    route(USDC_BASE, BASE, USDC_ARBITRUM, ARBITRUM, {
      routing: "BRIDGE",
      ...BRIDGE_RATE,
      gasFeeUSD: "0.01",
      estimatedFillTimeMs: 1_000,
    });
  });

  // @rule R3 — the gas swap runs BEFORE anything that spends from the chain. Ordering it after is
  // how a wallet with $0.00 native gets asked to broadcast a swap it cannot pay for.
  it("puts a TOP_UP chain's gas leg first, before anything that spends from it", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [WETH_ON_POLYGON],
        gasByChain: {
          [POLYGON]: verdict(POLYGON, { verdict: "TOP_UP", shortfallUsd: 10, topUp: topUp() }),
          [ARBITRUM]: verdict(ARBITRUM),
        },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stepTypes(result.plan.steps)).toEqual(["swap-gas", "swap-token", "bridge", "op"]);

    const legs = legsOf(result.plan);
    expect(legs[0]).toMatchObject({ kind: "swap-gas", chainId: POLYGON });
    expect(legs[0]?.tokenOut.address).toBe(NATIVE_TOKEN_ADDRESS);
    expect(legs[0]?.amountIn).toBe("4000000000000000");
    expect(result.plan.reason).toContain("gas");
    expect(result.plan.gas?.amountUsd).toBe(10);
  });

  // The gas step's own USD comes off the holding the slice was taken from, exactly as every other
  // leg's does. Left unpriced, a non-USDC top-up renders $0.00 beside a real token amount and its
  // slippage silently drops out of `bufferUsd`.
  it("prices the gas step's USD off the holding the slice came from", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [WETH_ON_POLYGON],
        gasByChain: {
          [POLYGON]: verdict(POLYGON, { verdict: "TOP_UP", shortfallUsd: 10, topUp: topUp() }),
          [ARBITRUM]: verdict(ARBITRUM),
        },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [gasStep] = result.plan.steps;
    expect(gasStep?.type).toBe("swap-gas");
    // 0.004 WETH taken off a 1 WETH / $2,500 holding.
    expect(gasStep?.amountUsd).toBe(10);
  });

  /** 0.02 WETH ≈ $50 on Polygon: enough for part of a 100 USDC requirement, not for all of it. */
  const SMALL_WETH_ON_POLYGON = source({
    address: WETH_POLYGON,
    chainId: POLYGON,
    symbol: "WETH",
    decimals: 18,
    amount: "20000000000000000",
    usd: 50,
  });

  // UF-13 (POO-1035) [R1]/[R2]: the planner's quote and the cost table are the same numbers, so the
  // table is derived from the plan the planner emitted and must reproduce its figures exactly. This
  // is the hardest shape to get right: two sources, a gas top-up, a swap and two bridges.
  it("emits a quote the cost model reproduces from the plan's own steps", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [SMALL_WETH_ON_POLYGON, USDC_ON_BASE],
        gasByChain: {
          [POLYGON]: verdict(POLYGON, { verdict: "TOP_UP", shortfallUsd: 10, topUp: topUp() }),
          [BASE]: verdict(BASE),
          [ARBITRUM]: verdict(ARBITRUM),
        },
        slippagePct: 2,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stepTypes(result.plan.steps)).toEqual([
      "swap-gas",
      "swap-token",
      "bridge",
      "bridge",
      "op",
    ]);

    const model = planCostBreakdown(result.plan);
    const { shortfallUsd, bufferUsd, feesUsd, totalPayUsd } = result.plan.quote;
    expect(model.quote).toEqual({ shortfallUsd, bufferUsd, feesUsd, totalPayUsd });
    // [R2] in whole cents: adding the exposed figures back up in floats is not an identity check.
    const cents = (usd: number) => Math.round(usd * 100);
    expect(cents(totalPayUsd)).toBe(cents(shortfallUsd) + cents(bufferUsd) + cents(feesUsd));

    // [R1] Two sources, with the Polygon gas top-up charged to the WETH holding that buys it.
    expect(model.sources.map((entry) => entry.symbol)).toEqual(["WETH", "USDC"]);
    expect(model.sources[0]?.stepKeys).toEqual(["swap-gas-0", "swap-token-1", "bridge-2"]);
    // [R3] Both bridges are priced, and neither carries a slippage allowance.
    expect(model.totals.bridgeFeeUsd).toBeGreaterThan(0);
    expect(model.sources[1]?.lines.slippageUsd).toBe(0);
  });

  // @rule R3 — a BLOCKED chain cannot originate ANY transaction, so it is not a funding source and
  // must not even be quoted. Planning from it produces a route that dies on its first broadcast.
  it("never plans from, or quotes, a BLOCKED chain", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        // Polygon is selected FIRST and is blocked; Base must carry the whole requirement.
        sources: [WETH_ON_POLYGON, USDC_ON_BASE],
        gasByChain: {
          [POLYGON]: verdict(POLYGON, {
            verdict: "BLOCKED",
            reasonKey: "provisioning.gasVerdict.noNative",
          }),
          [BASE]: verdict(BASE),
          [ARBITRUM]: verdict(ARBITRUM),
        },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stepTypes(result.plan.steps)).toEqual(["bridge", "op"]);
    expect(legsOf(result.plan).every((leg) => leg.chainId !== POLYGON)).toBe(true);
    expect(quoteCalls().every((call) => call.tokenInChainId !== POLYGON)).toBe(true);
  });

  // @rule R3 — a chain with no verdict at all is treated as unusable, not as implicitly fine. A
  // missing classification is missing information, and guessing "OK" is how the same broadcast fails.
  it("skips a source chain with no gas verdict", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [WETH_ON_POLYGON, USDC_ON_BASE],
        gasByChain: { [BASE]: verdict(BASE), [ARBITRUM]: verdict(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    expect(result.ok && stepTypes(result.plan.steps)).toEqual(["bridge", "op"]);
  });
});

describe("buildPlan: gas rollback for an unusable source", () => {
  /** A Polygon holding whose GAS route quotes but whose funding route is not offered (404). */
  const XYZ_POLYGON = "0x2222222222222222222222222222222222222222";
  const XYZ_ON_POLYGON = source({
    address: XYZ_POLYGON,
    chainId: POLYGON,
    symbol: "XYZ",
    decimals: 18,
    amount: ONE_ETH.toString(),
    usd: 900,
  });

  beforeEach(() => {
    // Polygon: the gas swap is routable…
    route(XYZ_POLYGON, POLYGON, NATIVE_TOKEN_ADDRESS, POLYGON, {
      routing: "CLASSIC",
      ...PARITY,
      gasFeeUSD: "0.03",
      permitDeadline: Math.floor(Date.parse(NOW) / 1000) + 8,
    });
    // …and the bridge out of Polygon is too, but XYZ → USDC on Polygon is NOT, so the funding route
    // dies in decomposition after the gas leg was already priced and pushed.
    route(USDC_POLYGON, POLYGON, USDC_ARBITRUM, ARBITRUM, {
      routing: "BRIDGE",
      ...BRIDGE_RATE,
      gasFeeUSD: "0.02",
    });
    route(WETH_ARBITRUM, ARBITRUM, NATIVE_TOKEN_ADDRESS, ARBITRUM, {
      routing: "CLASSIC",
      ...PARITY,
      gasFeeUSD: "0.02",
    });
    route(WETH_ARBITRUM, ARBITRUM, USDC_ARBITRUM, ARBITRUM, {
      routing: "CLASSIC",
      ...ETH_TO_USDC,
      gasFeeUSD: "0.02",
    });
  });

  const arbitrumTopUp = topUp({
    token: {
      symbol: "WETH",
      address: WETH_ARBITRUM,
      decimals: 18,
      balanceRaw: ONE_ETH.toString(),
      balanceUsd: 2_500,
    },
    // 0.002 WETH ≈ $5 at the table's $2,500 rate.
    amountRaw: "2000000000000000",
    amountUsd: 5,
    buyNativeUsd: 4,
  });

  const polygonTopUp = topUp({
    token: {
      symbol: "XYZ",
      address: XYZ_POLYGON,
      decimals: 18,
      balanceRaw: ONE_ETH.toString(),
      balanceUsd: 900,
    },
    amountRaw: "4000000000000000",
    amountUsd: 3.6,
    buyNativeUsd: 10,
  });

  // @rule R3 — a gas leg is speculative until the source it was priced for proves routable. Rolling
  // back only the leg leaves its money and its permit behind: the buy-gas figure the user is shown
  // would include a top-up for a chain the plan never touches, and the plan's TTL would be governed
  // by a permit nobody signs.
  it("rolls back the whole gas leg when the source's funding route is unusable", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [XYZ_ON_POLYGON, WETH_ON_ARBITRUM],
        gasByChain: {
          [POLYGON]: verdict(POLYGON, {
            verdict: "TOP_UP",
            shortfallUsd: 10,
            topUp: polygonTopUp,
          }),
          [ARBITRUM]: verdict(ARBITRUM, {
            verdict: "TOP_UP",
            shortfallUsd: 4,
            topUp: arbitrumTopUp,
          }),
        },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Polygon contributes nothing, so only Arbitrum's gas leg survives.
    expect(stepTypes(result.plan.steps)).toEqual(["swap-gas", "swap-token", "op"]);
    expect(legsOf(result.plan).every((leg) => leg.chainId === ARBITRUM)).toBe(true);
    // The buy-gas preset is Arbitrum's alone; the dropped Polygon top-up must not inflate it.
    expect(result.plan.gas?.amountUsd).toBe(4);
    // …nor may its permit deadline keep tightening a window it no longer belongs to.
    expect(result.plan.quote.ttlMs).toBe(UNISWAP_QUOTE_TTL_MS);
    // 0.002 WETH off a 1 WETH / $2,500 holding.
    expect(result.plan.steps[0]?.amountUsd).toBe(5);
  });
});

describe("buildPlan: multi-source aggregation", () => {
  beforeEach(() => {
    route(WETH_ARBITRUM, ARBITRUM, USDC_ARBITRUM, ARBITRUM, {
      routing: "CLASSIC",
      ...ETH_TO_USDC,
      gasFeeUSD: "0.02",
    });
    route(USDC_BASE, BASE, USDC_ARBITRUM, ARBITRUM, {
      routing: "BRIDGE",
      ...BRIDGE_RATE,
      gasFeeUSD: "0.01",
      estimatedFillTimeMs: 1_000,
    });
  });

  /** 0.02 WETH ≈ $50: enough for a third of a 300 USDC requirement, not for all of it. */
  const SMALL_WETH = source({
    address: WETH_ARBITRUM,
    chainId: ARBITRUM,
    symbol: "WETH",
    decimals: 18,
    amount: "20000000000000000",
    usd: 50,
  });

  // @rule R4 — selection order is route order: what the user picked first executes first. Anything
  // else means the reviewed plan and the executed plan are different plans.
  it("drains sources in selection order and aggregates to the requirement", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: "300000000",
        requiredUsd: 300,
        sources: [SMALL_WETH, USDC_ON_BASE],
        gasByChain: { [ARBITRUM]: verdict(ARBITRUM), [BASE]: verdict(BASE) },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stepTypes(result.plan.steps)).toEqual(["swap-token", "bridge", "op"]);

    const legs = legsOf(result.plan);
    // The undersized source is spent in full (EXACT_INPUT fallback), delivering $50 of USDC…
    expect(legs[0]?.amountIn).toBe(SMALL_WETH.amount);
    expect(legs[0]?.amountOutQuoted).toBe("50000000");
    // …and the bridge is sized backwards for exactly the remaining 250.
    expect(legs[1]?.amountOutQuoted).toBe("250000000");
  });

  // @rule R2 — only what is needed. Once the requirement is covered, later selections are not
  // planned: a leg that moves money the operation does not need is a fee the user did not agree to.
  it("stops once the requirement is covered", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [WETH_ON_ARBITRUM, USDC_ON_BASE],
        gasByChain: { [ARBITRUM]: verdict(ARBITRUM), [BASE]: verdict(BASE) },
      },
      { nowIso: NOW },
    );

    expect(result.ok && stepTypes(result.plan.steps)).toEqual(["swap-token", "op"]);
    expect(quoteCalls().every((call) => call.tokenInChainId !== BASE)).toBe(true);
  });

  // Never present a plan that cannot complete (UF-22 R3). Being told "you are short" is actionable;
  // a plan that strands halfway is not.
  it("fails typed when the selected sources cannot cover the requirement", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: "300000000",
        requiredUsd: 300,
        sources: [SMALL_WETH],
        gasByChain: { [ARBITRUM]: verdict(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    expect(result).toMatchObject({ ok: false, code: "PROVISIONING_INSUFFICIENT_FUNDS" });
  });

  // §4.7 — a 404 is a routing boundary, not an outage. The source is unusable; the others are not.
  it("skips a source whose route is not quotable and uses the next", async () => {
    const unroutable = source({
      address: "0x1111111111111111111111111111111111111111",
      chainId: ARBITRUM,
      symbol: "XYZ",
      usd: 900,
    });

    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [unroutable, WETH_ON_ARBITRUM],
        gasByChain: { [ARBITRUM]: verdict(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    expect(result.ok && stepTypes(result.plan.steps)).toEqual(["swap-token", "op"]);
  });
});

describe("buildPlan: plan contract", () => {
  beforeEach(() => {
    route(WETH_ARBITRUM, ARBITRUM, USDC_ARBITRUM, ARBITRUM, {
      routing: "CLASSIC",
      ...ETH_TO_USDC,
      gasFeeUSD: "0.02",
    });
  });

  // @rule R2 — the trailing `op` anchor is what every render surface reads as "and then your
  // operation runs", and `ProvisioningPlan` already requires it.
  it("always ends with the op anchor and emits i18n keys, never copy", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [WETH_ON_ARBITRUM],
        gasByChain: { [ARBITRUM]: verdict(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.steps.at(-1)?.type).toBe("op");
    expect(result.plan.steps.at(-1)?.leg).toBeUndefined();
    for (const step of result.plan.steps) {
      expect(step.labelKey).toMatch(/^provisioning\.steps\./);
      expect(step.key).toBeTruthy();
    }
    // Step keys are what `useWalletSignFlow` addresses a step by; duplicates silently merge steps.
    const keys = result.plan.steps.map((step) => step.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // The contract's own definition of the cost breakdown. UF-13 itemizes it; this pins the identity.
  it("obeys totalPay = shortfall + buffer + fees and echoes the slippage", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [WETH_ON_ARBITRUM],
        gasByChain: { [ARBITRUM]: verdict(ARBITRUM) },
        slippagePct: 0.5,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { shortfallUsd, bufferUsd, feesUsd, totalPayUsd } = result.plan.quote;
    expect(totalPayUsd).toBeCloseTo(shortfallUsd + bufferUsd + feesUsd, 2);
    expect(shortfallUsd).toBe(100);
    expect(result.plan.slippagePct).toBe(0.5);
  });

  // @rule R2 — nothing missing means nothing planned. The op signs unchanged and no modal opens.
  it("returns a no-op plan when nothing has to be provisioned", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: "0",
        requiredUsd: 0,
        sources: [WETH_ON_ARBITRUM],
        gasByChain: { [ARBITRUM]: verdict(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.needed).toBe(false);
    expect(result.plan.variant).toBe("none");
    expect(stepTypes(result.plan.steps)).toEqual(["op"]);
    expect(mocks.quoteSwap).not.toHaveBeenCalled();
  });

  // An op that spends no USDC (collect / withdraw / close) can still be blocked by gas alone, and
  // that is the `gas-only` branch the six modals already route on.
  it("routes a gas-only requirement to the gas-only variant", async () => {
    route(WETH_ARBITRUM, ARBITRUM, NATIVE_TOKEN_ADDRESS, ARBITRUM, {
      routing: "CLASSIC",
      ...PARITY,
      gasFeeUSD: "0.02",
    });

    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: "0",
        requiredUsd: 0,
        sources: [WETH_ON_ARBITRUM],
        gasByChain: {
          [ARBITRUM]: verdict(ARBITRUM, {
            verdict: "TOP_UP",
            shortfallUsd: 10,
            topUp: topUp({
              token: {
                symbol: "WETH",
                address: WETH_ARBITRUM,
                decimals: 18,
                balanceRaw: ONE_ETH.toString(),
                balanceUsd: 2_500,
              },
            }),
          }),
        },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stepTypes(result.plan.steps)).toEqual(["swap-gas", "op"]);
    expect(result.plan.variant).toBe("gas-only");
    expect(result.plan.reason).toEqual(["gas"]);
  });
});
