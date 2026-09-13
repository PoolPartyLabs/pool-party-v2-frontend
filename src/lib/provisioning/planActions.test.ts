/**
 * @id PP-CORE-LIB-016 (POO-1092, POO-1095)
 * @name computePlanAction assembly tests
 * @implements-rules-version v5 (POO-1095 rules v1) · v4 (POO-1092 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The first direct tests of `computePlanAction`, the server assembly in front of `buildPlan`.
 * `planner.realMode.test.ts` mocks this action out entirely, so the requirement arithmetic it owns
 * (what must LAND on the target chain, in USDC base units) had never been exercised. Two shipped
 * defects lived in exactly that gap:
 *
 *   POO-1092 — target-chain USDC counted TWICE. The action netted the wallet's target-chain USDC out
 *   of the requirement AND `buildPlan` earmarked the same holding with a zero-leg route, so the plan
 *   under-delivered by the held balance and reported `needed: false` on an operation that then
 *   reverted. Fixed by making `buildPlan`'s earmark the SINGLE accounting: the action stops netting
 *   and sends the full requirement.
 *
 *   POO-1095 — the requirement was sized from a CoinGecko-priced float (`source.usd`) while
 *   `buildPlan` prices USDC at parity, and the base-unit figure was FLOORED. After the double-count
 *   fix the float sum is deleted outright, and the parity conversion CEILs so a hard on-chain minimum
 *   is never sized a base unit short after an irreversible bridge.
 *
 * No network and no wallet read. `getSessionWallet` and `buildProvisioningGateContext` are mocked to
 * inject a deterministic inventory + gas verdicts; `buildPlan` is a spy that DELEGATES to the real
 * engine (so a real bridge/swap leg is produced) while recording the request the action built, which
 * is where the requirement arithmetic is asserted. `quoteSwap` answers from a recorded routing table
 * shaped after the live probe (`01_UNISWAP_INTEGRATION.md` §1.1), identical in spirit to
 * `buildPlan.test.ts` — including that BRIDGE routing ignores EXACT_OUTPUT.
 */

import { parseUnits } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import { NATIVE_RESERVE_ETH } from "@/lib/provisioning/nativeReserve";
import type { UniswapQuoteResponse, UniswapRouting } from "@/lib/uniswap/schemas";
import { quoteFixture } from "./fixtures/uniswapQuotes";
import type { GasFeasibility } from "./gasFeasibility";
import type { ProvisioningGateContext } from "./gateContext";
import type { ProvisioningLeg, ProvisioningNeedInput } from "./types";

const mocks = vi.hoisted(() => ({
  quoteSwap: vi.fn(),
  getSessionWallet: vi.fn(),
  buildProvisioningGateContext: vi.fn(),
}));

vi.mock("@/lib/uniswap/actions", () => ({
  quoteSwap: (...args: unknown[]) => mocks.quoteSwap(...args),
}));
vi.mock("@/lib/auth/session", () => ({
  getSessionWallet: (...args: unknown[]) => mocks.getSessionWallet(...args),
}));
vi.mock("./gateContext", () => ({
  buildProvisioningGateContext: (...args: unknown[]) => mocks.buildProvisioningGateContext(...args),
}));
// The engine runs for real (so the plan carries genuine legs), wrapped in a spy that records the
// request the action assembled — the requirement arithmetic under test.
vi.mock("./buildPlan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./buildPlan")>();
  return { ...actual, buildPlan: vi.fn(actual.buildPlan) };
});

import { buildPlan } from "./buildPlan";
import { computePlanAction } from "./planActions";

const buildPlanMock = vi.mocked(buildPlan);

const WALLET = "0x1111111111111111111111111111111111111111" as const;

const ARBITRUM = 42161;
const BASE = 8453;
const POLYGON = 137;

const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const WETH_ARBITRUM = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";

const ONE_ETH = BigInt(10) ** BigInt(18);

