/**
 * @id PP-STR-LIB-017 (POO-1036, POO-1037, POO-1038, POO-1043, POO-1094, POO-1093, POO-1136, POO-1154, POO-1508, POO-1916)
 * @name buildPlanSteps (provisioning execution rail)
 * @implements-rules-version v5 (POO-1916 rules v1) · v4 (POO-1508 rules v2) · v3 (POO-1154 / POO-1129 rules v3, POO-1136 / POO-1129 rules v3) · v2 (POO-1043 rules v1) · v1 (POO-1036 rules v1, POO-1094 rules v1, POO-1093 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The seam the Universal Funding epic converges on: it turns a priced {@link ProvisioningPlan} into
 * the ordered {@link FlowStep}s that {@link useWalletSignFlow} already knows how to run.
 *
 * ## We did not build an execution engine
 *
 * This repository already has one. `useWalletSignFlow` gives per-step status, per-step hashes,
 * resume-from-the-failed-step retry, `retryFrom(key)`, and a `{ skipped: true }` no-op, and
 * `executeBuiltTransaction` is the single broadcast choke point that asserts the wallet's chain (with
 * ONE corrective switch and a re-verify, `WRONG_CHAIN`) and its active account (`WRONG_ACCOUNT`).
 * So this file is an adapter, not a runtime: **cross-chain leg-to-leg chain switching needs no new
 * switching logic at all** ([R1]), it falls out of routing every broadcast through that choke point
 * with the leg's own chain as the target.
 *
 * ## What a leg costs at the wallet
 *
 * Per leg, in order: an ERC-20 approval (its own step, so it can render as skipped), then a re-quote,
 * then an optional Permit2 signature, then the broadcast.
 *
 *   approve:<key>   `/check_approval` → no calldata means the allowance already covers it ([R2])
 *   <key>           `/quote` → (sign) → `/swap` → executeBuiltTransaction ([R1], [R3], [R4], [R5])
 *
 * A native `tokenIn` gets no approval step at all: there is no ERC-20 allowance to grant, and asking
 * anyway spends an upstream call to be told so.
 *
 * ## Why the quote is taken here and not in the planner
 *
 * The planner's figures are for PRICING ([R8] of POO-1034). A quote for leg N+1 taken before leg N
 * executes is a guess: the realized output differs from the quoted one and a quote expires long
 * before a bridge settles. So a leg the planner flagged {@link ProvisioningLeg.requoteAtExecution} is
 * re-sized here from the balance the previous leg ACTUALLY produced ([R6]), measured as a delta
 * against a baseline recorded before that leg broadcast. The delta matters: an absolute balance read
 * would spend the user's pre-existing holding of the same token, which they never allocated to this
 * route.
 *
 * ## Money convention
 *
 * Token amounts are base-unit decimal STRINGS and every comparison is `BigInt`. `tx.value` is the one
 * field the live API returns as HEX (`"0x00"`), so it is normalised through `BigInt()` before it
 * reaches anything that reads it as decimal ([R5]).
 *
 * ## A bridge leg is not done when its transaction mines (POO-1037)
 *
 * A source receipt proves only that the funds LEFT. Arrival is a separate observation on the
 * destination chain, minutes later, so a bridge leg's `run()` stays open until
 * {@link awaitBridgeSettlement} sees the destination balance clear the leg's floor. At the poll
 * ceiling the leg is neither failed nor succeeded: it throws {@link BRIDGE_PENDING_CODE} carrying the
 * broadcast hash, and the panel degrades to "still settling" rather than offering a retry that would
 * re-broadcast money already in flight.
 *
 * ## Recovery and idempotency (POO-1038)
 *
 * Two obligations were added here, both from `02_BRIDGE_ARCHITECTURE.md` §3, and both are about
 * never spending a user's money twice:
 *
 * - **The journal write ordering (§3.4).** Every value-moving leg is recorded as `planned` (with the
 *   account nonce and, for a bridge, the destination baseline) BEFORE the wallet is prompted, and its
 *   hash is written **synchronously the instant the node returns it**, before the receipt is awaited.
 *   That is why the broadcast helper below is `sendBuiltTransaction` + `waitForReceipt` rather than
 *   the combined `executeBuiltTransaction`: the combined form resolves only after the receipt, which
 *   is exactly the window a closed tab falls into.
 * - **The re-quote gate ([R5], POO-1508 [R43] rules v2).** A leg is re-quoted at execution time by
 *   construction, so the price CAN move between approval and signature.
 *   {@link isRequoteMateriallyWorse} still decides whether a move is worth acting on at all (a per-leg
 *   1% tolerance, unchanged). What happens next is not: there is no "accept a worse price" step, and
 *   never was meant to be one signed silently by the user's earlier consent to *some* slippage. A move
 *   past the tolerance is measured against the BUFFER the user was shown before broadcasting anything
 *   ({@link SEED_BUFFER_RATE}, the 5% "set aside for price moves" disclosure), consumed CUMULATIVELY
 *   across every leg of the run through {@link PlanRailDeps.consumeBuffer}. Within the reserved buffer
 *   the leg proceeds at the worse price with nobody asked, because the user already approved absorbing
 *   exactly this by seeing the disclosure. Past it, nothing is sent: the leg throws
 *   {@link PROVISIONING_BUFFER_EXCEEDED_CODE}, which the panel turns into "prices moved while this ran,
 *   try again or cancel" rather than a silent continuation or a mid-flow interrogation. With nobody to
 *   ask (`consumeBuffer` not wired), it refuses exactly as before rather than assuming the buffer holds.
 *
 * **Approvals are deliberately not journaled.** An approval moves no funds, so re-running one cannot
 * spend money twice, and each leg reads its own `nonceBefore` immediately before its own prompt, so
 * an approval's nonce consumption is already accounted for by the leg that follows it. Journaling
 * approvals under the leg's index would be worse than useless: a settled approval would make the leg
 * look done when its swap had never run.
 *
 * ## How the wait and the journal compose on a bridge leg
 *
 * The two designs above are the same story told from the live tab and from the reload, and they meet
 * inside one `run()`. In order: the leg is journaled `planned` with its nonce and its destination
 * baseline, the split send returns a hash that is journaled `broadcast` **synchronously**, that same
 * hash is handed to {@link PlanRailDeps.onLegBroadcast}, the SOURCE receipt is awaited, and only then
 * does {@link awaitBridgeSettlement} hold the step open until the destination balance clears the
 * floor. So a bridge is waited for INLINE on the good path, and the record is durable the whole time.
 *
 * That is why a bridge leg is never marked `settled` from here even when the inline wait observes it
 * land: the journal's arrival verdict has exactly one author, `reconcileFundingJournal` (§3.6), which
 * re-derives it from the chain. Any other path (the poll ceiling, a closed tab, a dead RPC) leaves
 * the leg `broadcast` with its hash recorded, which is precisely what makes the ceiling recoverable
 * rather than a lost transfer.
 *
 * ## Deliberately NOT here
 *
 * - **The bridge-spender ERC-20 allowance.** `02_BRIDGE_ARCHITECTURE.md` §1.2 claims `/check_approval`
 *   reports only the Permit2 allowance, so a BRIDGE route's own spender may need a separate approval.
 *   The action's cross-chain form (`tokenOut` + `tokenOutChainId`) is passed here, which is the shape
 *   the API documents for exactly that case; whether it covers the bridge spender is unmeasured, and
 *   guessing produces either a redundant wallet prompt or a false failure. See the PP-TODO below.
 *
 * PP-INTEGRATION-POINT: every wallet interaction a funding plan performs is issued from this module,
 * against the Uniswap server-action layer (PP-CORE-LIB-052) injected as {@link PlanRailDeps}.
 */
import { parseUnits } from "viem";
import {
  apiNetworkForChain,
  getUsdcAddress,
  nativeSymbol,
  stableSymbol,
} from "@/lib/chains/config";
import { isOnRampCurrencyCode, type OnRampCurrencyCode } from "@/lib/onramp/tokenDeltas";
import type {
  ProvisioningLeg,
  ProvisioningOrder,
  ProvisioningPlan,
  ProvisioningStep,
} from "@/lib/provisioning";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/provisioning";
// POO-1154 Gap 2: reused here as the WALLET RESERVE FOR SIGNING when a fiat buy-swap would otherwise
// spend the FULL native delta — the floor of native the user KEEPS so the swap can gas itself ("you
// cannot spend the gas you sign with"), exactly `reserveNativeFloor` / `belowGasFloor`'s [R13] second
// consumer. It is NOT the [R1] gas TRIGGER and never sizes a gas COST: it caps the funding leg's spend
// and never reaches `classifyGasFeasibility` or `buildPlan`'s quote-driven gas path. See
// `nativeReserve.ts`.
import { NATIVE_RESERVE_ETH } from "@/lib/provisioning/nativeReserve";
import type { BuildTxFailure } from "@/lib/tx/actionResult";
import type { BuiltTx } from "@/lib/tx/builtTxSchema";
import {
  type Eip1193Provider,
  sendBuiltTransaction,
  TransactionError,
  TX_REVERTED,
  waitForReceipt,
} from "@/lib/tx/sendTransaction";
import type { UniswapQuoteResponse, UniswapTransactionRequest } from "@/lib/uniswap/schemas";
import type { FlowStep, FlowStepResult } from "../hooks/useWalletSignFlow";
import {
  awaitBridgeSettlement,
  BRIDGE_PENDING_CODE,
  type BridgeSettlement,
} from "./awaitBridgeSettlement";
import {
  assertPermitAuthorisesLeg,
  assertZeroingApproval,
  boundApprovalToPlan,
} from "./fundingAuthorisation";
import type { FundingJournalRecorder, PlannedLegInput } from "./fundingJournal";

