/**
 * @id PP-DEP-LIB-004
 * @name standalone on-ramp plan builder
 * @implements-rules-version v3 (POO-1129 rules v3)
 * @epic POO-1129 (fiat on-ramp), phase 6 (POO-1137)
 *
 * The bespoke STANDALONE fiat purchase plan for the `/deposit` rail: a buy-crypto CTA attached to no
 * operation ([R3]). It exists because the two shortcuts the epic considered are both wrong here:
 *
 *   - Reusing the server planner `buildPlan` would run `classifyGasFeasibility` to decide gas, which
 *     [R1] forbids for a standalone buy (no operation => no legs => nothing to quote => the classifier
 *     cannot run), and would fabricate a quote for an operation that does not exist.
 *   - Buying USDC directly and stopping leaves a no-gas buyer holding USDC and unable to transact, the
 *     exact frustration case [R1]'s standalone `NATIVE_RESERVE_ETH` trigger exists to prevent.
 *
 * So the sizing decision is made by {@link sizeOnRampOrder} with `standalone: true` (POO-1133, which
 * already implements [R1]'s standalone branch: buy ETH-BASE when native ETH on Base is below the floor,
 * else USDC-BASE direct, floored at PAYBIS_MIN_USD), and this module maps that decision onto the SAME
 * {@link ProvisioningPlan} shape the in-flow rail runs. The plan is then handed to the shipped
 * `buildPlanSteps` (PP-STR-LIB-017), so the buy + the ETH->USDC swap execute through the identical
 * machinery POO-1136 wired: `planRailSteps` synthesises the swap leg, sizes it from the settled delta
 * via `requoteAtExecution`, and reserves the gas share through `fiatSwapFractionBps`. No parallel
 * money path is invented.
 *
 * ## Why the plan carries a buy (+ swap) and NEVER a bridge or op ([R3])
 *
 * `buildPlan`'s in-flow on-ramp emits `buy -> buy-swap -> buy-bridge` and a trailing `op` anchor. A
 * standalone purchase terminates after the swap to USDC on Base: it has no operation to anchor and no
 * target chain to bridge to, even when the user arrived via a deep link that carried a strategy. So
 * this builder emits at most two steps and asserts (in tests) that a bridge / bridge-gas / op step can
 * never appear.
 *
 * ## The quote block is a structural placeholder, on purpose
 *
 * A {@link ProvisioningPlan} requires a {@link ProvisioningQuote}, but the standalone rail never renders
 * the cost-breakdown card and never re-quotes on a TTL: the authoritative price is Paybis inside the
 * widget, and the authoritative amount is the observed settlement delta ([R4]). `buildPlanSteps` reads
 * only `plan.steps` and `plan.slippagePct`. So the quote is filled plausibly (shortfall = the entered
 * receive amount, total = the fiat pre-fill) but is not a live figure, and this module takes no clock
 * so it stays pure and exhaustively unit-testable.
 *
 * PP-INTEGRATION-POINT: this is pure and carries no real call. Its `baseNativeEth` / `ethUsd` inputs
 * come from `useTokenBalances` (SIWE-gated), and its `order` is quoted + minted downstream by the
 * on-ramp server actions (POO-1132) at execution time, never here ([R8]).
 */

import { fiatSwapFractionBps } from "@/features/strategies/lib/buildPlanSteps";
import type { FundingJournal } from "@/features/strategies/lib/fundingJournal";
import { findResumableJournal } from "@/features/strategies/lib/fundingJournal";
import { toBaseUnits } from "@/lib/balances/toBaseUnits";
import type { TokenBalance } from "@/lib/balances/types";
import { getUsdcAddress } from "@/lib/chains/config";
import { sizeOnRampOrder } from "@/lib/onramp/sizeOnRampOrder";
import type { OnRampCurrencyCode, TokenDelta } from "@/lib/onramp/tokenDeltas";
import type {
  ProvisioningLeg,
  ProvisioningOrder,
  ProvisioningPlan,
  ProvisioningStep,
} from "@/lib/provisioning";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/provisioning";
import { ONRAMP_CHAIN_ID } from "@/lib/provisioning/computeNeed";
import { NATIVE_RESERVE_ETH } from "@/lib/provisioning/nativeReserve";

