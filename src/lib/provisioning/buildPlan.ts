/**
 * @id PP-CORE-LIB-055 (POO-1034, POO-1044, POO-1074, POO-1075, POO-1107, POO-1135, POO-1166, POO-1641, POO-1784, POO-1916, POO-1927)
 * @name buildPlan (real provisioning planner)
 * @implements-rules-version v9 (POO-1916 rules v1) · v8 (POO-1927 rules v1) · v7 (POO-1641 rules v1) · v6 (POO-1166 / POO-1129 rules v3) · v5 (POO-1135 / POO-1129 rules v3) · v4 (POO-1107 rules v1) · v3 (POO-1075 rules v1) · v2 (POO-1044 rules v1) · v1 (POO-1034 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * ## The fiat on-ramp leg (v5, POO-1135, epic POO-1129)
 *
 * When {@link BuildPlanRequest.onRampEnabled} is set and the wallet cannot cover the requirement (a
 * shortfall the funding loop could not close, or a gas-blocked target chain with no crypto donor),
 * the planner emits a fiat `buy` step instead of dead-ending. The purchase always lands on Base
 * ([R2]); {@link sizeOnRampOrder} (POO-1133) picks ETH-BASE (gas-first, [R1]) vs USDC-BASE and the
 * fiat amount. Its downstream swap/bridge are DISPLAY steps carrying no {@link ProvisioningLeg},
 * because their real input is the observed settlement delta, which does not exist until the purchase
 * clears ([R4]/[R8]); POO-1136 re-sizes and executes them from that delta. Absent the flag, the
 * planner behaves exactly as it did before this field existed (the crypto-only cut).
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
 *   different chain, DIFFERENT token → **`404 ResourceNotFound` FOR THE PAIR PROBED.**
 *
 * That last row is the flagship demo case (WETH on Polygon funding a USDC strategy on Arbitrum), so
 * the planner's core job is to never ask that question. It decomposes: swap to the source chain's
 * stable first, then bridge that stable to the target chain ([R1]).
 *
 * ## The boundary is PAIR-SPECIFIC, and this header used to say otherwise (POO-1916)
 *
 * Until POO-1916 the paragraph above ended: *"The intermediary is always USDC because every supported
 * chain has it and it is the bridge asset, so the bridge leg is always same-token and therefore
 * always routable."* Both halves were wrong, and that sentence is the root cause of POO-1779 and
 * POO-1784. Chain 4663 does not hold USDC in its stable slot; it holds USDG. And the 404 above was
 * measured on ONE pair on 2026-07-25, weeks before 4663 was in our stack, then generalised into a
 * rule about different-token routing as such. Re-probed live:
 *
 *   `WETH(137)  -> USDC(42161)` → `404 ResourceNotFound`   (2026-07-25, still 404 on 2026-09-12)
 *   `USDC(8453) -> USDC(42161)` → `200`, `routing: "BRIDGE"` (same-token control)
 *   `USDC(8453) -> USDG(4663)`  → `200`, `routing: "BRIDGE"` (2026-09-11: 10.000000 in, 9.952342 out)
 *   `USDC(4663) -> USDG(4663)`  → `404 NoRouteFoundError`    (no same-chain pool: do NOT swap locally)
 *
 * So the real boundary is whichever pairs the aggregator serves, and stable-to-stable across chains
 * is one of them. The intermediary is therefore the SOURCE chain's stable and the far side is the
 * TARGET chain's stable, both read from `ChainMeta` ([R2]); `usdcToken` has done that since POO-1779.
 * The fourth row is why there is no local-swap fallback: bridging to 4663 and swapping there fails at
 * leg two. `routing: "CHAINED"` (`POST /plan`) is never returned to us and is not used; see
 * `02_BRIDGE_ARCHITECTURE.md` §1.5.
 *
 * None of this is re-derivable from a chain id, and [R3] forbids trying: routability is a LIVE
 * property. Every bridge leg is quoted before it is planned, and a 404 drops the route rather than
 * offering one that dies at execution. That now includes the FIAT bridge, which used to be offered
 * unquoted (see {@link buildOnRampSteps}).
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
import {
  apiNetworkForChain,
  getUsdcAddress,
  isStableSymbol,
  nativeSymbol,
  stableSymbol,
} from "@/lib/chains/config";
// The stable-deliverability predicate the PLANNER and the panel's route picker share (POO-1784 [R1]).
import { onRampCanDeliverStable } from "@/lib/onramp/destinations";
// The pure on-ramp order sizer (POO-1133): it picks ETH-BASE vs USDC-BASE and the fiat amount, and its
// `order` already matches a `ProvisioningOrder`, so a fiat step consumes it with no remap. Imported from
// its own module rather than a barrel to keep this `server-only` graph tight; it is a pure function
// (no I/O, no server-only import of its own), so it carries no secret into the plan.
import { sizeOnRampOrder } from "@/lib/onramp/sizeOnRampOrder";
// PP-INTEGRATION-POINT: every leg is priced by the live Uniswap Trading API through the server
// action layer (PP-CORE-LIB-052). `POST /quote` is the only upstream call the planner makes.
import { quoteSwap } from "@/lib/uniswap/actions";
import { isTransientFailureCode } from "@/lib/uniswap/errors";
import type { UniswapQuoteResponse } from "@/lib/uniswap/schemas";
// `ONRAMP_CHAIN_ID` (8453): Paybis always sells on Base ([R2]). Imported from `computeNeed` (which
// depends only on `./types`) rather than the barrel, so this file never pulls the client-facing barrel.
import { ONRAMP_CHAIN_ID, onRampRouteBuysGas, PAYBIS_MIN_USD } from "./computeNeed";
import { buildCostBreakdown } from "./costBreakdown";
import type { GasFeasibility } from "./gasFeasibility";
import { quoteGasUsd, raiseTopUpToUsd } from "./gasFeasibility";
import type {
  OnRampAttribution,
  ProvisioningLeg,
  ProvisioningLegKind,
  ProvisioningLegToken,
  ProvisioningPlan,
  ProvisioningQuote,
  ProvisioningReason,
  ProvisioningStep,
  ProvisioningStepType,
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

/** i18n keys for each step label (resolved by the FE across all 12 locales). */
/**
 * Legs that exist to make a chain TRANSACTABLE rather than to fund the operation.
 *
 * One set rather than three inline predicates, because the three questions downstream ("is there a
 * gas leg", "is there a funding leg", "which variant") must not be able to disagree about a kind.
 * They did once: `bridge-gas` read as funding to a `kind !== "swap-gas"` test, which sent a gas-only
 * route to the wizard and dropped its cost from the gas figure.
 */