/**
 * The accumulating context, typed as the panel types it. `ProvisioningPanel` runs the rail with
 * `FlowStep<Record<string, unknown>>`, so anything narrower here would not be assignable to the prop
 * it exists to satisfy. The rail's own state therefore lives under ONE well-known key and is narrowed
 * on read ({@link readRailState}) rather than trusted.
 */
export type PlanRailCtx = Record<string, unknown>;

/** Where {@link PlanRailState} lives inside {@link PlanRailCtx}. */
export const PLAN_RAIL_STATE_KEY = "provisioningRail";

/**
 * What the rail carries from one leg to the next. All maps are keyed by {@link ProvisioningLeg.index}
 * (stringified, as object keys are), and every value is a base-unit decimal string.
 *
 * PP-INTEGRATION-POINT (POO-1038): this is the in-memory shape of the recovery journal. Persisting it
 * before each broadcast, and reconciling it against on-chain receipts on reload, is that issue's work.
 */
export interface PlanRailState {
  /** Balance of a leg's `tokenOut`, on its destination chain, read BEFORE that leg broadcast. */
  outBaselines: Record<string, string>;
  /** The amount a leg really spends, resolved once and reused so its approval cannot disagree. */
  legAmountsIn: Record<string, string>;
  /** The broadcast hash per leg. */
  legHashes: Record<string, string>;
}

/**
 * The result shape every injected server action returns (mirrors `UniswapActionResult`).
 *
 * POO-1251 [R1]: the failure branch IS the house {@link BuildTxFailure} rather than a private copy of
 * three of its fields. The copy narrowed `correlationId` away at the type, so {@link actionError}
 * could never be checked against a failure that carries one, on the rail that runs the money path.
 * The same correction this issue applied to `planActions.ts` and `onRampActions.ts`.
 */
export type RailActionResult<TPayload> = ({ ok: true } & TPayload) | BuildTxFailure;

/** `POST /quote` input, structurally identical to the action's `QuoteSwapInput`. */
export interface RailQuoteInput {
  tokenIn: string;
  tokenOut: string;
  tokenInChainId: number;
  tokenOutChainId: number;
  amount: string;
  type?: "EXACT_INPUT" | "EXACT_OUTPUT";
  slippageTolerance?: number;
}

/** `POST /check_approval` input, structurally identical to the action's `CheckApprovalInput`. */
export interface RailApprovalInput {
  token: string;
  amount: string;
  chainId: number;
  tokenOut?: string;
  tokenOutChainId?: number;
}

/** An EIP-712 payload in the shape a wallet signer takes. Never carries a native bigint ([R3]). */
export interface RailTypedData {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
}

/**
 * Everything the rail needs from the outside, injected rather than imported.
 *
 * The three Uniswap calls are parameters on purpose. They are `"use server"` actions whose transport
 * reads `UNISWAP_API_KEY` (ADR 0003), so importing them here would tie this module to the server
 * graph for no gain, and the suite would have to mock a module boundary instead of passing functions.
 */
export interface PlanRailDeps {
  /** The wallet address the plan was priced for. Derived from the SIWE session by the caller. */
  owner: string;
  /** The connected wallet's provider. The choke point still asserts the chain on every broadcast. */
  provider: Eip1193Provider;
  /**
   * Put the WALLET on `chainId` before a leg runs, through the wallet SDK rather than the provider.
   *
   * Every other operation in this app already does this (`useInvest`, `useWithdraw`,
   * `useCollectFees`, `useCreatePool`, `useMoveRange`, the manager hooks) with the note that signing
   * and sends otherwise fail with "chainId should be same as current chainId" (-32602). The rail was
   * the one path that skipped it and relied on the choke point's raw
   * `wallet_switchEthereumChain`, which a Privy EMBEDDED wallet does not honour: it is not slow to
   * switch, it does not switch at all, so no amount of waiting helps (POO-1078).
   *
   * Optional so a test rail runs unchanged. `assertProviderOnChain` remains the guarantee; this is
   * what makes the guarantee satisfiable on an embedded wallet.
   */
  switchChain?: (chainId: number) => Promise<void>;
  /** Sign EIP-712 typed data (Privy's `useSignTypedData`), resolving with the signature. */
  signTypedData: (data: RailTypedData) => Promise<string>;
  /** Base-unit balance of `token` for `owner` on `chainId`, as a decimal string. */
  readTokenBalance: (args: { chainId: number; token: string; owner: string }) => Promise<string>;
  quoteSwap: (input: RailQuoteInput) => Promise<RailActionResult<{ quote: UniswapQuoteResponse }>>;
  checkApproval: (input: RailApprovalInput) => Promise<
    RailActionResult<{
      approval: UniswapTransactionRequest | null;
      cancel: UniswapTransactionRequest | null;
    }>
  >;
  buildSwapTx: (input: {
    quote: UniswapQuoteResponse;
    signature?: string;
  }) => Promise<RailActionResult<{ swap: UniswapTransactionRequest }>>;
  /** Max slippage in percent. Falls back to the plan's own echoed figure. AMM legs only. */
  slippagePct?: number;
  /**
   * The recovery journal for THIS plan (POO-1038 [R2]), bound to the journal minted when the user
   * approved the cost breakdown. Optional: a rail with no journal executes identically and simply
   * has no in-flight record to recover from, which is the pre-POO-1038 behaviour.
   */
  journal?: FundingJournalRecorder;
  /**
   * POO-1508 [R43] rules v2: consume `worseBps` of the run's shared price-move buffer
   * ({@link SEED_BUFFER_RATE}, 5%, tracked cumulatively across every leg). Returns `true` when the
   * buffer still covers it, in which case the leg proceeds at the worse price with NOBODY ASKED — the
   * user already approved absorbing exactly this by seeing the buffer disclosure before broadcasting
   * anything. Returns `false` once the run's cumulative consumption would exceed the buffer, in which
   * case the leg throws {@link PROVISIONING_BUFFER_EXCEEDED_CODE} rather than being signed. With no
   * consumer wired the rail REFUSES a worse price rather than assuming the buffer holds: there is
   * nobody accounting for it, and a user must never have a materially different price sent on their
   * behalf that nothing confirmed was within what they were shown.
   */
  consumeBuffer?: (worseBps: number) => boolean;
  /**
   * Called the INSTANT a leg's broadcast returns a hash, before anything is awaited, from the same
   * synchronous point as the journal's own `broadcast` write.
   *
   * Since POO-1038 the DURABLE record is {@link journal}, so this is no longer the journal seam
   * itself; it is the live-tab channel beside it. The ordering is still the safety property
   * (`02_BRIDGE_ARCHITECTURE.md` §3.4): a transaction that has been sent but not settled is invisible
   * to a balance read, so a hash the app never recorded is indistinguishable from nothing having
   * happened, and that is how a user bridges twice. It is also where a long-running bridge step's
   * explorer link comes from, since the flow only records a hash a step RETURNS and a bridge leg does
   * not return until its funds land on the destination chain.
   */
  onLegBroadcast?: (event: { leg: ProvisioningLeg; txHash: string; at: number }) => void;
  /**
   * Execute the fiat purchase of a `buy` step (POO-1136): mint the `requestId` ([R8], execution-time,
   * never plan-time), open the embedded Paybis widget, and RESOLVE once the purchase settles from the
   * observed balance delta ([R4]/[R11], scoped to the on-ramp chain + the token the order bought).
   *
   * It resolves with nothing: the rail records the delivered token's balance as a baseline BEFORE this
   * runs and re-reads it after, so the downstream swap / bridge legs size themselves from the real
   * delta through the SAME `requoteAtExecution` machinery every crypto leg uses ({@link resolveAmountIn}).
   * It THROWS on a terminal failure (widget abandoned, card declined) so the flow fails legibly, and on
   * a reconcile timeout with a code the panel routes to the existing `settling` phase (the money may
   * still be in flight, so it is never a failure). Absent, a `buy` step fails legibly rather than being
   * silently skipped: there is nobody to open the widget.
   *
   * The React bridge lives in the panel (`ProvisioningPanel`), which renders `PaybisWidgetFrame` and
   * resolves this from a promise held in state: the widget has to RENDER for a settlement to happen at
   * all. Injected, not imported, for the same reason the Uniswap actions are.
   */
  runOnRampBuy?: (args: OnRampBuyRequest) => Promise<void>;
}

