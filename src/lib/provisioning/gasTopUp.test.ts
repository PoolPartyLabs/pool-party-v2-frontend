/**
 * @id PP-CORE-MOD-010 (POO-1044)
 * @name gas top-up via swap-to-native — tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * A wallet holding tokens but zero native coin cannot transact at all. This suite locks the branch
 * that fixes it: one `swap-gas` leg converts a slice of a held token into the chain's native coin,
 * and the operation then proceeds.
 *
 * Rules under test (POO-1044 rules v1):
 *   [R1] a gas-only shortfall with a swappable token on that chain produces exactly ONE `swap-gas`
 *        leg, then the operation
 *   [R2] the swap is sized to the gas requirement PLUS headroom, and is a SLICE, never the holding
 *   [R3] exactly-zero native is BLOCKED: no same-chain gas swap is ever planned from it, and the
 *        plan fails with a typed, actionable code rather than presenting an impossible route
 *   [R4] it applies to all six operations, not just invest
 *
 * The classifier is used FOR REAL here rather than stubbed. `buildPlan`'s own suite hand-builds
 * verdicts to isolate the planner; this one asserts the whole gas chain end to end, because the
 * headroom [R2] lives in the classifier and the leg that spends it lives in the planner, and a test
 * that stubs the join cannot see the two disagree.
 *
 * No network: `quoteSwap` answers from a routing table of recorded quote shapes, the same offline
 * harness `buildPlan.test.ts` uses.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import type { UniswapQuoteResponse, UniswapRouting } from "@/lib/uniswap/schemas";
import { quoteFixture } from "./fixtures/uniswapQuotes";
import type { GasCandidateChain, GasFeasibility } from "./gasFeasibility";
import { classifyGasFeasibility, withGasHeadroom } from "./gasFeasibility";
import type { ProvisioningGateContext } from "./gateContext";
import type { ProvisioningLeg, ProvisioningStepType } from "./types";
import { NATIVE_TOKEN_ADDRESS } from "./types";

const mocks = vi.hoisted(() => ({ quoteSwap: vi.fn() }));
vi.mock("@/lib/uniswap/actions", () => ({
  quoteSwap: (...args: unknown[]) => mocks.quoteSwap(...args),
}));

import { computeProvisioningNeed } from "./computeNeed";

const { buildPlan } = await import("./buildPlan");
const { PROVISIONING_OPS, realProvisioningInput } = await import(
  "@/features/strategies/lib/buildProvisioningInput"
);

const ARBITRUM = 42161;
const POLYGON = 137;

const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const WETH_ARBITRUM = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const WETH_POLYGON = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";

const NOW = "2026-07-25T12:00:00.000Z";
const ONE_ETH = BigInt(10) ** BigInt(18);

// --- the offline routing table -------------------------------------------------------------------

interface Route {
  routing: UniswapRouting;
  /** `out = in * rateNum / rateDen`, exact BigInt in both directions. */
  rateNum: bigint;
  rateDen: bigint;
  gasFeeUSD?: string;
}

interface QuoteCall {
  tokenIn: string;
  tokenOut: string;
  tokenInChainId: number;
  tokenOutChainId: number;
  amount: string;
  type?: "EXACT_INPUT" | "EXACT_OUTPUT";
}

const routes = new Map<string, Route>();

function routeKey(tokenIn: string, inChain: number, tokenOut: string, outChain: number): string {
  return `${tokenIn.toLowerCase()}@${inChain}>${tokenOut.toLowerCase()}@${outChain}`;
}

function route(
  tokenIn: string,
  inChain: number,
  tokenOut: string,
  outChain: number,
  spec: Route,
): void {
  routes.set(routeKey(tokenIn, inChain, tokenOut, outChain), spec);
}

/** WETH → the chain's native coin is 1:1, which is what unwrapping is. */
const PARITY: Pick<Route, "rateNum" | "rateDen"> = { rateNum: BigInt(1), rateDen: BigInt(1) };
/** ETH → USDC at $2,500: 1e18 wei buys 2,500e6 USDC. */
const ETH_TO_USDC: Pick<Route, "rateNum" | "rateDen"> = {
  rateNum: BigInt(2_500) * BigInt(10) ** BigInt(6),
  rateDen: ONE_ETH,
};