/**
 * Investor default Max slippage, percent, for the standalone ETH->USDC swap. Mirrors
 * `buildPlan.DEFAULT_SLIPPAGE_PCT` (POO-523): a standalone buy has no settings gear, so it inherits the
 * same figure the investor flow defaults to. The reused rail reads it off `plan.slippagePct`.
 */
export const STANDALONE_SLIPPAGE_PCT = 2;

/** What {@link buildStandaloneOnRampPlan} needs to size and shape one standalone purchase. */
export interface StandaloneOnRampInput {
  /** USD the user wants to RECEIVE as USDC (the entered `/deposit` amount). The op-funding slice. */
  receiveUsd: number;
  /**
   * Native ETH held on Base ([R1] standalone trigger). Below {@link NATIVE_RESERVE_ETH} => the buy
   * goes ETH-first so the user lands transactable. Snapshot through `useTokenBalances`, never a raw
   * holdings read (which returns `[]` pre-session and would read a false zero).
   */
  baseNativeEth: number;
  /**
   * ETH/USD, used only to value the gas floor in USD. `0` when the wallet cannot price ETH (it holds
   * no Base native coin); the gas component then collapses to 0 exactly as [R1]'s amount rule states,
   * and the swap reserve follows the same WAIVED gap the in-flow rail carries (POO-1136,
   * `fiatSwapFractionBps` PP-NOTE): it fails legibly, leaving the funds resting as ETH on Base.
   */
  ethUsd: number;
  /** Max slippage percent for the swap leg. Defaults to {@link STANDALONE_SLIPPAGE_PCT}. */
  slippagePct?: number;
}

/** The bespoke standalone plan, plus what the rail needs to open the widget and scope settlement. */
export interface StandaloneOnRampPlan {
  /** The {@link ProvisioningPlan} to run through `buildPlanSteps` (buy [+ swap], no bridge, no op). */
  plan: ProvisioningPlan;
  /** The fiat pre-fill the `buy` step carries ([R8]: no requestId / quoteId). */
  order: ProvisioningOrder;
  /** The token the order buys, scoping settlement detection to the purchase ([R11]). */
  expectedToken: OnRampCurrencyCode;
  /** `true` iff the on-ramp bought ETH-BASE, so a downstream swap-to-USDC leg is due. */
  needsSwapToUsdc: boolean;
}

/** Round a USD figure to whole cents (money is cents-precision, so float-safe). */
function round2(usd: number): number {
  return Math.round(usd * 100) / 100;
}

/**
 * The wallet's native ETH on Base, and its USD price, from a {@link useTokenBalances} snapshot.
 *
 * Paybis' gas-first trigger ([R1] standalone) compares native ETH on Base against
 * {@link NATIVE_RESERVE_ETH}, so only the Base native holding matters; a non-Base native coin and a
 * Base token are both excluded. A wallet holding none (the gas-first case) reads a safe zero, which is
 * below any floor and therefore correctly buys ETH. The price is `usd / amount`; a zero amount cannot
 * price ETH and degrades to `0` rather than dividing by zero.
 *
 * PP-NOTE (POO-1573): that `ethUsd = 0` is why the ETH TARGET is no longer derived from here. This
 * ratio prices the gas floor in DOLLARS for the order's `fiatAmount` (unchanged), but the received-
 * fixed ETH figure the mint quotes with comes from a real server-side price read
 * (`lib/onramp/ethTarget.ts`), because a ratio that is exactly 0 for a wallet holding no ETH cannot
 * denominate an order for the very buyer this leg exists to serve.
 */
export function readBaseNativeEth(balances: TokenBalance[]): { eth: number; ethUsd: number } {
  const native = balances.find(
    (balance) => balance.chainId === ONRAMP_CHAIN_ID && balance.isNative === true,
  );
  if (!native || !(native.amount > 0)) return { eth: 0, ethUsd: 0 };
  return { eth: native.amount, ethUsd: native.usd / native.amount };
}

