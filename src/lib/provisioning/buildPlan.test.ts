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
import { getUsdcAddress } from "@/lib/chains/config";
import type { UniswapQuoteResponse, UniswapRouting } from "@/lib/uniswap/schemas";
import { PAYBIS_MIN_USD } from "./computeNeed";
import { planCostBreakdown } from "./costBreakdown";
import { quoteFixture } from "./fixtures/uniswapQuotes";
import type { GasFeasibility, GasTopUpPlan } from "./gasFeasibility";
import type { ProvisioningLeg, ProvisioningStep, ProvisioningStepType } from "./types";

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
  // BRIDGE routing IGNORES EXACT_OUTPUT (POO-1074, probed live 2026-07-25): it pins the INPUT to the
  // requested amount and lets the output come back short by the bridge fee, identically to
  // EXACT_INPUT. CLASSIC honours it properly (probed: WETH→USDC EXACT_OUTPUT pins the output).
  // Modelling the difference is the point of this harness: a mock more capable than the API hides
  // exactly the defect the harness exists to catch.
  const isBridge = call.tokenInChainId !== call.tokenOutChainId;
  const exactOutput = call.type === "EXACT_OUTPUT" && !isBridge;
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
    // Two to size the bridge (the first is short because BRIDGE ignores EXACT_OUTPUT, the second
    // inverts the observed rate), then the swap. The forward bridge asks nothing: the swap is sized
    // to land exactly on the amount round two solved for, so its answer is already held.
    expect(asked).toHaveLength(3);
  });
});