function answerQuote(call: QuoteCall) {
  const spec = routes.get(
    routeKey(call.tokenIn, call.tokenInChainId, call.tokenOut, call.tokenOutChainId),
  );
  if (!spec) return { ok: false as const, code: "NOT_FOUND", message: "ResourceNotFound" };

  const requested = BigInt(call.amount);
  const exactOutput = call.type === "EXACT_OUTPUT";
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
  });
  return { ok: true as const, quote };
}

// --- the wallet under test -----------------------------------------------------------------------

/** 1 WETH on Arbitrum, worth $2,500. The gas source in every case below. */
const WETH_ON_ARBITRUM: FundingSource = {
  address: WETH_ARBITRUM,
  chainId: ARBITRUM,
  symbol: "WETH",
  decimals: 18,
  amount: ONE_ETH.toString(),
  usd: 2_500,
  reachableChainIds: [ARBITRUM, POLYGON],
  isNative: false,
  logoUrl: "",
};

/** $500 of USDC on the operation's chain, so an invest of $100 needs no funding leg at all. */
const USDC_ON_ARBITRUM: FundingSource = {
  address: USDC_ARBITRUM,
  chainId: ARBITRUM,
  symbol: "USDC",
  decimals: 6,
  amount: "500000000",
  usd: 500,
  reachableChainIds: [ARBITRUM, POLYGON],
  isNative: false,
  logoUrl: "",
};

/** What one chain's transactions cost, per the gate's live probe. Two cents on an L2. */
const QUOTED_GAS_USD = 0.02;

/**
 * The classifier's verdict for the operation's chain, run for real over `nativeUsd`.
 *
 * `swapUsd` is the operation's own transaction and `topUpSwapUsd` is the gas swap's, exactly as
 * `gateContext.quoteChainGas` fills them from one probe.
 */
function classifyTarget(nativeUsd: number, sources: readonly FundingSource[] = [WETH_ON_ARBITRUM]) {
  const candidate: GasCandidateChain = {
    chainId: ARBITRUM,
    nativeBalanceUsd: nativeUsd,
    gas: { swapUsd: QUOTED_GAS_USD, topUpSwapUsd: QUOTED_GAS_USD },
    sources: sources
      .filter((source) => source.chainId === ARBITRUM && !source.isNative)
      .map((source) => ({
        symbol: source.symbol,
        address: source.address,
        decimals: source.decimals,
        balanceRaw: source.amount,
        balanceUsd: source.usd,
      })),
  };
  const [verdict] = classifyGasFeasibility([candidate]);
  if (!verdict) throw new Error("the classifier returned no verdict");
  return verdict;
}

/** The gate context the six op modals would receive for this wallet. */
function gateContext(verdict: GasFeasibility, nativeUsd: number): ProvisioningGateContext {
  return {
    targetChainId: ARBITRUM,
    sources: [WETH_ON_ARBITRUM, USDC_ON_ARBITRUM],
    gasByChain: { [ARBITRUM]: verdict },
    balancesByChain: { [ARBITRUM]: { nativeUsd, tokenUsd: 3_000 } },
    gasEstimateUsd: verdict.requiredGasUsd,
  };
}

function stepTypes(steps: { type: ProvisioningStepType }[]): ProvisioningStepType[] {
  return steps.map((step) => step.type);
}

function legsOf(plan: { steps: { leg?: ProvisioningLeg }[] }): ProvisioningLeg[] {
  return plan.steps.flatMap((step) => (step.leg ? [step.leg] : []));
}

function quoteCalls(): QuoteCall[] {
  return mocks.quoteSwap.mock.calls.map((call) => call[0] as QuoteCall);
}

