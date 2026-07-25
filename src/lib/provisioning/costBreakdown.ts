/**
 * @id PP-CORE-LIB-056 (POO-1035, POO-1047)
 * @name provisioning cost model
 * @implements-rules-version v2 (POO-1047 rules v1) · v1 (POO-1035 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * What a funding plan costs, itemized per source and in aggregate, and the four `ProvisioningQuote`
 * figures the "You pay" line is built from.
 *
 * ## One function, two callers, no drift
 *
 * The planner (`buildPlan`, PP-CORE-LIB-055) needs the aggregate to fill its quote; the cost table
 * (POO-1040) needs the itemization to render. Those are the same numbers, so they are computed here
 * once, by a pure function over the plan's own steps, and BOTH callers run it. A user who approves a
 * total and then reads a breakdown that disagrees with it has been shown two different prices for one
 * transaction; keeping the derivation in one place is what makes that impossible rather than merely
 * unlikely. {@link planCostBreakdown} is the client entry point, {@link buildCostBreakdown} the
 * planner's.
 *
 * ## What is a cost, and what only looks like one
 *
 * `totalPayUsd = shortfallUsd + bufferUsd + feesUsd` is the contract's own definition ([R2]) and is
 * not re-derived here. Underneath it:
 *
 *   - **gas** is each on-chain leg's own quoted gas ([R1]). A signature step costs none ([R4]).
 *   - **slippage** is the allowance on AMM legs ONLY. Across quotes a bridge leg and
 *     `slippageTolerance` does not govern it (`02_BRIDGE_ARCHITECTURE.md` §1.4), so charging a
 *     tolerance line for one would be a fiction ([R3]).
 *   - **bridge fee** is the quoted spread, `amountIn − amountOutQuoted`, taken from the bridge quote
 *     ([R3]). Both sides of the leg are the same asset, so the difference IS the fee and no reference
 *     price is needed to state it.
 *   - **swap cost** is reported ([R1]) and deliberately **excluded from every total**. The quoted
 *     output the route is sized against is already net of the AMM's fee and spread, so the user pays
 *     it by receiving less, not by paying more; adding a line for it would charge it twice. This is
 *     the double count POO-1034 refused to introduce, and it stays refused.
 *   - **price impact** is the quote's own figure ([R7]), never derived. Its absence on a bridge leg
 *     is correct, not a gap. POO-1047 makes that absence STRUCTURAL rather than incidental, because
 *     the same figure now gates the plan: see {@link planPriceImpactPct}.
 *
 * ## Money
 *
 * Token amounts arrive as base-unit decimal strings and are differenced as BigInt ([R6]): a bridge
 * spread on an 18-decimal asset runs far past `Number.MAX_SAFE_INTEGER`. USD is accumulated as
 * INTEGER micro-dollars and exposed rounded to cents, because a breakdown a person reads has to add
 * up: `100 + 1.27 + 0.1` is `101.36999999999999` in IEEE-754, and a table whose rows do not sum to
 * its total reads as a bug in the price. Every exposed figure is display-grade; the authoritative
 * amounts remain the base-unit strings on the legs.
 *
 * ## Boundaries
 *
 * Pure and client-importable: no I/O, no clock, no `server-only`. The figures it reads were produced
 * server-side by the live Trading API and travel to the browser inside the plan.
 */

import type {
  ProvisioningLeg,
  ProvisioningLegKind,
  ProvisioningPlan,
  ProvisioningQuote,
  ProvisioningStep,
} from "./types";

/** The four contract figures, kept tied to the contract rather than re-declared ([R2]). */
export type ProvisioningQuoteFigures = Pick<
  ProvisioningQuote,
  "shortfallUsd" | "bufferUsd" | "feesUsd" | "totalPayUsd"
>;