const GAS_LEG_KINDS: ReadonlySet<ProvisioningLegKind> = new Set(["swap-gas", "bridge-gas"]);

// POO-1131 decision: keyed by `ProvisioningLegKind | "op"`, so the `buy-usdc` → `buy` step-type
// rename does NOT widen it. `buildPlan` emits no fiat leg today (there is no `buy` route class), so
// there is nothing to label here; the `provisioning.steps.buy` label is carried by the fiat step the
// on-ramp planner assembles, which lands with POO-1135. Do not add a `buy` entry pre-emptively.
// `satisfies Record<ProvisioningStepType, ...>` so the fiat `buy` step (POO-1131) is a compile error to
// omit: a missing label key is a runtime next-intl throw, not a type error, so the exhaustive Record is
// what turns it into one. Widened from `ProvisioningLegKind | "op"` when POO-1135 began emitting `buy`.
const LABEL_KEYS = {
  buy: "provisioning.steps.buy",
  bridge: "provisioning.steps.bridge",
  "bridge-gas": "provisioning.steps.bridgeGas",
  "swap-gas": "provisioning.steps.swapGas",
  "swap-token": "provisioning.steps.swapToken",
  op: "provisioning.steps.op",
} satisfies Record<ProvisioningStepType, string>;

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
   * EVERY holding the wallet has, not just the chosen ones. Used ONLY to source gas ([R1]).
   *
   * Gas is a precondition, not funding. `sources` is what the user elected to SPEND on the
   * operation, and making a gas donor conditional on that selection asks them to pick something the
   * rail exists to decide: a user who selects their USDC and leaves their ETH alone has not declined
   * to pay for transactions, they have said which money funds the position.
   *
   * This is the same split the gas TOP-UP already uses. `classifyGasFeasibility` slices a `swap-gas`
   * leg out of a holding it picks from the full inventory (the served context's per-chain gas
   * sources, POO-1098), never from the selection, so the gas bridge reading the selection was the
   * odd one out.
   *
   * Falls back to {@link sources} when absent, which keeps every existing caller and fixture honest.
   */
  inventory?: readonly FundingSource[];
  /**
   * POO-1032's verdict per candidate source chain, keyed by chain id ([R3]). A chain with no entry
   * is treated as unusable: a missing classification is missing information, and assuming OK is how
   * a plan's first broadcast fails for want of gas.
   */
  gasByChain: Readonly<Record<number, GasFeasibility>>;
  /** Max slippage from the settings gear, percent (POO-523 R2). Governs AMM legs only. */
  slippagePct?: number;
  /**
   * How much native the user asked to end up holding, USD (POO-1085 [F2-R2]).
   *
   * A CEILING-RAISER, never a sizer: the gas leg is `max(what the classifier computed, this)`. The
   * classifier's figure is what the route costs, and a leg below it reverts on-chain after the user
   * has signed, so a smaller choice is ignored rather than honoured. Absent, the plan is exactly
   * what it was before this field existed ([F2-R3]).
   */
  gasChoiceUsd?: number;
  /**
   * Whether the fiat on-ramp may fund a shortfall the wallet cannot cover (epic POO-1129 [R1]/[R2]).
   *
   * This is the ONE authority on whether a buy leg exists, threaded from the same source
   * `resolveFundingRoutes` reads for its `onRampEnabled` (`computePlanAction` passes the feature flag).
   * When `false` (the crypto-only cut, POO-1082 D3) the planner behaves exactly as before: a wallet
   * that cannot cover the requirement fails with `PROVISIONING_INSUFFICIENT_FUNDS`, and a gas-blocked
   * chain with no donor fails with `PROVISIONING_GAS_BLOCKED`. When `true`, both dead ends become a
   * fiat-first plan instead: buy on Base ([R2]), then swap/bridge toward the operation's chain.
   *
   * ONE exception survives the flag: `PROVISIONING_GAS_BLOCKED` still stands on a chain the rail
   * cannot deliver native for ({@link onRampCanUnblockGas}), because there the purchase would strand.
   */
  onRampEnabled?: boolean;
  /**
   * WHICH rail will serve the buy leg, for the step's display attribution (POO-1927 [R3]).
   *
   * Threaded from the flags by `computePlanAction` exactly as {@link onRampEnabled} above is, and
   * for the same reason: the engine stays a pure function of its request, so the 80-odd cases in
   * `buildPlan.test.ts` do not each become flag-dependent. The two cannot disagree, because
   * `decideOnRampRail` returns `"none"` precisely when `fiatOnRamp` is off, which is the same
   * condition that makes `onRampEnabled` false and emits no buy step at all.
   *
   * It sets `poweredBy` and NOTHING else. No leg, no sizing and no ordering reads it, which is what
   * keeps [R3] clear of rejection 10 of the epic's handoff ("the provisioning engine is not
   * touched"); the guard test for that claim is `buildPlan.test.ts` POO-1927 [R3], which asserts
   * that flipping this field leaves every other field of every step byte-identical.
   *
   * Absent, the attribution is `"paybis"`: the pre-POO-1927 answer, so every existing caller and
   * fixture keeps its exact meaning. The one production caller always supplies it
   * (`planActions.test.ts` pins that), so the default can never become the shipped answer.
   */
  onRampRail?: OnRampAttribution;
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