/** What the rail hands the panel to run one fiat purchase (POO-1136). */
export interface OnRampBuyRequest {
  /** The Paybis pre-fill: currency code + fiat amount ([R8]: carries no requestId / quoteId). */
  order: ProvisioningOrder;
  /** The token the order buys, scoping settlement detection to the purchase ([R11]). */
  expectedToken: OnRampCurrencyCode;
}

/**
 * How far a re-quote may drift against the user before it is worth acting on at all: 100 bps (1%).
 *
 * A quote for a leg expires in about a minute and a bridge settles in minutes, so a re-quote is
 * normal rather than exceptional (§4.4). Acting on every basis point would spend the run's buffer on
 * noise, which is worse than not having the gate.
 */
export const REQUOTE_MATERIAL_BPS = 100;

/**
 * POO-1508 [R43] rules v2: thrown by {@link gateRequote} when a materially worse re-quote, added to
 * what the run has already consumed of its buffer, would exceed it. The panel routes this to the
 * "prices moved while this ran" screen (`Try again` retries THIS leg with a fresh quote / `Cancel`
 * aborts the run), never to the generic failure phase.
 */
export const PROVISIONING_BUFFER_EXCEEDED_CODE = "PROVISIONING_BUFFER_EXCEEDED";

/** Whether a rail step grants an allowance, executes a route leg, or runs the fiat purchase. */
export type PlanRailStepKind = "approve" | "leg" | "buy";

/**
 * One step of the rail. Exported because it is the plan's EXECUTION shape, which the plan card
 * (POO-1041) has to render: the rail emits an approval step per leg that the plan itself does not
 * contain, so a view built only from `plan.steps` would silently omit rows the user is signing.
 */
export type PlanRailStep =
  | {
      key: string;
      kind: "approve";
      planStep: ProvisioningStep;
      leg: ProvisioningLeg;
      previousLeg?: ProvisioningLeg;
    }
  | {
      key: string;
      kind: "leg";
      planStep: ProvisioningStep;
      leg?: ProvisioningLeg;
      previousLeg?: ProvisioningLeg;
      /**
       * POO-1136: size this leg to a FRACTION of the settled delta, in basis points, reserving the
       * rest. Set only on the fiat ETH->USDC buy-swap: the on-ramp bought ETH for gas PLUS funding
       * ([R1]), so the swap must convert only the funding share and leave the gas share as native
       * (you also cannot swap 100% of native ETH, the swap tx itself needs gas). The share is the
       * plan's own `buy-swap.amountUsd / buy.amountUsd`, so it scales with whatever the user actually
       * bought ([R4]). Absent on every crypto leg and on a fiat USDC bridge, which spend the whole delta.
       */
      sizeFractionBps?: number;
      /**
       * POO-1154 Gap 2 / [R13]: base units of NATIVE to keep in the wallet when this leg would otherwise
       * spend the FULL native delta (no {@link sizeFractionBps} reserves a share). Set only on a fiat
       * buy-swap whose `tokenIn` is native and whose funding share is not strictly below the buy total:
       * spending 100% of native ETH leaves nothing to gas the swap itself. This is the SIGNING RESERVE
       * (`NATIVE_RESERVE_ETH`, the [R13] second consumer), native the user KEEPS to sign — never a gas
       * COST, so it never reaches `classifyGasFeasibility` or the quote-driven gas sizing. Mutually
       * exclusive with {@link sizeFractionBps} by construction (a proportional reserve already holds
       * native back). Absent on every crypto leg and on a non-native fiat leg.
       */
      reserveNativeRaw?: string;
    }
  | {
      key: string;
      kind: "buy";
      planStep: ProvisioningStep;
      /**
       * The SYNTHETIC leg the fiat purchase delivers (POO-1136): its `tokenOut` is the bought asset on
       * Base and its `index` is where the buy records the pre-purchase baseline, so the next fiat leg's
       * {@link resolveAmountIn} sizes the delta against it exactly as one crypto leg feeds the next.
       */
      buyLeg: ProvisioningLeg;
    };

/** Calldata: 0x-prefixed and NON-EMPTY. `"0x"` fails this, which is the point ([R4]). */
const CALLDATA_PATTERN = /^0x[0-9a-fA-F]+$/;

/** A frozen empty state, so a context that carries none can never be written through. */
const EMPTY_RAIL_STATE: PlanRailState = Object.freeze({
  outBaselines: Object.freeze({}) as Record<string, string>,
  legAmountsIn: Object.freeze({}) as Record<string, string>,
  legHashes: Object.freeze({}) as Record<string, string>,
});

const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Read the rail's own state out of the accumulating context, tolerating an absent/foreign shape. */
export function readRailState(ctx: PlanRailCtx): PlanRailState {
  const raw = ctx[PLAN_RAIL_STATE_KEY];
  if (!raw || typeof raw !== "object") return EMPTY_RAIL_STATE;
  const state = raw as Partial<PlanRailState>;
  return {
    outBaselines: state.outBaselines ?? {},
    legAmountsIn: state.legAmountsIn ?? {},
    legHashes: state.legHashes ?? {},
  };
}

/**
 * The rail steps a plan expands into, in execution order.
 *
 * Pure and exported so the same decomposition drives the UI. Three shapes it deliberately produces:
 * no approval for a native `tokenIn`, no approval for a step whose `method` this rail cannot execute
 * (never prompt for an allowance a step will not use), and a leg-less step for a plan step the rail
 * cannot run at all, which fails legibly instead of being dropped. Dropping it would let a plan
 * silently execute fewer steps than the user approved.
 */
export function planRailSteps(plan: ProvisioningPlan): PlanRailStep[] {
  const rail: PlanRailStep[] = [];
  let previousLeg: ProvisioningLeg | undefined;
  // POO-1136: fiat legs are SYNTHESIZED (buildPlan emits the buy sub-route legless, [R4]/[R8]), and
  // their indices key the rail's baselines / hashes / journal, so they must never collide with the
  // planner's own crypto leg indices. Start past the highest one.
  let fiatIndex = maxLegIndex(plan) + 1;
  // The legless fiat sub-route is contiguous right after the `buy` (buildPlan emits it first, before
  // any crypto leg). Only inside it is a legless swap / bridge SYNTHESIZED rather than refused; the
  // first legged crypto step ends it.
  let inFiatSubroute = false;
  // The buy's total fiat USD, so the ETH->USDC buy-swap can reserve the gas share of the delta ([R1]).
  let buyTotalUsd = 0;

  for (const planStep of plan.steps) {
    // The trailing anchor is a display marker for the operation itself, not a route leg.
    if (planStep.type === "op") continue;

    // POO-1136: the fiat purchase. Run against the on-ramp, not a route leg. It carries a SYNTHETIC
    // delivered leg so the next fiat leg sizes the settled delta against the baseline the buy records
    // under it, exactly as one crypto leg feeds the next ({@link resolveAmountIn}).
    if (planStep.type === "buy") {
      const buyLeg = syntheticBuyLeg(planStep, fiatIndex++);
      if (buyLeg) {
        rail.push({ key: planStep.key, kind: "buy", planStep, buyLeg });
        previousLeg = buyLeg;
        inFiatSubroute = true;
        buyTotalUsd = planStep.amountUsd;
        continue;
      }
      // A buy whose delivered asset we cannot resolve falls through to the legless leg step, which
      // refuses legibly rather than executing an unsized purchase.
    }

    // POO-1136: a legless downstream fiat step (swap / bridge after a buy) is synthesized into a real
    // leg from known token constants, so the branch below emits its approval and the existing rail
    // machinery executes it. Its amount is a placeholder that `requoteAtExecution` re-sizes from the
    // settled delta at execution ([R4]).
    let leg = planStep.leg;
    // [R1] The ETH->USDC buy-swap converts the FUNDING share of the delta and reserves the gas share.
    let sizeFractionBps: number | undefined;
    // POO-1154 Gap 2 / [R13]: base units of native to keep when the leg would spend the FULL delta.
    let reserveNativeRaw: string | undefined;
    if (leg) {
      inFiatSubroute = false;
    } else if (inFiatSubroute) {
      const synthesized = synthesizeFiatLeg(planStep, fiatIndex);
      if (synthesized) {
        leg = synthesized;
        fiatIndex++;
        sizeFractionBps = fiatSwapFractionBps(planStep, buyTotalUsd);
        // POO-1154 Gap 2: with no proportional share to reserve (`fiatSwapFractionBps` returned
        // undefined => spend the full delta) a NATIVE buy-swap would swap 100% of the native balance and
        // leave nothing to gas its own transaction. Keep the signing reserve instead ([R13]). A
        // proportional reserve (`sizeFractionBps` set) already holds native back, so the two never both
        // apply; a non-native leg (a USDC bridge) pays no native gas here, so it keeps nothing.
        if (
          sizeFractionBps === undefined &&
          sameAddress(leg.tokenIn.address, NATIVE_TOKEN_ADDRESS)
        ) {
          reserveNativeRaw = nativeSigningReserveRaw(leg.tokenIn.decimals);
        }
      }
    }

    if (!leg) {
      rail.push({ key: planStep.key, kind: "leg", planStep });
      continue;
    }
    if (isExecutable(planStep) && !sameAddress(leg.tokenIn.address, NATIVE_TOKEN_ADDRESS)) {
      rail.push({ key: `approve:${planStep.key}`, kind: "approve", planStep, leg, previousLeg });
    }
    rail.push({
      key: planStep.key,
      kind: "leg",
      planStep,
      leg,
      previousLeg,
      ...(sizeFractionBps === undefined ? {} : { sizeFractionBps }),
      ...(reserveNativeRaw === undefined ? {} : { reserveNativeRaw }),
    });
    previousLeg = leg;
  }
  return rail;
}

