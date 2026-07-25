/**
 * @id PP-CORE-LIB-055 (POO-1034, POO-1044)
 * @name buildPlan (real provisioning planner)
 * @implements-rules-version v2 (POO-1044 rules v1) · v1 (POO-1034 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The engine. It turns "this operation needs N USDC on chain X, and the wallet holds these things
 * in this order" into an ordered list of legs that a wallet can actually execute.
 *
 * ## The one fact that shapes everything
 *
 * A live probe of the Trading API (`docs/_hackathon/01_UNISWAP_INTEGRATION.md` §1.1) established
 * three route shapes and one boundary:
 *
 *   same chain, different token   → `routing: "CLASSIC"`, one transaction
 *   different chain, same token   → `routing: "BRIDGE"`, one transaction, Across-backed
 *   different chain, DIFFERENT token → **`404 ResourceNotFound`. Not routable in one call.**
 *
 * That last row is the flagship demo case (WETH on Polygon funding a USDC strategy on Arbitrum), so
 * the planner's core job is to never ask that question. It decomposes: swap to the source chain's
 * USDC first, then bridge USDC to the target chain ([R1]). The intermediary is always USDC because
 * every supported chain has it and it is the bridge asset, so the bridge leg is always same-token
 * and therefore always routable. `routing: "CHAINED"` (`POST /plan`) is never returned to us and is
 * not used; see `02_BRIDGE_ARCHITECTURE.md` §1.5.
 *
 * ## Sizing runs backwards, execution runs forwards
 *
 * The requirement is "land exactly this much on the target chain", so each route is sized backwards
 * from its destination with `EXACT_OUTPUT` quotes: the bridge leg says how much USDC must leave the
 * source chain, and the swap leg says how much of the held token buys that. This is the request
 * shape POO-1028 [R4] wrongly forbade; [R6] removed that guard on live evidence.
 *
 * When a source cannot cover the whole requirement, the backward question has no answer within its
 * balance, so we ask the forward one instead: spend the entire holding with `EXACT_INPUT` and take
 * what it delivers. Partial coverage is normal, and the next selected source continues from there.
 *
 * **The figures here are for PRICING, not for execution** ([R8]). A quote for leg 2 taken before
 * leg 1 executes is a guess: the realized output differs from the quoted one, and the quote expires
 * long before a bridge settles. Every leg fed by a previous leg is flagged
 * {@link ProvisioningLeg.requoteAtExecution}, and the rail (POO-1036) re-quotes it from the balance
 * that actually arrived. That is also what makes a plan a pure function of current holdings, which
 * is the backbone of recovery (`02_BRIDGE_ARCHITECTURE.md` §3.1).
 *
 * ## Money convention
 *
 * Token amounts are base-unit decimal STRINGS and every amount comparison is BigInt ([R8] sizing
 * included). USD figures are display-grade numbers, and they are only ever derived FROM the exact
 * amounts, never used to compute one.
 *
 * ## Boundaries
 *
 * Server-only ([R9]): it calls the Uniswap server-action layer, whose transport reads
 * `UNISWAP_API_KEY` (ADR 0003). A client surface reaches a plan through `computePlan` →
 * `computePlanAction`, never through this module.
 *
 * Approvals are NOT planned here. An ERC-20 allowance is a property of the chain at the moment of
 * execution, not of the route, and `/check_approval` has to be asked with the amount the leg really
 * spends, which is only known once the previous leg settled. The rail inserts the approval (and the
 * bridge-spender allowance `/check_approval` does not report, §1.2) as a skippable step. Planning
 * one here would either be stale or duplicate work.
 */
import "server-only";

import { formatUnits } from "viem";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import { apiNetworkForChain, getUsdcAddress, nativeSymbol } from "@/lib/chains/config";
// PP-INTEGRATION-POINT: every leg is priced by the live Uniswap Trading API through the server
// action layer (PP-CORE-LIB-052). `POST /quote` is the only upstream call the planner makes.
import { quoteSwap } from "@/lib/uniswap/actions";
import type { UniswapQuoteResponse } from "@/lib/uniswap/schemas";
import { buildCostBreakdown } from "./costBreakdown";
import type { GasFeasibility } from "./gasFeasibility";
import { quoteGasUsd } from "./gasFeasibility";
import type {
  ProvisioningLeg,
  ProvisioningLegKind,
  ProvisioningLegToken,
  ProvisioningPlan,
  ProvisioningQuote,
  ProvisioningReason,
  ProvisioningStep,
} from "./types";
import { NATIVE_TOKEN_ADDRESS } from "./types";

/**
 * How the Trading API addresses a chain's native coin, and the convention the funding inventory
 * already uses for it (`FundingSource.address`).
 *
 * Moved onto the contract (`./types`) by POO-1036 and re-exported here, because the execution rail
 * needs the same comparison from the CLIENT side (a native leg has no ERC-20 allowance to grant) and
 * this module is `server-only`.
 *
 * VERIFIED LIVE (2026-07-25, all three chains). The zero address is correct and the vendored Uniswap
 * skill's WETH convention would be silently WRONG here:
 *
 *   tokenOut = 0x0000...0000  -> 200, output.token = 0x0000...  (native ETH / POL: PAYS GAS)
 *   tokenOut = WETH / WPOL    -> 200, output.token = the wrapped token (CANNOT pay gas)
 *
 * Both return 200 with an identical output AMOUNT, so this is not a loud failure: following the
 * skill would have produced a gas top-up that leaves the wallet exactly as unable to transact as
 * before, with nothing in the response to say so. That is why the constant is pinned here rather
 * than taken from the skill.
 */
export { NATIVE_TOKEN_ADDRESS } from "./types";