/**
 * Can a fiat purchase un-block this chain's gas? POO-1135 [R2]: the rail delivers ETH or USDC on
 * BASE and nothing else, so the only native coin it can ever produce is ETH. Bridging that gas
 * onwards has the same constraint {@link planGasBridge} already carries: a donor must hold the SAME
 * native symbol, because there is no cross-chain different-token route to serve.
 *
 * So on a POL chain (Polygon) a purchase cannot become gas by any path. Falling through the refusal
 * there would emit buy-ETH-on-Base -> swap -> bridge-USDC-to-Polygon and hand back a plan whose
 * final op transaction can NEVER broadcast: the user pays fiat and the USDC lands on a chain where
 * they hold zero native. That is exactly the "never hand back a plan that strands halfway" invariant
 * (UF-22 [R3]), so the refusal stands for any chain this returns false for.
 */
function onRampCanUnblockGas(chainId: number): boolean {
  return nativeToken(chainId).symbol === "ETH";
}

/*
 * The stable question's counterpart to {@link onRampCanUnblockGas} is `onRampCanDeliverStable`, and
 * since POO-1784 it is IMPORTED from `lib/onramp/destinations` rather than declared here. It used to
 * be a private function of this module (POO-1779), which is exactly why the panel's route picker
 * shipped without it and offered a `buy` route this planner then refused: one rule, two places, and
 * only one of them had it.
 *
 * POO-1916 [R1]/[R3] narrowed what it answers. It is no longer `usdcDestination`'s boolean shadow
 * (the ramp's delivery asset and the bridge's far side are different questions) and it no longer
 * claims routability: it says only that the registry names a stable on that chain. The live half is
 * asked HERE, in {@link buildOnRampSteps}, because only this module can ask `/quote`.
 */

/**
 * The chain's STABLE as a leg endpoint, or `null` when the chain is not one we operate on.
 *
 * POO-1779 [R1]: the symbol is the chain's own ("USDG" on Robinhood), because it rides the leg all
 * the way to the rail's row labels and to `ProvisioningStep.toToken`. The address was already
 * per-chain; only the label was a constant.
 */