/**
 * The share of the settled delta the fiat ETH->USDC buy-swap converts, in basis points, or `undefined`
 * to spend the whole delta (POO-1136 [R1]).
 *
 * The on-ramp bought ETH for the operation's funding PLUS gas, so the swap must convert only the
 * funding share (`buy-swap.amountUsd`) of what the purchase delivered (`buy.amountUsd`) and leave the
 * gas share as native. The ratio is the plan's own, so it scales with whatever the user actually bought
 * ([R4]), and you can never swap 100% of native ETH anyway, the swap transaction needs gas to run.
 *
 * Only for a `swap-token` fiat leg; a fiat `bridge` moves the whole (already-USDC) delta. `undefined`
 * when the ratio is not a proper fraction (missing / non-positive / not below one), which spends the
 * full delta rather than reserving a figure we cannot trust.
 *
 * Exported for the standalone `/deposit` rail (POO-1137), which has to record the SAME share in its
 * recovery journal at settlement so a resumed conversion converts what the live run would have. A
 * second copy of this ratio in the deposit feature is exactly the drift this export prevents.
 *
 * PP-NOTE (POO-1129 follow-up POO-1154): two known gaps in the fiat sizing were WAIVED out of POO-1136
 * because both fail legibly and non-destructively (the leg or the op refuses and the money rests in the
 * user's own wallet as ETH or USDC on Base, so nothing strands and nothing is charged twice).
 *   1. SOLVED (POO-1154 Gap 2). `undefined` above spends the FULL delta whenever the funding share is
 *      not strictly below the buy total. For a native-ETH purchase whose gas component is zero that
 *      built a swap of 100% of the native balance, which the wallet then could not gas. `planRailSteps`
 *      now marks that leg with {@link PlanRailStep.reserveNativeRaw} (the [R13] signing reserve, native
 *      the user KEEPS to sign — not a gas COST), and {@link sizeFromRealBalance} keeps it back.
 *   2. STILL TRACKED (POO-1154 Gap 1). A user who SHRINKS the purchase inside the widget can land a
 *      settled delta whose PROPORTIONAL gas share falls under what `classifyGasFeasibility` required.
 *      Re-verdicting that needs a quote-driven valuation of the reserved native at execution and a
 *      user-facing surface, both of which are open design questions on POO-1154; the raise-only floor
 *      (`NATIVE_RESERVE_ETH`) must NOT stand in for the classifier figure ([R4]/[R13]).
 * Neither is solved by a second sizing path in this function.
 */
export function fiatSwapFractionBps(
  planStep: ProvisioningStep,
  buyTotalUsd: number,
): number | undefined {
  if (planStep.type !== "swap-token") return undefined;
  const fundingUsd = planStep.amountUsd;
  if (!(buyTotalUsd > 0) || !(fundingUsd > 0) || fundingUsd >= buyTotalUsd) return undefined;
  return Math.round((fundingUsd / buyTotalUsd) * 10_000);
}

/**
 * The native SIGNING RESERVE for a full-delta buy-swap, in base units, or `undefined` when the floor is
 * disabled (POO-1154 Gap 2 / [R13]).
 *
 * `NATIVE_RESERVE_ETH` converted at the native coin's own decimals, exactly as `reserveNativeFloor`
 * (`planActions.ts`) does for a selected native funding source: this is the SAME quantity, kept back so
 * the swap can gas itself, applied here to the on-ramp delta instead of a picked holding. `toFixed`
 * keeps the float out of `parseUnits` (never scientific notation). A `0` floor (the config kill switch,
 * `NEXT_PUBLIC_PAYBIS_GAS_FLOOR_ETH="0"`) returns `undefined` so nothing is reserved and the leg spends
 * the whole delta, matching the standalone trigger and the wallet-reserve consumers.
 *
 * Deliberately NOT a gas COST: it never sizes a purchase and never reaches `classifyGasFeasibility` or
 * `buildPlan`'s gas path, so [R4]/[R1]'s "gas comes from the quote, never a constant" is untouched.
 */
function nativeSigningReserveRaw(decimals: number): string | undefined {
  const reserve = parseUnits(NATIVE_RESERVE_ETH.toFixed(decimals), decimals);
  return reserve > BigInt(0) ? reserve.toString() : undefined;
}

/** The highest crypto leg index the planner assigned, or -1 when there are none (POO-1136). */
function maxLegIndex(plan: ProvisioningPlan): number {
  return plan.steps.reduce((max, step) => (step.leg ? Math.max(max, step.leg.index) : max), -1);
}

/**
 * The tokens a fiat sub-route touches, as executable {@link ProvisioningLeg.tokenIn} endpoints
 * (POO-1136).
 *
 * Paybis sells ETH / USDC on Base ([R2]), so the origin addresses are KNOWN constants: native
 * (`0x0…0`) for the chain's own coin, `getUsdcAddress` for the stable. That is what lets a fiat leg
 * be built at rail time without the settled delta, which supplies only the SIZE (deferred through
 * `requoteAtExecution`). Returns `undefined` for anything else, so an unexpected asset refuses
 * rather than routing wrongly.
 *
 * POO-1916 [R2]: the stable arm matched the LITERAL "USDC" and nothing else, which was invisible
 * while every fiat route ended on a USDC chain. It does not any more. The bridge delivers the TARGET
 * chain's stable (`USDC(8453) -> USDG(4663)` quotes `200`, probed live 2026-09-11), so a correct
 * `buy-bridge` step now says `toToken: "USDG"` — and this function would have answered `undefined`
 * to it, refusing the row and leaving the purchase with nowhere to land. Compared against the
 * chain's own stable symbol instead. It is no looser: `stableSymbol` reads the registry, so an
 * unexpected ticker still refuses, and a chain outside the registry refuses at `getUsdcAddress`.
 */
function resolveFiatToken(
  symbol: string | undefined,
  chainId: number | undefined,
): ProvisioningLeg["tokenIn"] | undefined {
  if (symbol === undefined || chainId === undefined) return undefined;
  if (symbol === stableSymbol(chainId)) {
    const address = getUsdcAddress(chainId);
    return address ? { address, symbol, decimals: 6, chainId } : undefined;
  }
  if (symbol === nativeSymbol(apiNetworkForChain(chainId))) {
    return { address: NATIVE_TOKEN_ADDRESS, symbol, decimals: 18, chainId };
  }
  return undefined;
}

/**
 * The synthetic leg a fiat `buy` delivers (POO-1136): the bought asset on Base, carried so the first
 * downstream fiat leg sizes the settled delta against the baseline the buy records under its `index`.
 *
 * Only `index` and `tokenOut` are load-bearing (the delta baseline key and the endpoint the next leg
 * continues); the rest are inert placeholders, because a fiat buy is never itself run as a route leg.
 */
function syntheticBuyLeg(planStep: ProvisioningStep, index: number): ProvisioningLeg | undefined {
  const delivered = resolveFiatToken(planStep.toToken, planStep.toChainId);
  if (!delivered) return undefined;
  return {
    index,
    kind: "swap-token",
    chainId: delivered.chainId,
    tokenIn: delivered,
    tokenOut: delivered,
    amountIn: "0",
    amountOutQuoted: "0",
    minAmountOut: "0",
    routing: "CLASSIC",
    gasUsd: 0,
    requoteAtExecution: false,
  };
}

/**
 * Turn a legless downstream fiat step (buy-swap ETH->USDC on Base, or buy-bridge USDC Base->target)
 * into a real, executable {@link ProvisioningLeg} (POO-1136).
 *
 * The tokens come from the step's own display fields resolved to addresses ({@link resolveFiatToken});
 * the amount is `"0"`, a placeholder every field of which `requoteAtExecution` overrides at execution
 * (the input is sized from the settled delta, the arrival floor from the fresh quote). Returns
 * `undefined` when either endpoint cannot be resolved, so the step falls back to refusing.
 */
function synthesizeFiatLeg(planStep: ProvisioningStep, index: number): ProvisioningLeg | undefined {
  const tokenIn = resolveFiatToken(planStep.fromToken, planStep.fromChainId);
  const tokenOut = resolveFiatToken(planStep.toToken, planStep.toChainId);
  if (!tokenIn || !tokenOut) return undefined;
  const kind: ProvisioningLeg["kind"] = planStep.type === "bridge" ? "bridge" : "swap-token";
  return {
    index,
    kind,
    chainId: tokenIn.chainId,
    tokenIn,
    tokenOut,
    amountIn: "0",
    amountOutQuoted: "0",
    minAmountOut: "0",
    routing: kind === "bridge" ? "BRIDGE" : "CLASSIC",
    gasUsd: 0,
    // [R4]/[R8] The whole point: this leg is sized from the settled delta at execution, never here.
    requoteAtExecution: true,
    ...(planStep.etaSeconds === undefined ? {} : { etaSeconds: planStep.etaSeconds }),
  };
}