/** The cost lines of one source, or of the whole plan ([R1]). Every figure is USD, to the cent. */
export interface ProvisioningCostLines {
  /**
   * What the AMM legs cost to execute: value in, less value out.
   *
   * **Informational, and a term of nothing.** It is already inside the quoted output, so adding it to
   * a total double-counts it. Legs whose output has no price on the plan (a gas swap buys the native
   * coin, which the plan carries no rate for) are excluded rather than guessed at.
   */
  swapCostUsd: number;
  /** The bridge's own take, from its quote: `amountIn − amountOutQuoted` ([R3]). */
  bridgeFeeUsd: number;
  /** Every on-chain leg's quoted gas, summed. A `SIGN_MSG` step contributes zero ([R4]). */
  gasUsd: number;
  /** The slippage allowance on AMM legs. Always zero for a bridge leg ([R3]). */
  slippageUsd: number;
  /**
   * The worst AMM price impact across these legs, percent, when a quote reported one ([R7]).
   *
   * The MAXIMUM rather than a sum: impacts on separate legs do not add up to anything a user can act
   * on, and the surface that reads this compares one figure against one threshold
   * (`HIGH_PRICE_IMPACT_PCT`). Absent when no leg reported one, which is the normal case for a plan
   * that is all bridge.
   */
  priceImpactPct?: number;
  /**
   * `gasUsd + slippageUsd + bridgeFeeUsd`: the provisioning OVERHEAD, i.e. the buffer plus the fees.
   * It excludes the shortfall (which is the operation's own money, not a cost) and the swap cost
   * (already paid inside the quote).
   */
  totalUsd: number;
}

/** What one funding source contributes to the bill ([R1]). */
export interface ProvisioningCostSource {
  /** `chainId:address` of the holding these legs spend. Stable across a re-quote. */
  key: string;
  chainId: number;
  address: string;
  symbol: string;
  /** USD this source hands over: the legs that spend the holding itself, not the ones they feed. */
  spendUsd: number;
  /** The `ProvisioningStep.key`s attributed to this source, in execution order. */
  stepKeys: readonly string[];
  lines: ProvisioningCostLines;
}

/** One on-chain leg's own gas ([R1]). Kept per leg so the table can show where the gas goes. */
export interface ProvisioningCostGasLine {
  stepKey: string;
  chainId: number;
  kind: ProvisioningLegKind;
  /** USD, to the micro-dollar: L2 gas is routinely sub-cent and must not round away to nothing. */
  usd: number;
}

/** The whole bill: per source, per leg, in aggregate, and as the contract's four figures. */
export interface ProvisioningCostModel {
  /** Funding sources in route order, which is the order the user selected them in. */
  sources: readonly ProvisioningCostSource[];
  /** Every on-chain leg's gas, in execution order. */
  gas: readonly ProvisioningCostGasLine[];
  /** The aggregate lines. Exactly the sum of {@link sources}, so the table adds up. */
  totals: ProvisioningCostLines;
  /** TRUE when any leg crosses chains. Drives the fee tooltip's Bridge line ([R5]). */
  crossChain: boolean;
  /** The contract figures, ready to drop into a {@link ProvisioningQuote} ([R2]). */
  quote: ProvisioningQuoteFigures;
}

export interface CostBreakdownInput {
  /**
   * The plan's ordered steps, `op` anchor included (it is not a leg and costs nothing).
   *
   * PP-INTEGRATION-POINT: every figure read off these steps was produced by a live Uniswap
   * `POST /quote` inside the server-only planner (PP-CORE-LIB-055). Nothing here is a constant, and
   * nothing here calls out: the model is offline by construction.
   */
  steps: readonly ProvisioningStep[];
  /** The bare gap the operation needs, USD. Becomes `ProvisioningQuote.shortfallUsd` unchanged. */
  shortfallUsd: number;
  /**
   * Max slippage the plan was quoted with, percent (POO-523 R2). Absent means the plan recorded
   * none, and no allowance is claimed: substituting the investor default would present a tolerance
   * this plan was not quoted with.
   */
  slippagePct?: number;
}

/** Micro-dollars per USD. The internal unit: integer, so sub-cent gas survives being summed. */
const MICROS = 1_000_000;

/** A USD figure as integer micro-dollars. A NaN or negative reading contributes nothing ([R6]). */
function toMicros(usd: number | undefined): number {
  return typeof usd === "number" && Number.isFinite(usd) && usd > 0 ? Math.round(usd * MICROS) : 0;
}

/** Micro-dollars back to a display-grade USD figure, rounded to the cent. */
function toUsd(micros: number): number {
  return Math.round(micros / 10_000) / 100;
}

/** A base-unit decimal string as a BigInt, or `0n` when it is not one (mirrors `buildPlan`). */
function toBigInt(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : BigInt(0);
}

/** A BigInt micro-dollar count as a safe number. An implausible scale contributes zero, never NaN. */
function microsFromBigInt(value: bigint): number {
  const asNumber = Number(value);
  return Number.isSafeInteger(asNumber) && asNumber > 0 ? asNumber : 0;
}