beforeEach(() => {
  routes.clear();
  route(WETH_ARBITRUM, ARBITRUM, NATIVE_TOKEN_ADDRESS, ARBITRUM, {
    routing: "CLASSIC",
    ...PARITY,
    gasFeeUSD: String(QUOTED_GAS_USD),
  });
  route(WETH_ARBITRUM, ARBITRUM, USDC_ARBITRUM, ARBITRUM, {
    routing: "CLASSIC",
    ...ETH_TO_USDC,
    gasFeeUSD: String(QUOTED_GAS_USD),
  });
  mocks.quoteSwap.mockReset();
  mocks.quoteSwap.mockImplementation((call: QuoteCall) => Promise.resolve(answerQuote(call)));
});

// --------------------------------------------------------------------------------------------------

describe("[R1] [R4] the gas-only branch, for every operation", () => {
  // Every operation is a transaction on the strategy's chain, so every one of them can be stopped by
  // gas alone. Five spend no USDC at all; invest spends some, and here already holds it on the
  // operation's chain, so for all six the ONLY thing missing is the native coin.
  it.each(
    PROVISIONING_OPS,
  )("routes %s to gas-only when the native coin is the only thing missing", (op) => {
    const nativeUsd = 0.01;
    const context = gateContext(classifyTarget(nativeUsd), nativeUsd);

    const need = computeProvisioningNeed(realProvisioningInput(op, { context, amount: 100 }));

    expect(need.needed).toBe(true);
    expect(need.needsGas).toBe(true);
    expect(need.needsUsdc).toBe(false);
    expect(need.needsBridge).toBe(false);
    expect(need.variant).toBe("gas-only");
  });

  // The requirement is zero for all six: the five non-spending operations ask the wallet for no
  // USDC, and invest's USDC is already sitting on the operation's own chain, so nothing has to be
  // routed there. Which leaves exactly one leg to plan, the gas swap.
  it("plans exactly one swap-gas leg, then the operation", async () => {
    const nativeUsd = 0.01;
    const verdict = classifyTarget(nativeUsd);

    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: "0",
        requiredUsd: 0,
        sources: [],
        gasByChain: { [ARBITRUM]: verdict },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stepTypes(result.plan.steps)).toEqual(["swap-gas", "op"]);
    expect(result.plan.variant).toBe("gas-only");
    expect(result.plan.reason).toEqual(["gas"]);

    const [leg] = legsOf(result.plan);
    expect(leg).toMatchObject({
      kind: "swap-gas",
      chainId: ARBITRUM,
      requoteAtExecution: false,
    });
    // The native coin is the ZERO address, never WETH: a WETH output cannot pay for gas, and the
    // 0xEeee sentinel is a 404 on this API. Verified live, `01_UNISWAP_INTEGRATION.md`.
    expect(leg?.tokenOut.address).toBe(NATIVE_TOKEN_ADDRESS);
  });

  // A funding source the user picked must not silently become the gas source, and vice versa: the
  // gas leg is emitted from the classifier's own pick, before anything spends from that chain.
  it("emits the gas leg first, ahead of the funding leg it pays for", async () => {
    const nativeUsd = 0.01;
    const verdict = classifyTarget(nativeUsd);

    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: "100000000",
        requiredUsd: 100,
        sources: [WETH_ON_ARBITRUM],
        gasByChain: { [ARBITRUM]: verdict },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stepTypes(result.plan.steps)).toEqual(["swap-gas", "swap-token", "op"]);
  });
});