/**
 * The plan's route legs as journal entries, in route order (POO-1043 [R7]).
 *
 * The translation from "what we priced" to "what we are about to put on a chain" belongs here, with
 * the rest of the plan-to-rail mapping, rather than in the journal module: the journal knows about
 * transactions, not about provisioning plans, and keeping it that way is what lets it stay the
 * untrusted-input boundary it is.
 *
 * Approvals are deliberately absent, for the reason the header states: an approval moves no funds, so
 * re-running one cannot spend money twice, and recording it under the leg's index would make a leg
 * whose swap never ran look done.
 */
export function planJournalLegs(plan: ProvisioningPlan): PlannedLegInput[] {
  return planRailSteps(plan).flatMap((railStep) =>
    railStep.kind === "leg" && railStep.leg
      ? [
          {
            index: railStep.leg.index,
            kind: railStep.leg.kind,
            chainId: railStep.leg.chainId,
            tokenIn: railStep.leg.tokenIn.address,
            tokenOut: railStep.leg.tokenOut.address,
            amountIn: railStep.leg.amountIn,
            minAmountOut: railStep.leg.minAmountOut,
            // A leg whose output lands on another chain is a bridge, and only a bridge has a
            // destination-side arrival test to run (§3.6).
            ...(railStep.leg.tokenOut.chainId === railStep.leg.chainId
              ? {}
              : { destChainId: railStep.leg.tokenOut.chainId }),
          },
        ]
      : [],
  );
}

/**
 * Map a priced plan onto the wallet-sign rail.
 *
 * This is the function `ProvisioningPanel`'s `buildPlanSteps` prop has been typed for since the epic
 * was designed and, until now, passed by no production caller (its fallback settles a `0xMOCK…MOCK`
 * hash after 900 ms). Bind the deps in a closure at the call site:
 * `buildPlanSteps={(plan) => buildPlanSteps(plan, deps)}`.
 */
export function buildPlanSteps(
  plan: ProvisioningPlan,
  deps: PlanRailDeps,
): FlowStep<PlanRailCtx>[] {
  const slippagePct = deps.slippagePct ?? plan.slippagePct;
  return planRailSteps(plan).map((railStep) => ({
    key: railStep.key,
    run: (ctx: PlanRailCtx) =>
      railStep.kind === "approve"
        ? runApprovalStep(railStep, ctx, deps)
        : railStep.kind === "buy"
          ? runBuyStep(railStep, ctx, deps)
          : runLegStep(railStep, ctx, deps, slippagePct),
  }));
}

/**
 * Execute one fiat `buy` step (POO-1136), replacing the `PROVISIONING_STEP_UNSUPPORTED` throw.
 *
 * Option (A): the purchase is a first-class flow step (its own testid, its own signing disclosure),
 * and the downstream swap / bridge are LEGGED steps the existing rail machinery runs unchanged. This
 * step's only job is the fiat half and the hand-off to that machinery:
 *
 *   1. read the delivered token's balance on Base as a BASELINE, keyed by the synthetic buy leg, so
 *      the next fiat leg sizes the settled delta against it through {@link resolveAmountIn} — the same
 *      mechanism a crypto leg uses to feed the next ([R4]);
 *   2. run the purchase ({@link PlanRailDeps.runOnRampBuy}): mint the `requestId` ([R8], execution
 *      time), open the widget, and resolve once the balance delta appears ([R11], scoped).
 *
 * It returns NO `txHash`: a fiat buy mines no on-chain transaction, so it is terminal-good WITHOUT a
 * hash, the one leg the e2e harness hash-exempts. A terminal widget failure throws (the flow fails
 * legibly); a reconcile timeout throws a code the panel routes to `settling`. Both come out of
 * `runOnRampBuy`, so this step neither swallows nor reclassifies them.
 */
async function runBuyStep(
  railStep: Extract<PlanRailStep, { kind: "buy" }>,
  ctx: PlanRailCtx,
  deps: PlanRailDeps,
): Promise<FlowStepResult<PlanRailCtx>> {
  const { buyLeg, planStep } = railStep;
  const order = planStep.order;
  if (!order) throw unsupportedStep(planStep, "carries no on-ramp order");
  if (!deps.runOnRampBuy) throw unsupportedStep(planStep, "has no on-ramp runner");
  // [R11] `currencyCode` is typed `string` on the order (it crosses the planner boundary as data), so
  // it is VALIDATED here rather than asserted. An unknown code would otherwise reach
  // `selectPurchaseDeltas`, miss the scope map, and throw a bare `TypeError` at settlement time, i.e.
  // after the card has been charged. Refusing BEFORE the widget opens costs the user nothing.
  const currencyCode = order.currencyCode;
  if (!isOnRampCurrencyCode(currencyCode)) {
    throw unsupportedStep(planStep, `buys an unsupported currency "${currencyCode}"`);
  }

  // [R4] The pre-purchase baseline of the delivered token, read on-chain on Base, recorded under the
  // synthetic buy leg's index. The downstream leg reads the same balance after settlement and spends
  // the DIFFERENCE, so a pre-existing holding of the same token is never swept into the route.
  const baseline = await deps.readTokenBalance({
    chainId: buyLeg.tokenOut.chainId,
    token: buyLeg.tokenOut.address,
    owner: deps.owner,
  });
  const state = readRailState(ctx);
  const withBaseline: PlanRailState = {
    ...state,
    outBaselines: { ...state.outBaselines, [buyLeg.index]: baseline },
  };

  // [R8] The requestId is minted INSIDE runOnRampBuy, at execution time, never baked into the plan.
  // [R11] `expectedToken` scopes settlement to the token the order bought (ETH-BASE / USDC-BASE).
  await deps.runOnRampBuy({ order, expectedToken: currencyCode });

  // [R7] A new context partial, never a write into the frozen one this step was handed.
  return { [PLAN_RAIL_STATE_KEY]: withBaseline };
}

/**
 * Grant the allowance this leg needs, or declare there is nothing to grant ([R2]).
 *
 * The amount is resolved HERE and carried forward, so the approval and the leg cannot disagree about
 * what is being spent: an allowance sized to one figure and a swap sized to a larger one reverts.
 *
 * **Approvals are sized to the plan, never unbounded (UF-28 R3), and that is enforced on the CALLDATA
 * rather than on the request.** Asking `/check_approval` for `amount` says nothing about what comes
 * back: Uniswap's documented flow is a one-time INFINITE approval to Permit2, so an unbounded
 * response is the expected case, not a hypothetical. {@link boundApprovalToPlan} reads the calldata,
 * refuses anything that is not an `approve` on this leg's own token, and caps the amount to what the
 * plan spends. Capping the ERC-20 allowance is what bounds the whole authorisation chain, since
 * Permit2 can only ever move what the token's allowance to Permit2 permits. The cost is one approval
 * per leg instead of one per token forever, which is the trade the security baseline asks for.
 */
async function runApprovalStep(
  railStep: Extract<PlanRailStep, { kind: "approve" }>,
  ctx: PlanRailCtx,
  deps: PlanRailDeps,
): Promise<FlowStepResult<PlanRailCtx>> {
  const { leg } = railStep;
  // An approval is a broadcast like any other, so it needs the wallet on this leg's chain too
  // (POO-1078). It runs BEFORE the leg step, so relying on that step's switch would approve on
  // whichever chain the wallet happened to be left on.
  await deps.switchChain?.(leg.chainId);
  const { amount, state } = await resolveAmountIn(leg, railStep.previousLeg, ctx, deps);
  const crossChain = leg.tokenIn.chainId !== leg.tokenOut.chainId;

  // PP-TODO(POO-1043): verify against the live API whether the cross-chain form also reports the
  // BRIDGE route's own spender allowance (`02_BRIDGE_ARCHITECTURE.md` §1.2 says it does not, in
  // which case a bridge leg needs an `allowance(owner, swap.to)` read and its own approval).
  const result = await deps.checkApproval({
    token: leg.tokenIn.address,
    amount,
    chainId: leg.chainId,
    ...(crossChain
      ? { tokenOut: leg.tokenOut.address, tokenOutChainId: leg.tokenOut.chainId }
      : {}),
  });
  if (!result.ok) throw actionError(result);

  // [R7] A new context partial, never a write into the one this step was handed.
  const carried = { [PLAN_RAIL_STATE_KEY]: state };
  // [R2] No calldata means the allowance already covers this amount. The flow renders it skipped.
  // Checked BEFORE the cancel below: a zeroing transaction with no approval to follow it would spend
  // the user's gas to lower an allowance nothing asked us to change.
  if (!result.approval) return { ...carried, skipped: true };

  // UF-28 R3/R6: read both transactions before either is broadcast. Doing it here rather than one at
  // a time means an unsafe approval is refused BEFORE the cancel has already spent the user's gas.
  const authorisation = { chainId: leg.chainId, token: leg.tokenIn.address, amount };
  const bounded = boundApprovalToPlan(result.approval, authorisation);
  if (result.cancel) assertZeroingApproval(result.cancel, authorisation);

  // Some tokens (USDT-class) reject a non-zero allowance being raised; the API returns the zeroing
  // transaction alongside, and skipping it makes the approval itself revert.
  if (result.cancel) await broadcast(result.cancel, leg.chainId, deps);
  return { ...carried, txHash: await broadcast(bounded.request, leg.chainId, deps) };
}