/**
 * Size and shape one standalone fiat purchase into a {@link ProvisioningPlan} the shipped rail runs.
 *
 * See the module header for the full rationale. The body is the "one line" mapping the [R1] sizing test
 * anticipated: delegate the ETH-vs-USDC + amount decision to {@link sizeOnRampOrder}, then emit the
 * display steps `buildPlan` emits for the same decision, minus the bridge and the op anchor ([R3]).
 */
export function buildStandaloneOnRampPlan(input: StandaloneOnRampInput): StandaloneOnRampPlan {
  const { receiveUsd, baseNativeEth, ethUsd, slippagePct = STANDALONE_SLIPPAGE_PCT } = input;

  // [R1] standalone: the trigger is `baseNativeEth < NATIVE_RESERVE_ETH`, never the classifier. The
  // sizer owns that decision (POO-1133); this module never re-derives it.
  const { order, needsSwapToUsdc } = sizeOnRampOrder({
    standalone: true,
    requiredUsd: receiveUsd,
    baseNativeEth,
    gasFloorEth: NATIVE_RESERVE_ETH,
    ethUsd,
  });
  const buysEth = order.currencyCode === "ETH-BASE";
  const expectedToken: OnRampCurrencyCode = buysEth ? "ETH-BASE" : "USDC-BASE";

  // [R2] The purchase, always leading, always on Base. Mirrors `buildPlan`'s buy step: `poweredBy` +
  // `order` are the fiat counterpart of a leg's on-chain detail. No `fromChainId` (fiat has no chain).
  const steps: ProvisioningStep[] = [
    {
      type: "buy",
      key: "buy",
      labelKey: "provisioning.steps.buy",
      fromToken: "USD",
      toToken: buysEth ? "ETH" : "USDC",
      toChainId: ONRAMP_CHAIN_ID,
      amountUsd: round2(Number(order.fiatAmount)),
      amountToken: order.fiatAmount,
      poweredBy: "paybis",
      order,
    },
  ];

  // [R1] Bought ETH for gas: convert the op-funding slice to USDC on Base and STOP ([R3] — never a
  // bridge). `buildPlanSteps` synthesises this leg, sizes it from the settled delta, and reserves the
  // gas share via `fiatSwapFractionBps` (buy-swap.amountUsd / buy.amountUsd). Skipped for a $0 receive.
  if (buysEth && needsSwapToUsdc && receiveUsd > 0) {
    steps.push({
      type: "swap-token",
      key: "buy-swap",
      labelKey: "provisioning.steps.swapToken",
      fromToken: "ETH",
      toToken: "USDC",
      fromChainId: ONRAMP_CHAIN_ID,
      toChainId: ONRAMP_CHAIN_ID,
      amountUsd: round2(receiveUsd),
      amountToken: round2(receiveUsd).toFixed(2),
    });
  }

  const plan: ProvisioningPlan = {
    needed: true,
    reason: buysEth ? ["gas", "usdc"] : ["usdc"],
    variant: "multi",
    steps,
    // Structural placeholder: the standalone rail never renders this or re-quotes on it (see header).
    quote: {
      shortfallUsd: round2(receiveUsd),
      bufferUsd: 0,
      feesUsd: 0,
      totalPayUsd: round2(Number(order.fiatAmount)),
      quotedAt: "",
      ttlMs: 0,
    },
    slippagePct,
  };

  return { plan, order, expectedToken, needsSwapToUsdc };
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────────
 * The settled-but-unconverted window (POO-1137 blocking fix)
 *
 * A gas-first purchase settles as ETH on Base and then has ONE leg left. Between those two moments
 * the deposit is INVISIBLE to a balance read: the ETH it delivered is indistinguishable from a
 * holding the user always had, so re-deriving the plan (a reload, a killed tab, a Try again that
 * remounts) does not resume anything. It reads a wallet that now CLEARS `NATIVE_RESERVE_ETH`,
 * builds a USDC-direct purchase, mints a SECOND Paybis request, and leaves the first purchase's ETH
 * where it is: two card charges and stranded funds for one intended deposit.
 *
 * That is the one gap `fundingJournal.ts`'s header names (a state a balance read cannot see), so it
 * is closed the way that module closes it, with a record. The record is a normal funding journal
 * under the `deposit` operation kind, opened at SETTLEMENT (not at the confirm: before the purchase
 * settles there is nothing on-chain to convert and the on-ramp journal's own `open` record already
 * makes the purchase resumable, [R7]), and retired when the conversion lands. It therefore also
 * inherits POO-1038/1043 leg recovery and the app-wide `FundingRecoveryBanner`, which is what hands a
 * returning user back to `/deposit`.
 * ────────────────────────────────────────────────────────────────────────────────────────────────*/

/** The operation a standalone `/deposit` purchase journals under. */
export const STANDALONE_DEPOSIT_OPERATION = "deposit" as const;

/**
 * The route index `planRailSteps` gives the standalone plan's ETH->USDC leg.
 *
 * A standalone plan carries NO crypto legs, so the rail's fiat indices start at 0: the `buy` takes 0
 * (its synthetic delivered leg) and the swap takes 1. Pinning it here rather than recomputing keeps
 * the journal's leg index aligned with the index the running rail records under, so `beginLeg` /
 * `recordBroadcast` / `recordSettled` land on the leg this module wrote. Asserted against
 * `planRailSteps` in the tests, so a change to the rail's indexing fails there and not in production.
 */
export const STANDALONE_SWAP_LEG_INDEX = 1;

/** ETH on Base as a route endpoint (`resolveFiatToken`'s native branch, for the same two tokens). */
const BASE_ETH = {
  address: NATIVE_TOKEN_ADDRESS,
  symbol: "ETH",
  decimals: 18,
  chainId: ONRAMP_CHAIN_ID,
} as const;

/**
 * The base units of native ETH a settled purchase left for the conversion, or `null` when there is
 * nothing to convert.
 *
 * [R4] the observed delta is the authority, never the amount we requested: the user can change the
 * amount inside the widget. The FUNDING share of it is what converts, exactly as the live run sizes
 * it ({@link fiatSwapFractionBps} on the same two plan steps), because the on-ramp bought ETH for the
 * deposit PLUS gas and the swap transaction itself has to be payable.
 */
export function settledSwapBaseUnits(plan: ProvisioningPlan, deltas: TokenDelta[]): string | null {
  const swapStep = plan.steps.find((step) => step.key === "buy-swap");
  const buyStep = plan.steps.find((step) => step.type === "buy");
  if (!swapStep || !buyStep) return null;

  // Only native growth on the on-ramp chain is the purchase we are converting. The widget frame
  // already scopes the delta to the bought token ([R11]); this is the second, cheap assertion that
  // we are not about to size an ETH swap from a USDC row.
  const delivered = deltas.find(
    (delta) => delta.chainId === ONRAMP_CHAIN_ID && delta.symbol.toUpperCase() === "ETH",
  );
  if (!delivered) return null;
  const raw = toBaseUnits(delivered);
  if (raw === null) return null;

  const bps = fiatSwapFractionBps(swapStep, buyStep.amountUsd);
  // `undefined` is the rail's own "spend the whole delta" verdict (the funding share is not a proper
  // fraction of the purchase). Recording the same figure keeps the record and the live run agreed.
  const amount = bps === undefined ? BigInt(raw) : (BigInt(raw) * BigInt(bps)) / BigInt(10_000);
  return amount > BigInt(0) ? amount.toString() : null;
}

/**
 * The one-leg plan that converts a settled purchase's ETH to USDC on Base and stops ([R3]).
 *
 * Used twice, on purpose: once at settlement, to give {@link ProvisioningRail.openJournal} a plan
 * whose leg carries the REAL amount (the journal would otherwise record the `"0"` placeholder every
 * synthesized fiat leg is born with, and a resumed conversion cannot be sized from `"0"`), and once
 * on resume, as the plan the rail actually runs. One shape, so the two can never disagree.
 *
 * The leg is REAL rather than legless because `planRailSteps` only synthesizes a fiat leg inside the
 * contiguous sub-route that follows a `buy`, and a resumed conversion has no `buy` in front of it. It
 * keeps `requoteAtExecution`, so the amount is still re-derived at execution against the live
 * balance: `sizeFromRealBalance` finds no baseline (nothing in THIS run produced the ETH) and spends
 * `min(recorded, held)`, which never exceeds what the purchase delivered and never exceeds what the
 * wallet still has. `minAmountOut` comes from the fresh quote, so the placeholder here is inert.
 */
export function buildStandaloneSwapPlan(input: {
  /** Base units of native ETH on Base to convert (from {@link settledSwapBaseUnits} or the journal). */
  amountIn: string;
  /** Max slippage percent. Defaults to {@link STANDALONE_SLIPPAGE_PCT}. */
  slippagePct?: number;
}): ProvisioningPlan {
  const { amountIn, slippagePct = STANDALONE_SLIPPAGE_PCT } = input;
  const usdc = getUsdcAddress(ONRAMP_CHAIN_ID);
  const leg: ProvisioningLeg | undefined = usdc
    ? {
        index: STANDALONE_SWAP_LEG_INDEX,
        kind: "swap-token",
        chainId: ONRAMP_CHAIN_ID,
        tokenIn: { ...BASE_ETH },
        tokenOut: { address: usdc, symbol: "USDC", decimals: 6, chainId: ONRAMP_CHAIN_ID },
        amountIn,
        amountOutQuoted: "0",
        minAmountOut: "0",
        routing: "CLASSIC",
        gasUsd: 0,
        requoteAtExecution: true,
      }
    : undefined;

  return {
    needed: true,
    reason: ["usdc"],
    variant: "multi",
    steps: [
      {
        type: "swap-token",
        // The SAME key the live plan's conversion carries, so a resumed run's step keys, statuses and
        // captions read identically to the run it is finishing.
        key: "buy-swap",
        labelKey: "provisioning.steps.swapToken",
        fromToken: "ETH",
        toToken: "USDC",
        fromChainId: ONRAMP_CHAIN_ID,
        toChainId: ONRAMP_CHAIN_ID,
        // Display-grade only; the rail reads `plan.steps[].leg` and `plan.slippagePct`, never this.
        amountUsd: 0,
        ...(leg === undefined ? {} : { leg }),
      },
    ],
    quote: { shortfallUsd: 0, bufferUsd: 0, feesUsd: 0, totalPayUsd: 0, quotedAt: "", ttlMs: 0 },
    slippagePct,
  };
}

/** A settled purchase whose conversion never landed, ready to be re-run. */
export interface StandaloneSwapResume {
  /** The journal the earlier session opened, so the resumed run writes to it and retires it. */
  journalId: string;
  /** The one-leg conversion plan, sized from the recorded amount. */
  plan: ProvisioningPlan;
}

/**
 * The settled-but-unconverted purchase for `wallet`, or `null` ([R7], extended past the mint).
 *
 * Scoped to the `deposit` operation so a strategy-funding journal for the same wallet can neither be
 * mistaken for one of these nor mask one, and to a leg that has not reached a terminal status, so a
 * conversion that already landed is never offered again. A record with no usable amount is treated as
 * absent: sizing a swap from `"0"` throws at execution, and refusing to resume simply falls back to a
 * fresh purchase, which is the pre-POO-1137 behaviour rather than a new failure.
 */
export function findStandaloneSwapResume(
  wallet: string,
  slippagePct: number = STANDALONE_SLIPPAGE_PCT,
): StandaloneSwapResume | null {
  const journal: FundingJournal | null = findResumableJournal(
    wallet,
    Date.now(),
    STANDALONE_DEPOSIT_OPERATION,
  );
  if (!journal) return null;
  const leg = journal.legs.find(
    (entry) => entry.status !== "settled" && entry.status !== "failed" && entry.amountIn !== "0",
  );
  if (!leg) return null;
  return {
    journalId: journal.journalId,
    plan: buildStandaloneSwapPlan({ amountIn: leg.amountIn, slippagePct }),
  };
}