/** Do two leg endpoints name the same token on the same chain? */
function sameEndpoint(
  a: ProvisioningLeg["tokenOut"] | undefined,
  b: ProvisioningLeg["tokenIn"],
): boolean {
  return (
    a !== undefined &&
    a.chainId === b.chainId &&
    a.address.toLowerCase() === b.address.toLowerCase()
  );
}

/** The grouping key of the holding a leg spends. */
function sourceKey(token: ProvisioningLeg["tokenIn"]): string {
  return `${token.chainId}:${token.address.toLowerCase()}`;
}

/**
 * A base-unit amount of a USDC-denominated endpoint in micro-dollars, at parity.
 *
 * USDC is read at $1 throughout this codebase, and it is the only asset the plan can price without a
 * rate: the intermediary of every route is USDC precisely because every chain has it. The scaling is
 * BigInt so an 18-decimal balance keeps its magnitude on the way to a display figure ([R6]).
 */
function usdcMicros(amount: string, decimals: number): number {
  const units = BigInt(10) ** BigInt(Math.max(0, decimals));
  return microsFromBigInt((toBigInt(amount) * BigInt(MICROS)) / units);
}

/** Is this endpoint one we can price without a quote? */
const isUsdc = (token: ProvisioningLeg["tokenIn"]): boolean =>
  token.symbol.toUpperCase() === "USDC";

/**
 * The bridge's fee, in micro-dollars: what went in, less what the bridge quoted out ([R3]).
 *
 * Exact by construction, because both sides of a bridge leg are the SAME asset: the difference is the
 * fee, with no reference price involved. Priced at parity when that asset is USDC (always, today, by
 * how the planner picks its bridge intermediary), and otherwise pro-rated against the leg's own USD
 * notional rather than assumed to be a dollar.
 */
function bridgeFeeMicros(leg: ProvisioningLeg, notionalMicros: number): number {
  const amountIn = toBigInt(leg.amountIn);
  const spread = amountIn - toBigInt(leg.amountOutQuoted);
  if (spread <= BigInt(0)) return 0;
  if (isUsdc(leg.tokenOut)) return usdcMicros(spread.toString(), leg.tokenOut.decimals);
  if (amountIn <= BigInt(0)) return 0;
  return microsFromBigInt((BigInt(notionalMicros) * spread) / amountIn);
}

/** A mutable accumulator: micro-dollars per line, plus the worst impact seen. */
interface Accumulator {
  swapCost: number;
  bridgeFee: number;
  gas: number;
  slippage: number;
  priceImpactPct?: number;
}

const emptyAccumulator = (): Accumulator => ({ swapCost: 0, bridgeFee: 0, gas: 0, slippage: 0 });

function add(into: Accumulator, from: Accumulator): void {
  into.swapCost += from.swapCost;
  into.bridgeFee += from.bridgeFee;
  into.gas += from.gas;
  into.slippage += from.slippage;
  if (from.priceImpactPct !== undefined) {
    into.priceImpactPct = Math.max(into.priceImpactPct ?? from.priceImpactPct, from.priceImpactPct);
  }
}

/** Round an accumulator into the lines a person reads. */
function toLines(totals: Accumulator): ProvisioningCostLines {
  const gasUsd = toUsd(totals.gas);
  const slippageUsd = toUsd(totals.slippage);
  const bridgeFeeUsd = toUsd(totals.bridgeFee);
  return {
    swapCostUsd: toUsd(totals.swapCost),
    bridgeFeeUsd,
    gasUsd,
    slippageUsd,
    ...(totals.priceImpactPct === undefined ? {} : { priceImpactPct: totals.priceImpactPct }),
    // Summed from the ROUNDED lines, not from the raw micros: this figure sits directly under those
    // three in the table, and it has to equal what they say.
    totalUsd: toUsd(toMicros(gasUsd) + toMicros(slippageUsd) + toMicros(bridgeFeeUsd)),
  };
}