/**
 * Has the price moved materially against the user since they approved it ([R5])?
 *
 * Compares RATES, not amounts, because a leg is re-sized at execution time from the balance the
 * previous one really produced: half the input for half the output is the same price and must not
 * read as a worsening. Cross-multiplied in `BigInt` so no float touches a money comparison.
 *
 *   worse ⟺  quotedOut · approvedIn · 10000  <  approvedOut · quotedIn · (10000 − tolerance)
 *
 * A quote carrying no output amount (the field is optional on the wire) cannot be compared at all.
 * That answers `false`: refusing every leg whose quote omits an optional field would break the rail
 * for a shape the API is allowed to send, and the leg still has its own slippage floor on-chain.
 */
export function isRequoteMateriallyWorse(
  approved: { amountIn: string; amountOut: string },
  quoted: { amountIn: string; amountOut: string },
  toleranceBps: number = REQUOTE_MATERIAL_BPS,
): boolean {
  const worse = requoteWorseBps(approved, quoted);
  return worse !== null && worse > toleranceBps;
}

/** How much worse the rate got, in bps; negative when better, null when it cannot be compared. */
function requoteWorseBps(
  approved: { amountIn: string; amountOut: string },
  quoted: { amountIn: string; amountOut: string },
): number | null {
  let approvedIn: bigint;
  let approvedOut: bigint;
  let quotedIn: bigint;
  let quotedOut: bigint;
  try {
    approvedIn = BigInt(approved.amountIn);
    approvedOut = BigInt(approved.amountOut);
    quotedIn = BigInt(quoted.amountIn);
    quotedOut = BigInt(quoted.amountOut);
  } catch {
    return null;
  }
  if (approvedIn <= BigInt(0) || quotedIn <= BigInt(0) || approvedOut <= BigInt(0)) return null;

  const approvedScaled = approvedOut * quotedIn;
  const quotedScaled = quotedOut * approvedIn;
  // Integer bps of the shortfall against the approved rate. Truncation rounds toward "not worse",
  // which only ever matters within a single basis point of the threshold.
  return Number(((approvedScaled - quotedScaled) * BigInt(10_000)) / approvedScaled);
}

/**
 * Execute one route leg: re-quote, record the destination baseline, sign any permit, build, broadcast.
 *
 * The baseline read sits before ANY wallet prompt on purpose (`02_BRIDGE_ARCHITECTURE.md` §3.4): it is
 * the "before" side of the arrival test for a bridge, and the divisor of the next leg's sizing, and
 * neither is measurable once the transaction is in flight.
 */
async function runLegStep(
  railStep: Extract<PlanRailStep, { kind: "leg" }>,
  ctx: PlanRailCtx,
  deps: PlanRailDeps,
  slippagePct: number | undefined,
): Promise<FlowStepResult<PlanRailCtx>> {
  const { planStep, leg } = railStep;
  if (!leg) throw unsupportedStep(planStep, "carries no executable route leg");
  if (!isExecutable(planStep)) throw unsupportedStep(planStep, `uses ${planStep.method}`);

  // Before ANY of it: the quote, the approval, the permit signature and the broadcast all have to
  // happen with the wallet on this leg's chain. A cross-chain plan changes chain between legs, which
  // is why the rail feels this and the single-chain operations never did.
  await deps.switchChain?.(leg.chainId);

  const { amount, state } = await resolveAmountIn(
    leg,
    railStep.previousLeg,
    ctx,
    deps,
    railStep.sizeFractionBps,
    railStep.reserveNativeRaw,
  );

  // [R6] The quote that actually gets signed is taken now, at the size this leg really spends.
  // EXACT_INPUT because at execution time the known quantity is what we hold, not what we want.
  const quoted = await deps.quoteSwap({
    tokenIn: leg.tokenIn.address,
    tokenOut: leg.tokenOut.address,
    tokenInChainId: leg.tokenIn.chainId,
    tokenOutChainId: leg.tokenOut.chainId,
    amount,
    type: "EXACT_INPUT",
    ...(slippagePct === undefined ? {} : { slippageTolerance: slippagePct }),
  });
  if (!quoted.ok) throw actionError(quoted);

  // [R5] Before any signature: is this still the price the user approved?
  const quotedOut = quoted.quote.quote.output?.amount;
  await gateRequote(leg, amount, quotedOut, deps);

  // PP-INTEGRATION-POINT (POO-1037/POO-1038): the pre-broadcast destination balance, the "before"
  // side of the arrival test below (a bridge settles when `balanceOf(tokenOut) - this >= minAmountOut`
  // on the destination chain, §3.6). Read here, before ANY wallet prompt, because it is not
  // measurable once the transaction is in flight, and it is the same figure the journal persists so
  // a second session can re-run that test without this one.
  const baseline = await deps.readTokenBalance({
    chainId: leg.tokenOut.chainId,
    token: leg.tokenOut.address,
    owner: deps.owner,
  });
  const withBaseline: PlanRailState = {
    ...state,
    outBaselines: { ...state.outBaselines, [leg.index]: baseline },
  };

  // [R2] §3.4 steps 1 and 2: the intent, the account nonce and the destination baseline are all in
  // the record BEFORE the wallet is prompted. The arrival threshold is the FRESH quote's output, not
  // the planner's: this leg may have been re-sized, and a threshold sized for an amount we are no
  // longer sending would leave a perfectly good bridge reading as unarrived forever.
  await deps.journal?.beginLeg({
    index: leg.index,
    kind: leg.kind,
    chainId: leg.chainId,
    tokenIn: leg.tokenIn.address,
    tokenOut: leg.tokenOut.address,
    amountIn: amount,
    minAmountOut: quotedOut ?? leg.minAmountOut,
    ...(leg.tokenOut.chainId === leg.chainId
      ? {}
      : { destChainId: leg.tokenOut.chainId, destBalanceBefore: baseline }),
  });

  // [R3] A quote that carries `permitData` needs it signed before `/swap` will build anything.
  //
  // UF-28 R4: a Permit2 signature is a money-moving authorisation with no gas prompt and no on-chain
  // trace, so it is the one thing on this rail a user could approve without any wallet warning at
  // all. Before it is signed, the struct is checked against the leg the user reviewed: verified by
  // Permit2 on THIS chain (the domain separator is the only thing binding a signature to a network),
  // for THIS token, with an expiration short enough to be a per-swap authorisation rather than a
  // standing one. Its AMOUNT is reported rather than capped, because the ERC-20 approval above is
  // already capped to the plan and Permit2 cannot move more than that allowance permits.
  const permitData = quoted.quote.permitData;
  if (permitData) {
    assertPermitAuthorisesLeg(permitData, {
      chainId: leg.chainId,
      token: leg.tokenIn.address,
      amount,
    });
  }
  const signature = permitData
    ? await deps.signTypedData(toSignableTypedData(permitData))
    : undefined;

  const built = await deps.buildSwapTx({
    quote: quoted.quote,
    ...(signature === undefined ? {} : { signature }),
  });
  if (!built.ok) throw actionError(built);

  // [R1] The single broadcast choke point: chain assertion (one corrective switch, then re-verify)
  // and account assertion, inherited rather than re-implemented.
  // Passing the leg is what makes this broadcast journaled: the hash is written, and reported, the
  // instant the node returns it and before the receipt is awaited (§3.4 step 4).
  const txHash = await broadcast(built.swap, leg.chainId, deps, leg);
  // POO-1037: for a bridge leg this hash proves only that the funds LEFT the source chain. Arrival is
  // a destination-chain observation, minutes later, and the step is not done until it happens.
  if (leg.tokenOut.chainId !== leg.chainId) {
    const settlement = await awaitBridgeSettlement(
      {
        chainId: leg.tokenOut.chainId,
        token: leg.tokenOut.address,
        owner: deps.owner,
        baseline,
        // POO-1094: the FRESH quote's output, the same threshold `beginLeg` records above and for
        // the same reason. A bridge leg carries no slippage tolerance, and this leg may have just
        // been re-sized from the previous leg's realised delta, so the planner's figure is a floor
        // for an amount we are no longer sending. Comparing against it made a bridge that landed in
        // full read as unarrived until the ceiling, and `onDone()` never fired.
        minAmountOut: quotedOut ?? leg.minAmountOut,
        ...(leg.etaSeconds === undefined ? {} : { etaMs: leg.etaSeconds * 1000 }),
      },
      { readTokenBalance: deps.readTokenBalance },
    );
    // At the ceiling the leg stays `broadcast` in the journal WITH its hash, which is the whole
    // reason this throw is recoverable rather than a lost transfer (§3.6).
    if (!settlement.settled) throw bridgeStillSettling(leg, txHash, settlement);
  }
  // §3.6: a bridge is never called settled from here, not even by the inline wait above. The journal's
  // arrival verdict has one author, `reconcileFundingJournal`, which re-derives it from the chain; a
  // rail that wrote it too would be the "fakes success" failure by another name. Everything else is
  // done the moment its receipt is in, and this sits AFTER the wait so a cross-chain leg can never be
  // recorded settled on a source receipt whatever its `kind` says.
  // Chain-crossing, NOT kind: the sentence above promised "whatever its `kind` says" while the
  // code asked the kind, so a `bridge-gas` leg was recorded settled on its source receipt alone
  // (POO-1075). This is the same predicate the inline wait uses, which is the point.
  if (leg.tokenOut.chainId === leg.chainId) deps.journal?.recordSettled(leg.index);
  return {
    [PLAN_RAIL_STATE_KEY]: {
      ...withBaseline,
      legHashes: { ...withBaseline.legHashes, [leg.index]: txHash },
    },
    txHash,
  };
}