/**
 * How long a plan's pricing is good for ([R7]).
 *
 * The API publishes no TTL field, so this is its documented expiry: the vendored skill says quotes
 * "expire quickly (typically 30 seconds)" and its flow reference says ~60. We take the SHORTER of
 * the two, because the cost of re-quoting early is a request and the cost of re-quoting late is a
 * `/swap` that returns empty calldata after the user pressed confirm. It replaces the mock planner's
 * invented 60 s, and it is only a ceiling: {@link permitDeadlineMs} tightens it whenever a quote
 * carries a Permit2 deadline that expires sooner.
 */
export const UNISWAP_QUOTE_TTL_MS = 30_000;

/**
 * Investor default Max slippage, percent (POO-523). Kept in sync with `DEFAULT_SLIPPAGE_PCT` in
 * `src/features/strategies/lib/slippage.ts` by hand: `lib/` must not depend on `features/`.
 */
const DEFAULT_SLIPPAGE_PCT = 2;

/** i18n keys for each step label (resolved by the FE across all 11 locales). */
/**
 * Legs that exist to make a chain TRANSACTABLE rather than to fund the operation.
 *
 * One set rather than three inline predicates, because the three questions downstream ("is there a
 * gas leg", "is there a funding leg", "which variant") must not be able to disagree about a kind.
 * They did once: `bridge-gas` read as funding to a `kind !== "swap-gas"` test, which sent a gas-only
 * route to the wizard and dropped its cost from the gas figure.
 */
const GAS_LEG_KINDS: ReadonlySet<ProvisioningLegKind> = new Set(["swap-gas", "bridge-gas"]);

const LABEL_KEYS: Record<ProvisioningLegKind | "op", string> = {
  bridge: "provisioning.steps.bridge",
  "bridge-gas": "provisioning.steps.bridgeGas",
  "swap-gas": "provisioning.steps.swapGas",
  "swap-token": "provisioning.steps.swapToken",
  op: "provisioning.steps.op",
};

/** What the planner needs to know. Everything is derived; nothing is read from the network here. */
export interface BuildPlanRequest {
  /** The operation's chain. Every route must terminate here. */
  targetChainId: number;
  /**
   * Base units of the target chain's USDC the operation still needs, decimal string. `"0"` for an
   * operation that spends none (collect / withdraw / close), which can still need a gas top-up.
   */
  requiredAmount: string;
  /** USD value of {@link requiredAmount} (display-grade). The plan's `shortfallUsd`. */
  requiredUsd: number;
  /**
   * What the user chose to spend, IN SELECTION ORDER ([R4]). Selection order is route order, so the
   * plan the user reviewed is the plan that executes. From the funding inventory (POO-1031).
   */
  sources: readonly FundingSource[];
  /**
   * POO-1032's verdict per candidate source chain, keyed by chain id ([R3]). A chain with no entry
   * is treated as unusable: a missing classification is missing information, and assuming OK is how
   * a plan's first broadcast fails for want of gas.
   */
  gasByChain: Readonly<Record<number, GasFeasibility>>;
  /** Max slippage from the settings gear, percent (POO-523 R2). Governs AMM legs only. */
  slippagePct?: number;
}

/** Injectable clock, so the suite can assert a stable `quotedAt` / `ttlMs`. */
export interface BuildPlanOptions {
  nowIso?: string;
}

/**
 * Mirrors the house action contract (`@/lib/tx/actionResult`): a typed failure, never a throw, so a
 * caller can branch on the code rather than parse a message.
 */
export type BuildPlanResult =
  | { ok: true; plan: ProvisioningPlan }
  | { ok: false; code: string; message: string };

/** USD figures are display-grade; round to cents for anything the user reads. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A base-unit decimal string as a BigInt, or `0n` when it is not one. */
function toBigInt(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : BigInt(0);
}

/** The chain's native coin as a leg endpoint. */
function nativeToken(chainId: number): ProvisioningLegToken {
  return {
    address: NATIVE_TOKEN_ADDRESS,
    symbol: nativeSymbol(apiNetworkForChain(chainId)),
    decimals: 18,
    chainId,
  };
}

/** The chain's USDC as a leg endpoint, or `null` when the chain is not one we operate on. */
function usdcToken(chainId: number): ProvisioningLegToken | null {
  const address = getUsdcAddress(chainId);
  return address ? { address, symbol: "USDC", decimals: 6, chainId } : null;
}

/** A funding source as a leg endpoint. */
function sourceToken(source: FundingSource): ProvisioningLegToken {
  return {
    address: source.address,
    symbol: source.symbol,
    decimals: source.decimals,
    chainId: source.chainId,
  };
}

const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * The Permit2 signature deadline on a quote, in epoch ms, or `undefined`.
 *
 * A signature past it is worthless, so it is a hard ceiling on how long the plan can be acted on,
 * independent of how long the PRICE stays good. The field is unvalidated `Record<string, unknown>`
 * inside `permitData`, so anything that does not read as a plausible unix-seconds number is ignored
 * rather than guessed at: a wrong deadline here would either expire the plan instantly or promise a
 * window that does not exist.
 */