describe("[R2] the swap is sized to the requirement plus headroom, and is a slice", () => {
  it("carries headroom over the bare gap, so the wallet does not land at zero", () => {
    const nativeUsd = 0.01;
    const verdict = classifyTarget(nativeUsd);

    expect(verdict.verdict).toBe("TOP_UP");
    // A TOP_UP chain runs one MORE transaction than an OK one, so the requirement is the operation's
    // gas plus the gas swap's own, and only then the headroom.
    expect(verdict.quotedGasUsd).toBe(QUOTED_GAS_USD * 2);
    expect(verdict.requiredGasUsd).toBe(withGasHeadroom(QUOTED_GAS_USD * 2));
    // Strictly more than the unbuffered gap. This is the whole rule: a swap sized to the bare
    // shortfall lands the wallet at exactly zero native and strands it one step later.
    expect(verdict.topUp?.buyNativeUsd).toBeGreaterThan(QUOTED_GAS_USD * 2 - nativeUsd);
    expect(verdict.topUp?.buyNativeUsd).toBe(verdict.requiredGasUsd - nativeUsd);
  });

  it("spends a slice of the holding, never the holding", async () => {
    const nativeUsd = 0.01;
    const verdict = classifyTarget(nativeUsd);

    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: "0",
        requiredUsd: 0,
        sources: [],
        gasByChain: { [ARBITRUM]: verdict },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [leg] = legsOf(result.plan);
    const spent = BigInt(leg?.amountIn ?? "0");

    expect(spent).toBe(BigInt(verdict.topUp?.amountRaw ?? "0"));
    expect(spent).toBeGreaterThan(BigInt(0));
    // $0.08 of a $2,500 holding. A thousandth of it would still be twenty times too much.
    expect(spent * BigInt(1_000)).toBeLessThan(BigInt(WETH_ON_ARBITRUM.amount));
  });
});

describe("[R3] exactly-zero native is BLOCKED, and no impossible plan is presented", () => {
  it("classifies a wallet with no native coin as BLOCKED, however much token it holds", () => {
    const verdict = classifyTarget(0);

    expect(verdict.verdict).toBe("BLOCKED");
    expect(verdict.topUp).toBeUndefined();
    // [R3]'s two escapes: move a little native in from another network, or buy crypto.
    expect(verdict.escapes?.map((option) => option.kind)).toEqual(["bridge-native", "buy-crypto"]);
  });

  it("never plans a same-chain gas swap for a zero-native operation chain", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: "0",
        requiredUsd: 0,
        sources: [],
        gasByChain: { [ARBITRUM]: classifyTarget(0) },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("PROVISIONING_GAS_BLOCKED");
    // Not one upstream call: a blocked chain cannot originate anything, so there is nothing to price.
    expect(mocks.quoteSwap).not.toHaveBeenCalled();
  });

  it("fails the plan rather than returning a no-op the operation would run into", async () => {
    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: "100000000",
        requiredUsd: 100,
        sources: [USDC_ON_ARBITRUM],
        gasByChain: { [ARBITRUM]: classifyTarget(0) },
      },
      { nowIso: NOW },
    );

    // Funding the operation is beside the point: with no native coin the operation's OWN
    // transaction cannot be broadcast, so a plan that "succeeds" here strands the user's money on
    // the last step. The typed code is what the panel turns into actionable copy.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("PROVISIONING_GAS_BLOCKED");
  });

  it("never sources gas from a zero-native funding chain", async () => {
    route(WETH_POLYGON, POLYGON, NATIVE_TOKEN_ADDRESS, POLYGON, {
      routing: "CLASSIC",
      ...PARITY,
      gasFeeUSD: String(QUOTED_GAS_USD),
    });
    const blockedPolygon: GasFeasibility = {
      chainId: POLYGON,
      verdict: "BLOCKED",
      quotedGasUsd: QUOTED_GAS_USD,
      requiredGasUsd: withGasHeadroom(QUOTED_GAS_USD),
      shortfallUsd: withGasHeadroom(QUOTED_GAS_USD),
      surplusUsd: 0,
      reasonKey: "provisioning.gasVerdict.noNative",
    };

    const result = await buildPlan(
      {
        targetChainId: ARBITRUM,
        requiredAmount: "0",
        requiredUsd: 0,
        sources: [{ ...WETH_ON_ARBITRUM, address: WETH_POLYGON, chainId: POLYGON }],
        gasByChain: { [POLYGON]: blockedPolygon, [ARBITRUM]: classifyTarget(5) },
      },
      { nowIso: NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(legsOf(result.plan).some((leg) => leg.kind === "swap-gas")).toBe(false);
    expect(quoteCalls().some((call) => call.tokenInChainId === POLYGON)).toBe(false);
  });
});