/**
 * How much this leg spends, in base units ([R6]).
 *
 * Resolved once per leg and memoised into the context, because the approval step and the leg step
 * both need it and a second on-chain read between them could return a different number.
 *
 * A leg the planner did NOT flag spends a balance that already exists, so its planned figure is
 * exact. A flagged leg is fed by the previous one, and is sized from the DELTA against the baseline
 * recorded before that leg broadcast: an absolute read would sweep in the user's pre-existing holding
 * of the same token, which they never allocated to this route.
 */
async function resolveAmountIn(
  leg: ProvisioningLeg,
  previousLeg: ProvisioningLeg | undefined,
  ctx: PlanRailCtx,
  deps: PlanRailDeps,
  sizeFractionBps?: number,
  reserveNativeRaw?: string,
): Promise<{ amount: string; state: PlanRailState }> {
  const state = readRailState(ctx);
  const memoised = state.legAmountsIn[String(leg.index)];
  if (memoised) return { amount: memoised, state };

  const amount = leg.requoteAtExecution
    ? await sizeFromRealBalance(leg, previousLeg, state, deps, sizeFractionBps, reserveNativeRaw)
    : leg.amountIn;
  return {
    amount,
    state: { ...state, legAmountsIn: { ...state.legAmountsIn, [leg.index]: amount } },
  };
}

/** The realized output of the leg that feeds this one, read on-chain as a delta ([R6]). */
async function sizeFromRealBalance(
  leg: ProvisioningLeg,
  previousLeg: ProvisioningLeg | undefined,
  state: PlanRailState,
  deps: PlanRailDeps,
  sizeFractionBps?: number,
  reserveNativeRaw?: string,
): Promise<string> {
  const balance = toBigInt(
    await deps.readTokenBalance({
      chainId: leg.chainId,
      token: leg.tokenIn.address,
      owner: deps.owner,
    }),
    "balance",
  );

  const feeds =
    previousLeg !== undefined &&
    previousLeg.tokenOut.chainId === leg.tokenIn.chainId &&
    sameAddress(previousLeg.tokenOut.address, leg.tokenIn.address);
  const baseline = feeds ? state.outBaselines[String(previousLeg.index)] : undefined;

  // No baseline means nothing in this run produced this token, so there is no delta to measure.
  // Fall back to the smaller of what the user approved and what is actually there: the first never
  // spends beyond the reviewed plan, the second never builds a transaction that cannot settle.
  const planned = toBigInt(leg.amountIn, "amount");
  const delta =
    baseline === undefined
      ? planned < balance
        ? planned
        : balance
      : balance - toBigInt(baseline, "balance");

  // POO-1136 [R1]: a fiat ETH->USDC buy-swap converts only the funding share of the delta and reserves
  // the gas share (the on-ramp bought ETH for both, and the swap tx itself needs native to run). The
  // fraction is applied to the DELTA, so the reserve scales with whatever the purchase delivered ([R4]).
  const fractioned =
    sizeFractionBps === undefined || delta <= BigInt(0)
      ? delta
      : (delta * BigInt(sizeFractionBps)) / BigInt(10_000);

  // POO-1154 Gap 2 / [R13]: with no proportional share to reserve, a NATIVE buy-swap would spend the
  // whole delta and leave nothing to gas its own transaction. Keep the signing reserve back (native the
  // user KEEPS to sign, never a gas COST). Only ever set alongside an undefined `sizeFractionBps`, so
  // `fractioned === delta` here; subtracting rather than re-deriving keeps the two paths from drifting.
  // A delta at or below the reserve leaves nothing, and the shipped empty-leg throw below fires.
  const reserve =
    reserveNativeRaw !== undefined && delta > BigInt(0)
      ? toBigInt(reserveNativeRaw, "reserve")
      : BigInt(0);
  const retained = fractioned - reserve;
  const amount = retained > BigInt(0) ? retained : BigInt(0);

  if (amount <= BigInt(0)) {
    throw new TransactionError("The previous funding step delivered nothing to continue with", {
      code: "PROVISIONING_LEG_EMPTY",
    });
  }
  return amount.toString();
}

/**
 * Hand the fresh hash to the live-tab seam, and never let that fail the leg.
 *
 * The money has already moved by the time this runs. A callback that throws (a full `localStorage`,
 * a host bug) must not turn a successful broadcast into a flow error, because the flow's `retry()`
 * re-invokes the failed step verbatim, which for a bridge is a second deposit of the same funds.
 * Losing the write degrades RECOVERY; failing here would risk the money itself. The durable journal
 * beside it needs no such wrapper: `fundingJournal` already swallows an unwritable store internally,
 * for the same reason.
 */
function reportBroadcast(leg: ProvisioningLeg, txHash: string, deps: PlanRailDeps): void {
  try {
    deps.onLegBroadcast?.({ leg, txHash, at: Date.now() });
  } catch (error) {
    console.warn("[PP] funding journal write failed; the leg continues", error);
  }
}

/**
 * The poll ceiling, expressed as a throw ([R3]).
 *
 * The rail has exactly two channels back to `useWalletSignFlow` (return or throw) and returning would
 * advance the plan onto money that has not arrived. So a still-settling bridge throws, with a code the
 * panel branches on to render "still settling, we'll update you" instead of a failure, and with the
 * hash so the user can verify the transfer independently. It is deliberately NOT in the diagnostics
 * catalog: this is not a transaction failure and must never reach a retry affordance.
 *
 * The cause carries only what `toTxError` actually reads (`code`, `txHash`). The destination chain
 * stays in the message: the panel's explorer link needs the SOURCE chain, which is where the hash
 * exists, so a `destChainId` on the cause would be a field nothing could correctly consume.
 */
function bridgeStillSettling(
  leg: ProvisioningLeg,
  txHash: string,
  settlement: Extract<BridgeSettlement, { settled: false }>,
): TransactionError {
  return new TransactionError(
    `Bridged funds have not arrived on chain ${leg.tokenOut.chainId} after ${Math.round(
      settlement.waitedMs / 1000,
    )}s (${settlement.polls} checks, last observed delta ${settlement.delta})`,
    { code: BRIDGE_PENDING_CODE, txHash },
  );
}

/**
 * Send a provider-built transaction through the shipped choke point and wait for its receipt.
 *
 * Deliberately NOT `executeBuiltTransaction`, which is the same two calls in one: it resolves only
 * after the receipt, and both records of the hash have to happen in between ([R2], §3.4 step 4).
 * `sendBuiltTransaction` resolves the moment the node accepts the transaction, and that resolution
 * point is where the hash is written to the journal and reported to the live tab, synchronously,
 * before anything is awaited. A hash learned and then lost to a closed tab is the failure this
 * ordering exists to prevent, and for a bridge that loss is a second deposit of the same money.
 *
 * `leg` is absent for an approval step, which is exactly why an approval is neither journaled nor
 * reported: it moves no funds, so re-running one cannot spend money twice.
 */
async function broadcast(
  request: UniswapTransactionRequest,
  targetChainId: number,
  deps: PlanRailDeps,
  leg?: ProvisioningLeg,
): Promise<`0x${string}`> {
  // POO-1093 [R3]: never spend twice for money already in flight.
  //
  // `flow.retry()` re-runs the failed step verbatim (the provisioning flow sets no `pauseAfterKey`,
  // so both of `useWalletSignFlow.retry()`'s guarded branches are skipped), and the rail used to
  // broadcast again without ever asking whether this leg had already left. One flaky receipt read
  // was enough to arm it, and the amount is memoised into the rail context, so the retry re-sent the
  // identical size: a second bridge deposit wherever the wallet still held a residual balance.
  //
  // Refusing here rather than at the button keeps the guard at the choke point every leg funnels
  // through, so a new caller cannot route around it. Recovery is the correct path from this state:
  // `reconcileFundingJournal` reads the chain and decides whether the leg landed.
  const recorded = leg ? deps.journal?.legStatus(leg.index) : null;
  if (recorded?.status === "broadcast" && recorded.txHash) {
    throw new TransactionError(
      "This step already went out and is being tracked. Reload to pick it up rather than sending it again.",
      { code: "PROVISIONING_LEG_ALREADY_BROADCAST", txHash: recorded.txHash },
    );
  }

  const hash = await sendBuiltTransaction(
    deps.provider,
    toBuiltTx(request, deps.owner),
    deps.owner,
    targetChainId,
  );
  if (leg) {
    deps.journal?.recordBroadcast(leg.index, hash);
    reportBroadcast(leg, hash, deps);
  }
  try {
    await waitForReceipt(deps.provider, hash);
  } catch (error) {
    // POO-1093 [R3]: a REVERT moved no money, so the leg must be freed or the guard above would
    // block the legitimate retry while telling the user it "was already sent and is still being
    // tracked" — the opposite of what happened. `recordFailed` keeps the hash, which is still
    // evidence.
    //
    // A TIMEOUT is deliberately NOT treated this way. We never learned the outcome, so the leg may
    // well be on chain and must stay `broadcast` for the guard to keep protecting it. "Failed" is a
    // verdict, not a shrug.
    if (leg && isRevert(error)) deps.journal?.recordFailed(leg.index);
    throw error;
  }
  return hash;
}