// --- recorded routing table (a trimmed copy of buildPlan.test.ts's harness) -----------------------

interface Route {
  routing: UniswapRouting;
  /** `out = in * rateNum / rateDen`, exact BigInt both ways. */
  rateNum: bigint;
  rateDen: bigint;
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

function route(tokenIn: string, inChain: number, tokenOut: string, outChain: number, spec: Route) {
  routes.set(routeKey(tokenIn, inChain, tokenOut, outChain), spec);
}

/** Across takes 0.1% on a USDC bridge leg. */
const BRIDGE_RATE = { rateNum: BigInt(999), rateDen: BigInt(1000) } as const;

function answerQuote(call: QuoteCall) {
  const spec = routes.get(
    routeKey(call.tokenIn, call.tokenInChainId, call.tokenOut, call.tokenOutChainId),
  );
  if (!spec) return { ok: false as const, code: "NOT_FOUND", message: "ResourceNotFound" };

  const requested = BigInt(call.amount);
  // BRIDGE routing IGNORES EXACT_OUTPUT (POO-1074, probed live): it pins the INPUT and lets the
  // output come back short by the fee. CLASSIC honours EXACT_OUTPUT.
  const isBridge = call.tokenInChainId !== call.tokenOutChainId;
  const exactOutput = call.type === "EXACT_OUTPUT" && !isBridge;
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
  });
  return { ok: true as const, quote };
}

// --- fixtures -------------------------------------------------------------------------------------

function source(
  over: Partial<FundingSource> & Pick<FundingSource, "address" | "chainId">,
): FundingSource {
  return {
    symbol: "USDC",
    decimals: 6,
    amount: "0",
    usd: 0,
    reachableChainIds: [ARBITRUM, BASE, POLYGON],
    isNative: false,
    logoUrl: "",
    ...over,
  };
}

function verdict(chainId: number): GasFeasibility {
  return {
    chainId,
    verdict: "OK",
    quotedGasUsd: 0.02,
    requiredGasUsd: 0.075,
    shortfallUsd: 0,
    surplusUsd: 5,
    reasonKey: "provisioning.gasVerdict.ok",
  };
}

function context(
  over: Partial<ProvisioningGateContext> & Pick<ProvisioningGateContext, "sources">,
): ProvisioningGateContext {
  const { sources, gasByChain, ...rest } = over;
  const resolvedGas =
    gasByChain ??
    Object.fromEntries(
      [...new Set([ARBITRUM, BASE, POLYGON, ...sources.map((s) => s.chainId)])].map((id) => [
        id,
        verdict(id),
      ]),
    );
  return {
    targetChainId: ARBITRUM,
    sources,
    nativeHoldings: [],
    gasByChain: resolvedGas,
    balancesByChain: {},
    gasEstimateUsd: 0.075,
    ...rest,
  };
}

function input(over: Partial<ProvisioningNeedInput> = {}): ProvisioningNeedInput {
  return {
    currentChainId: ARBITRUM,
    targetChainId: ARBITRUM,
    opRequiredUsdc: 100,
    gasEstimateUsd: 0.075,
    ...over,
  };
}