/** One step's contribution to the bill. */
function priceStep(step: ProvisioningStep, leg: ProvisioningLeg, slippagePct: number): Accumulator {
  const notionalMicros = toMicros(step.amountUsd);
  const line = emptyAccumulator();

  // [R4] A signature costs no gas. The quote's figure is ignored rather than trusted: a payload that
  // is signed, not broadcast, cannot spend any.
  line.gas = step.method === "SIGN_MSG" ? 0 : toMicros(leg.gasUsd);

  if (leg.kind === "bridge") {
    line.bridgeFee = bridgeFeeMicros(leg, notionalMicros);
  } else {
    // [R3] AMM legs alone carry the allowance.
    line.slippage = Math.round((notionalMicros * Math.max(0, slippagePct)) / 100);
    // The swap's realized cost, only where the output has a price on the plan. Clamped at zero: a
    // negative reading is the holdings feed and the route disagreeing about the input's price, which
    // is not a rebate and must not render as one.
    if (isUsdc(leg.tokenOut)) {
      const outMicros = usdcMicros(leg.amountOutQuoted, leg.tokenOut.decimals);
      line.swapCost = Math.max(0, notionalMicros - outMicros);
    }
  }

  // [R7] Straight from the quote, never derived, and only off an AMM leg.
  //
  // POO-1047 [R5]: a bridge leg is quoted by Across and `quote.priceImpact` is an AMM figure, so a
  // figure that rides along on one describes nothing. `buildPlan` copies whatever the quote reports
  // onto the leg regardless of kind, which is exactly why the exclusion has to be enforced HERE
  // rather than assumed upstream: this figure is now what the price-impact gate judges, and a stray
  // reading would block a route that carries no AMM risk at all.
  if (
    leg.kind !== "bridge" &&
    typeof leg.priceImpactPct === "number" &&
    Number.isFinite(leg.priceImpactPct)
  ) {
    line.priceImpactPct = leg.priceImpactPct;
  }
  return line;
}

/** A source under construction: the legs it pays for, and what it hands over. */
interface SourceGroup {
  key: string;
  chainId: number;
  address: string;
  symbol: string;
  spendMicros: number;
  stepKeys: string[];
  totals: Accumulator;
}

/**
 * Attribute every leg to the holding that pays for it ([R1]).
 *
 * A leg whose input is the previous leg's output CONTINUES that route (the bridge that carries a
 * swap's proceeds is paid for by whoever funded the swap); any other leg starts a new one, spending a
 * holding of its own. Runs that spend the same holding are then merged, so a chain's gas top-up shows
 * up inside the source that buys it rather than as a second row for one token.
 *
 * This is derived from the plan rather than carried on it deliberately: a plan is a pure function of
 * current holdings and is re-derived on every re-quote, so an attribution field would be one more
 * thing that can go stale, and the route already states where each leg's money comes from.
 */
function groupBySource(
  steps: readonly ProvisioningStep[],
  slippagePct: number,
): { sources: SourceGroup[]; gas: ProvisioningCostGasLine[] } {
  const groups = new Map<string, SourceGroup>();
  const order: string[] = [];
  const gas: ProvisioningCostGasLine[] = [];

  let previousOut: ProvisioningLeg["tokenOut"] | undefined;
  let currentKey: string | undefined;

  for (const step of steps) {
    const leg = step.leg;
    // A step with no leg is not an on-chain leg: the `op` anchor, and every step of a mock plan.
    if (!leg) continue;

    const continuesRoute = currentKey !== undefined && sameEndpoint(previousOut, leg.tokenIn);
    const key = continuesRoute ? (currentKey as string) : sourceKey(leg.tokenIn);

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        chainId: leg.tokenIn.chainId,
        address: leg.tokenIn.address,
        symbol: leg.tokenIn.symbol,
        spendMicros: 0,
        stepKeys: [],
        totals: emptyAccumulator(),
      };
      groups.set(key, group);
      order.push(key);
    }

    const line = priceStep(step, leg, slippagePct);
    add(group.totals, line);
    group.stepKeys.push(step.key);
    // Only a leg that spends the holding itself is money the user hands over. A fed leg spends the
    // previous leg's proceeds, and counting it again would inflate the source's contribution.
    if (!continuesRoute) group.spendMicros += toMicros(step.amountUsd);

    gas.push({ stepKey: step.key, chainId: leg.chainId, kind: leg.kind, usd: line.gas / MICROS });
    previousOut = leg.tokenOut;
    currentKey = key;
  }

  return { sources: order.map((key) => groups.get(key) as SourceGroup), gas };
}

/**
 * The whole bill for a set of priced steps.
 *
 * Pure: quotes are passed in, already priced onto the steps by the planner. Nothing is fetched and
 * nothing is invented, so a figure the model cannot state honestly (a native coin's rate, a bridge
 * that quoted no spread) is left out rather than filled in.
 */