/** A receipt that came back FAILED, as opposed to a read we never got an answer from. */
function isRevert(error: unknown): boolean {
  return (
    error instanceof TransactionError &&
    (error.cause as { code?: string } | undefined)?.code === TX_REVERTED
  );
}

/**
 * POO-1508 [R43] rules v2: hold the leg if the fresh quote is materially worse than the price the
 * user approved ([R5]), UNLESS the run's shared price-move buffer still covers it.
 *
 * Runs BEFORE the permit signature and therefore before anything the user could mistake for consent.
 * There is no "accept a worse price" step here, on purpose: within the buffer the leg proceeds with
 * nobody asked (the disclosure shown before broadcasting anything is the consent), and past it nothing
 * is sent at all. With no consumer wired this refuses rather than assuming the buffer holds: silently
 * signing a refreshed quote nothing accounted for is the failure mode that turns a good integration
 * into a support incident (§4.4).
 */
async function gateRequote(
  leg: ProvisioningLeg,
  amountIn: string,
  quotedOut: string | undefined,
  deps: PlanRailDeps,
): Promise<void> {
  if (quotedOut === undefined) return;
  const approved = { amountIn: leg.amountIn, amountOut: leg.amountOutQuoted };
  const quoted = { amountIn, amountOut: quotedOut };
  if (!isRequoteMateriallyWorse(approved, quoted)) return;

  const worseBps = requoteWorseBps(approved, quoted) ?? 0;
  if (deps.consumeBuffer?.(worseBps)) return;
  throw new TransactionError(
    "The market moved more than the buffer we set aside, so nothing was sent and your money did not move",
    { code: PROVISIONING_BUFFER_EXCEEDED_CODE },
  );
}

/**
 * Adapt a Uniswap `TransactionRequest` into the {@link BuiltTx} the send path takes, asserting the
 * two fields that are wrong in ways a wallet will not catch.
 *
 * [R4] `data` must be non-empty hex. The schema already enforces it, and it is re-asserted here
 * because the cost of being wrong is a mined transaction that reverts and burns the gas. A stale
 * quote is exactly how `/swap` returns empty calldata, and a stale quote is normal on this rail.
 *
 * [R5] `value` arrives as HEX from the live API. `request.chainId` rides along so the choke point's
 * build-vs-target check (`BUILD_TARGET_MISMATCH`) cross-checks the route's own chain for free.
 */
function toBuiltTx(request: UniswapTransactionRequest, owner: string): BuiltTx {
  if (!CALLDATA_PATTERN.test(request.data)) {
    throw new TransactionError(
      "The funding route returned empty calldata, which would revert on-chain",
      { code: "PROVISIONING_EMPTY_CALLDATA" },
    );
  }
  return {
    tx: {
      to: request.to,
      from: request.from ?? owner,
      data: request.data,
      value: normaliseWeiValue(request.value),
    },
    chainId: request.chainId,
  };
}

/**
 * A wei amount as a decimal string, from either the hex the API sends or a decimal ([R5]).
 *
 * Explicitly NOT the silent-zero fallback `toHexValue` uses: a value it cannot parse becomes `0x0`
 * there, which for a `WRAP` route would drop the native amount and mine a transaction that does
 * nothing. Refusing to send is the only safe reading of an amount we cannot understand.
 */
function normaliseWeiValue(value: string | undefined): string {
  if (value === undefined || value.trim() === "") return "0";
  return toBigInt(value, "value").toString();
}

/** Parse a base-unit amount (decimal or hex). Rejects anything unparseable or negative. */
function toBigInt(value: string, label: string): bigint {
  let parsed: bigint;
  try {
    parsed = BigInt(value.trim());
  } catch {
    throw new TransactionError(`The funding route's ${label} is not a valid amount: ${value}`, {
      code: "PROVISIONING_INVALID_AMOUNT",
    });
  }
  if (parsed < BigInt(0)) {
    throw new TransactionError(`The funding route's ${label} is negative: ${value}`, {
      code: "PROVISIONING_INVALID_AMOUNT",
    });
  }
  return parsed;
}

/**
 * Uniswap's `permitData` as a signable EIP-712 payload, with **every uint as a decimal string** ([R3]).
 *
 * Twice-learned in this codebase (POO-1001, then POO-1002's create-pool twin): Privy's embedded
 * (social-login) wallet signer `JSON.stringify`s typed data, and `JSON.stringify` throws
 * "Do not know how to serialize a BigInt". External wallets tolerate a native bigint through a
 * different path, so this fails for social-login users only, which is the worst way to find out.
 * Decimal strings are the canonical EIP-712 JSON encoding for uints and hash identically, so the
 * signature is unchanged and both wallet types sign.
 *
 * `domain.chainId` is the one field kept NUMERIC, mirroring the shipped `permitTypedData`: viem's
 * signer types it as a number.
 */
export function toSignableTypedData(permitData: {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  values: Record<string, unknown>;
}): RailTypedData {
  const domain = normaliseTypedValue(permitData.domain) as Record<string, unknown>;
  const chainId = domain.chainId;
  return {
    domain:
      typeof chainId === "string" && /^\d+$/.test(chainId)
        ? { ...domain, chainId: Number(chainId) }
        : domain,
    types: normaliseTypedValue(permitData.types) as Record<string, unknown>,
    primaryType: resolvePrimaryType(permitData.types),
    message: normaliseTypedValue(permitData.values) as Record<string, unknown>,
  };
}

/** Deep-copy, turning every native bigint into its decimal string. Everything else passes through. */
function normaliseTypedValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normaliseTypedValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        normaliseTypedValue(nested),
      ]),
    );
  }
  return value;
}

/**
 * The primary type of an EIP-712 type graph: the struct nothing else references.
 *
 * The API sends `{ domain, types, values }` with no `primaryType`, and a wallet needs one. Deriving
 * it beats hardcoding `"PermitSingle"`, which would silently sign the wrong struct the day a route
 * returns a different permit shape. Ambiguity (more than one root) resolves to declaration order,
 * which is the same answer a hardcode would have given for the shape we do see.
 */
function resolvePrimaryType(types: Record<string, unknown>): string {
  const declared = Object.keys(types).filter((name) => name !== "EIP712Domain");
  const referenced = new Set<string>();
  for (const fields of Object.values(types)) {
    if (!Array.isArray(fields)) continue;
    for (const field of fields) {
      const type = (field as { type?: unknown }).type;
      // Strip an array suffix: `PermitDetails[]` still references `PermitDetails`.
      if (typeof type === "string") referenced.add(type.replace(/\[\d*\]$/, ""));
    }
  }
  return declared.find((name) => !referenced.has(name)) ?? declared[0] ?? "PermitSingle";
}

/** Only a plain broadcast is executable here; EIP-5792 batching (`SEND_CALLS`) is out of scope. */
function isExecutable(planStep: ProvisioningStep): boolean {
  return planStep.method === undefined || planStep.method === "SEND_TX";
}

/** A step this rail cannot run. Fails legibly rather than being silently skipped. */
function unsupportedStep(planStep: ProvisioningStep, detail: string): TransactionError {
  return new TransactionError(
    `Funding step "${planStep.key}" ${detail}, which this rail cannot execute.`,
    { code: "PROVISIONING_STEP_UNSUPPORTED" },
  );
}

/**
 * A typed action failure as the throw the flow expects. The house contract (POO-475 [R3]): the code
 * rides on `error.cause.code`, which is where `toTxError` / `classifyTxError` read it, so a funding
 * failure classifies exactly like every other build-action failure. POO-1251 [R1]: the correlation
 * id rides alongside it, so a funding failure gets a support reference like every other one.
 */
function actionError(failure: BuildTxFailure): TransactionError {
  return new TransactionError(failure.message, {
    code: failure.code,
    // Omitted rather than set to `undefined`, so `toTxError`'s fallback to the browser trace id fires
    // on a failure that never reached the backend. `TransactionError.cause` is `unknown`, so nothing
    // here is checked at compile time and the spelling of this key is guarded by tests alone.
    ...(failure.correlationId ? { correlationId: failure.correlationId } : {}),
  });
}