const key = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`;

function legsOf(plan: { steps: { leg?: ProvisioningLeg }[] }): ProvisioningLeg[] {
  return plan.steps.flatMap((step) => (step.leg ? [step.leg] : []));
}

/** The request the action handed `buildPlan` on its most recent call. */
function lastRequest() {
  const calls = buildPlanMock.mock.calls;
  return calls[calls.length - 1]?.[0];
}

beforeEach(() => {
  routes.clear();
  mocks.quoteSwap.mockReset();
  mocks.quoteSwap.mockImplementation((call: QuoteCall) => Promise.resolve(answerQuote(call)));
  mocks.getSessionWallet.mockReset();
  mocks.getSessionWallet.mockResolvedValue(WALLET);
  mocks.buildProvisioningGateContext.mockReset();
  // Delegates to the real engine; only its call history is cleared between tests.
  buildPlanMock.mockClear();
});

describe("computePlanAction: target-chain USDC is counted once (POO-1092)", () => {
  // @rule POO-1092 — the exact reproduction. Invest 100 USDC on Arbitrum while holding 80 on
  // Arbitrum, 50 on Base, 30 on Polygon. The 80 already on the target chain covers 80; the 20
  // shortfall MUST be bridged. The buggy code netted the 80 out of the requirement (100 → 20) AND
  // earmarked the same 80 against the remaining 20, zeroing it and returning `needed: false`, so the
  // operation ran with only 80 on chain and reverted.
  it("bridges the shortfall instead of reporting needed: false", async () => {
    route(USDC_BASE, BASE, USDC_ARBITRUM, ARBITRUM, { routing: "BRIDGE", ...BRIDGE_RATE });

    const arb = source({ address: USDC_ARBITRUM, chainId: ARBITRUM, amount: "80000000", usd: 80 });
    const base = source({ address: USDC_BASE, chainId: BASE, amount: "50000000", usd: 50 });
    const pol = source({ address: USDC_POLYGON, chainId: POLYGON, amount: "30000000", usd: 30 });
    mocks.buildProvisioningGateContext.mockResolvedValue(context({ sources: [arb, base, pol] }));

    // Selection order = route order: the target-chain USDC first, then Base for the remainder. The
    // picker forces covering the FULL requirement (its shortfall is 0 since the wallet holds enough
    // in total), and the only way to reach 100 from {80, 50, 30} is to include the on-target 80.
    const result = await computePlanAction(input(), [
      key(ARBITRUM, USDC_ARBITRUM),
      key(BASE, USDC_BASE),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.needed).toBe(true);

    const bridge = legsOf(result.plan).find((leg) => leg.kind === "bridge");
    expect(bridge).toBeDefined();
    expect(bridge?.tokenIn.chainId).toBe(BASE);
    expect(bridge?.tokenOut.chainId).toBe(ARBITRUM);
    // It lands ~20 USDC on Arbitrum: the shortfall, not zero.
    expect(BigInt(bridge?.amountOutQuoted ?? "0")).toBeGreaterThanOrEqual(BigInt("20000000"));

    // The requirement the engine was asked to fund is the FULL 100 USDC, not the netted 20: the held
    // balance is accounted for once, by the earmark inside the engine.
    expect(lastRequest()?.requiredAmount).toBe("100000000");
    expect(lastRequest()?.requiredUsd).toBe(100);
  });

  // @rule POO-1092 — the "unchanged" guard: when the wallet holds NO USDC on the target chain, the
  // requirement was ALREADY the full amount (nothing to net), so this path behaves identically before
  // and after the fix. It locks that the fix did not regress the common cross-chain case.
  it("keeps the full requirement when no USDC sits on the target chain", async () => {
    route(USDC_BASE, BASE, USDC_ARBITRUM, ARBITRUM, { routing: "BRIDGE", ...BRIDGE_RATE });

    const base = source({ address: USDC_BASE, chainId: BASE, amount: "200000000", usd: 200 });
    mocks.buildProvisioningGateContext.mockResolvedValue(context({ sources: [base] }));

    const result = await computePlanAction(input(), [key(BASE, USDC_BASE)]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.needed).toBe(true);
    expect(legsOf(result.plan).some((leg) => leg.kind === "bridge")).toBe(true);
    expect(lastRequest()?.requiredAmount).toBe("100000000");
  });
});

describe("computePlanAction: the requirement is priced at parity, not by CoinGecko (POO-1095)", () => {
  // @rule POO-1095 R1 — the requirement is sized from the operation's USDC need at parity, never from
  // the target-chain USDC holding's CoinGecko-priced `usd`. Two contexts identical except a wildly
  // wrong price on the on-target USDC must produce the SAME requirement and the SAME bridge. The buggy
  // code subtracted `source.usd` from the requirement, so the plan moved with the price.
  it("sizes the requirement independently of the target-USDC price", async () => {
    const run = async (usdcPriceUsd: number) => {
      routes.clear();
      route(USDC_BASE, BASE, USDC_ARBITRUM, ARBITRUM, { routing: "BRIDGE", ...BRIDGE_RATE });
      const arb = source({
        address: USDC_ARBITRUM,
        chainId: ARBITRUM,
        amount: "80000000", // exactly 80 USDC, base units — the parity truth
        usd: usdcPriceUsd, // a lie from the price feed: what the buggy netting trusted
      });
      const base = source({ address: USDC_BASE, chainId: BASE, amount: "500000000", usd: 500 });
      mocks.buildProvisioningGateContext.mockResolvedValue(context({ sources: [arb, base] }));
      buildPlanMock.mockClear();

      const result = await computePlanAction(input(), [
        key(ARBITRUM, USDC_ARBITRUM),
        key(BASE, USDC_BASE),
      ]);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      return {
        requiredAmount: lastRequest()?.requiredAmount,
        bridge: legsOf(result.plan).find((leg) => leg.kind === "bridge"),
      };
    };

    const underPriced = await run(40); // feed says the 80 USDC is worth $40
    const overPriced = await run(120); // feed says the 80 USDC is worth $120

    // Requirement is parity-sized and identical regardless of the reported price.
    expect(underPriced.requiredAmount).toBe("100000000");
    expect(overPriced.requiredAmount).toBe("100000000");
    // And the same ~20 USDC is bridged in both, rather than a plan that moves with the price feed.
    expect(underPriced.bridge?.amountOutQuoted).toBe(overPriced.bridge?.amountOutQuoted);
    expect(BigInt(underPriced.bridge?.amountOutQuoted ?? "0")).toBeGreaterThanOrEqual(
      BigInt("20000000"),
    );
  });

  // @rule POO-1095 R2 — a requirement with sub-micro-dollar precision CEILs to base units, so it is
  // never sized a base unit short. Uses realistic non-round magnitudes (a 0.37418291 WETH holding at
  // $1,187.43) so truncation is actually exercised, unlike the even 1e18/$2500 divisions elsewhere.
  it("ceils a fractional requirement into USDC base units", async () => {
    // 1 WETH = 1,187.43 USDC: 1e18 wei buys 1,187,430,000 USDC base units.
    route(WETH_ARBITRUM, ARBITRUM, USDC_ARBITRUM, ARBITRUM, {
      routing: "CLASSIC",
      rateNum: BigInt(1_187_430_000),
      rateDen: ONE_ETH,
    });

    const weth = source({
      address: WETH_ARBITRUM,
      chainId: ARBITRUM,
      symbol: "WETH",
      decimals: 18,
      amount: "374182910000000000", // 0.37418291 WETH
      usd: 444.36,
    });
    mocks.buildProvisioningGateContext.mockResolvedValue(context({ sources: [weth] }));

    // 100.1234567 USD → 100_123_456.7 base units. CEIL = 100123457; FLOOR (the old bug) = 100123456.
    const result = await computePlanAction(input({ opRequiredUsdc: 100.1234567 }), [
      key(ARBITRUM, WETH_ARBITRUM),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(lastRequest()?.requiredAmount).toBe("100123457");
    expect(lastRequest()?.requiredAmount).not.toBe("100123456");

    // The non-round requirement still routes: a real CLASSIC swap that delivers at least it.
    expect(result.plan.needed).toBe(true);
    const swap = legsOf(result.plan).find((leg) => leg.kind === "swap-token");
    expect(swap).toBeDefined();
    expect(BigInt(swap?.amountOutQuoted ?? "0")).toBeGreaterThanOrEqual(BigInt("100123457"));
  });

  it("[R2] ceils a remainder below half a base unit, where ROUND would still floor", async () => {
    // The test above uses a .7 remainder, which `Math.ceil` and `Math.round` agree on, so it cannot
    // tell a regression to `round` from the correct `ceil`. A remainder BELOW .5 separates them,
    // and `round` there reintroduces exactly the one-base-unit shortfall [R2] forbids.
    const weth = source({
      chainId: ARBITRUM,
      address: WETH_ARBITRUM,
      symbol: "WETH",
      decimals: 18,
      amount: "374182910000000000",
      usd: 444.36,
    });
    mocks.buildProvisioningGateContext.mockResolvedValue(context({ sources: [weth] }));

    // 100.1234561 USD → 100_123_456.1 base units. CEIL = 100123457; ROUND and FLOOR = 100123456.
    const result = await computePlanAction(input({ opRequiredUsdc: 100.1234561 }), [
      key(ARBITRUM, WETH_ARBITRUM),
    ]);

    // Asserts the REQUIREMENT only, deliberately. Whether this particular amount also routes is a
    // property of the recorded quote table, not of [R2], and asserting it would couple this test to
    // a fixture detail that has nothing to do with rounding direction.
    void result;
    expect(lastRequest()?.requiredAmount).toBe("100123457");
    expect(lastRequest()?.requiredAmount).not.toBe("100123456");
  });
});

const NATIVE = "0x0000000000000000000000000000000000000000";

describe("computePlanAction: same-chain reachability + native reserve (POO-1155)", () => {
  // @rule POO-1155 — the server twin of the `reachesChain` root cause. `reachableChainIds` is bridge
  // DESTINATIONS and excludes the source chain, so a USDC holding on the operation's own chain arrives
  // with the target absent. The old membership test dropped it here, and the plan ignored the balance
  // the user was standing on. It must be KEPT and earmarked.
  it("keeps a same-chain holding whose reachable set omits its own chain", async () => {
    const arb = source({
      address: USDC_ARBITRUM,
      chainId: ARBITRUM,
      amount: "100000000",
      usd: 100,
      reachableChainIds: [BASE, POLYGON], // own chain (ARBITRUM) absent, as live on dev
    });
    mocks.buildProvisioningGateContext.mockResolvedValue(context({ sources: [arb] }));

    const result = await computePlanAction(input(), [key(ARBITRUM, USDC_ARBITRUM)]);

    expect(result.ok).toBe(true);
    // The holding reached the engine (not dropped by the reachability pre-filter) and is earmarked
    // with a zero-leg route, so the operation is fully funded from the chain it runs on.
    expect(lastRequest()?.sources.map((s) => s.address)).toContain(USDC_ARBITRUM);
  });

  // @rule POO-1155 — a selected native coin commits only the EXCESS above the signing reserve. The
  // amount handed to the engine is `balance - floor`, so the funding swap can never drain the gas the
  // wallet still needs to sign ("you cannot spend the gas you sign with").
  it("hands the engine a native holding capped at balance minus the signing floor", async () => {
    const floorWei = parseUnits(NATIVE_RESERVE_ETH.toFixed(18), 18);
    const balanceWei = floorWei * BigInt(6); // well above the floor
    const eth = source({
      address: NATIVE,
      chainId: ARBITRUM,
      symbol: "ETH",
      decimals: 18,
      isNative: true,
      amount: balanceWei.toString(),
      usd: 20,
      reachableChainIds: [], // same-chain native: bridge list empty, still kept
    });
    mocks.buildProvisioningGateContext.mockResolvedValue(context({ sources: [eth] }));

    await computePlanAction(input(), [key(ARBITRUM, NATIVE)]);

    const nativeSource = lastRequest()?.sources.find((s) => s.isNative);
    expect(nativeSource).toBeDefined();
    expect(BigInt(nativeSource?.amount ?? "0")).toBe(balanceWei - floorWei);
  });

  // @rule POO-1155 — the clone's USD must shrink IN STEP with its amount. `buildPlan.amountUsd` prices
  // a spend off the source's own `usd / amount` ratio, so a clone that kept the FULL balance's `usd`
  // beside a capped `amount` would price the reserved native above its worth per wei, and every
  // downstream figure (the leg's USD, `totalPayUsd`, the confirm card) would inherit the inflation.
  it("scales the reserved native's usd in proportion to the capped amount", async () => {
    const floorWei = parseUnits(NATIVE_RESERVE_ETH.toFixed(18), 18);
    const balanceWei = floorWei * BigInt(4); // 4x the floor: exactly 3/4 stays spendable
    const fullUsd = 20;
    const eth = source({
      address: NATIVE,
      chainId: ARBITRUM,
      symbol: "ETH",
      decimals: 18,
      isNative: true,
      amount: balanceWei.toString(),
      usd: fullUsd,
      reachableChainIds: [],
    });
    mocks.buildProvisioningGateContext.mockResolvedValue(context({ sources: [eth] }));

    await computePlanAction(input(), [key(ARBITRUM, NATIVE)]);

    const nativeSource = lastRequest()?.sources.find((s) => s.isNative);
    // 3/4 of the balance is spendable, so 3/4 of the value is: $15, not the full $20.
    expect(nativeSource?.usd).toBeCloseTo(fullUsd * 0.75, 6);
    expect(nativeSource?.usd).toBeLessThan(fullUsd);
    // The two move together: the per-wei price the engine reads is unchanged by the reserve.
    const perWeiBefore = fullUsd / Number(balanceWei);
    const perWeiAfter = (nativeSource?.usd ?? 0) / Number(BigInt(nativeSource?.amount ?? "1"));
    expect(perWeiAfter).toBeCloseTo(perWeiBefore, 20);
  });

  it("zeroes the reserved native's usd when the whole balance is the signing reserve", async () => {
    const floorWei = parseUnits(NATIVE_RESERVE_ETH.toFixed(18), 18);
    const eth = source({
      address: NATIVE,
      chainId: ARBITRUM,
      symbol: "ETH",
      decimals: 18,
      isNative: true,
      amount: floorWei.toString(), // exactly at the floor: nothing is spendable
      usd: 5,
      reachableChainIds: [],
    });
    mocks.buildProvisioningGateContext.mockResolvedValue(context({ sources: [eth] }));

    await computePlanAction(input(), [key(ARBITRUM, NATIVE)]);

    const nativeSource = lastRequest()?.sources.find((s) => s.isNative);
    // A zero spend must be worth zero, not $5. Matches `belowGasFloor`/`committedUsd`, which both
    // treat an at-floor native as contributing nothing.
    expect(nativeSource?.amount).toBe("0");
    expect(nativeSource?.usd).toBe(0);
  });

  it("leaves a non-native holding's amount and usd untouched", async () => {
    const arb = source({
      address: USDC_ARBITRUM,
      chainId: ARBITRUM,
      amount: "80000000",
      usd: 80,
    });
    mocks.buildProvisioningGateContext.mockResolvedValue(context({ sources: [arb] }));

    await computePlanAction(input(), [key(ARBITRUM, USDC_ARBITRUM)]);

    const picked = lastRequest()?.sources.find((s) => s.address === USDC_ARBITRUM);
    expect(picked?.amount).toBe("80000000");
    expect(picked?.usd).toBe(80);
  });
});

describe("computePlanAction: threads the fiatOnRamp flag as onRampEnabled (POO-1135)", () => {
  // A USDC holding ON the target chain, so the plan resolves with no leg and no route table is needed;
  // the flag threading is captured on the request `buildPlan` receives regardless of the plan outcome.
  beforeEach(() => {
    mocks.buildProvisioningGateContext.mockResolvedValue(
      context({
        sources: [
          source({ address: USDC_ARBITRUM, chainId: ARBITRUM, amount: "200000000", usd: 200 }),
        ],
      }),
    );
  });

  it("passes onRampEnabled=false when the flag is off (the crypto-only default)", async () => {
    await computePlanAction(input(), [key(ARBITRUM, USDC_ARBITRUM)]);
    expect(lastRequest()?.onRampEnabled).toBe(false);
  });

  it("passes onRampEnabled=true when the fiatOnRamp flag is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP", "on");
    try {
      await computePlanAction(input(), [key(ARBITRUM, USDC_ARBITRUM)]);
      expect(lastRequest()?.onRampEnabled).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // POO-1927 [R3]: the RAIL is threaded on the same request, from the same flags, so the buy step's
  // attribution is derived rather than the literal `"paybis"` it used to be. These three cases are
  // what keep `buildOnRampSteps`'s back-compat default unreachable in production: the one caller
  // that builds a real plan always states the rail.
  it("[R3] passes onRampRail=paybis when only fiatOnRamp is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP", "on");
    try {
      await computePlanAction(input(), [key(ARBITRUM, USDC_ARBITRUM)]);
      expect(lastRequest()?.onRampRail).toBe("paybis");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("[R3] passes onRampRail=privy when privyOnRamp is on too", async () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP", "on");
    vi.stubEnv("NEXT_PUBLIC_FEATURE_PRIVY_ON_RAMP", "on");
    try {
      await computePlanAction(input(), [key(ARBITRUM, USDC_ARBITRUM)]);
      expect(lastRequest()?.onRampRail).toBe("privy");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // `decideOnRampRail` returns `"none"` precisely when `fiatOnRamp` is off, which is the same
  // condition that makes `onRampEnabled` false and emits no buy step at all. So the field is simply
  // absent rather than naming a rail for a purchase that cannot happen.
  it("[R3] omits onRampRail entirely when fiat is not offered", async () => {
    await computePlanAction(input(), [key(ARBITRUM, USDC_ARBITRUM)]);
    expect(lastRequest()?.onRampEnabled).toBe(false);
    expect(lastRequest()?.onRampRail).toBeUndefined();
  });
});

describe("computePlanAction: unselected money is never spent (POO-1166)", () => {
  // @rule POO-1166 — the reported wallet, the same-chain-only selection. Investing $100 on Arbitrum
  // while holding 17.54 USDC there and 8.56 USDC on Base, the user selects ONLY the on-target USDC.
  // The Base holding they did NOT select must not be bridged in: `picked` is built from `selection`,
  // so an unselected source cannot become a "Move to Arbitrum" step. The remainder is the on-ramp's.
  it("does not bridge the unselected Base USDC when only the on-target USDC is picked", async () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FIAT_ON_RAMP", "on");
    try {
      const arb = source({
        address: USDC_ARBITRUM,
        chainId: ARBITRUM,
        amount: "17540000",
        usd: 17.54,
      });
      const base = source({ address: USDC_BASE, chainId: BASE, amount: "8560000", usd: 8.56 });
      mocks.buildProvisioningGateContext.mockResolvedValue(context({ sources: [arb, base] }));
      // POO-1916 [R3]: the remainder rides a fiat bridge the planner now QUOTES before offering it.
      route(USDC_BASE, BASE, USDC_ARBITRUM, ARBITRUM, { routing: "BRIDGE", ...BRIDGE_RATE });

      const result = await computePlanAction(input(), [key(ARBITRUM, USDC_ARBITRUM)]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // No crypto leg touches the Base holding: the unselected 8.56 produces no bridge and no swap.
      expect(legsOf(result.plan).some((leg) => leg.kind === "bridge")).toBe(false);
      expect(legsOf(result.plan).some((leg) => leg.tokenIn.chainId === BASE)).toBe(false);
      // Only the on-target USDC reached the engine; the unselected Base source was never sent.
      const sent = lastRequest()?.sources.map((s) => s.address.toLowerCase()) ?? [];
      expect(sent).toContain(USDC_ARBITRUM.toLowerCase());
      expect(sent).not.toContain(USDC_BASE.toLowerCase());
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