export function buildCostBreakdown(input: CostBreakdownInput): ProvisioningCostModel {
  const slippagePct = input.slippagePct ?? 0;
  const grouped = groupBySource(input.steps, slippagePct);

  const sources = grouped.sources.map((group) => ({
    key: group.key,
    chainId: group.chainId,
    address: group.address,
    symbol: group.symbol,
    spendUsd: toUsd(group.spendMicros),
    stepKeys: group.stepKeys,
    lines: toLines(group.totals),
  }));

  // Summed from the per-source LINES rather than from the raw micros, so the aggregate row is
  // literally the sum of the rows above it (see the header: a table that does not add up reads as a
  // wrong price). The two differ by at most half a cent per source.
  const aggregate = emptyAccumulator();
  for (const source of sources) {
    add(aggregate, {
      swapCost: toMicros(source.lines.swapCostUsd),
      bridgeFee: toMicros(source.lines.bridgeFeeUsd),
      gas: toMicros(source.lines.gasUsd),
      slippage: toMicros(source.lines.slippageUsd),
      ...(source.lines.priceImpactPct === undefined
        ? {}
        : { priceImpactPct: source.lines.priceImpactPct }),
    });
  }
  const totals = toLines(aggregate);

  // [R2] The contract's own definition, not a re-derivation: buffer is the provisioning transactions'
  // gas plus the slippage allowance, fees are the bridge's take, and the swap cost is in neither.
  const shortfallUsd = toUsd(toMicros(input.shortfallUsd));
  const bufferUsd = toUsd(toMicros(totals.gasUsd) + toMicros(totals.slippageUsd));
  const feesUsd = totals.bridgeFeeUsd;

  return {
    sources,
    gas: grouped.gas,
    totals,
    crossChain: input.steps.some((step) => step.leg?.kind === "bridge"),
    quote: {
      shortfallUsd,
      bufferUsd,
      feesUsd,
      totalPayUsd: toUsd(toMicros(shortfallUsd) + toMicros(bufferUsd) + toMicros(feesUsd)),
    },
  };
}

/**
 * The same bill, for a plan that has already been computed. The UI's entry point.
 *
 * Reads the plan's own `shortfallUsd` and `slippagePct`, so the figures it returns are the ones the
 * plan was quoted with and its `quote` reproduces `plan.quote` exactly.
 */
export function planCostBreakdown(plan: ProvisioningPlan): ProvisioningCostModel {
  return buildCostBreakdown({
    steps: plan.steps,
    shortfallUsd: plan.quote.shortfallUsd,
    ...(plan.slippagePct === undefined ? {} : { slippagePct: plan.slippagePct }),
  });
}

/**
 * The one price-impact figure a funding plan is gated on (POO-1047).
 *
 * The WORST AMM leg on the route, in percent, or `undefined` when no leg reported one. Deliberately
 * the cost model's own aggregate rather than a second walk over the legs: the user is shown this
 * number as the breakdown's "Price impact" row and is asked to acknowledge that same number, and two
 * derivations is how those come apart. Bridge legs are excluded at the source ({@link priceStep},
 * POO-1047 [R5]) and a malformed reading yields nothing, which the gate reads as NO gate rather than
 * as 0% ([R3]): a display figure we could not obtain must never block a legitimate route.
 *
 * Per PLAN, not per step ([R4]). The user acknowledges the route they are approving; asking again
 * per leg, mid-execution, would be asking about a decision already made.
 */
export function planPriceImpactPct(plan: ProvisioningPlan): number | undefined {
  return planCostBreakdown(plan).totals.priceImpactPct;
}

/** What the canonical fee tooltip needs to render its Bridge line ([R5]). */
export interface BridgeFeeTooltipInput {
  /** The tooltip shows a Bridge line at all only on a cross-chain flow (POO-799 decision #2). */
  crossChain: boolean;
  /** The real figure, when the quote gave us one. Absent leaves the placeholder standing. */
  bridgeUsd?: number;
}

/**
 * Thread a plan's bridge fee into `buildCanonicalFeeLines` ([R5]).
 *
 * PP-INTEGRATION-POINT: the tooltip's Bridge line has been a "Coming soon" placeholder since POO-800
 * because no production caller could produce a real number. This is that number. POO-1040 wires it
 * into the modals; nothing here reaches into `features/`, which `lib/` must not depend on.
 *
 * A bridge leg whose quote showed no spread yields NO figure rather than `$0.00`: it means the quote
 * did not price the bridge, not that Across carried the money for free, and stating the second would
 * be a fabricated fee (POO-799 global directive #1).
 */
export function bridgeFeeTooltipInput(model: ProvisioningCostModel): BridgeFeeTooltipInput {
  const bridgeUsd = model.totals.bridgeFeeUsd;
  return {
    crossChain: model.crossChain,
    ...(model.crossChain && bridgeUsd > 0 ? { bridgeUsd } : {}),
  };
}