function permitDeadlineMs(quote: UniswapQuoteResponse): number | undefined {
  const values = quote.permitData?.values as Record<string, unknown> | undefined;
  const raw = values?.sigDeadline ?? values?.deadline;
  const seconds = typeof raw === "string" || typeof raw === "number" ? Number(raw) : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

/** What one priced leg tells the planner, beyond the leg itself. */
interface PricedLeg {
  leg: ProvisioningLeg;
  /** Permit deadline in epoch ms, when the quote carried one. Tightens the plan's TTL ([R7]). */
  deadlineMs?: number;
}

/** Ask `/quote` for one leg and turn the answer into a {@link ProvisioningLeg}. */
async function priceLeg(args: {
  index: number;
  kind: ProvisioningLegKind;
  tokenIn: ProvisioningLegToken;
  tokenOut: ProvisioningLegToken;
  /** Base units of the side named by {@link type}. */
  amount: string;
  type: "EXACT_INPUT" | "EXACT_OUTPUT";
  slippagePct: number;
  requoteAtExecution: boolean;
}): Promise<PricedLeg | null> {
  const result = await quoteSwap({
    tokenIn: args.tokenIn.address,
    tokenOut: args.tokenOut.address,
    tokenInChainId: args.tokenIn.chainId,
    tokenOutChainId: args.tokenOut.chainId,
    amount: args.amount,
    type: args.type,
    slippageTolerance: args.slippagePct,
  });
  // A 404 here is a ROUTING BOUNDARY, not an outage (§4.7): this pair is simply not offered. The
  // caller drops the source and moves to the next one rather than failing the whole plan.
  if (!result.ok) return null;

  const quote = result.quote;
  const amountIn = quote.quote.input?.amount;
  const amountOut = quote.quote.output?.amount;
  // No priced sides means nothing to execute against. A UniswapX quote looks like this, and the
  // action layer already rejects those; anything else that lands here is a shape we cannot size.
  if (!amountIn || !amountOut) return null;

  const quotedOut = toBigInt(amountOut);
  const isBridge = args.tokenIn.chainId !== args.tokenOut.chainId;

  return {
    leg: {
      index: args.index,
      kind: args.kind,
      chainId: args.tokenIn.chainId,
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      amountIn,
      amountOutQuoted: amountOut,
      minAmountOut: isBridge
        ? // Across quotes a bridge leg and the AMM slippage allowance does not govern it
          // (§1.4 / UF-13 R3). Shaving it here would present a tolerance that does not exist.
          amountOut
        : applySlippageFloor(quotedOut, args.slippagePct).toString(),
      routing: quote.routing,
      // [R5] From the quote. `quoteGasUsd` prefers the top-level `gasFeeUSD` over `gasInfo`'s and
      // deliberately never derives USD from the wei figure.
      gasUsd: quoteGasUsd(quote) ?? 0,
      ...(typeof quote.quote.priceImpact === "number"
        ? { priceImpactPct: quote.quote.priceImpact }
        : {}),
      ...(typeof quote.quote.estimatedFillTimeMs === "number"
        ? { etaSeconds: Math.max(1, Math.round(quote.quote.estimatedFillTimeMs / 1000)) }
        : {}),
      requoteAtExecution: args.requoteAtExecution,
    },
    ...(permitDeadlineMs(quote) === undefined ? {} : { deadlineMs: permitDeadlineMs(quote) }),
  };
}

/**
 * How many rounds {@link sizeBridgeInput} may spend converging. Rate inversion lands in one for a
 * linear fee and one more for a nonlinear one; a third exists only so an adversarial curve cannot
 * spin the loop. `/quote` is rate-limited on a shared key, so this is a real budget, not a formality.
 */
const MAX_BRIDGE_SIZING_ROUNDS = 3;

/**
 * Price the bridge leg that DELIVERS at least `required` on the far chain ([R1], [R2], POO-1074).
 *
 * `BRIDGE` routing ignores `EXACT_OUTPUT`. Probed live 2026-07-25: asking for exactly 100 USDC out
 * returns `in=100000000, out=99981280`, which is the EXACT_INPUT answer wearing the other name, and
 * the input is pinned rather than grossed up. Sizing a route from that `amountIn` under-delivers by
 * the bridge fee every single time. `CLASSIC` was probed alongside it and DOES honour EXACT_OUTPUT,
 * so this correction is deliberately scoped to bridge legs.
 *
 * The shortfall is small (~0.019% on USDC) but the failure it causes is not proportional to it: an
 * operation with a hard on-chain minimum takes the money, pays swap and bridge fees, lands a hair
 * under the minimum and fails at the last step, leaving the user mid-route and out of pocket.
 *
 * Convergence inverts the observed rate instead of adding the shortfall back. Additive gross-up pays
 * a fee on the fee each round and approaches the answer without arriving; inversion asks "at this
 * rate, what input yields `required`?" and lands in one round whenever the fee is linear. The live
 * fee is closer to flat, which inversion over-shoots slightly, and over-delivery is safe: the caller
 * caps `delivered` at what was asked ([R2] permits over-delivery, never under-delivery).
 */
async function sizeBridgeInput(args: {
  index: number;
  /** `"bridge"` carries the operation's asset; `"bridge-gas"` carries native coin (POO-1075). */
  kind: "bridge" | "bridge-gas";
  tokenIn: ProvisioningLegToken;
  tokenOut: ProvisioningLegToken;
  required: bigint;
  slippagePct: number;
}): Promise<PricedLeg | null> {
  let attempt = args.required;

  for (let round = 0; round < MAX_BRIDGE_SIZING_ROUNDS; round += 1) {
    const priced = await priceLeg({
      index: args.index,
      kind: args.kind,
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      amount: attempt.toString(),
      type: "EXACT_INPUT",
      slippagePct: args.slippagePct,
      // The amount is one this planner chose, not one a previous leg produced, so it is exact.
      requoteAtExecution: false,
    });
    if (!priced) return null;

    const out = toBigInt(priced.leg.amountOutQuoted);
    if (out >= args.required) return priced;
    // A leg that returns nothing cannot be inverted, and a route that eats the whole amount is not
    // one to plan around.
    if (out <= BigInt(0)) return null;

    // Ceil, so the answer is never a hair short of the requirement it was derived from.
    const next = (args.required * attempt + out - BigInt(1)) / out;
    // No forward progress means the curve is not invertible here. Refuse rather than re-ask.
    if (next <= attempt) return null;
    attempt = next;
  }

  return null;
}

/**
 * The smallest native amount a bridge will actually carry, in wei ([R3], POO-1075).
 *
 * Probed live 2026-07-25, Base to Arbitrum: 0.0002 ETH returns `404 ResourceNotFound`, 0.0003 quotes
 * fine. The relayer fee is near-FLAT rather than proportional (~4.7e12 wei at both 0.0003 and 0.002
 * ETH), so this floor is about economics, not precision: below it the fee approaches the amount and
 * the network declines to carry it.
 *
 * A gas need under the floor therefore bridges MORE than it strictly requires. That excess is the
 * user's own money landing on a chain they are about to use, which is why it is disclosed rather
 * than hidden, but it is not free and the cost line has to say so.
 */
const MIN_GAS_BRIDGE_WEI = BigInt("300000000000000");

/**
 * Carry native coin INTO the operation's chain when that chain cannot pay for its own transaction
 * ([R1], POO-1075).
 *
 * This is the last chicken-and-egg in the rail. Every other funding leg assumes the target chain can
 * broadcast; a chain holding zero native cannot, however well-funded the route into it is. Before
 * this existed the planner refused, and the UI told the user to go move native coin across by hand,
 * which is precisely the job the rail exists to do.
 *
 * It works because a native-to-native cross-chain quote returns `routing: "BRIDGE"` and delivers
 * TRUE native on the destination, so no destination-side transaction is needed to make it spendable.
 * That is the whole trick: any route ending in a token would need gas on the far side to unwrap, and
 * would deadlock exactly where it started.
 *
 * **Both chains must share a native asset** ([R5]). Probed across every ordered pair we operate on:
 * Base and Arbitrum both quote (they are both ETH), and every pair involving Polygon 404s, because
 * POL and ETH are different assets and the API serves no cross-chain different-token route. The two
 * escape hatches were probed too and also 404: `POL -> ETH`, and `WETH(Polygon) -> ETH(Arbitrum)`.
 * `WETH -> WETH` does bridge, but unwrapping on the far side needs gas there, which is the same
 * deadlock. So Polygon is genuinely unreachable here and keeps its BLOCKED copy.
 */
async function planGasBridge(args: {
  targetChainId: number;
  targetGas: GasFeasibility;
  gasByChain: Readonly<Record<number, GasFeasibility>>;
  sources: readonly FundingSource[];
  slippagePct: number;
}): Promise<PricedLeg | null> {
  const target = nativeToken(args.targetChainId);

  // `classifyGasFeasibility` already decided which chains hold native to spare, and deliberately
  // excludes a chain that is only just OK ([R2]: a donor must not strand itself). The only condition
  // it cannot know is this one, because it never sees the target: the coin has to be the SAME coin.
  const donors = Object.values(args.gasByChain)
    .filter(
      (gas) =>
        gas.chainId !== args.targetChainId &&
        gas.verdict === "OK" &&
        gas.surplusUsd > 0 &&
        nativeToken(gas.chainId).symbol === target.symbol,
    )
    .sort((a, b) => b.surplusUsd - a.surplusUsd || a.chainId - b.chainId);

  for (const donor of donors) {
    // The inventory is the authority on what is actually spendable. A donor whose native holding is
    // not in it cannot be drawn on, whatever the classifier thinks it is worth.
    const held = args.sources.find(
      (source) =>
        source.chainId === donor.chainId && sameAddress(source.address, NATIVE_TOKEN_ADDRESS),
    );
    if (!held) continue;

    const balance = toBigInt(held.amount);
    const balanceMicros = BigInt(Math.round(Math.max(0, held.usd) * 1e6));
    if (balance <= BigInt(0) || balanceMicros <= BigInt(0)) continue;

    // USD to base units off the REAL holding, never a constant ([R4] of POO-1032 applies here too):
    // the ratio comes from a balance the inventory priced, so no second price source can disagree
    // with the first. Micro-dollars keep the whole conversion in BigInt.
    const toBaseUnits = (usd: number) =>
      (balance * BigInt(Math.round(Math.max(0, usd) * 1e6))) / balanceMicros;

    // [R2] What this donor can give WITHOUT stranding itself: its surplus, which the classifier
    // already computed as native beyond its own requirement.
    const spendable = toBaseUnits(donor.surplusUsd);
    const wanted = toBaseUnits(args.targetGas.requiredGasUsd);
    const required = wanted < MIN_GAS_BRIDGE_WEI ? MIN_GAS_BRIDGE_WEI : wanted;
    if (required > spendable) continue;

    const priced = await sizeBridgeInput({
      index: 0,
      kind: "bridge-gas",
      tokenIn: nativeToken(donor.chainId),
      tokenOut: target,
      required,
      slippagePct: args.slippagePct,
    });
    // A 404 is this pair declining the amount, not an outage: try the next donor.
    if (!priced) continue;

    // Sizing grosses the INPUT up past `required` to cover the bridge fee, so the surplus test has
    // to be re-run against what actually leaves the donor. Checking only the output would let a leg
    // through that strands the very chain it was drawn from.
    if (toBigInt(priced.leg.amountIn) > spendable) continue;

    return priced;
  }

  return null;
}

/**
 * The quoted output less the slippage allowance, in base units.
 *
 * Basis points keep the whole computation in BigInt: a percentage applied as a float to an 18-decimal
 * amount is exactly the drift the money convention exists to prevent. Rounded DOWN, because this is
 * a floor and rounding a floor up is claiming a guarantee we were not given.
 */
function applySlippageFloor(amountOut: bigint, slippagePct: number): bigint {
  const bps = BigInt(Math.min(10_000, Math.max(0, Math.round(slippagePct * 100))));
  return (amountOut * (BigInt(10_000) - bps)) / BigInt(10_000);
}

/**
 * A base-unit amount of `token` in USD, priced off the holding it came from.
 *
 * The ratio is taken in BigInt against micro-dollars and only the final micro-dollar integer becomes
 * a `number`, so an 18-decimal balance well past `Number.MAX_SAFE_INTEGER` does not lose its scale
 * on the way to a display figure. USDC is the exception and is read at parity, which is what the
 * rest of this codebase already does with it.
 */
function amountUsd(amount: string, token: ProvisioningLegToken, source?: FundingSource): number {
  if (token.symbol === "USDC") {
    return round2(Number(formatUnits(toBigInt(amount), token.decimals)));
  }
  if (!source) return 0;
  const balance = toBigInt(source.amount);
  const balanceMicros = BigInt(Math.round(Math.max(0, source.usd) * 1e6));
  if (balance <= BigInt(0) || balanceMicros <= BigInt(0)) return 0;
  return round2(Number((toBigInt(amount) * balanceMicros) / balance) / 1e6);
}

/** The plan of legs a single funding source contributes, and what it delivers on the target. */
interface SourceRoute {
  legs: ProvisioningLeg[];
  deadlines: number[];
  /** Base units of the target chain's USDC this source lands. */
  delivered: bigint;
  /** Base units of the source token this source spends (0 when it needs no leg). */
  spent: bigint;
}

/**
 * Plan the legs for ONE source, sized to deliver at most `remaining` on the target chain.
 *
 * The route shape is decided by two comparisons and nothing else ([R1]):
 *
 *   same chain + already the target asset  → no leg at all, the money is already where it belongs
 *   same chain + different token           → one CLASSIC swap
 *   different chain + already USDC         → one BRIDGE leg
 *   different chain + different token      → swap to the source chain's USDC, THEN bridge
 *
 * Sizing is backwards from `remaining` (see the module header). When the backward answer exceeds
 * what the source holds, the source is drained forwards instead and delivers what it can.
 */
async function planSource(args: {
  source: FundingSource;
  usableBalance: bigint;
  remaining: bigint;
  targetChainId: number;
  targetUsdc: ProvisioningLegToken;
  slippagePct: number;
  nextIndex: number;
}): Promise<SourceRoute | null> {
  const { source, usableBalance, remaining, targetChainId, targetUsdc, slippagePct } = args;
  const from = sourceToken(source);
  const sameChain = source.chainId === targetChainId;

  // Already the operation's asset on the operation's chain: nothing to route, just earmark it.
  if (sameChain && sameAddress(from.address, targetUsdc.address)) {
    const spend = usableBalance < remaining ? usableBalance : remaining;
    return spend > BigInt(0) ? { legs: [], deadlines: [], delivered: spend, spent: spend } : null;
  }

  const bridgeAsset = sameChain ? targetUsdc : usdcToken(source.chainId);
  // A chain we cannot name USDC on cannot host the bridge asset, so it cannot fund anything here.
  if (!bridgeAsset) return null;

  const needsSwap = !sameAddress(from.address, bridgeAsset.address);
  const needsBridge = !sameChain;

  // --- backward pass: what has to go IN so that `remaining` comes out on the target chain --------
  //
  // Each backward quote is KEPT, not just measured. When the source covers the whole requirement the
  // forward pass asks the identical question, and the upstream `/quote` is rate-limited on a shared
  // API key: re-asking would double the calls on the primary happy path for an answer we hold.
  //
  // The bridge leg cannot use an EXACT_OUTPUT question at all, because BRIDGE routing ignores it
  // (POO-1074). `sizeBridgeInput` converges on the input by inverting the observed rate instead, and
  // returns the quote that actually satisfies the requirement.
  let bridgeIn: bigint | null = null;
  let backwardBridge: PricedLeg | null = null;
  if (needsBridge) {
    backwardBridge = await sizeBridgeInput({
      index: 0,
      kind: "bridge",
      tokenIn: bridgeAsset,
      tokenOut: targetUsdc,
      required: remaining,
      slippagePct,
    });
    if (!backwardBridge) return null;
    bridgeIn = toBigInt(backwardBridge.leg.amountIn);
  }

  /** How much of the bridge asset the route must produce on the source chain. */
  const swapTarget = needsBridge ? (bridgeIn ?? remaining) : remaining;

  let exactInputAmount: bigint | null = null;
  let backwardSwap: PricedLeg | null = null;
  if (needsSwap) {
    backwardSwap = await priceLeg({
      index: 0,
      kind: "swap-token",
      tokenIn: from,
      tokenOut: bridgeAsset,
      amount: swapTarget.toString(),
      type: "EXACT_OUTPUT",
      slippagePct,
      requoteAtExecution: false,
    });
    if (!backwardSwap) return null;
    // The source cannot buy the whole requirement, so drain it forwards instead.
    if (toBigInt(backwardSwap.leg.amountIn) > usableBalance) exactInputAmount = usableBalance;
  } else if (swapTarget > usableBalance) {
    exactInputAmount = usableBalance;
  }

  if (exactInputAmount !== null && exactInputAmount <= BigInt(0)) return null;

  // --- forward pass: price the legs in execution order, at the sizes they will actually run ------
  const legs: ProvisioningLeg[] = [];
  const deadlines: number[] = [];
  let index = args.nextIndex;
  let carried = exactInputAmount ?? BigInt(0);
  const exactOutput = exactInputAmount === null;

  if (needsSwap) {
    // Fully covered, the question is unchanged from the backward pass, so its answer stands. Only a
    // drained source changes it (EXACT_INPUT over the whole holding), and that one has to be asked.
    const priced = exactOutput
      ? backwardSwap
      : await priceLeg({
          index,
          kind: "swap-token",
          tokenIn: from,
          tokenOut: bridgeAsset,
          amount: carried.toString(),
          type: "EXACT_INPUT",
          slippagePct,
          // The first leg of a route spends a balance that already exists, so it is exact.
          requoteAtExecution: false,
        });
    if (!priced) return null;
    legs.push({ ...priced.leg, index });
    if (priced.deadlineMs !== undefined) deadlines.push(priced.deadlineMs);
    index += 1;
    carried = toBigInt(priced.leg.amountOutQuoted);
  }

  if (needsBridge) {
    // Once a swap feeds it, the bridge is sized from that swap's realized OUTPUT, which makes it an
    // EXACT_INPUT question and an estimate ([R8]). Unfed and fully covered, it keeps the backward
    // question, which the backward pass already answered for exactly this amount.
    const fedByLeg = needsSwap || !exactOutput;
    // The swap was sized EXACT_OUTPUT to land precisely on the amount `sizeBridgeInput` solved for,
    // so on the fully-covered path the forward question is one the backward pass already asked and
    // answered. `/quote` is rate-limited on a shared key ([R5]), so re-asking is a real cost for an
    // answer already in hand. Compared on the amount rather than assumed: a drained source lands
    // somewhere else entirely and must genuinely re-ask.
    const alreadyPriced =
      backwardBridge && toBigInt(backwardBridge.leg.amountIn) === carried ? backwardBridge : null;
    const priced = fedByLeg
      ? (alreadyPriced ??
        (await priceLeg({
          index,
          kind: "bridge",
          tokenIn: bridgeAsset,
          tokenOut: targetUsdc,
          amount: carried.toString(),
          type: "EXACT_INPUT",
          slippagePct,
          requoteAtExecution: needsSwap,
        })))
      : backwardBridge;
    if (!priced) return null;
    // Set here rather than inherited: a reused backward quote carries `false`, but a leg a swap
    // feeds is an estimate until that swap lands ([R8]). `needsSwap` is false whenever the leg is
    // unfed, so this is the right flag on every path.
    legs.push({ ...priced.leg, index, requoteAtExecution: needsSwap });
    if (priced.deadlineMs !== undefined) deadlines.push(priced.deadlineMs);
    carried = toBigInt(priced.leg.amountOutQuoted);
  }

  if (legs.length === 0 || carried <= BigInt(0)) return null;

  const first = legs[0];
  return {
    legs,
    deadlines,
    // Never claim to deliver more than was asked for: an over-quote on the last leg is not extra
    // funding, it is a rounding artefact, and counting it would under-plan the next source.
    delivered: carried > remaining ? remaining : carried,
    spent: first ? toBigInt(first.amountIn) : BigInt(0),
  };
}

/**
 * Decompose a funding requirement into ordered, executable legs.
 *
 * Returns a typed failure rather than throwing, and never returns a plan that cannot complete: a
 * user told "you are $12 short" can act, a user handed a plan that strands halfway cannot
 * (UF-22 [R3]).
 */
export async function buildPlan(
  request: BuildPlanRequest,
  options: BuildPlanOptions = {},
): Promise<BuildPlanResult> {
  const quotedAt = options.nowIso ?? new Date().toISOString();
  const slippagePct = request.slippagePct ?? DEFAULT_SLIPPAGE_PCT;

  const targetUsdc = usdcToken(request.targetChainId);
  if (!targetUsdc) {
    return {
      ok: false,
      code: "PROVISIONING_UNSUPPORTED_CHAIN",
      message: `Chain ${request.targetChainId} is not a network this app can provision on.`,
    };
  }

  // UF-22 [R3] The operation's LAST step is a transaction on its own chain, so a chain that cannot
  // pay for one cannot run the operation, however well-funded the route into it is. Checked before
  // anything is quoted: there is no plan to price, and asking would spend upstream calls on a route
  // that can never execute.
  //
  // Refusing here is the difference between a legible dead end and a silent one. Without it a
  // gas-only requirement on a zero-native chain plans NO legs (the classifier emits a gas swap only
  // for TOP_UP), which assembles as `needed: false` — a plan card whose confirm runs nothing,
  // reports success, and hands the operation back to a wallet that still cannot broadcast. The code
  // classifies as `gasBlocked` (`@/lib/tx/diagnostics`) so the panel can name the network and offer
  // the escapes the verdict already carries, rather than "something went wrong".
  //
  // BLOCKED is no longer terminal (POO-1075). A donor chain holding the SAME native coin can carry
  // gas in, and a native bridge delivers spendable native on the far side, so the deadlock is real
  // but escapable. Only when no donor qualifies does the refusal above still stand, which is the
  // case for Polygon in either direction: its native coin is not ETH and the API serves no
  // cross-chain different-token route.
  const targetGas = request.gasByChain[request.targetChainId];
  let gasBridge: PricedLeg | null = null;
  if (targetGas?.verdict === "BLOCKED") {
    gasBridge = await planGasBridge({
      targetChainId: request.targetChainId,
      targetGas,
      gasByChain: request.gasByChain,
      sources: request.sources,
      slippagePct,
    });
    if (!gasBridge) {
      return {
        ok: false,
        code: "PROVISIONING_GAS_BLOCKED",
        message: `Chain ${request.targetChainId} holds no native coin to pay for the operation's own transaction, and no other network holds spare ${nativeToken(request.targetChainId).symbol} to send over.`,
      };
    }
  }

  const required = toBigInt(request.requiredAmount);
  let remaining = required;

  const legs: ProvisioningLeg[] = [];
  /** The source each leg was priced against, so a USD figure can be derived from a real holding. */
  const legSources = new Map<number, FundingSource>();
  const deadlines: number[] = [];
  const toppedUpChains = new Set<number>();
  /** Base units already earmarked per (chain, token), so two legs cannot spend the same balance. */
  const committed = new Map<string, bigint>();
  let topUpUsd = 0;

  // [R4] Seeded BEFORE any funding leg, so it is leg 0 and every later `legs.length` index follows
  // it. Position is necessary but not sufficient: the rail additionally waits for a bridge to SETTLE
  // before advancing, which is what actually stops a target-chain broadcast the gas has not arrived
  // for. Its USD is derived from the donor's real holding like every other leg's.
  if (gasBridge) {
    const donor = request.sources.find(
      (source) =>
        source.chainId === gasBridge.leg.chainId &&
        sameAddress(source.address, NATIVE_TOKEN_ADDRESS),
    );
    if (donor) legSources.set(legs.length, donor);
    legs.push({ ...gasBridge.leg, index: legs.length });
    if (gasBridge.deadlineMs !== undefined) deadlines.push(gasBridge.deadlineMs);
    // Counted into the same figure a TOP_UP swap feeds, so the plan's `gas` amount is what the user
    // actually spends on being able to transact, by whichever route it was obtained ([R6]).
    topUpUsd += amountUsd(gasBridge.leg.amountIn, gasBridge.leg.tokenIn, donor);
  }

  const commitKey = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`;
  const committedOf = (chainId: number, address: string) =>
    committed.get(commitKey(chainId, address)) ?? BigInt(0);
  const commit = (chainId: number, address: string, amount: bigint) => {
    committed.set(commitKey(chainId, address), committedOf(chainId, address) + amount);
  };
  const setCommitted = (chainId: number, address: string, amount: bigint) => {
    committed.set(commitKey(chainId, address), amount);
  };

  /**
   * [R3] The gas swap for a TOP_UP chain, emitted BEFORE the first leg that spends from that chain.
   * Ordering it after is exactly the chicken-and-egg §4.6 describes: the wallet is asked to broadcast
   * a swap it cannot pay for. Returns false when the top-up itself cannot be priced, which makes the
   * chain unusable rather than merely expensive.
   */
  async function ensureGas(verdict: GasFeasibility): Promise<boolean> {
    if (verdict.verdict !== "TOP_UP") return true;
    if (toppedUpChains.has(verdict.chainId)) return true;
    // TOP_UP without a sized swap is a classifier contract violation; treat it as unusable rather
    // than planning a route that cannot pay for itself.
    if (!verdict.topUp) return false;

    const token = verdict.topUp.token;
    const priced = await priceLeg({
      index: legs.length,
      kind: "swap-gas",
      tokenIn: {
        address: token.address,
        symbol: token.symbol,
        decimals: token.decimals,
        chainId: verdict.chainId,
      },
      tokenOut: nativeToken(verdict.chainId),
      amount: verdict.topUp.amountRaw,
      type: "EXACT_INPUT",
      slippagePct,
      requoteAtExecution: false,
    });
    if (!priced) return false;

    // The gas slice comes off a real holding the classifier already read, so the step's USD is
    // derived the same way every other leg's is. Without it a non-USDC top-up renders as $0.00 and
    // its slippage silently drops out of `bufferUsd`.
    legSources.set(legs.length, {
      address: token.address,
      chainId: verdict.chainId,
      symbol: token.symbol,
      decimals: token.decimals,
      amount: token.balanceRaw,
      usd: token.balanceUsd,
      reachableChainIds: [verdict.chainId],
      isNative: sameAddress(token.address, NATIVE_TOKEN_ADDRESS),
      logoUrl: "",
    });
    legs.push(priced.leg);
    if (priced.deadlineMs !== undefined) deadlines.push(priced.deadlineMs);
    commit(verdict.chainId, token.address, toBigInt(verdict.topUp.amountRaw));
    toppedUpChains.add(verdict.chainId);
    topUpUsd += verdict.topUp.buyNativeUsd;
    return true;
  }

  // [R4] Selection order is route order. The loop never reorders, never sorts and never optimizes:
  // a plan the user did not review is not the plan they approved.
  for (const source of request.sources) {
    if (remaining <= BigInt(0)) break;

    const verdict = request.gasByChain[source.chainId];
    // [R3] BLOCKED cannot originate a transaction at all, and an unclassified chain is unknown
    // rather than fine. Neither is quoted: asking costs an upstream call for a route we will not use.
    if (!verdict || verdict.verdict === "BLOCKED") continue;

    // Everything `ensureGas` can mutate, snapshotted: the gas leg is speculative until the source it
    // was added for proves routable, and rolling back only the leg leaves the plan quoting a top-up
    // for a chain it never touches.
    const before = legs.length;
    const deadlinesBefore = deadlines.length;
    const topUpUsdBefore = topUpUsd;
    const gasToken = verdict.topUp?.token;
    const gasCommittedBefore = gasToken
      ? committedOf(verdict.chainId, gasToken.address)
      : BigInt(0);

    /**
     * Undo this iteration's gas leg, whole. `legs.length > before` is what makes it "this
     * iteration's": a chain an earlier source already topped up returned early from `ensureGas`, and
     * its leg is not ours to undo.
     */
    const rollbackGas = () => {
      if (legs.length <= before) return;
      legs.length = before;
      legSources.delete(before);
      deadlines.length = deadlinesBefore;
      topUpUsd = topUpUsdBefore;
      // Restored, not deleted: an earlier source may have committed against the same holding.
      if (gasToken) setCommitted(verdict.chainId, gasToken.address, gasCommittedBefore);
      toppedUpChains.delete(verdict.chainId);
    };

    if (!(await ensureGas(verdict))) {
      rollbackGas();
      continue;
    }

    const usableBalance = toBigInt(source.amount) - committedOf(source.chainId, source.address);
    // Nothing left to spend: the source funds nothing, so its gas leg has nothing to pay for.
    if (usableBalance <= BigInt(0)) {
      rollbackGas();
      continue;
    }

    const route = await planSource({
      source,
      usableBalance,
      remaining,
      targetChainId: request.targetChainId,
      targetUsdc,
      slippagePct,
      nextIndex: legs.length,
    });
    // The source is not routable. Roll back the gas leg we speculatively added for it, so the plan
    // never carries a top-up for a chain it never touches.
    if (!route) {
      rollbackGas();
      continue;
    }

    for (const leg of route.legs) {
      legSources.set(legs.length, source);
      legs.push({ ...leg, index: legs.length });
    }
    deadlines.push(...route.deadlines);
    commit(source.chainId, source.address, route.spent);
    remaining -= route.delivered;
  }

  // The operation's own chain needs gas even when it contributes nothing to funding: the operation
  // itself is a transaction there. Appended last so it still precedes the `op` anchor. This is also
  // the ONLY leg a gas-only requirement produces ([R1]): `remaining` is zero, so the loop above ran
  // no iteration at all.
  if (targetGas) await ensureGas(targetGas);

  if (remaining > BigInt(0)) {
    return {
      ok: false,
      code: "PROVISIONING_INSUFFICIENT_FUNDS",
      message: `The selected funding sources cover ${(required - remaining).toString()} of the ${required.toString()} required.`,
    };
  }

  return {
    ok: true,
    plan: assemblePlan({
      legs,
      legSources,
      deadlines,
      quotedAt,
      slippagePct,
      requiredUsd: request.requiredUsd,
      hasRequirement: required > BigInt(0),
      topUpUsd,
    }),
  };
}

/** Turn the priced legs into the {@link ProvisioningPlan} every render surface already speaks. */
function assemblePlan(args: {
  legs: ProvisioningLeg[];
  legSources: Map<number, FundingSource>;
  deadlines: number[];
  quotedAt: string;
  slippagePct: number;
  requiredUsd: number;
  hasRequirement: boolean;
  topUpUsd: number;
}): ProvisioningPlan {
  const { legs, legSources, quotedAt, slippagePct, requiredUsd } = args;

  // [R2] The trailing display anchor, always last, never a leg.
  const opStep: ProvisioningStep = {
    type: "op",
    key: "op",
    labelKey: LABEL_KEYS.op,
    amountUsd: round2(requiredUsd),
  };

  if (legs.length === 0) {
    return {
      needed: false,
      reason: [],
      variant: "none",
      steps: [opStep],
      quote: {
        shortfallUsd: 0,
        bufferUsd: 0,
        feesUsd: 0,
        totalPayUsd: 0,
        quotedAt,
        ttlMs: UNISWAP_QUOTE_TTL_MS,
      },
      slippagePct,
    };
  }

  const steps: ProvisioningStep[] = legs.map((leg, index) => ({
    type: leg.kind,
    // `useWalletSignFlow` addresses a step by its key, so it carries the leg index: two swaps on
    // the same pair from two sources are different steps and must not collapse into one.
    key: `${leg.kind}-${index}`,
    labelKey: LABEL_KEYS[leg.kind],
    fromToken: leg.tokenIn.symbol,
    toToken: leg.tokenOut.symbol,
    fromChainId: leg.tokenIn.chainId,
    toChainId: leg.tokenOut.chainId,
    chainId: leg.chainId,
    amountUsd: amountUsd(leg.amountIn, leg.tokenIn, legSources.get(index)),
    // Human-readable token units for display; `leg.amountIn` keeps the exact base units.
    amountToken: formatUnits(toBigInt(leg.amountIn), leg.tokenIn.decimals),
    method: "SEND_TX",
    ...(leg.etaSeconds === undefined ? {} : { etaSeconds: leg.etaSeconds }),
    leg,
  }));
  steps.push(opStep);

  const hasGasLeg = legs.some((leg) => GAS_LEG_KINDS.has(leg.kind));
  // A gas bridge crosses a network too, and the reason line exists to tell the user why their money
  // is moving between chains at all.
  const hasBridgeLeg = legs.some((leg) => leg.kind === "bridge" || leg.kind === "bridge-gas");
  const hasFundingLeg = legs.some((leg) => !GAS_LEG_KINDS.has(leg.kind));

  const reason: ProvisioningReason[] = [];
  if (hasGasLeg) reason.push("gas");
  if (args.hasRequirement && hasFundingLeg) reason.push("usdc");
  if (hasBridgeLeg) reason.push("network");

  return {
    needed: true,
    reason,
    // Gas alone routes to the simpler buy-gas modal; anything that moves the operation's own funds
    // is the wizard. Same vocabulary the six op modals already branch on (POO-1033 [R3]).
    variant: hasFundingLeg ? "multi" : "gas-only",
    steps,
    quote: buildQuote({
      steps,
      deadlines: args.deadlines,
      quotedAt,
      slippagePct,
      requiredUsd,
    }),
    ...(hasGasLeg ? { gas: { presetUsd: null, amountUsd: round2(args.topUpUsd) } } : {}),
    slippagePct,
  };
}

/**
 * The cost breakdown, to the contract's own definition:
 * `totalPayUsd = shortfallUsd + bufferUsd + feesUsd`.
 *
 * The arithmetic itself lives in the cost model (PP-CORE-LIB-056), which is pure, client-importable
 * and itemizes the same figures per source for the cost table (POO-1040). Both run the SAME function
 * over the SAME steps, so the total a user approves and the breakdown they read cannot disagree.
 *
 * Three deliberate choices, all of which UF-13 (POO-1035) itemizes further:
 *
 *   - **buffer** is the provisioning transactions' own gas (summed from the quotes, [R5]) plus the
 *     slippage allowance, applied ONLY to AMM legs. A bridge leg is quoted by Across and slippage
 *     does not govern it, so charging the user a tolerance line for it would be a fiction (§1.4).
 *   - **fees** is the bridge cost, derived exactly: both sides of a bridge leg are USDC, so
 *     `amountIn − amountOut` IS the fee, with no reference price required.
 *   - a **swap** fee is not added, because it is already inside the quote: the output amount the
 *     route is sized against is net of it. Adding a line for it would double-count.
 *
 * The TTL stays here: it is a property of the QUOTES, which only the planner holds (a permit deadline
 * never reaches the plan), not of what the plan costs.
 */
function buildQuote(args: {
  steps: ProvisioningStep[];
  deadlines: number[];
  quotedAt: string;
  slippagePct: number;
  requiredUsd: number;
}): ProvisioningQuote {
  const { steps, quotedAt, slippagePct, requiredUsd } = args;

  const { quote } = buildCostBreakdown({ steps, shortfallUsd: requiredUsd, slippagePct });

  // [R7] The quote's window, tightened by any permit that expires sooner. Never below zero: an
  // already-expired plan re-quotes immediately, which is the correct behaviour, not an error.
  const quotedAtMs = Date.parse(quotedAt);
  const permitTtl = args.deadlines.map((deadline) => deadline - quotedAtMs);
  const ttlMs = Math.max(0, Math.min(UNISWAP_QUOTE_TTL_MS, ...permitTtl));

  return { ...quote, quotedAt, ttlMs };
}