// @rule R1 / R2 (POO-1074) — BRIDGE routing ignores EXACT_OUTPUT and pins the INPUT instead, so a
// route sized from its `amountIn` delivers short by the bridge fee. Small in relative terms, but an
// operation with a hard on-chain minimum takes the money, pays the fees, lands under the minimum and
// fails at the last step.
describe("buildPlan: a bridge leg must not under-deliver [R2]", () => {
  beforeEach(() => {
    route(USDC_BASE, BASE, USDC_ARBITRUM, ARBITRUM, {
      routing: "BRIDGE",
      ...BRIDGE_RATE,
      gasFeeUSD: "0.01",
      estimatedFillTimeMs: 1_000,
    });
    route(WETH_POLYGON, POLYGON, USDC_POLYGON, POLYGON, { routing: "CLASSIC", ...ETH_TO_USDC });
    route(USDC_POLYGON, POLYGON, USDC_ARBITRUM, ARBITRUM, {
      routing: "BRIDGE",
      ...BRIDGE_RATE,
      estimatedFillTimeMs: 1_000,
    });
  });

  it("pins the API behaviour this guards against: EXACT_OUTPUT on a bridge returns the input", () => {
    const answer = answerQuote({
      tokenIn: USDC_BASE,
      tokenInChainId: BASE,
      tokenOut: USDC_ARBITRUM,
      tokenOutChainId: ARBITRUM,
      amount: HUNDRED_USDC,
      type: "EXACT_OUTPUT",
    });
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    // Input pinned to what was requested as OUTPUT, and the output short by the fee. If a future API
    // version starts honouring EXACT_OUTPUT this fails, which is the point: the correction below
    // becomes unnecessary and should be revisited rather than silently kept forever.
    expect(answer.quote.quote.input?.amount).toBe(HUNDRED_USDC);
    expect(BigInt(answer.quote.quote.output?.amount ?? "0")).toBeLessThan(BigInt(HUNDRED_USDC));
  });

  it("delivers AT LEAST the requirement on a single bridge leg", async () => {
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
    const [leg] = legsOf(result.plan);
    // The whole defect in one assertion.
    expect(BigInt(leg?.amountOutQuoted ?? "0")).toBeGreaterThanOrEqual(BigInt(HUNDRED_USDC));
    // And it is paid for by sending MORE in, not by wishing the fee away.
    expect(BigInt(leg?.amountIn ?? "0")).toBeGreaterThan(BigInt(HUNDRED_USDC));
  });

  it("delivers AT LEAST the requirement through the swap-then-bridge decomposition", async () => {
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
    const bridge = legs.find((leg) => leg.kind === "bridge");
    expect(BigInt(bridge?.amountOutQuoted ?? "0")).toBeGreaterThanOrEqual(BigInt(HUNDRED_USDC));
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

// POO-1075 — a chain holding zero native cannot broadcast the operation's own transaction, however
// well-funded the route into it is. Before this, the planner refused and the UI told the user to go
// move native coin across by hand, which is the job the rail exists to do. A native-to-native quote
// returns BRIDGE and delivers TRUE native, so no destination-side transaction is needed to make it
// spendable, which is what breaks the deadlock.
describe("buildPlan: bridging gas into a BLOCKED target chain [R1]", () => {
  /** Native ETH held on Base, the donor side of the flagship case. */
  const ETH_ON_BASE = source({
    address: NATIVE_TOKEN_ADDRESS,
    chainId: BASE,
    symbol: "ETH",
    decimals: 18,
    amount: (ONE_ETH / BigInt(100)).toString(), // 0.01 ETH
    usd: 36,
  });
  /** Native POL held on Polygon: real money, but the wrong coin for an ETH chain. */
  const POL_ON_POLYGON = source({
    address: NATIVE_TOKEN_ADDRESS,
    chainId: POLYGON,
    symbol: "POL",
    decimals: 18,
    amount: (ONE_ETH * BigInt(50)).toString(),
    usd: 25,
  });

  /** The target chain: zero native, so nothing can be broadcast there. */
  const blocked = (chainId: number, over: Partial<GasFeasibility> = {}) =>
    verdict(chainId, {
      verdict: "BLOCKED",
      shortfallUsd: 0.075,
      surplusUsd: 0,
      reasonKey: "provisioning.gasVerdict.noNative",
      ...over,
    });

  beforeEach(() => {
    route(NATIVE_TOKEN_ADDRESS, BASE, NATIVE_TOKEN_ADDRESS, ARBITRUM, {
      routing: "BRIDGE",
      ...BRIDGE_RATE,
      gasFeeUSD: "0.01",
      estimatedFillTimeMs: 1_000,
    });
    route(USDC_BASE, BASE, USDC_ARBITRUM, ARBITRUM, {
      routing: "BRIDGE",
      ...BRIDGE_RATE,
      gasFeeUSD: "0.01",
      estimatedFillTimeMs: 1_000,
    });
  });

  it("carries native in from a donor chain instead of refusing", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [USDC_ON_BASE, ETH_ON_BASE],
        gasByChain: { [BASE]: verdict(BASE), [ARBITRUM]: blocked(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // [R4] The gas arrives FIRST. Everything after it spends gas on a chain that now has some.
    expect(stepTypes(result.plan.steps)).toEqual(["bridge-gas", "bridge", "op"]);

    const [gas] = legsOf(result.plan);
    expect(gas?.kind).toBe("bridge-gas");
    expect(gas?.index).toBe(0);
    expect(gas?.chainId).toBe(BASE);
    // Native on BOTH ends: a route ending in a token would need gas on the far side to unwrap it,
    // and would deadlock exactly where it started.
    expect(gas?.tokenIn.address).toBe(NATIVE_TOKEN_ADDRESS);
    expect(gas?.tokenOut.address).toBe(NATIVE_TOKEN_ADDRESS);
    expect(gas?.tokenOut.chainId).toBe(ARBITRUM);
  });

  // @rule R3 — the API declines a bridge below ~0.0003 ETH (0.0002 returns 404), so a tiny gas need
  // still has to send the floor. Over-delivery is the user's own money on a chain they are about to
  // use, which is why it is allowed, but it must not be silently under-sent instead.
  it("floors a tiny gas need at the minimum the network will carry", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [USDC_ON_BASE, ETH_ON_BASE],
        gasByChain: {
          [BASE]: verdict(BASE),
          // A hundredth of a cent of gas: real, and far below the bridge floor.
          [ARBITRUM]: blocked(ARBITRUM, { requiredGasUsd: 0.0001 }),
        },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [gas] = legsOf(result.plan);
    expect(BigInt(gas?.amountOutQuoted ?? "0")).toBeGreaterThanOrEqual(BigInt("300000000000000"));
  });

  // @rule R2 — a donor that gives away what it needs for its OWN legs has simply moved the deadlock
  // one chain over.
  it("refuses a donor whose surplus cannot cover the bridge", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [USDC_ON_BASE, ETH_ON_BASE],
        gasByChain: {
          // Barely OK: nothing to give without stranding itself.
          [BASE]: verdict(BASE, { surplusUsd: 0.0001 }),
          [ARBITRUM]: blocked(ARBITRUM),
        },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("PROVISIONING_GAS_BLOCKED");
  });

  // @rule R5 — Polygon's native is POL, so every Polygon pair is a cross-chain DIFFERENT-token quote
  // and the API serves none. Probed in both directions, plus both escape hatches (POL->ETH, and
  // WETH(Polygon)->ETH(Arbitrum)): all 404. This limit is the API's, not a policy choice.
  it("does not treat a POL chain as a donor for an ETH chain", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [USDC_ON_BASE, POL_ON_POLYGON],
        gasByChain: {
          [POLYGON]: verdict(POLYGON, { surplusUsd: 25 }),
          [ARBITRUM]: blocked(ARBITRUM),
        },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("PROVISIONING_GAS_BLOCKED");
    // Never quoted: the pair is known-unroutable, so asking would spend a rate-limited call to be
    // told what the native symbols already say.
    expect(
      quoteCalls().some(
        (call) => call.tokenInChainId === POLYGON && call.tokenOutChainId === ARBITRUM,
      ),
    ).toBe(false);
  });

  // A gas bridge is a GAS leg, not a funding one. Classifying it as funding sent an operation that
  // needs no USDC at all (collect / withdraw / close) to the multi-step wizard instead of the simple
  // gas modal, and dropped its cost out of the plan's gas figure entirely.
  it("stays a gas-only plan when the operation needs no funding", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        // Collect / withdraw / close: nothing to fund, but the chain still cannot broadcast.
        requiredAmount: "0",
        requiredUsd: 0,
        sources: [ETH_ON_BASE],
        gasByChain: { [BASE]: verdict(BASE), [ARBITRUM]: blocked(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stepTypes(result.plan.steps)).toEqual(["bridge-gas", "op"]);
    expect(result.plan.variant).toBe("gas-only");
    expect(result.plan.reason).toContain("gas");
    // And the money spent on becoming able to transact is reported, not silently zero.
    expect(result.plan.gas?.amountUsd ?? 0).toBeGreaterThan(0);
  });

  // The gas bridge spends the donor's native. When that SAME holding is also the funding source,
  // failing to earmark it plans the balance twice: the bridge lands (irreversibly), then the funding
  // leg reverts for insufficient native and the user is stranded having paid to bridge gas. The
  // other tests here hide it by funding from USDC and donating from a separate ETH holding.
  it("[R2] never plans the donor's native twice when it also funds the operation", async () => {
    // 1 ETH at $2,500, the rate the routing table already uses, so the arithmetic is exact.
    const ETH_FUNDS_EVERYTHING = source({
      address: NATIVE_TOKEN_ADDRESS,
      chainId: BASE,
      symbol: "ETH",
      decimals: 18,
      amount: ONE_ETH.toString(),
      usd: 2_500,
    });
    route(NATIVE_TOKEN_ADDRESS, BASE, USDC_BASE, BASE, {
      routing: "CLASSIC",
      ...ETH_TO_USDC,
      gasFeeUSD: "0.02",
    });

    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        // Exactly what the WHOLE balance yields: 1 ETH buys 2,500 USDC, the bridge takes 0.1%. So
        // the funding route alone needs every last wei, and any amount the gas bridge also spends
        // has to come out of the same holding.
        requiredAmount: "2497500000",
        requiredUsd: 2_497.5,
        sources: [ETH_FUNDS_EVERYTHING],
        gasByChain: { [BASE]: verdict(BASE), [ARBITRUM]: blocked(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    if (result.ok) {
      const drawn = legsOf(result.plan)
        .filter(
          (leg) =>
            leg.chainId === BASE &&
            leg.tokenIn.address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase(),
        )
        .reduce((total, leg) => total + BigInt(leg.amountIn), BigInt(0));
      // Uncommitted, the gas bridge and the funding swap each plan the full balance and this lands
      // over 100%: the bridge settles, the swap reverts for insufficient native, and the user has
      // paid to bridge gas and is stranded (UF-22 [R3]).
      expect(drawn).toBeLessThanOrEqual(BigInt(ETH_FUNDS_EVERYTHING.amount));
    } else {
      // Refusing is the other honest answer: earmarking the gas leaves the route genuinely short,
      // and "you are short" is a state the user can act on. Stranding them is not.
      expect(result.code).toBe("PROVISIONING_INSUFFICIENT_FUNDS");
    }
  });

  // The real report: USDC and ETH on Base, investing in an Arbitrum strategy with zero of either
  // there. The user selects their USDC to fund the position and leaves the ETH alone, which is the
  // obvious thing to do, and the gas bridge then found no donor because it searched the SELECTION.
  // Gas is a precondition, not a spend choice: choosing which money funds the position is not
  // declining to pay for transactions. The gas TOP-UP already drew from the full inventory.
  it("[R1] finds a donor the user did not select to spend", async () => {
    route(USDC_BASE, BASE, USDC_ARBITRUM, ARBITRUM, {
      routing: "BRIDGE",
      ...BRIDGE_RATE,
      gasFeeUSD: "0.01",
      estimatedFillTimeMs: 1_000,
    });

    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        // Only the USDC was elected to fund the position...
        sources: [USDC_ON_BASE],
        // ...but the wallet also holds ETH on Base, and the rail can see it.
        inventory: [USDC_ON_BASE, ETH_ON_BASE],
        gasByChain: { [BASE]: verdict(BASE), [ARBITRUM]: blocked(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Bridge the gas, then bridge the USDC, then run the operation.
    expect(stepTypes(result.plan.steps)).toEqual(["bridge-gas", "bridge", "op"]);
  });

  // POO-1076 — the funding inventory drops sub-$1 rows because dust cannot usefully be SPENT. A gas
  // bridge is not a spend: at the live ~$1,900/ETH its 0.0003 ETH floor is about $0.56, so a holding
  // that can genuinely donate sits below a threshold that was never about donating. The gate now
  // passes native holdings through unfiltered.
  it("[R1] uses a native holding the picker's dust filter would have hidden", async () => {
    const DUSTY_ETH = source({
      address: NATIVE_TOKEN_ADDRESS,
      chainId: BASE,
      symbol: "ETH",
      decimals: 18,
      // $0.80 of ETH at ~$1,900: under the $1 picker threshold, over the ~$0.56 bridge floor.
      amount: "421000000000000",
      usd: 0.8,
    });

    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [USDC_ON_BASE],
        inventory: [USDC_ON_BASE, DUSTY_ETH],
        gasByChain: {
          [BASE]: verdict(BASE, { surplusUsd: 0.7 }),
          [ARBITRUM]: blocked(ARBITRUM),
        },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stepTypes(result.plan.steps)).toEqual(["bridge-gas", "bridge", "op"]);
  });

  // A refusal has to say WHICH gate closed. One catch-all for five situations sent a user to buy
  // crypto when the real answer was "your ETH is there, just under the bridge minimum", and left
  // nothing to debug from when it happened in the wild.
  it("[R1] names the reason it could not bridge gas", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [USDC_ON_BASE],
        inventory: [USDC_ON_BASE],
        gasByChain: { [BASE]: verdict(BASE), [ARBITRUM]: blocked(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("PROVISIONING_GAS_BLOCKED");
    // Not the generic sentence alone: it says the donor chain had spare gas by the classifier but no
    // native holding reached the planner, which is the actual defect class.
    expect(result.message).toContain(String(BASE));
    expect(result.message.length).toBeGreaterThan(120);
  });

  it("keeps refusing when no chain holds native at all", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        // USDC only: nothing native to send, on any chain.
        sources: [USDC_ON_BASE],
        gasByChain: { [BASE]: verdict(BASE), [ARBITRUM]: blocked(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("PROVISIONING_GAS_BLOCKED");
  });
});

/**
 * POO-1107. `priceLeg` collapsed EVERY `!result.ok` into "this source is not routable", including a
 * transient 429. So a throttled quote read as "no route exists": the source was silently dropped and
 * a funded wallet could be told it had insufficient funds.
 *
 * The distinction is the whole point. A 404 IS a routing boundary and must still drop the source, or
 * every unroutable pair would fail the plan. A 429 is not an answer about routing at all.
 */
describe("buildPlan: a throttled quote is not a routing verdict (POO-1107)", () => {
  const usdcBase = () =>
    source({
      chainId: BASE,
      address: USDC_BASE,
      symbol: "USDC",
      decimals: 6,
      amount: "500000000",
      usd: 500,
    });

  // Both throttles, because they are different code vocabularies from different hops and only one
  // of them is the case that actually fires. `FUNDING_WALLET_RATE_LIMITED` is pool-party-api's own
  // per-wallet Uniswap-quota shed (POO-1097 [R2]); `UNISWAP_RATE_LIMITED` is Uniswap's 429
  // forwarded through it. A set covering only the forwarded one leaves the real case broken.
  it.each([
    "FUNDING_WALLET_RATE_LIMITED",
    "THROTTLER",
    "UNISWAP_RATE_LIMITED",
    "SYSTEM_TIMEOUT",
  ])("[R2] reports an upstream failure, never insufficient funds, when a quote fails with %s", async (code) => {
    mocks.quoteSwap.mockResolvedValue({
      ok: false,
      code,
      message: "Too many requests",
    });

    const result = await buildPlan({
      targetChainId: ARBITRUM,
      requiredAmount: "100000000",
      requiredUsd: 100,
      sources: [usdcBase()],
      inventory: [usdcBase()],
      gasByChain: { [BASE]: verdict(BASE), [ARBITRUM]: verdict(ARBITRUM) },
      slippagePct: 2,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The user has 500 USDC. Telling them they are short is the specific failure to eliminate.
    expect(result.code).not.toBe("PROVISIONING_INSUFFICIENT_FUNDS");
    expect(result.code).toBe("PROVISIONING_UPSTREAM_UNAVAILABLE");
  });

  it("[R1] a 404 still drops the source, because that IS a routing verdict", async () => {
    // The regression guard for the fix: if the transient check were widened to catch everything,
    // an unroutable pair would fail the whole plan instead of moving to the next source.
    mocks.quoteSwap.mockResolvedValue({
      ok: false,
      code: "UNISWAP_REQUEST_ERROR",
      message: "ResourceNotFound",
    });

    const result = await buildPlan({
      targetChainId: ARBITRUM,
      requiredAmount: "100000000",
      requiredUsd: 100,
      sources: [usdcBase()],
      inventory: [usdcBase()],
      gasByChain: { [BASE]: verdict(BASE), [ARBITRUM]: verdict(ARBITRUM) },
      slippagePct: 2,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("PROVISIONING_INSUFFICIENT_FUNDS");
  });

  // The throw escalates the two GAS pricing sites as well, and those answer with a different code.
  // Both assertions are about not lying: a throttled quote must not be reported as a settled fact
  // about the user's money, whether that fact is "you are short" or "this chain cannot transact".
  it("[R2] a throttled gas-bridge quote is an outage, not a BLOCKED verdict", async () => {
    const ethOnBase = source({
      address: NATIVE_TOKEN_ADDRESS,
      chainId: BASE,
      symbol: "ETH",
      decimals: 18,
      amount: (ONE_ETH / BigInt(100)).toString(),
      usd: 36,
    });

    mocks.quoteSwap.mockResolvedValue({
      ok: false,
      code: "FUNDING_WALLET_RATE_LIMITED",
      message: "Too many funding requests for this wallet; retry in 12s",
    });

    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [usdcBase()],
        // The wallet CAN donate gas into the blocked target; only the quote is unavailable.
        inventory: [usdcBase(), ethOnBase],
        gasByChain: {
          [BASE]: verdict(BASE),
          [ARBITRUM]: verdict(ARBITRUM, {
            verdict: "BLOCKED",
            shortfallUsd: 0.075,
            surplusUsd: 0,
            reasonKey: "provisioning.gasVerdict.noNative",
          }),
        },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // PROVISIONING_GAS_BLOCKED would claim the chain is unusable. We do not know that: we could not
    // price the bridge that would have unblocked it.
    expect(result.code).not.toBe("PROVISIONING_GAS_BLOCKED");
    expect(result.code).toBe("PROVISIONING_UPSTREAM_UNAVAILABLE");
  });

  it("[R2] a throttled swap-gas top-up quote is an outage, not a shortfall", async () => {
    mocks.quoteSwap.mockResolvedValue({
      ok: false,
      code: "SYSTEM_RATE_LIMITED",
      message: "Too Many Requests",
    });

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

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).not.toBe("PROVISIONING_INSUFFICIENT_FUNDS");
    expect(result.code).toBe("PROVISIONING_UPSTREAM_UNAVAILABLE");
  });
});

// -------------------------------------------------------------------------------------------------
// POO-1135: the fiat on-ramp funds what the wallet cannot. `buildPlan` emitted zero fiat steps before
// this; a shortfall dead-ended in PROVISIONING_INSUFFICIENT_FUNDS or PROVISIONING_GAS_BLOCKED. With
// `onRampEnabled`, it emits a `buy` leading step (+ display swap/bridge, re-sized at execution by
// POO-1136) instead. Epic POO-1129 rules v3.
// -------------------------------------------------------------------------------------------------

describe("POO-1135: the fiat on-ramp buy leg [R1]/[R2]", () => {
  const blocked = (chainId: number, over: Partial<GasFeasibility> = {}) =>
    verdict(chainId, {
      verdict: "BLOCKED",
      shortfallUsd: 0.075,
      surplusUsd: 0,
      reasonKey: "provisioning.gasVerdict.noNative",
      ...over,
    });

  // @rule R1 R2 — empty wallet, off-Base target: buy ETH (gas-first) -> swap the op slice to USDC on
  // Base -> bridge to the operation's chain -> op.
  it("buys ETH on Base, swaps to USDC and bridges, for an empty wallet on Arbitrum", async () => {
    // POO-1916 [R3]: the fiat bridge is QUOTED before the purchase is offered, so an off-Base
    // target needs the leg it will really run to be a pair the table serves.
    route(USDC_BASE, BASE, USDC_ARBITRUM, ARBITRUM, { routing: "BRIDGE", ...BRIDGE_RATE });
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [],
        gasByChain: { [ARBITRUM]: blocked(ARBITRUM) },
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stepTypes(result.plan.steps)).toEqual(["buy", "swap-token", "bridge", "op"]);

    const buy = result.plan.steps.find((step) => step.type === "buy");
    expect(buy?.toToken).toBe("ETH");
    expect(buy?.toChainId).toBe(BASE);
    expect(buy?.poweredBy).toBe("paybis");
    expect(buy?.order?.currencyCode).toBe("ETH-BASE");
    // A fiat step has no source chain, so the merged caption path must tolerate its absence.
    expect(buy?.fromChainId).toBeUndefined();

    expect(result.plan.variant).toBe("multi");
    expect(result.plan.reason).toEqual(expect.arrayContaining(["gas", "usdc", "network"]));
    // The fiat path is PRICED by Paybis, not Uniswap, and its display steps still carry no executable
    // leg (their real size is the settled delta, POO-1136). POO-1916 [R3] adds exactly one Uniswap
    // call to it, and it is not a price: it is the routability probe on the leg that crosses, whose
    // numbers are discarded. One, so a regression that starts sizing the fiat path from a quote reds
    // here rather than silently pricing money that has not arrived.
    expect(quoteCalls()).toHaveLength(1);
    expect(quoteCalls()[0]).toMatchObject({ tokenInChainId: BASE, tokenOutChainId: ARBITRUM });
    expect(legsOf(result.plan)).toHaveLength(0);
  });

  // POO-1542 [B]: the reachable case named in the issue, at buildPlan's OWN boundary. This function
  // already read Base's verdict before this issue (unlike the panel, which read only the target's),
  // so its OWN decision for this exact input does not move. What this locks in is that switching to
  // the function SHARED with `fundingRoutes.ts` (`onRampRouteBuysGas`) preserves that decision byte
  // for byte, which is what makes the two call sites provably unable to diverge going forward. Proof
  // that the shared predicate is otherwise a real change lives in `computeNeed.test.ts` (mutating
  // `onRampRouteBuysGas` itself) and `fundingRoutes.test.ts` (the row-level divergence this issue
  // actually reports: the panel's OWN target-only reading disagreeing with this one).
  it("still buys ETH gas-first when the TARGET chain is OK but Base has no verdict at all", async () => {
    // POO-1916 [R3]: the fiat bridge is QUOTED before the purchase is offered, so an off-Base
    // target needs the leg it will really run to be a pair the table serves.
    route(USDC_BASE, BASE, USDC_ARBITRUM, ARBITRUM, { routing: "BRIDGE", ...BRIDGE_RATE });
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [],
        gasByChain: { [ARBITRUM]: verdict(ARBITRUM) },
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const buy = result.plan.steps.find((step) => step.type === "buy");
    expect(buy?.toToken).toBe("ETH");
    expect(buy?.toChainId).toBe(BASE);
  });

  // POO-1542 [B]: the one input the shared predicate MOVES at this boundary. The old expression here
  // (`gasStillBlocked || Base not-OK`) read a merely-TOP_UP target as fine and ordered plain USDC;
  // `onRampRouteBuysGas` reads any not-OK target as "buys gas", so this case now goes ETH-first with
  // a gas component on the order. Deliberate, and the [R4] direction: the surplus stays in the wallet
  // and never strands, so the cost is a few dollars more on the card, never an understated row or an
  // unbroadcastable route. The crypto swap-gas leg for the target's own top-up still rides alongside,
  // the same deliberate double provision as the Base TOP_UP case below.
  it("buys ETH gas-first when Base is OK but the TARGET chain is only TOP_UP", async () => {
    // POO-1916 [R3]: the fiat bridge is QUOTED before the purchase is offered, so an off-Base
    // target needs the leg it will really run to be a pair the table serves.
    route(USDC_BASE, BASE, USDC_ARBITRUM, ARBITRUM, { routing: "BRIDGE", ...BRIDGE_RATE });
    route(WETH_ARBITRUM, ARBITRUM, NATIVE_TOKEN_ADDRESS, ARBITRUM, {
      routing: "CLASSIC",
      ...PARITY,
      gasFeeUSD: "0.01",
    });

    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [],
        gasByChain: {
          [BASE]: verdict(BASE),
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
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const buy = result.plan.steps.find((step) => step.type === "buy");
    expect(buy?.toToken).toBe("ETH");
    expect(buy?.toChainId).toBe(BASE);
    expect(buy?.order?.currencyCode).toBe("ETH-BASE");
  });

  // @rule R1 — a wallet that already has gas on Base buys USDC directly, with no swap.
  it("buys USDC directly when the wallet already has gas on Base", async () => {
    // POO-1916 [R3]: the fiat bridge is QUOTED before the purchase is offered, so an off-Base
    // target needs the leg it will really run to be a pair the table serves.
    route(USDC_BASE, BASE, USDC_ARBITRUM, ARBITRUM, { routing: "BRIDGE", ...BRIDGE_RATE });
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [],
        gasByChain: { [BASE]: verdict(BASE), [ARBITRUM]: verdict(ARBITRUM) },
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stepTypes(result.plan.steps)).toEqual(["buy", "bridge", "op"]);
    const buy = result.plan.steps.find((step) => step.type === "buy");
    expect(buy?.toToken).toBe("USDC");
    expect(buy?.order?.currencyCode).toBe("USDC-BASE");
  });

  // @rule R1 R2 — a Base operation never bridges; a gas-first buy still swaps its op slice to USDC.
  it("stays on Base for a Base operation, no bridge", async () => {
    const result = await buildPlan(
      {
        targetChainId: BASE,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [],
        gasByChain: { [BASE]: blocked(BASE) },
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stepTypes(result.plan.steps)).toEqual(["buy", "swap-token", "op"]);
  });

  // @rule R1 — carry (POO-1133 review): a gas-only fiat top-up buys ETH but has NOTHING to swap, so
  // the ETH->USDC leg is skipped despite `needsSwapToUsdc` mirroring the ETH choice. Emitting it would
  // charge the user gas for a swap of nothing.
  it("skips the ETH->USDC swap for a gas-only top-up (op-funding slice is zero)", async () => {
    const result = await buildPlan(
      {
        targetChainId: BASE,
        requiredAmount: "0",
        requiredUsd: 0,
        sources: [],
        gasByChain: { [BASE]: blocked(BASE) },
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stepTypes(result.plan.steps)).toEqual(["buy", "op"]);
    expect(result.plan.steps.find((step) => step.type === "buy")?.toToken).toBe("ETH");
    expect(result.plan.variant).toBe("gas-only");
    expect(result.plan.reason).toEqual(["gas"]);
  });

  // @rule R6 — the whole order floors at the Paybis $10 minimum, even for a $2 shortfall.
  it("floors the fiat amount at the Paybis minimum for a tiny shortfall", async () => {
    const result = await buildPlan(
      {
        targetChainId: BASE,
        requiredAmount: "2000000",
        requiredUsd: 2,
        sources: [],
        gasByChain: { [BASE]: verdict(BASE) },
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const buy = result.plan.steps.find((step) => step.type === "buy");
    expect(Number(buy?.order?.fiatAmount)).toBeGreaterThanOrEqual(10);
  });

  // The crypto-only cut is unchanged: with the on-ramp off, a shortfall still dead-ends exactly as it
  // did, so shipping this code dark cannot move production behaviour.
  it("still fails with PROVISIONING_INSUFFICIENT_FUNDS when the on-ramp is disabled", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [],
        gasByChain: { [ARBITRUM]: verdict(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("PROVISIONING_INSUFFICIENT_FUNDS");
  });

  it("still fails with PROVISIONING_GAS_BLOCKED when the on-ramp is disabled", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: "0",
        requiredUsd: 0,
        sources: [],
        gasByChain: { [ARBITRUM]: blocked(ARBITRUM) },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("PROVISIONING_GAS_BLOCKED");
  });

  // PR 719 review, BLOCKING. The on-ramp does NOT un-block every chain. The rail delivers ETH or USDC
  // on BASE and nothing else ([R2]), and `planGasBridge` needs a donor holding the SAME native symbol
  // (there is no cross-chain different-token route), so a POL chain can be reached by neither path.
  // Falling the refusal through for it emitted buy-ETH-on-Base -> swap -> bridge-USDC-to-Polygon and
  // handed back a plan whose op transaction can never broadcast: the user pays fiat and the USDC
  // lands where they hold zero native. That is the stranded-halfway plan UF-22 [R3] forbids, so the
  // refusal stands regardless of the flag. Arbitrum and Base (both ETH) are covered above; only
  // Polygon exercises the non-ETH branch, which is why this slipped.
  it("[R3] still refuses a gas-BLOCKED POLYGON target, on-ramp enabled or not", async () => {
    const result = await buildPlan(
      {
        targetChainId: POLYGON,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [],
        gasByChain: { [POLYGON]: blocked(POLYGON) },
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("PROVISIONING_GAS_BLOCKED");
    // The native coin the rail cannot deliver is named, so the refusal is diagnosable from the
    // response alone.
    expect(result.message).toContain("POL");
  });

  // The same refusal on the pure `gasStillBlocked` shape (nothing to fund, only gas missing), which
  // is the emit gate rather than the early return.
  it("[R3] refuses a gas-only POLYGON top-up too, rather than buying gas it cannot deliver", async () => {
    const result = await buildPlan(
      {
        targetChainId: POLYGON,
        requiredAmount: "0",
        requiredUsd: 0,
        sources: [],
        gasByChain: { [POLYGON]: blocked(POLYGON) },
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("PROVISIONING_GAS_BLOCKED");
  });

  // PR 719 review, DECIDED (keep). A Base TOP_UP verdict plans a swap-gas leg AND the buy still goes
  // ETH-first, so Base gas is provisioned twice. That is deliberate: the swap-gas leg is itself a Base
  // transaction, so it cannot fund the purchase's own swap/bridge ORIGIN transactions on Base — those
  // have to be payable before it runs. Buying ETH first is what makes them executable at all. Per [R4]
  // the surplus stays in the wallet and never strands; a few dollars more on the card is the right
  // side to err on against an unbroadcastable route.
  it("[R1] buys ETH first on a Base TOP_UP, keeping the deliberate double gas provision", async () => {
    route(USDC_BASE, BASE, NATIVE_TOKEN_ADDRESS, BASE, {
      routing: "CLASSIC",
      // The inverse of the table's $2,500 ETH: 2,500e6 USDC buys 1e18 wei.
      rateNum: ONE_ETH,
      rateDen: BigInt(2_500) * BigInt(10) ** BigInt(6),
      gasFeeUSD: "0.01",
    });
    /** $50 of USDC on Base against a $100 requirement: the tokens-plus-buy shape. */
    const HALF_USDC_ON_BASE = source({
      address: USDC_BASE,
      chainId: BASE,
      symbol: "USDC",
      decimals: 6,
      amount: "50000000",
      usd: 50,
    });

    const result = await buildPlan(
      {
        targetChainId: BASE,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [HALF_USDC_ON_BASE],
        gasByChain: {
          [BASE]: verdict(BASE, {
            verdict: "TOP_UP",
            shortfallUsd: 10,
            topUp: topUp({
              token: {
                symbol: "USDC",
                address: USDC_BASE,
                decimals: 6,
                balanceRaw: "50000000",
                balanceUsd: 50,
              },
              amountRaw: "10000000",
            }),
          }),
        },
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both provisions are present: the crypto swap-gas leg AND a gas-first fiat buy.
    expect(stepTypes(result.plan.steps)).toEqual(["buy", "swap-token", "swap-gas", "op"]);

    const buy = result.plan.steps.find((step) => step.type === "buy");
    expect(buy?.toToken).toBe("ETH");
    expect(buy?.order?.currencyCode).toBe("ETH-BASE");
    // $10 of the $50 holding went to the swap-gas leg, so $40 funded the operation and $60 is left to
    // buy. The order carries the gas component ON TOP of that, which is the over-buy being accepted.
    expect(Number(buy?.order?.fiatAmount)).toBeGreaterThan(60);
    // Exactly one crypto leg, the Base swap-gas: the fiat steps carry none (POO-1136 sizes them).
    const legs = legsOf(result.plan);
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ kind: "swap-gas", chainId: BASE });
  });
});
// -------------------------------------------------------------------------------------------------
// POO-1916, superseding POO-1779 / POO-1784 for the stable question. The on-ramp sells USDC on Base,
// but the leg that carries a purchase onwards is a BRIDGE and the bridge is NOT same-token-only:
// `USDC(8453) -> USDG(4663)` answers `200`, `routing: "BRIDGE"` (probed live 2026-09-11, re-probed
// 2026-09-12, 10.000000 USDC in for ~9.95 USDG out). So a fiat purchase does reach a Robinhood
// strategy, and the refusal was withholding a route that works.
//
// What replaces the refusal is not a second hardcode ("4663 is fine") but the live question ([R3]):
// the planner quotes the fiat bridge before it offers the purchase, and a pair the bridge will not
// carry degrades into the same `PROVISIONING_INSUFFICIENT_FUNDS` dead end a `404` already produces.
// -------------------------------------------------------------------------------------------------

describe("POO-1916: the fiat on-ramp funds a chain whose stable the BRIDGE can deliver", () => {
  const ROBINHOOD = 4663;
  /** Read from the registry, never retyped: [R2] is "the target stable comes from `ChainMeta`". */
  const USDG = getUsdcAddress(ROBINHOOD) as string;

  const blocked = (chainId: number) =>
    verdict(chainId, {
      verdict: "BLOCKED",
      shortfallUsd: 0.075,
      surplusUsd: 0,
      reasonKey: "provisioning.gasVerdict.noNative",
    });

  /** The leg the live probe confirmed: Base USDC into the target chain's own stable. */
  const fiatBridge = (tokenOut: string, chainOut: number) =>
    route(USDC_BASE, BASE, tokenOut, chainOut, { routing: "BRIDGE", ...BRIDGE_RATE });

  // @rule R1
  it("[R1] plans buy -> bridge -> op for a USDG target the bridge can reach", async () => {
    fiatBridge(USDG, ROBINHOOD);

    const result = await buildPlan(
      {
        targetChainId: ROBINHOOD,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [],
        gasByChain: { [BASE]: verdict(BASE), [ROBINHOOD]: verdict(ROBINHOOD) },
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    // The reversal, in one assertion: this was `PROVISIONING_INSUFFICIENT_FUNDS` before POO-1916.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stepTypes(result.plan.steps)).toEqual(["buy", "bridge", "op"]);
  });

  // @rule R2
  it("[R2] names the TARGET chain's own stable on the bridge step, not a USDC literal", async () => {
    fiatBridge(USDG, ROBINHOOD);

    const result = await buildPlan(
      {
        targetChainId: ROBINHOOD,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [],
        gasByChain: { [BASE]: verdict(BASE), [ROBINHOOD]: verdict(ROBINHOOD) },
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bridge = result.plan.steps.find((step) => step.type === "bridge");
    // The purchase still delivers USDC, because that is what the rail sells. What lands on the far
    // side is the target chain's stable, and the row has to say so or the user reads "USDC" for a
    // token they will never hold.
    expect(result.plan.steps.find((step) => step.type === "buy")?.toToken).toBe("USDC");
    expect(bridge?.fromToken).toBe("USDC");
    expect(bridge?.toToken).toBe("USDG");
    expect(bridge?.toChainId).toBe(ROBINHOOD);
  });

  // @rule R2
  it("[R2] asks the bridge for the registry's USDG address, not for a USDC on 4663", async () => {
    fiatBridge(USDG, ROBINHOOD);

    await buildPlan(
      {
        targetChainId: ROBINHOOD,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [],
        gasByChain: { [BASE]: verdict(BASE), [ROBINHOOD]: verdict(ROBINHOOD) },
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    const probe = quoteCalls().find((call) => call.tokenOutChainId === ROBINHOOD);
    expect(probe).toBeDefined();
    expect(probe?.tokenIn.toLowerCase()).toBe(USDC_BASE.toLowerCase());
    expect(probe?.tokenInChainId).toBe(BASE);
    // Compared against the registry's own value, so a test that pasted the address would not pass
    // against a second literal in the planner.
    expect(probe?.tokenOut.toLowerCase()).toBe(USDG.toLowerCase());
  });

  // @rule R3
  it("[R3] degrades like a 404 when the bridge will not carry the target's stable", async () => {
    // No route registered, so the harness answers `404 ResourceNotFound` exactly as the live API
    // does for a pair it does not serve. The failure mode this pins is the one the issue names:
    // replacing "the target stable must be USDC" with "4663 is fine" and then offering a purchase
    // that dies after the card has already been charged.
    const result = await buildPlan(
      {
        targetChainId: ROBINHOOD,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [],
        gasByChain: { [BASE]: verdict(BASE), [ROBINHOOD]: verdict(ROBINHOOD) },
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The same dead end the crypto-only cut gives, which the panel already renders as "you need
    // <stable> on <chain>": legible, and it never charges a card for an undeliverable token.
    expect(result.code).toBe("PROVISIONING_INSUFFICIENT_FUNDS");
  });

  // @rule R3
  it("[R3] asks the question LIVE rather than answering it from the chain id", async () => {
    // The same chain, the same request, two different answers decided only by what the API serves.
    // A static predicate cannot produce this pair, which is what makes it the test for [R3].
    const request = {
      targetChainId: ROBINHOOD,
      requiredAmount: HUNDRED_USDC,
      requiredUsd: 100,
      sources: [],
      gasByChain: { [BASE]: verdict(BASE), [ROBINHOOD]: verdict(ROBINHOOD) },
      onRampEnabled: true,
    };

    const refused = await buildPlan(request, { nowIso: NOW });
    fiatBridge(USDG, ROBINHOOD);
    const offered = await buildPlan(request, { nowIso: NOW });

    expect(refused.ok).toBe(false);
    expect(offered.ok).toBe(true);
  });

  // @rule R3
  it("[R3] an OUTAGE on the probe is not a routing verdict", async () => {
    // POO-1107's rule, which the new quote has to obey too: a throttled upstream must not tell a
    // funded user their chain cannot be reached. `priceLeg` throws `UpstreamUnavailableError` on a
    // transient code, and the planner surfaces that rather than silently dropping the purchase.
    mocks.quoteSwap.mockResolvedValue({
      ok: false,
      code: "UNISWAP_RATE_LIMITED",
      message: "429 Too Many Requests",
    });

    const result = await buildPlan(
      {
        targetChainId: ROBINHOOD,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [],
        gasByChain: { [BASE]: verdict(BASE), [ROBINHOOD]: verdict(ROBINHOOD) },
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The user is not told they are short. Same verdict POO-1107 already pins for a crypto leg.
    expect(result.code).not.toBe("PROVISIONING_INSUFFICIENT_FUNDS");
    expect(result.code).toBe("PROVISIONING_UPSTREAM_UNAVAILABLE");
  });

  // The launch chains are untouched, and now prove the probe is genuinely asked for them too.
  it("still buys and bridges for a USDC target on the same input shape", async () => {
    fiatBridge(USDC_ARBITRUM, ARBITRUM);

    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [],
        gasByChain: { [BASE]: verdict(BASE), [ARBITRUM]: verdict(ARBITRUM) },
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stepTypes(result.plan.steps)).toEqual(["buy", "bridge", "op"]);
    expect(result.plan.steps.find((step) => step.type === "buy")?.toToken).toBe("USDC");
    expect(result.plan.steps.find((step) => step.type === "bridge")?.toToken).toBe("USDC");
  });

  // @rule R3
  it("[R3] a Base target asks no bridge probe at all, because nothing crosses", async () => {
    const result = await buildPlan(
      {
        targetChainId: BASE,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [],
        gasByChain: { [BASE]: verdict(BASE) },
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stepTypes(result.plan.steps)).toEqual(["buy", "op"]);
    expect(quoteCalls()).toEqual([]);
  });

  // A gas-only purchase buys ETH on Base and never touches a stable at all, so it has no bridge to
  // probe and keeps working for every chain {@link onRampCanUnblockGas} already allows. Refusing it
  // would assemble a legless plan with `needed: false` — a confirm that runs nothing and reports
  // success, which is the silent dead end UF-22 [R3] exists to prevent.
  it("still buys ETH for a gas-only requirement on a USDG chain, with no probe", async () => {
    const result = await buildPlan(
      {
        targetChainId: ROBINHOOD,
        requiredAmount: "0",
        requiredUsd: 0,
        sources: [],
        gasByChain: { [ROBINHOOD]: blocked(ROBINHOOD) },
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stepTypes(result.plan.steps)).toEqual(["buy", "op"]);
    expect(result.plan.steps.find((step) => step.type === "buy")?.toToken).toBe("ETH");
    expect(quoteCalls()).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------------
// POO-1140 (absorbed): the gas headroom raise reaches the bridge-gas ESCAPE leg too, not just the
// swap top-up. It is clamped to the donor's surplus and must never turn a viable donor into a skip.
// -------------------------------------------------------------------------------------------------

describe("POO-1140: the gas raise reaches the bridge-gas escape leg", () => {
  const ETH_ON_BASE = source({
    address: NATIVE_TOKEN_ADDRESS,
    chainId: BASE,
    symbol: "ETH",
    decimals: 18,
    amount: (ONE_ETH / BigInt(100)).toString(), // 0.01 ETH ~= $36 at the table rate
    usd: 36,
  });
  const blocked = (chainId: number) =>
    verdict(chainId, {
      verdict: "BLOCKED",
      shortfallUsd: 0.075,
      surplusUsd: 0,
      reasonKey: "provisioning.gasVerdict.noNative",
    });

  beforeEach(() => {
    route(NATIVE_TOKEN_ADDRESS, BASE, NATIVE_TOKEN_ADDRESS, ARBITRUM, {
      routing: "BRIDGE",
      ...BRIDGE_RATE,
      gasFeeUSD: "0.01",
      estimatedFillTimeMs: 1_000,
    });
    route(USDC_BASE, BASE, USDC_ARBITRUM, ARBITRUM, {
      routing: "BRIDGE",
      ...BRIDGE_RATE,
      gasFeeUSD: "0.01",
      estimatedFillTimeMs: 1_000,
    });
  });

  async function bridgeGasOut(gasChoiceUsd?: number): Promise<bigint> {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [USDC_ON_BASE, ETH_ON_BASE],
        gasByChain: { [BASE]: verdict(BASE), [ARBITRUM]: blocked(ARBITRUM) },
        ...(gasChoiceUsd === undefined ? {} : { gasChoiceUsd }),
      },
      { nowIso: NOW },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("plan failed");
    const gas = legsOf(result.plan).find((leg) => leg.kind === "bridge-gas");
    return BigInt(gas?.amountOutQuoted ?? "0");
  }

  it("a gas choice within the donor's surplus raises the bridge-gas amount", async () => {
    const baseline = await bridgeGasOut();
    const raised = await bridgeGasOut(3);
    expect(raised).toBeGreaterThan(baseline);
  });

  it("an oversized gas choice still yields a plan (falls back to the classifier figure)", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [USDC_ON_BASE, ETH_ON_BASE],
        gasByChain: { [BASE]: verdict(BASE), [ARBITRUM]: blocked(ARBITRUM) },
        gasChoiceUsd: 1_000_000,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stepTypes(result.plan.steps)).toEqual(["bridge-gas", "bridge", "op"]);
  });
});

// -------------------------------------------------------------------------------------------------
// POO-1141 (absorbed): a large gas headroom choice can consume balance the operation needs when the
// gas source is ALSO a funding source. The discretionary raise is bounded so it never starves the op.
// -------------------------------------------------------------------------------------------------

describe("POO-1141: the gas raise cannot starve the operation", () => {
  beforeEach(() => {
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

  const topUpVerdict = verdict(ARBITRUM, {
    verdict: "TOP_UP",
    quotedGasUsd: 0.04,
    requiredGasUsd: 0.075,
    shortfallUsd: 0.065,
    surplusUsd: 0,
    reasonKey: "provisioning.gasVerdict.topUp",
    topUp: topUp({
      token: {
        symbol: "WETH",
        address: WETH_ARBITRUM,
        decimals: 18,
        balanceRaw: ONE_ETH.toString(),
        balanceUsd: 2_500,
      },
      amountRaw: "30000000000000", // ~$0.075 at $2,500/ETH
      amountUsd: 0.075,
      buyNativeUsd: 0.075,
    }),
  });

  it("funds the operation instead of starving it when the gas source also funds the op", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: "2000000000", // $2,000 USDC of a $2,500 holding
        requiredUsd: 2_000,
        sources: [WETH_ON_ARBITRUM],
        gasByChain: { [ARBITRUM]: topUpVerdict },
        // Unbounded, this would swap $2,000 of the holding to gas and leave the op $1,500 short.
        gasChoiceUsd: 2_000,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stepTypes(result.plan.steps)).toEqual(["swap-gas", "swap-token", "op"]);
  });

  it("still honours a headroom choice that fits within the free surplus", async () => {
    // $2,000 op of a $2,500 holding leaves $500 free; $100 of gas fits without starving anything.
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: "2000000000",
        requiredUsd: 2_000,
        sources: [WETH_ON_ARBITRUM],
        gasByChain: { [ARBITRUM]: topUpVerdict },
        gasChoiceUsd: 100,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const gasLeg = legsOf(result.plan).find((leg) => leg.kind === "swap-gas");
    // $100 of WETH at $2,500 = 0.04 ETH = 4e16 wei.
    expect(BigInt(gasLeg?.amountIn ?? "0")).toBe(BigInt("40000000000000000"));
  });
});

describe("POO-1641: the buy amount IS the picker's still-to-go", () => {
  /**
   * What the operation actually receives from the purchase.
   *
   * Identical to what was ordered, which is the whole point of POO-1641. POO-1166 believed we took a
   * 1% cut out of the delivery and sized every order up to survive it; we do not, and never did. The
   * partner-side configuration is already inside the price Paybis quotes, so the delivered crypto
   * arrives whole (Rafael, 2026-08-16).
   */
  function landedUsd(buy: ProvisioningStep | undefined): number {
    return Number(buy?.order?.fiatAmount);
  }

  // @rule R2 — the header's "still to go" is `requiredUsd − what the selection covers`, and the buy
  // funds exactly that remainder. A $100 op on Base holding 17.54 USDC on Base (the on-target asset,
  // earmarked with no bridge) leaves $82.46 to go, so the buy is $82.46. It was $83.30.
  //
  // The buy and "still to go" are now the SAME figure on this path, which is the reconciliation
  // POO-1166 could only state as an inequality.
  it("sizes the buy at the still-to-go remainder, with no fee headroom on top", async () => {
    const onTarget = source({
      address: USDC_BASE,
      chainId: BASE,
      symbol: "USDC",
      decimals: 6,
      amount: "17540000", // 17.54 USDC on the operation's own chain
      usd: 17.54,
    });
    const result = await buildPlan(
      {
        targetChainId: BASE,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [onTarget],
        gasByChain: { [BASE]: verdict(BASE) },
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // On-target USDC is earmarked with no bridge; the buy lands on Base directly, so no leg loses value
    // between the buy and the operation and the reconciliation is exact.
    expect(stepTypes(result.plan.steps)).toEqual(["buy", "op"]);
    const buy = result.plan.steps.find((step) => step.type === "buy");
    // still to go = requiredUsd − committed = 100 − 17.54 = 82.46. The buy IS that.
    expect(buy?.amountUsd).toBe(82.46);
    expect(Number(buy?.order?.fiatAmount)).toBe(82.46);
    // The regression lock for POO-1166's gross-up: $83.30 is a figure nobody receives.
    expect(Number(buy?.order?.fiatAmount)).toBeLessThan(83.3);
    expect(landedUsd(buy)).toBe(82.46);
  });

  // @rule R2 — the guarantee, across remainders: the order is the requirement, to the cent. Every one
  // of these used to carry a percent of headroom for a cut nobody collects.
  it("orders exactly the requirement, whatever the remainder", async () => {
    for (const requiredUsd of [12, 73.9, 100, 250.37]) {
      const result = await buildPlan(
        {
          targetChainId: BASE,
          requiredAmount: `${Math.round(requiredUsd * 1_000_000)}`,
          requiredUsd,
          sources: [],
          gasByChain: { [BASE]: verdict(BASE) },
          onRampEnabled: true,
        },
        { nowIso: NOW },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const buy = result.plan.steps.find((step) => step.type === "buy");
      expect(landedUsd(buy)).toBe(requiredUsd);
    }
  });

  // @rule R4 — the $10 floor is unaffected. It lives INSIDE `sizeOnRampOrder`, downstream of the
  // removed gross-up, so removing an upstream term cannot drop an order below it: a $2 remainder is
  // still ordered at $10, exactly as it was when it arrived here as $2.03.
  it("still floors a tiny remainder at the Paybis minimum", async () => {
    const result = await buildPlan(
      {
        targetChainId: BASE,
        requiredAmount: "2000000",
        requiredUsd: 2,
        sources: [],
        gasByChain: { [BASE]: verdict(BASE) },
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const buy = result.plan.steps.find((step) => step.type === "buy");
    expect(Number(buy?.order?.fiatAmount)).toBe(PAYBIS_MIN_USD);
  });

  /**
   * @rule R4 — the one band where the gross-up was doing the floor's job, and the floor takes it back.
   *
   * A requirement in `(9.90, 10.00]` is the ONLY range where removing an upstream term could
   * conceivably drop an order under the Paybis minimum: it is exactly the range the gross-up used to
   * lift over $10 on its own ($9.95 / 0.99 = $10.05). It cannot, because `sizeOnRampOrder` applies
   * `Math.max(minUsd, …)` to whatever it is handed, so the order lands ON the floor rather than under
   * it. Asserted rather than reasoned about, because "the floor still holds" is the one claim this
   * refactor cannot be allowed to get wrong: an order Paybis rejects is a dead flow, not a cheaper one.
   */
  it("lands ON the Paybis floor, never under it, for a requirement just below $10", async () => {
    const result = await buildPlan(
      {
        targetChainId: BASE,
        requiredAmount: "9950000",
        requiredUsd: 9.95,
        sources: [],
        gasByChain: { [BASE]: verdict(BASE) },
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const buy = result.plan.steps.find((step) => step.type === "buy");
    expect(Number(buy?.order?.fiatAmount)).toBe(PAYBIS_MIN_USD);
    expect(Number(buy?.order?.fiatAmount)).toBeGreaterThanOrEqual(PAYBIS_MIN_USD);
  });

  /**
   * @rule R2 R4 — the gas-first `ETH-BASE` leg carries the change too, on BOTH figures it names.
   *
   * This leg serves the empty first-time wallet, so it is the one that matters most, and it sizes two
   * amounts from the same `requiredUsd`: `fiatAmount` and the received-fixed `ethTarget.fundingUsd`
   * (POO-1573 [R2]). Both were carrying the 1%; both stop. And the ETH floor recipe (`gasFloorEth`)
   * is a separate term that this change does not touch, which is what keeps the leg funding real gas.
   */
  it("drops the fee headroom from the gas-first ETH leg, on both of its figures", async () => {
    // POO-1916 [R3]: the fiat bridge is QUOTED before the purchase is offered, so an off-Base
    // target needs the leg it will really run to be a pair the table serves.
    route(USDC_BASE, BASE, USDC_ARBITRUM, ARBITRUM, { routing: "BRIDGE", ...BRIDGE_RATE });
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [],
        // No Base verdict at all: the wallet holds no Base ETH, so the buy goes ETH-first.
        gasByChain: { [ARBITRUM]: verdict(ARBITRUM, { verdict: "BLOCKED", surplusUsd: 0 }) },
        onRampEnabled: true,
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const buy = result.plan.steps.find((step) => step.type === "buy");
    expect(buy?.order?.currencyCode).toBe("ETH-BASE");
    // $100 required, no classifier gas figure and no gas choice, so the order is the requirement.
    // It was $101.02 on both halves.
    expect(buy?.order?.fiatAmount).toBe("100.00");
    expect(buy?.order?.ethTarget?.fundingUsd).toBe("100.00");
  });
});

/**
 * POO-1779: the plan's target endpoint is the TARGET CHAIN'S stable. On Robinhood Chain that is
 * USDG, and the symbol rides on the leg + step the provisioning rail labels its rows from.
 */
describe("POO-1779: the funding target is the chain's own stable", () => {
  const ROBINHOOD = 4663;
  const USDG = getUsdcAddress(ROBINHOOD) as string;
  const WETH_ROBINHOOD = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";

  // @rule R1
  it("[R1] routes a Robinhood source into USDG, not a USDC that chain does not have", async () => {
    route(WETH_ROBINHOOD, ROBINHOOD, USDG, ROBINHOOD, {
      routing: "CLASSIC",
      // 1 WETH -> 2,500 USDG (6 decimals), the table's standard rate.
      rateNum: BigInt(2_500) * BigInt(10) ** BigInt(6),
      rateDen: ONE_ETH,
    });
    const wethOnRobinhood = source({
      address: WETH_ROBINHOOD,
      chainId: ROBINHOOD,
      symbol: "WETH",
      decimals: 18,
      amount: ONE_ETH.toString(),
      usd: 2_500,
    });

    const result = await buildPlan({
      targetChainId: ROBINHOOD,
      requiredAmount: HUNDRED_USDC,
      requiredUsd: 100,
      sources: [wethOnRobinhood],
      inventory: [wethOnRobinhood],
      gasByChain: { [ROBINHOOD]: verdict(ROBINHOOD) },
      slippagePct: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [leg] = legsOf(result.plan);
    expect(leg?.tokenOut).toMatchObject({ address: USDG, symbol: "USDG", chainId: ROBINHOOD });
    expect(result.plan.steps.find((step) => step.type === "swap-token")?.toToken).toBe("USDG");
  });

  // @rule R2 — an Arbitrum plan still targets USDC.
  it("[R2] keeps USDC as the target endpoint on the launch chains", async () => {
    route(WETH_ARBITRUM, ARBITRUM, USDC_ARBITRUM, ARBITRUM, {
      routing: "CLASSIC",
      rateNum: BigInt(2_500) * BigInt(10) ** BigInt(6),
      rateDen: ONE_ETH,
    });

    const result = await buildPlan({
      targetChainId: ARBITRUM,
      requiredAmount: HUNDRED_USDC,
      requiredUsd: 100,
      sources: [WETH_ON_ARBITRUM],
      inventory: [WETH_ON_ARBITRUM],
      gasByChain: { [ARBITRUM]: verdict(ARBITRUM) },
      slippagePct: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(legsOf(result.plan)[0]?.tokenOut.symbol).toBe("USDC");
  });
});

// -------------------------------------------------------------------------------------------------
// POO-1927 [R3]: the buy step's vendor attribution is DERIVED from the rail, not a literal.
//
// `poweredBy` used to be the string `"paybis"` on every fiat buy leg, including one Privy brokers
// through Stripe or MoonPay, and the type admitted no other answer. The rail now arrives on the
// request exactly as `onRampEnabled` already does (`computePlanAction` threads both).
//
// The last test in this block is the one that answers rejection 10 of the epic's handoff, which
// forbids touching the provisioning engine: it proves the rail changes the ATTRIBUTION and nothing
// else: same steps, same keys, same order, same amounts, same legs.
// -------------------------------------------------------------------------------------------------

describe("POO-1927: the fiat attribution follows the rail [R3]", () => {
  const blockedArb = () =>
    verdict(ARBITRUM, {
      verdict: "BLOCKED",
      shortfallUsd: 0.075,
      surplusUsd: 0,
      reasonKey: "provisioning.gasVerdict.noNative",
    });

  const planOnRail = async (rail?: "paybis" | "privy") => {
    // POO-1916 [R3]: the fiat bridge is QUOTED before the purchase is offered, so this off-Base
    // target needs the leg it will really run to be a pair the table serves. Without the route the
    // probe answers 404, `buildOnRampSteps` returns no steps, and the plan dead-ends in
    // `PROVISIONING_INSUFFICIENT_FUNDS` with no buy step left to attribute at all.
    route(USDC_BASE, BASE, USDC_ARBITRUM, ARBITRUM, { routing: "BRIDGE", ...BRIDGE_RATE });
    return buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: HUNDRED_USDC,
        requiredUsd: 100,
        sources: [],
        gasByChain: { [ARBITRUM]: blockedArb() },
        onRampEnabled: true,
        ...(rail === undefined ? {} : { onRampRail: rail }),
      },
      { nowIso: NOW },
    );
  };

  // @rule R3: the Privy rail is now expressible, which is the whole point. The old type could not
  // say it, so the buy leg could only ever credit a vendor that had nothing to do with the charge.
  it("[R3] credits privy when the request says the rail is privy", async () => {
    const result = await planOnRail("privy");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.steps.find((step) => step.type === "buy")?.poweredBy).toBe("privy");
  });

  // @rule R3: the Paybis rail is unchanged while it lives (POO-1819 keeps it as the 72-hour
  // rollback target), so its attribution must still be exactly what it always was.
  it("[R3] credits paybis when the request says the rail is paybis", async () => {
    const result = await planOnRail("paybis");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.steps.find((step) => step.type === "buy")?.poweredBy).toBe("paybis");
  });

  // @rule R3: back-compat, a caller that has not been taught the rail gets the pre-POO-1927 answer
  // rather than an undefined attribution. The ONE production caller always supplies it, which is
  // pinned in `planActions.test.ts` so this default can never silently become the shipped answer.
  it("[R3] falls back to paybis when the request carries no rail", async () => {
    const result = await planOnRail();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.steps.find((step) => step.type === "buy")?.poweredBy).toBe("paybis");
  });

  // @rule R3: rejection 10 of the epic's handoff says the provisioning engine is NOT touched, and
  // `buildOnRampSteps` / `ProvisioningOrder` get zero behavioural changes. `poweredBy` is a display
  // attribution field, so flipping the rail must move nothing a leg, a size or an order depends on.
  it("[R3] changes the attribution and NOTHING else about the plan", async () => {
    const paybis = await planOnRail("paybis");
    const privy = await planOnRail("privy");

    expect(paybis.ok && privy.ok).toBe(true);
    if (!paybis.ok || !privy.ok) return;

    // Strip the one field under test; everything else must be byte-identical, the sized fiat
    // `order` included.
    const withoutAttribution = (plan: typeof paybis.plan) =>
      plan.steps.map(({ poweredBy: _poweredBy, ...rest }) => rest);

    expect(withoutAttribution(privy.plan)).toEqual(withoutAttribution(paybis.plan));
    expect(stepTypes(privy.plan.steps)).toEqual(stepTypes(paybis.plan.steps));
    expect(legsOf(privy.plan)).toEqual(legsOf(paybis.plan));
    expect(privy.plan.variant).toBe(paybis.plan.variant);
    expect(privy.plan.quote).toEqual(paybis.plan.quote);
  });
});