function usdcToken(chainId: number): ProvisioningLegToken | null {
  const address = getUsdcAddress(chainId);
  return address ? { address, symbol: stableSymbol(chainId), decimals: 6, chainId } : null;
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
  //
  // POO-1107: an OUTAGE is not a routing verdict and must not be read as one. Dropping the source on
  // a 429 told a funded user they had insufficient funds, which is both wrong and unactionable. This
  // used to be safe because the old transport retried a throttled POST; that retry went with the
  // move to pool-party-api (POO-1097), so the distinction has to be made here instead.
  if (!result.ok) {
    if (isTransientFailureCode(result.code)) throw new UpstreamUnavailableError(result.message);
    return null;
  }

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
 * What {@link planGasBridge} concluded: a priced leg, or the reason there is none.
 *
 * The reason is carried rather than discarded because the five ways this refuses are not
 * interchangeable to the user. "No network holds spare ETH" means go get some; "Base holds ETH but
 * less than the bridge will carry" means the money is already there and nearly enough. Collapsing
 * both into "buy a little crypto, or move some over" sent a user to do the wrong thing, and left us
 * with nothing to debug from when it happened.
 */
type GasBridgeOutcome =
  | { priced: PricedLeg; refusal?: undefined }
  | { priced?: undefined; refusal: string };

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
  /**
   * POO-1140: the user's gas headroom choice, USD. The escape leg honours it exactly like the swap
   * top-up does (`ensureGas` → `raiseTopUpToUsd`), which it did not before: it sized from
   * `targetGas.requiredGasUsd` alone, so a user who asked for headroom silently got none here. It is a
   * ceiling raise clamped to the donor's surplus, and it may NEVER turn a donor that could cover the
   * classifier's own figure into a skip: see the per-donor fallback below.
   */
  gasChoiceUsd?: number;
}): Promise<GasBridgeOutcome> {
  const target = nativeToken(args.targetChainId);
  // Why each donor was passed over, in order. A single catch-all message for five different
  // situations ("no chain holds spare ETH" vs "Base has ETH but under the bridge minimum") sends the
  // user off to do the wrong thing, and gave us nothing to debug from when this went wrong in the
  // wild. Collected here, surfaced on the failure, never thrown away.
  const notes: string[] = [];

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

  if (donors.length === 0) {
    const sameAsset = Object.values(args.gasByChain).filter(
      (gas) =>
        gas.chainId !== args.targetChainId && nativeToken(gas.chainId).symbol === target.symbol,
    );
    notes.push(
      sameAsset.length === 0
        ? `no other network uses ${target.symbol}, and a different native asset is not routable`
        : `no ${target.symbol} network has gas to spare (${sameAsset
            .map((g) => `chain ${g.chainId}: ${g.verdict}, spare $${g.surplusUsd.toFixed(4)}`)
            .join("; ")})`,
    );
  }

  for (const donor of donors) {
    // The inventory is the authority on what is actually spendable. A donor whose native holding is
    // not in it cannot be drawn on, whatever the classifier thinks it is worth.
    const held = args.sources.find(
      (source) =>
        source.chainId === donor.chainId && sameAddress(source.address, NATIVE_TOKEN_ADDRESS),
    );
    if (!held) {
      // The likeliest cause is the funding inventory's sub-$1 dust filter, which exists for the
      // PICKER and has no business gating gas: at $1,900/ETH the bridge floor is about $0.56, so a
      // holding that can donate is hidden below a threshold that was never about donating.
      notes.push(
        `chain ${donor.chainId} has $${donor.surplusUsd.toFixed(4)} spare by the classifier, but no native holding reached the planner (dust filter?)`,
      );
      continue;
    }

    const balance = toBigInt(held.amount);
    const balanceMicros = BigInt(Math.round(Math.max(0, held.usd) * 1e6));
    if (balance <= BigInt(0) || balanceMicros <= BigInt(0)) {
      notes.push(`chain ${donor.chainId} native holding is unpriced or empty`);
      continue;
    }

    // USD to base units off the REAL holding, never a constant ([R4] of POO-1032 applies here too):
    // the ratio comes from a balance the inventory priced, so no second price source can disagree
    // with the first. Micro-dollars keep the whole conversion in BigInt.
    const toBaseUnits = (usd: number) =>
      (balance * BigInt(Math.round(Math.max(0, usd) * 1e6))) / balanceMicros;

    // [R2] What this donor can give WITHOUT stranding itself: its surplus, which the classifier
    // already computed as native beyond its own requirement.
    const spendable = toBaseUnits(donor.surplusUsd);

    // POO-1140: the delivered native, in USD. The classifier's figure is the inviolable FLOOR; the
    // user's choice may only lift it, and only as far as this donor's surplus allows. Two candidates
    // are tried in order — the raised target first, the classifier floor as a guaranteed fallback — so
    // the raise can never turn a donor that could cover the floor into a skip (an oversized raise still
    // yields a plan). `raiseTopUpToUsd` is the swap-side twin of this rule.
    const floorUsd = args.targetGas.requiredGasUsd;
    const raisedUsd = Math.min(Math.max(floorUsd, args.gasChoiceUsd ?? 0), donor.surplusUsd);
    const attemptsUsd = raisedUsd > floorUsd ? [raisedUsd, floorUsd] : [floorUsd];

    let priced: PricedLeg | null = null;
    let lastNote = "";
    for (const attemptUsd of attemptsUsd) {
      const wanted = toBaseUnits(attemptUsd);
      const required = wanted < MIN_GAS_BRIDGE_WEI ? MIN_GAS_BRIDGE_WEI : wanted;
      if (required > spendable) {
        lastNote = `chain ${donor.chainId} can spare ${spendable} wei but the bridge needs ${required} (floor ${MIN_GAS_BRIDGE_WEI})`;
        continue;
      }

      // `/quote` is rate-limited on a shared key, so the fallback second call only happens when a
      // raise was requested AND its size cannot be carried within the surplus — the rare, opt-in case.
      const candidate = await sizeBridgeInput({
        index: 0,
        kind: "bridge-gas",
        tokenIn: nativeToken(donor.chainId),
        tokenOut: target,
        required,
        slippagePct: args.slippagePct,
      });
      // A 404 is this pair declining the amount, not an outage: try the floor, then the next donor.
      if (!candidate) {
        lastNote = `chain ${donor.chainId} to ${args.targetChainId}: no quote for ${required} wei`;
        continue;
      }

      // Sizing grosses the INPUT up past `required` to cover the bridge fee, so the surplus test has
      // to be re-run against what actually leaves the donor. Checking only the output would let a leg
      // through that strands the very chain it was drawn from.
      if (toBigInt(candidate.leg.amountIn) > spendable) {
        lastNote = `chain ${donor.chainId} needs ${candidate.leg.amountIn} wei in once fees are covered, over its ${spendable} spare`;
        continue;
      }

      priced = candidate;
      break;
    }

    if (!priced) {
      notes.push(lastNote);
      continue;
    }

    return { priced };
  }

  return { refusal: notes.join(" | ") || "no donor chain was considered" };
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
  // POO-1779 [R1]: parity is a property of BEING the dollar, not of the string "USDC".
  if (isStableSymbol(token.symbol)) {
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
/**
 * An upstream outage encountered while pricing. Thrown rather than returned so it cannot be mistaken
 * for `null`, which every pricing caller already reads as "this source is not routable" (POO-1107).
 */
class UpstreamUnavailableError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "UpstreamUnavailableError";
  }
}

export async function buildPlan(
  request: BuildPlanRequest,
  options: BuildPlanOptions = {},
): Promise<BuildPlanResult> {
  try {
    return await buildPlanInner(request, options);
  } catch (error) {
    // POO-1107 [R2]: a retryable outage, reported as itself. Anything else keeps propagating: this
    // catch exists to classify one condition, not to swallow bugs.
    if (error instanceof UpstreamUnavailableError) {
      return {
        ok: false,
        code: "PROVISIONING_UPSTREAM_UNAVAILABLE",
        message: `Could not price a route just now: ${error.message}. This is temporary, please try again.`,
      };
    }
    throw error;
  }
}

async function buildPlanInner(
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
    const outcome = await planGasBridge({
      targetChainId: request.targetChainId,
      targetGas,
      gasByChain: request.gasByChain,
      // The FULL inventory: a donor the user did not elect to spend is still a donor ([R1]).
      sources: request.inventory ?? request.sources,
      slippagePct,
      ...(request.gasChoiceUsd === undefined ? {} : { gasChoiceUsd: request.gasChoiceUsd }),
    });
    // POO-1135: a blocked target chain is no longer a dead end when the fiat on-ramp is enabled AND
    // the rail can actually deliver this chain's native coin ({@link onRampCanUnblockGas}). The buy
    // path below buys native ETH on Base ([R1] gas-first) and the target chain's gas is re-derived
    // from the settled delta at execution (POO-1136), so we fall through rather than refusing here.
    //
    // For a POL chain the fall-through is NOT available: no rail asset and no donor can become gas
    // there, so a bought balance would strand. With the on-ramp OFF, the refusal stands for every
    // chain exactly as before.
    if (!outcome.priced && !(request.onRampEnabled && onRampCanUnblockGas(request.targetChainId))) {
      return {
        ok: false,
        code: "PROVISIONING_GAS_BLOCKED",
        // The reason rides on the message so a failure in the wild is diagnosable from the response
        // alone, without a repro. The UI still shows its own copy; this is for the log and the bug
        // report, which is exactly what was missing when this first went wrong.
        message: `Chain ${request.targetChainId} holds no native coin to pay for the operation's own transaction, and no other network could send ${nativeToken(request.targetChainId).symbol} over. ${outcome.refusal}`,
      };
    }
    gasBridge = outcome.priced ?? null;
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

  const commitKey = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`;
  const committedOf = (chainId: number, address: string) =>
    committed.get(commitKey(chainId, address)) ?? BigInt(0);
  const commit = (chainId: number, address: string, amount: bigint) => {
    committed.set(commitKey(chainId, address), committedOf(chainId, address) + amount);
  };
  const setCommitted = (chainId: number, address: string, amount: bigint) => {
    committed.set(commitKey(chainId, address), amount);
  };

  // [R4] Seeded BEFORE any funding leg, so it is leg 0 and every later `legs.length` index follows
  // it. Position is necessary but not sufficient: the rail additionally waits for a bridge to SETTLE
  // before advancing, which is what actually stops a target-chain broadcast the gas has not arrived
  // for. Its USD is derived from the donor's real holding like every other leg's.
  if (gasBridge) {
    const donor = (request.inventory ?? request.sources).find(
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
    // The donor's native is spent by THIS leg, so the funding loop must not plan it a second time.
    // Without this the same balance funds both, and when the donor's native is also the funding
    // source the plan draws over 100% of it: the gas bridge lands (irreversibly), then the funding
    // leg reverts for insufficient native and the user is stranded having paid to bridge gas. That
    // is exactly the "never hand back a plan that strands halfway" invariant (UF-22 [R3]).
    //
    // Seeded AFTER the commit helpers for that reason; they used to be declared below this block.
    commit(gasBridge.leg.chainId, NATIVE_TOKEN_ADDRESS, toBigInt(gasBridge.leg.amountIn));
  }

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

    // [F2-R2] The user's choice may only RAISE the slice, never shrink it below what the classifier
    // priced. See `raiseTopUpToUsd` for why the two figures answer different questions.
    //
    // POO-1141: but the raise must not STARVE the operation. When the gas token is also a funding
    // source the operation draws on, a large headroom choice can commit balance the operation needs,
    // surfacing a plan-time `PROVISIONING_INSUFFICIENT_FUNDS` on a holding that would have covered
    // both. Triage found that error unrecoverable in practice (the error branch returns before the
    // plan card, so the selector unmounts, and "Try again" exits the flow), so the DISCRETIONARY raise
    // is bounded to leave the operation's still-unmet requirement in the holding. The classifier's own
    // figure is the floor and is never touched: an insufficiency at the floor is a genuine shortfall,
    // not a raise-induced one, and is reported as `PROVISIONING_INSUFFICIENT_FUNDS` as before.
    const gasToken = verdict.topUp.token;
    const gasIsFundingSource = request.sources.some(
      (source) =>
        source.chainId === verdict.chainId && sameAddress(source.address, gasToken.address),
    );
    // `remaining` is the operation's still-unmet requirement in target-chain USDC base units, read at
    // parity. When the gas holding is not a funding source there is nothing to starve, so no bound.
    const opRemainingUsd = Number(remaining) / 1_000_000;
    const raiseCeilingUsd = gasIsFundingSource
      ? Math.max(0, gasToken.balanceUsd) - opRemainingUsd
      : Number.POSITIVE_INFINITY;
    const boundedChoiceUsd =
      request.gasChoiceUsd === undefined
        ? undefined
        : Math.min(request.gasChoiceUsd, raiseCeilingUsd);
    const topUp = raiseTopUpToUsd(verdict.topUp, boundedChoiceUsd);

    const token = topUp.token;
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
      amount: topUp.amountRaw,
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
    commit(verdict.chainId, token.address, toBigInt(topUp.amountRaw));
    toppedUpChains.add(verdict.chainId);
    topUpUsd += topUp.buyNativeUsd;
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

  // POO-1135: the fiat on-ramp funds whatever the wallet could not. Reached when the on-ramp is
  // enabled AND either the operation is still short (`remaining > 0`) or the target chain is still
  // gas-blocked with no crypto donor to unblock it. The purchase always lands on Base ([R2]).
  // The SAME rail-reachability condition the refusal above is gated on, restated locally so the
  // gas-first buy can never be emitted for a chain the purchase could not un-block. Today the
  // refusal makes that unreachable; keeping the condition here means a future change to the refusal
  // cannot silently start emitting a stranding plan from 200 lines away.
  const gasStillBlocked =
    targetGas?.verdict === "BLOCKED" &&
    gasBridge === null &&
    onRampCanUnblockGas(request.targetChainId);
  const onRampSteps: ProvisioningStep[] =
    request.onRampEnabled && (remaining > BigInt(0) || gasStillBlocked)
      ? await buildOnRampSteps({
          shortfall: remaining,
          targetChainId: request.targetChainId,
          gasByChain: request.gasByChain,
          gasStillBlocked,
          slippagePct,
          ...(request.gasChoiceUsd === undefined ? {} : { gasChoiceUsd: request.gasChoiceUsd }),
          // POO-1927 [R3]: display attribution only, see `BuildPlanRequest.onRampRail`.
          ...(request.onRampRail === undefined ? {} : { onRampRail: request.onRampRail }),
        })
      : [];
  // The purchase (and its downstream legs) cover the rest, so nothing is left unfunded.
  if (onRampSteps.length > 0) remaining = BigInt(0);

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
      onRampSteps,
    }),
  };
}

/**
 * The fiat purchase path, as DISPLAY steps (POO-1135, epic [R1]/[R2]).
 *
 * `sizeOnRampOrder` (POO-1133) picks ETH-BASE vs USDC-BASE and the fiat amount; its `order` drops
 * straight onto the `buy` step with no remap. It consumes `requiredUsd` AS-IS, and since POO-1641
 * that IS the remainder: there is no fee headroom to add on this side. The purchase always lands on
 * Base ([R2]), then:
 *
 *   - a bought-ETH plan swaps the op-funding slice to USDC on Base ([R1]) — SKIPPED when that slice is
 *     zero (a pure gas top-up), despite `needsSwapToUsdc` mirroring the ETH choice, because there is
 *     nothing to convert and a zero-value swap only charges the user gas (POO-1133 review carry);
 *   - an off-Base target bridges the bought USDC to the operation's chain ([R2]).
 *
 * These steps carry NO {@link ProvisioningLeg}: their real input is the observed settlement delta,
 * which does not exist until the purchase clears, so POO-1136 re-sizes and executes them from that
 * delta at execution ([R4]/[R8]). They exist here for the plan the user reviews, and the cost model
 * skips a legless step, so they contribute no fabricated Uniswap fee to the quote.
 */
async function buildOnRampSteps(args: {
  /** Base units of the target chain's STABLE the on-ramp must cover (the op-funding shortfall). */
  shortfall: bigint;
  targetChainId: number;
  gasByChain: Readonly<Record<number, GasFeasibility>>;
  /** The target chain holds no native coin and no crypto donor could reach it ([R1] gas-first buy). */
  gasStillBlocked: boolean;
  gasChoiceUsd?: number;
  /** Passed through to the routability probe only; the fiat steps themselves carry no quote. */
  slippagePct: number;
  /** POO-1927 [R3]: the rail credited on the buy step. Display only, see `BuildPlanRequest`. */
  onRampRail?: OnRampAttribution;
}): Promise<ProvisioningStep[]> {
  const { shortfall, targetChainId, gasByChain, gasStillBlocked, gasChoiceUsd, slippagePct } = args;

  // POO-1779: no purchase at all when this app cannot even name a stable on the target chain
  // ({@link onRampCanDeliverStable}). The caller leaves `remaining` untouched for an empty array, so
  // the shortfall dead-ends in `PROVISIONING_INSUFFICIENT_FUNDS` exactly as it does with the flag
  // off, which the panel already renders as "you need <stable> on <chain>".
  //
  // Scoped to a shortfall on purpose: a gas-only purchase (`shortfall === 0`) buys ETH on Base and
  // never touches a stable, so it stays available for every chain {@link onRampCanUnblockGas}
  // already allows, Robinhood Chain included. Refusing it here would assemble a legless plan with
  // `needed: false` (nothing else emits a leg for a BLOCKED chain) — a confirm that runs nothing and
  // reports success, which is a worse dead end than the refusal it replaced.
  if (shortfall > BigInt(0) && !onRampCanDeliverStable(targetChainId)) return [];

  /*
   * POO-1916 [R3]: and no purchase when the BRIDGE will not carry it there.
   *
   * The predicate above is static — it reads the registry, and since POO-1916 it deliberately says
   * nothing about routing. This is the live half, and it exists because the fiat bridge is the one
   * bridge in this planner that was never quoted: its steps are legless by design ([R4]/[R8]), sized
   * at execution from the settled delta, so nothing in the plan ever asked whether the pair is
   * served. POO-1784 papered over that with "the bridge is same-token, therefore always routable",
   * which is the sentence this issue deletes.
   *
   * One `/quote` on a path that already makes several, and only when something actually crosses.
   * It buys the difference between "we knew and did not offer it" and "the user paid a card and the
   * money stranded on Base", which is the UF-22 invariant this module keeps citing. Its NUMBERS are
   * discarded on purpose: the real input is the settlement delta, which does not exist yet.
   *
   * Sized at the amount that will really cross, never below the on-ramp floor: a sub-floor probe can
   * 404 for economics rather than for the pair (`MIN_GAS_BRIDGE_WEI` documents that failure on the
   * native side) and would suppress a route the floored purchase funds perfectly well.
   *
   * A 429 is NOT an answer here (POO-1107): `priceLeg` throws `UpstreamUnavailableError` on a
   * transient code, so an outage fails the plan loudly instead of telling a funded user their chain
   * cannot be reached.
   */
  if (shortfall > BigInt(0) && targetChainId !== ONRAMP_CHAIN_ID) {
    const bought = usdcToken(ONRAMP_CHAIN_ID);
    const lands = usdcToken(targetChainId);
    if (!bought || !lands) return [];
    const floor = BigInt(Math.round(PAYBIS_MIN_USD * 1_000_000));
    const probed = await priceLeg({
      index: 0,
      kind: "bridge",
      tokenIn: bought,
      tokenOut: lands,
      amount: (shortfall > floor ? shortfall : floor).toString(),
      type: "EXACT_INPUT",
      slippagePct,
      requoteAtExecution: false,
    });
    if (!probed) return [];
  }

  const shortfallUsd = round2(Number(shortfall) / 1_000_000);

  // POO-1641: the buy is sized to the bare remainder, because the bare remainder is what lands.
  //
  // POO-1166 grossed this up by 1% (`needed / (1 - rate)`) on the belief that a Pool Party cut came
  // out of the delivery. It does not. The cut is a partner-side configuration, already embedded in
  // the price Paybis quotes, and it is not 1% any more either (Rafael, 2026-08-16); nothing in
  // `pool-party-api` collects it. So the gross-up was charging every buyer a percent that no one
  // receives, and a headroom for a fee nobody collects is not a safety margin.
  //
  // Paybis's own cut stays unmodelled here for the reason it always did: POO-1139 made the quote
  // received-fixed, so THEY compute the charge from the amount we ask them to deliver.
  //
  // The downstream swap/bridge display steps are on `shortfallUsd` too, and now trivially so: it is
  // one figure end to end. PAYBIS_MIN_USD is still applied AFTER this, inside `sizeOnRampOrder`, so a
  // tiny remainder floors up to an order Paybis will accept rather than one it would reject. That
  // floor is what makes removing an upstream term safe: it clamps whatever it is handed.
  //
  // There is deliberately no `fundingUsd` local any more: the whole reason one existed was to name
  // "the remainder, adjusted", and an alias for an unadjusted figure is an invitation to re-adjust it.

  // The buy and its downstream swap/bridge ORIGIN transactions all run on Base, so the purchase has to
  // include gas (buy ETH, [R1] gas-first) whenever the wallet cannot already pay for a Base
  // transaction. Buying ETH and keeping a floor is the SAFE direction: a wallet that turns out to have
  // had Base gas is merely left holding a little ETH, never stranded mid-route.
  //
  // A Base TOP_UP verdict therefore reads as "not OK" here and the buy goes ETH-first EVEN THOUGH
  // `ensureGas` has already planned a Base swap-gas leg. That double-provisioning is DELIBERATE
  // (POO-1135 review decision), not an oversight: the swap-gas leg is itself a Base transaction, so
  // it cannot fund the very transactions it would have to run before it — the purchase's own swap and
  // bridge origin transactions on Base. Buying ETH first is what makes those executable at all. Per
  // [R4] any surplus simply stays in the wallet and never strands, so the cost is a few dollars more
  // on the card, which is the side to err on when the alternative is an unbroadcastable route.
  const baseGas = gasByChain[ONRAMP_CHAIN_ID];
  /**
   * POO-1542 [B]: the Base term is `onRampRouteBuysGas` now, shared with the "Where from" row.
   *
   * It used to be spelled out here while the panel spelled a DIFFERENT question (the target chain's
   * verdict) for the same decision, so the row could print `Buy $210.00` with no reserve on a route
   * that was about to buy ETH. The helper carries the reasoning; `gasStillBlocked` stays ORed in
   * because it depends on state only this function has (whether a gas bridge leg was planned), but it
   * requires a `BLOCKED` target verdict the helper's own target term already reads as not-OK, so the
   * decision here IS the helper and the row matches it exactly.
   */
  const needsGasBuy = gasStillBlocked || onRampRouteBuysGas(gasByChain, targetChainId);

  const { order, needsSwapToUsdc } = sizeOnRampOrder({
    requiredUsd: shortfallUsd,
    standalone: false,
    gasFundedByOnRamp: needsGasBuy,
    ...(baseGas?.shortfallUsd === undefined ? {} : { classifierGasUsd: baseGas.shortfallUsd }),
    ...(gasChoiceUsd === undefined ? {} : { gasChoiceUsd }),
  });
  const buysEth = order.currencyCode === "ETH-BASE";
  const steps: ProvisioningStep[] = [];

  // [R2] The purchase, always leading, always on Base. `poweredBy` + `order` are the fiat counterpart
  // of a leg's on-chain detail (POO-1131). Deliberately NO `fromChainId`: fiat has no chain, and the
  // merged caption path (PR 707) must interpolate the row without a missing-placeholder throw.
  steps.push({
    type: "buy",
    key: "buy",
    labelKey: LABEL_KEYS.buy,
    fromToken: "USD",
    toToken: buysEth ? "ETH" : "USDC",
    toChainId: ONRAMP_CHAIN_ID,
    amountUsd: round2(Number(order.fiatAmount)),
    amountToken: order.fiatAmount,
    // POO-1927 [R3]: the rail that will actually serve, not the literal `"paybis"` this used to be
    // on every fiat leg including one Privy brokers through Stripe or MoonPay. The fallback is the
    // pre-POO-1927 answer for a caller that has not been taught the rail; see `BuildPlanRequest`.
    poweredBy: args.onRampRail ?? "paybis",
    order,
  });

  // [R1] Bought ETH for gas: convert the op-funding slice to USDC on Base. Skipped when the slice is
  // zero (a gas-only requirement), despite `needsSwapToUsdc` — the carry above.
  if (buysEth && needsSwapToUsdc && shortfall > BigInt(0)) {
    steps.push({
      type: "swap-token",
      key: "buy-swap",
      labelKey: LABEL_KEYS["swap-token"],
      fromToken: "ETH",
      toToken: "USDC",
      fromChainId: ONRAMP_CHAIN_ID,
      toChainId: ONRAMP_CHAIN_ID,
      amountUsd: shortfallUsd,
      amountToken: shortfallUsd.toFixed(2),
    });
  }

  // [R2] Off-Base target: bridge the bought USDC from Base to the operation's chain, after settlement.
  //
  // POO-1916 [R2]: `toToken` is the TARGET chain's own stable, read through `stableSymbol`, not the
  // literal the far side used to carry. `fromToken` stays "USDC" because that is genuinely what the
  // rail sells and what leaves Base. The two differ on Robinhood Chain, and saying "USDC" on both
  // sides would print a token the user will never hold on the row describing where their money goes —
  // and the rail's `resolveFiatToken` resolves this symbol to an ADDRESS, so it is a money path, not
  // just a label.
  if (shortfall > BigInt(0) && targetChainId !== ONRAMP_CHAIN_ID) {
    steps.push({
      type: "bridge",
      key: "buy-bridge",
      labelKey: LABEL_KEYS.bridge,
      fromToken: "USDC",
      toToken: stableSymbol(targetChainId),
      fromChainId: ONRAMP_CHAIN_ID,
      toChainId: targetChainId,
      amountUsd: shortfallUsd,
      amountToken: shortfallUsd.toFixed(2),
    });
  }

  return steps;
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
  /**
   * POO-1135: the fiat purchase and its downstream DISPLAY steps, or empty. Not legs, so they are
   * threaded in rather than derived from `legs`: `legs.map` below cannot see them, and both the
   * nothing-needed early return and the reason/variant derivation must ([R1]/[R2]).
   */
  onRampSteps: ProvisioningStep[];
}): ProvisioningPlan {
  const { legs, legSources, quotedAt, slippagePct, requiredUsd, onRampSteps } = args;

  // [R2] The trailing display anchor, always last, never a leg.
  const opStep: ProvisioningStep = {
    type: "op",
    key: "op",
    labelKey: LABEL_KEYS.op,
    amountUsd: round2(requiredUsd),
  };

  // Nothing needed only when there is NEITHER a crypto leg NOR a fiat purchase. A fiat-only plan on
  // Base (buy USDC, no leg) has `legs.length === 0` and must not report `needed: false`.
  if (legs.length === 0 && onRampSteps.length === 0) {
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

  const legSteps: ProvisioningStep[] = legs.map((leg, index) => ({
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
  // [R2] The fiat purchase LEADS: buy -> (swap) -> (bridge) -> crypto legs -> op. Its steps carry no
  // leg, so the leg-indexed keys above never collide with them.
  const steps: ProvisioningStep[] = [...onRampSteps, ...legSteps, opStep];

  const hasGasLeg = legs.some((leg) => GAS_LEG_KINDS.has(leg.kind));
  // A gas bridge crosses a network too, and the reason line exists to tell the user why their money
  // is moving between chains at all.
  const hasBridgeLeg = legs.some((leg) => leg.kind === "bridge" || leg.kind === "bridge-gas");
  const hasFundingLeg = legs.some((leg) => !GAS_LEG_KINDS.has(leg.kind));

  // The fiat purchase's own contributions, read off the emitted steps: an ETH buy funds gas; a USDC
  // buy or an ETH->USDC swap funds the operation; a fiat bridge crosses a network.
  const buyStep = onRampSteps.find((step) => step.type === "buy");
  const hasFiatGas = buyStep?.toToken === "ETH";
  const hasFiatBridge = onRampSteps.some((step) => step.type === "bridge");
  const hasFiatFunding =
    buyStep?.toToken === "USDC" || onRampSteps.some((step) => step.type === "swap-token");

  const reason: ProvisioningReason[] = [];
  if (hasGasLeg || hasFiatGas) reason.push("gas");
  if (args.hasRequirement && (hasFundingLeg || hasFiatFunding)) reason.push("usdc");
  if (hasBridgeLeg || hasFiatBridge) reason.push("network");

  return {
    needed: true,
    reason,
    // Gas alone routes to the simpler buy-gas modal; anything that moves the operation's own funds
    // is the wizard. Same vocabulary the six op modals already branch on (POO-1033 [R3]).
    variant: hasFundingLeg || hasFiatFunding ? "multi" : "gas-only",
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
