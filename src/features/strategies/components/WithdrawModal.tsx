/**
 * @id PP-STR-MOD-004
 * @name WithdrawModal (amount/method → Review → pending → success)
 * @implements-rules-version v12 (POO-844 + POO-847 rules v1)
 *
 * POO-847 (rules v1, Murilo 2026-07-11): an OWNED (isPoolManager) position reached through this
 * investor surface (the managed view is desktop-only, so mobile managers land here). POO-804 R1
 * applies on this surface too — the payout is PAIR-ONLY (receive-as locked to the pool pair, fixed
 * gear display, every build rides receiveAsPair=true) — and an ACTIVE removal that is a full exit
 * OR promotes to a close (owned > 50% or a dust remainder, mirroring desktop POO-312) CLOSES the
 * pool (R4) with full manage-path signaling: the destructive close alert + investors note replace
 * the dust notice, the CTAs become the destructive "Close strategy", a Continue / Keep-the-strategy
 * ConfirmDialog gates the build (POO-804 R3 parity) and success reads "Strategy closed". A CLOSED
 * owned position is a post-close claim and keeps the investor copy.
 *
 * POO-844 (rules v1, money-truth): when EVERY decoded leg is USDC the decode is the ALL-IN payout
 * (fees included) and drives the success body + the receipt's Amount/Total VERBATIM — never
 * decoded + the fee snapshot (double count); a mixed/pair decode understates, so those keep the
 * estimate composition (R1). A built `minAmountInStable` outside the plausible band (below 0.9x
 * the protocolFee-free client floor — the POO-845 dropped-leg class — or above the amount, or with
 * a zero floor) suppresses the real arrival line instead of displaying the broken figure (R2,
 * never a fabricated substitute). EVERY amountText write (seed / close-reset / Max / unit flip)
 * runs through the sanitizer against the target unit, and the seed re-syncs from the live balance
 * on open (R3/R4), so the display can never read >100% or carry a raw float — which also makes a
 * sub-floor position's unit flip land on 100 (R5).
 *
 * POO-844 (rules v1, raw-values refinement to R1): an X/USDC pair whose non-USDC leg goes UNPRICED
 * (its meta failed to resolve) no longer collapses to the all-USDC verbatim path. `buildReceivedLegs`
 * keeps that leg as a RAW base-unit row (no `usd`) instead of dropping it and sets `hasUnpricedLeg`,
 * so the gate here (`!hasUnpricedLeg` + every leg priced) stays OFF and the receipt shows the
 * per-token raw amounts (USDC leg as USD, the unpriced leg raw) rather than a USDC-only total that
 * understates the payout. On the genuine all-USDC branch the fee line reads "Fees collected
 * (included)" (feesIncludedInTotal) so an Amount == Total receipt can't read as if fees add on top.
 *
 * Withdraw from an owned position: choose an amount + method → Review → pending → success. Two
 * methods — Regular (≈2 business days, no fee, the default) and Instant (1% fee, red-tinted as the
 * cost of the choice). The fee appears only on the Instant option and again in the Review fee block
 * (fees-at-confirmation rule). The Review step reinforces that the remaining balance keeps earning,
 * so withdrawing is never incentivized over staying invested. Combines PP-STR-MOD-004 + PP-STR-MOD-005.
 *
 * Closed position (the manager ended the strategy — POO-185, Drafts 5369:571/578): a single-step
 * flow instead — the full balance, tagged only "Instant" (settlement is immediate). POO-570: the
 * chip no longer claims "No fee" — a closed exit is NOT fee-free (it always carries network gas,
 * the swap slippage when the strategy tokens convert to USDC, and protocol fees), and the
 * instant-with-fee / 2-business-day-free split that "No fee" referred to is not implemented. The
 * closed receipt therefore drops the fee row entirely (it is not fee-free, so asserting it is
 * misleading), keeping amount · date + explorer link.
 *
 * POO-498 (POO-483 rules v2 @implements-rules-version v2): when the pair is selected, "You receive at
 * least" breaks into exactly TWO per-token rows (amount + estimated USD + logo) computed by the pure
 * positionTokenSplit / splitUsdAmount lib (PP-CORE-LIB-022) from the position's raw reserves, SAME
 * code path in mock and real mode. When the raw block is absent (the split is null) it degrades to
 * the honest single USD total (R4). This replaced the even-split PP-MOCK WithdrawTokenList + the
 * MOCK_TOKEN_PRICE_USD table (deleted).
 *
 * POO-513 R2: closing the modal resets the gear settings (slippage / deadline / receive-as) to the
 * flow defaults, joining the universal reset-on-close policy Invest/Collect/Compound already followed.
 *
 * POO-514 (rules v1): EVERY success receipt (regular and closed alike) carries the transaction row
 * and the shared ExplorerTxLink (PP-CORE-CMP-050) on the strategy's network — the explorer link is
 * no longer scoped to the closed-position receipt.
 *
 * POO-515 R2 (v6): receive-as = the token pair skips the stable swap, so the Max slippage component
 * (and any DEX fee) drops out of the Est. fee and the min-received math; the caption drops the
 * slippage qualifier accordingly. Only the network gas (+ the mock Instant fee) remain.
 *
 * POO-512 (v7): the Review arrival footer respects the REAL arrival semantics. In mock mode it
 * follows the CHOSEN method (Regular = about 2 business days, Instant = instantly); a lock-up still
 * wins (POO-403 R9). Real mode is unchanged: no method choice, instant, lock-up-aware (POO-302 R1).
 *
 * POO-548 (rules v2): review refinements aligning the investor Withdraw with the manager Remove. R1
 * — the amount step is already gearless (guard), and the closed-position step KEEPS its gear (the
 * only slippage/receive-as entry for a closed exit; R1 exception). R2 — the amount already opens in
 * $ (guard). R3 — the Review shows a "Fees available to collect" row directly below "Amount
 * requested", shown even at $0.00. R4 — on the token-pair path BOTH "Amount requested" AND the
 * Fees-available row break into per-token rows via the shared positionTokenSplit / splitUsdAmount
 * (PP-CORE-LIB-022); "You receive at least" stays a single total line (its per-token receive rows are
 * the POO-498 behavior, unchanged); USDC keeps single-value rows. R5 — the fee figure sources from
 * position.totalYield (= totalFeesInUsd, the Home Yield source), not the empty uncollectedFeesUsd.
 *
 * POO-846 R1 (rules v1): supersedes POO-548 R4's USDC branch — the Amount requested + Fees available
 * per-token split now shows whenever the reserve split resolves, regardless of receive-as; the rows
 * describe what the withdrawal unwinds, the Receive-as row states the payout.
 *
 * POO-574 (rules v1, R1-R6): the build->review->sign handshake. Continuing from the amount step now
 * builds the withdraw quote first, then advances to Review; the Review reflects that freshly built
 * quote before the user signs. A 10s re-quote timer keeps the Review honest: when it elapses the quote
 * is re-fetched (re-built) so the numbers the user signs against never go stale, and only then does
 * signing proceed. This makes build, review, and sign one ordered handshake instead of three loose steps.
 *
 * POO-595 (rules v1): extraction only, no behavior change. The `building` spinner is the shared
 * BuildingStep (PP-CORE-CMP-052) and the Review countdown is the shared useReviewCountdown
 * (PP-CORE-HOK-018); the re-quote copy now reads the shared `flow.review.refreshIn` key (was
 * `withdraw.review.refreshIn`), so the rollout modals reuse the same primitives.
 *
 * POO-612 (rules v1): the Review reads the REAL swap figures from the built quote (swapInfo). On the
 * USDC payout the Review breaks the swap down into a price-impact row (R1) and the real swap protocol
 * fee joins the Est. fee breakdown; the real minimum received (already net of slippage + impact + fee)
 * replaces the client estimate (R3). The token-pair payout skips the stable swap, so these rows drop out.
 *
 * POO-800 (rules v1, R5/R6): the Review's "Est. fees" row goes through the shared buildFeeRow
 * (FeeBreakdown) — the hand-rolled WithdrawFeesTooltipBody + flat-label duplicate are gone, same
 * lines and values. The "after fees…" caption (USDC payout only, POO-923 R3) and the instant
 * arrival footer read the shared `flow.review.caption` / `footerInstant` keys, reused by every card.
 *
 * POO-803 (rules v1, 0710 overhaul): setup hardening — the dust promotion is inclusive (≤ $5, R1),
 * a sub-floor balance locks the input at the full exit (R2), and the amount input clamps at the
 * balance with 6/1 decimal caps ($/%, R3). The Review + Receipt render the SHARED withdraw-family
 * cards (WithdrawFlowCards, also used by RemoveLiquidityModal — POO-799 decision #10): the old
 * You-receive-at-least / Remaining-invested / Amount / Total-received-(min) rows are gone (R5); the
 * arrival line is the min indicator, REAL only off the built minimum (R8); the receipt shows
 * Amount Received / Fees collected / Total received with the final canonical Fee (R9/R11) and the
 * 5s auto-close is gone (R10). The $0.30 gas figure is mock-only (real hides the line); the closed
 * notice no longer claims "no fee" (R4).
 *
 * POO-853 [R6] (referral parity, rules v1): on a confirmed remove/withdraw, logs REMOVE_LIQUIDITY to
 * the referral operation feed (`useReferralOperationLog`, real-only + deduped).
 */
"use client";

import { RefreshCw, Zap } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { BuildingStep } from "@/components/ui/BuildingStep";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { ExplorerTxLink } from "@/components/ui/ExplorerTxLink";
import { TransactionModalHeader } from "@/components/ui/TransactionModalHeader";
import { ownedRemovalClosesPool } from "@/features/manager/lib/removalPlan";
import { useReferralOperationLog } from "@/features/rewards/hooks/useReferralOperationLog";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import type { Position, Strategy } from "@/lib/schemas";
import type { TxError } from "@/lib/tx/diagnostics";
import type { ReceivedLegsResult } from "@/lib/tx/receivedAmounts";
import { usePostWriteRefresh } from "@/lib/tx/usePostWriteRefresh";
import { positionTokenSplit, type SplitUsdAmount, splitUsdAmount } from "@/lib/uniswap";
import { cn } from "@/lib/utils/cn";
import { formatTokenAmount, formatTxHash, formatUsd } from "@/lib/utils/format";
import { useProvisioningGate } from "../hooks/useProvisioningGate";
import { useReviewCountdown } from "../hooks/useReviewCountdown";
import { useSlippageAutoRetry } from "../hooks/useSlippageAutoRetry";
import { type FlowStep, useWalletSignFlow } from "../hooks/useWalletSignFlow";
import type { WithdrawCtx } from "../hooks/useWithdraw";
import { provisioningOpLabelKey } from "../lib/buildProvisioningInput";
import { withdrawReceiveOptions } from "../lib/receiveOptions";
import { DEFAULT_SLIPPAGE_PCT } from "../lib/slippage";
import { PriceImpactGate, usePriceImpactGate } from "./PriceImpactGate";
import { ProvisioningPanel } from "./ProvisioningPanel";
import { StrategyMiniHeader } from "./StrategyMiniHeader";
import {
  MOCK_BUILT_TX,
  settleOutcomeForSlippage,
  settleSwapInfo,
  settleTxError,
  settleTxHash,
} from "./settle";
import { TransactionErrorActions, useTxErrorBody } from "./TransactionErrorActions";
import { TransactionSettingsDialog } from "./TransactionSettingsDialog";
import { TransactionStatus } from "./TransactionStatus";
import { resolveWalletSignSteps } from "./WalletSignModal";
import { WalletSteps } from "./WalletSteps";
import {
  WithdrawReceiptCard,
  WithdrawReviewCard,
  type WithdrawTokenRow,
} from "./WithdrawFlowCards";
import type { WalletSignSpec } from "./walletSignSteps";

/** Withdrawal speed/cost option. */
type Method = "regular" | "instant";
/** Flow phases for the withdraw dialog ("closed" replaces method+confirm for closed positions;
 * pending shows the multistep wallet handoff, POO-295; "provision" is the POO-419 pre-flight gate). */
// POO-574: `building` runs the server build (pauseAfterKey) before the Review; the Review shows the
// built figures + a 10s re-quote countdown, and the wallet is only called on the Review's approve.
type Phase =
  | "closed"
  | "method"
  | "building"
  | "review"
  | "provision"
  | "pending"
  | "success"
  | "error";

/** The instant-withdrawal fee, as a fraction of the amount. */
const INSTANT_FEE_RATE = 0.01;

/** Below this remaining USD value a partial withdraw is promoted to a full exit (no dust positions). */
const DUST_FLOOR_USD = 5;

/** POO-574 R3: the Review re-quotes (flow.rebuild) this many seconds after each build settles. */
const REVIEW_REFRESH_SECS = 10;

/**
 * Estimated network gas for the withdrawal, in USD (mock, POO-403 R10). Part of the Review's
 * "Est. fees (slippage + network)" so the row matches its label and breaks down in the tooltip.
 * PP-INTEGRATION-POINT (POO-405): the real gas estimate comes from the server when it builds the
 * withdraw tx.
 */
const NETWORK_FEE_USD = 0.3;

/** Round to 2 decimals (keeps the $/% toggle conversion from showing float noise). */
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * POO-844 R2: how far below the client floor (amount − fees − slippage) a BUILT minimum may sit and
 * still be trusted. A legit quote lands within a few percent of the floor (price impact is already
 * in the fee estimate); a zero-quoted route leg (POO-845) understates it by tens of percent.
 */
const MIN_RECEIVED_PLAUSIBILITY = 0.9;

/**
 * POO-844 R3 (extends POO-803 R3): cap/clamp an amount string for a unit against the position
 * balance — digits + a single dot, 6 decimals in $ / 1 in %, hard clamp at the max (the clamp
 * floors to the decimal cap so a raw balance float never leaks more precision than the cap). Pure,
 * shared by the seed / close-reset / Max / unit-flip writers and the onChange sanitizer.
 */
function sanitizeAmountFor(value: string, unit: "usd" | "pct", maxUsd: number): string {
  const clean = value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
  const [head, tail] = clean.split(".");
  const capped = tail != null ? `${head}.${tail.slice(0, unit === "usd" ? 6 : 1)}` : clean;
  const max = unit === "usd" ? maxUsd : 100;
  const parsed = Number.parseFloat(capped);
  return Number.isFinite(parsed) && parsed > max
    ? String(unit === "usd" ? Math.floor(max * 1e6) / 1e6 : max)
    : capped;
}

/**
 * Round a $ preset to a clean step (>= $5 spacing) so the quick amounts read like "$600", not
 * "$585.27" (POO-386 R3). Quarter-magnitude step, floored at $5.
 */
function roundPreset(value: number): number {
  if (value <= 5) return Math.max(5, Math.round(value));
  const mag = 10 ** Math.floor(Math.log10(value));
  const step = Math.max(5, mag / 4);
  return Math.round(value / step) * step;
}

/** The withdraw signing sequence: server build → send (no client signature). */
const WITHDRAW_SPEC: WalletSignSpec = { build: true, confirm: "withdraw" };

/** Per-step mock duration so the stepper visibly walks in mock mode. */
const MOCK_STEP_MS = 350;

/**
 * Mock withdraw steps: build then a final step that settles success/error. POO-499 R6: the confirm
 * step reads the current gear slippage via `slippageRef` so a <= 0.1% setting fails deterministically
 * with the canned slippage error (demoing the auto-retry path); higher slippage keeps the happy path.
 */
function mockWithdrawSteps(
  slippageRef: { current: number },
  amountUsd: number,
): FlowStep<WithdrawCtx>[] {
  const beat = () => new Promise((resolve) => setTimeout(resolve, MOCK_STEP_MS));
  return [
    {
      key: "build",
      run: async () => {
        await beat();
        // POO-611: the mock build now carries a real-shaped swapInfo so the Review demos real figures
        // (price impact / protocol fee / min received) in mock mode; gas stays the honest estimate.
        return {
          built: {
            tx: MOCK_BUILT_TX,
            swapInfo: settleSwapInfo(amountUsd, { slippagePct: slippageRef.current }),
          },
        };
      },
    },
    {
      key: "confirm:withdraw",
      run: async () => {
        await beat();
        if (settleOutcomeForSlippage(slippageRef.current) === "error") {
          const mockError = settleTxError();
          throw Object.assign(new Error(mockError.message), { code: mockError.code });
        }
        return { txHash: settleTxHash() };
      },
    },
  ];
}

/** A selectable method card (radio). */
function MethodOption({
  selected,
  title,
  desc,
  fee,
  onSelect,
}: {
  selected: boolean;
  title: string;
  desc: string;
  fee: string;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-xl border p-4 text-left transition-colors",
        "focus-within:ring-2 focus-within:ring-ring",
        selected ? "border-input bg-surface-raised" : "border-border hover:bg-surface-raised",
      )}
    >
      <input
        type="radio"
        name="withdraw-method"
        checked={selected}
        onChange={onSelect}
        className="sr-only"
      />
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-foreground" : "border-border",
        )}
        aria-hidden="true"
      >
        {selected ? <span className="size-2.5 rounded-full bg-foreground" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-foreground text-sm">{title}</span>
        <span className="block text-muted-foreground text-xs">{desc}</span>
      </span>
      {/* POO-445 R5: fees are never red — the method cost is always muted. */}
      <span className="shrink-0 font-medium text-muted-foreground text-sm">{fee}</span>
    </label>
  );
}

/** Public props for {@link WithdrawModal}. */
export interface WithdrawModalProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void;
  /** The strategy the position belongs to. */
  strategy: Strategy;
  /** The owned position being withdrawn from. */
  position: Position;
  /**
   * Real-mode step builder (server build → send), driven by the wallet-sign runner. When provided it
   * replaces the mock settle AND collapses the UI to an instant, fee-free withdrawal (the API removal
   * is immediate and has no fee) — the method choice and fee statements are hidden. When absent the
   * dialog runs the mock Regular/Instant flow.
   */
  buildWithdrawSteps?: (
    amountUsd: number,
    slippage: number,
    /** POO-481 R4: the gear's receive-as choice; true = keep the pool pair (shouldSwapFees false). */
    receiveAsPair?: boolean,
  ) => FlowStep<WithdrawCtx>[];
  /** Called once the withdraw succeeds, so the detail screen refreshes the owner's position. */
  onChanged?: () => void;
}

/** Withdraw method + confirm dialog. */
export function WithdrawModal({
  open,
  onOpenChange,
  strategy,
  position,
  buildWithdrawSteps,
  onChanged,
}: WithdrawModalProps) {
  const t = useTranslations("strategies");
  // POO-847: the owned-close signaling reuses the manage-path copy (alert note, confirm dialog,
  // destructive CTA, "Strategy closed" success) so both surfaces speak one close language.
  const tManager = useTranslations("manager");
  // Receipt dates render in the ACTIVE locale (a hard-coded en-US date on a pt-BR receipt is the
  // semantic-i18n class i18n:check cannot catch).
  const format = useFormatter();
  const { track } = useAnalytics();
  // POO-853 [R6]: log a referred wallet's remove-liquidity to the referral operation feed (real-only,
  // deduped, fire-and-forget); no-ops for non-referred wallets and in mock mode.
  const logReferralOp = useReferralOperationLog();
  // POO-419: pre-flight gate (dark-launched flag) — decides review → provision → pending.
  const gate = useProvisioningGate();
  // Closed position: the manager already unwound it, so the whole flow collapses to one step.
  const isClosedPosition = position.status === "closed";
  const initialPhase: Phase = isClosedPosition ? "closed" : "method";
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [txError, setTxError] = useState<TxError | null>(null);
  const [method, setMethod] = useState<Method>("regular");
  // Real mode: an instant, fee-free withdrawal — no method choice, no fee statements.
  const isReal = buildWithdrawSteps != null;
  const [txHash, setTxHash] = useState<string | null>(null);
  // POO-810 R6: the REAL per-token amounts received, decoded from the receipt (USDC leg as USD),
  // snapshotted at success. Null → the receipt falls back to the pre-broadcast "Total received" (R9).
  const [decodedReceived, setDecodedReceived] = useState<ReceivedLegsResult | null>(null);
  // Post-write freshness: refetch positions + catalog + re-render, with a bounded poll (POO-364).
  const postWriteRefresh = usePostWriteRefresh(onChanged);
  // POO-844 R3: the seed runs through the sanitizer (a raw balance float would exceed the 6-decimal
  // cap); R4 below re-syncs it from the LIVE balance on every open.
  const [amountText, setAmountText] = useState(() =>
    sanitizeAmountFor(String(position.currentValue), "usd", position.currentValue),
  );
  // POO-386 R2: the amount accepts $ or % via a toggle; the typed value is the source of truth and
  // the USD amount is derived from the active unit.
  const [unit, setUnit] = useState<"usd" | "pct">("usd");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slippage, setSlippage] = useState<number>(DEFAULT_SLIPPAGE_PCT);
  const [deadlineMins, setDeadlineMins] = useState(30);
  // POO-481 R1 (supersedes the POO-403 R4 N-way picker): binary receive-as, USDC (default) or the
  // pool token pair, resolved from data the modal already holds in BOTH modes
  // (claimableFeeTokens → detail.poolPair → top-level strategy.poolPair).
  const { options: receiveOptions, pairTokens } = withdrawReceiveOptions(strategy, position);
  const [receiveAs, setReceiveAs] = useState(receiveOptions[0] ?? "USDC");
  // POO-847 (Murilo 2026-07-11): an OWNED (isPoolManager) position reached through the investor
  // surface — the managed view is desktop-only, so below `lg` the manager lands here. POO-804 R1
  // applies to the manager on THIS surface too: the payout is PAIR-ONLY (receive-as locked, fixed
  // gear display, every build rides receiveAsPair=true), and an ACTIVE removal that is a full exit
  // OR promotes to a close (> 50% or a dust remainder, mirroring desktop POO-312) CLOSES the pool
  // (R4) with the manage-path signaling (close alert + investors note + Continue/Keep confirm).
  const ownedManaged = position.isPoolManager === true;
  const pairOption = receiveOptions.find((option) => option !== "USDC");
  // POO-847 R3-parity confirm gate for the owned close (mirrors POO-804 R3).
  const [confirmClose, setConfirmClose] = useState(false);

  const typedRaw = Number.parseFloat(amountText) || 0;
  const typedAmount = isClosedPosition
    ? position.currentValue
    : unit === "pct"
      ? Math.min(position.currentValue, (typedRaw / 100) * position.currentValue)
      : typedRaw;
  const typedRemaining = Math.max(0, position.currentValue - typedAmount);
  // Dust rule (POO-313, POO-803 R1: the boundary is now INCLUSIVE): a partial that would leave
  // 0 < remaining <= $5 is promoted to a full withdraw (can't leave a dust position).
  const dust = !isClosedPosition && typedRemaining > 0 && typedRemaining <= DUST_FLOOR_USD;
  // POO-403 R8 / POO-803 R2: a position at/below the dust floor can only be withdrawn in full —
  // the alert shows on open, the partial presets drop and the input LOCKS at the full balance.
  const belowFloor =
    !isClosedPosition && position.currentValue > 0 && position.currentValue <= DUST_FLOOR_USD;
  // The effective withdraw amount — full when the dust rule applies (typed partial or sub-floor).
  const amount = dust || belowFloor ? position.currentValue : typedAmount;
  // No fee in real mode (the API withdrawal is instant + free); mock mode keeps the Instant fee.
  const fee = !isReal && !isClosedPosition && method === "instant" ? amount * INSTANT_FEE_RATE : 0;
  const youReceive = amount - fee;
  const remaining = Math.max(0, position.currentValue - amount);
  const valid = typedAmount > 0 && typedAmount <= position.currentValue;
  // POO-847 R4: an ACTIVE owned removal that is a full exit (typed full / Max / dust / below-floor)
  // OR promotes to a close (> 50% or a dust remainder, via the SHARED desktop POO-312 predicate
  // `ownedRemovalClosesPool`) CLOSES the pool — mirrored from useWithdraw's routing off the SAME
  // effective `amount` so the UI signals EXACTLY what will build (no divergent 50% here). A closed
  // owned position is a post-close claim (withdraw-tx) and keeps the investor copy.
  const closingPool =
    ownedManaged && !isClosedPosition && ownedRemovalClosesPool(amount, position.currentValue);
  // POO-819 R4: read the lock-up TOP-LEVEL first (the real v2 mapper carries `lockupDays` and never
  // fabricates `detail`), falling back to the mock prospectus `detail.lockupDays` for mock parity.
  const lockupDays = strategy.lockupDays ?? strategy.detail?.lockupDays ?? 0;
  const locked = lockupDays > 0;
  // POO-481: the pair is selected (USDC is always options[0]). POO-847/POO-804 R1: an owned
  // position is pair-locked whenever the pair is resolvable, regardless of the picker state.
  const receivingPair = ownedManaged
    ? pairTokens != null
    : receiveAs !== "USDC" && pairTokens != null;

  // The gear slippage read at run time by the mock confirm step (POO-499 R6), kept out of step deps.
  const slippageRef = useRef(slippage);
  slippageRef.current = slippage;
  // POO-574: the wallet-sign flow now PAUSES after the `build` step (pauseAfterKey), so the Review
  // renders the BUILT figures before the wallet is called. Steps rebuild when amount / slippage /
  // receive-as change; the runner reads the latest via refs.
  const withdrawSteps = useMemo<FlowStep<WithdrawCtx>[]>(
    () =>
      buildWithdrawSteps
        ? // POO-481 R4: the receive-as choice rides into the build (steps rebuild when it flips).
          // POO-847/POO-804 R1: an owned position always builds pair-side (even when the pair
          // tokens could not be resolved for display, the manager payout never swaps to USDC).
          buildWithdrawSteps(amount, slippage, ownedManaged || receivingPair)
        : mockWithdrawSteps(slippageRef, amount),
    [amount, slippage, receivingPair, ownedManaged, buildWithdrawSteps],
  );
  const flow = useWalletSignFlow(withdrawSteps, {
    fallbackErrorCode: "WITHDRAW_FAILED",
    pauseAfterKey: "build",
  });
  // POO-574 R5 reshaped by POO-803: the network-fee line reads the BUILT gas. Mock mode keeps the
  // honest PP-MOCK estimate; real mode NEVER falls back to it — a real build without
  // `estimatedGasInUsd` hides the line instead of fabricating $0.30 (POO-799 directive #1).
  const networkFeeUsd =
    flow.context.built?.estimatedGasInUsd ?? (isReal ? undefined : NETWORK_FEE_USD);
  // POO-595: the shared Review re-quote countdown (extracted from the two inline POO-574 R3 effects).
  // Active on the Review; on each zero-crossing it re-quotes via flow.rebuild() and resets the window.
  // POO-888 R3: the Review CTA suspends it synchronously (same-tick zero-cross vs send race).
  const { seconds: countdown, suspend: suspendCountdown } = useReviewCountdown({
    active: phase === "review",
    seconds: REVIEW_REFRESH_SECS,
    onRefresh: flow.rebuild,
  });

  // POO-386 R6: the Review fee block discriminates Amount / Est. fees (instant fee + slippage +
  // network) / Total received (min). POO-515 R2: the token-pair payout keeps the pool tokens (no
  // stable swap), so the Max slippage component drops out of the fee estimate AND the min-received
  // math; only the network gas (+ the mock Instant fee) remain.
  const slippageCost = receivingPair ? 0 : amount * (slippage / 100);
  // POO-612: the real swap figures from the built quote. The token-pair payout skips the stable swap,
  // so there is no price impact / swap protocol fee on that path (swapInfo stays undefined there).
  const swapInfo = receivingPair ? undefined : flow.context.built?.swapInfo;
  // POO-1011: the catastrophic price-impact gate (>= 10% blocks the Review CTA behind an explicit
  // funds-at-risk acknowledgment; the pair payout never swaps, so swapInfo undefined = no gate, R4).
  const impactGate = usePriceImpactGate(swapInfo?.priceImpactPercentage, phase === "review");
  // POO-612 R3: the real minimum received (net of slippage + impact + fee); the client estimate
  // stands only for the mock walk / pair payout maths that anchor the reserve split below.
  const estFeesForMin = fee + slippageCost + (networkFeeUsd ?? 0) + (swapInfo?.protocolFee ?? 0);
  // POO-844 R2: a built minimum outside the plausible band means the server quote is broken (a
  // dropped zero-quoted leg understates it, POO-845; a mis-scaled figure overstates it) — fall
  // back to the honest client estimate for the maths and suppress the real arrival line below
  // (never display or fabricate the broken figure). The plausibility floor deliberately EXCLUDES
  // the suspect quote's own protocolFee (a mis-scaled fee would deflate the floor and let a broken
  // min pass), and a zero floor (costs swallow the amount) validates nothing.
  const clientFloorMin = Math.max(0, amount - estFeesForMin);
  const builtMin = swapInfo?.minAmountInStable;
  const plausibilityFloor = Math.max(0, amount - fee - slippageCost - (networkFeeUsd ?? 0));
  const builtMinPlausible =
    builtMin != null &&
    plausibilityFloor > 0 &&
    builtMin >= plausibilityFloor * MIN_RECEIVED_PLAUSIBILITY &&
    builtMin <= amount;
  const totalReceivedMin = builtMinPlausible && builtMin != null ? builtMin : clientFloorMin;
  // POO-483 R1/R3 v2: the pure client-side value split of the pool position's raw reserves. Null when
  // the raw block is absent (mock-lean / real lean read) or degenerate — the caller degrades to the
  // honest USD total (R4). PP-INTEGRATION-POINT (POO-325): backend-verified per-token figures replace
  // this estimate when they land; the lib remains a cross-check.
  const pairSplit = useMemo(() => positionTokenSplit(position), [position]);
  // POO-548 R5: the accrued pool fees this withdraw also collects — sourced from position.totalYield
  // (= totalFeesInUsd, the SAME field the Home Yield column uses), NOT the empty uncollectedFeesUsd.
  // PP-INTEGRATION-POINT (POO-548): totalYield is CUMULATIVE — long-term the API should populate a
  // claimable field that decrements on collect; today it is the honest accrued-yield figure.
  const feesAvailableUsd = position.totalYield;
  // POO-846 R1 (supersedes POO-548 R4's USDC branch): per-token split of the GROSS Amount requested
  // and of the Fees-available figure, shown whenever the reserve split RESOLVES — regardless of
  // receive-as. The rows describe what the withdrawal unwinds from the pool; the Receive-as row
  // states the payout. A lean/absent block degrades to the single USD figure.
  // PP-INTEGRATION-POINT (POO-846 R1, BE follow-up): pool-party-api zeroes `totalSupply0/1` for
  // NON-manager rows (portfolio utils `isPoolManager ? … : '0'`), so in real mode the split only
  // resolves for the manager's own row today — zero reserves null out in `positionTokenSplit`
  // (honest degrade). Investor rows light up here the moment the API sends the block for every row.
  const amountRequestedSplit = splitUsdAmount(pairSplit, amount, strategy.tvl);
  const feesAvailableSplit = splitUsdAmount(pairSplit, feesAvailableUsd, strategy.tvl);
  // POO-803: adapt a reserve split into the shared card's per-token rows (amount + est. USD + logo).
  const toTokenRows = (split: SplitUsdAmount | null): WithdrawTokenRow[] | null =>
    split != null && pairTokens != null
      ? [
          { symbol: pairTokens[0], amount: split.amount0, usd: split.usd0 },
          { symbol: pairTokens[1], amount: split.amount1, usd: split.usd1 },
        ]
      : null;
  // POO-803 R11: the receipt's "Fees collected" snapshots at the Review approve — the post-write
  // refresh zeroes position.totalYield while the receipt is still open.
  const [receiptFeesUsd, setReceiptFeesUsd] = useState<number | null>(null);

  // POO-803 R3 / POO-844 R3: the shared cap-and-clamp against the live balance; `u` lets a writer
  // sanitize against a unit other than the current one (the flip targets the NEXT unit).
  const sanitizeAmount = (value: string, u: "usd" | "pct" = unit): string =>
    sanitizeAmountFor(value, u, position.currentValue);
  /** Switch unit, converting the current value so the equivalent amount is preserved (R2).
   * POO-844 R3: the conversion re-sanitizes against the NEXT unit — a stale $ amount above the
   * refreshed balance lands on the clamped 100, never 100.4. */
  function toggleUnit(next: "usd" | "pct") {
    if (next === unit) return;
    const pct = position.currentValue > 0 ? (typedAmount / position.currentValue) * 100 : 0;
    setAmountText(
      sanitizeAmount(next === "usd" ? String(round2(typedAmount)) : String(round2(pct)), next),
    );
    setUnit(next);
  }

  // POO-844 R4: the modal stays mounted with `open` controlled (no key), so the mount-time seed
  // goes stale when the position refreshes (post-write poll / LP drift). Re-seed from the LIVE
  // balance on the closed→open transition only — never mid-session, which would stomp typing.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setUnit("usd");
      setAmountText(sanitizeAmountFor(String(position.currentValue), "usd", position.currentValue));
    }
    wasOpen.current = open;
  }, [open, position.currentValue]);

  // POO-499 (POO-467 R2/R3): shared slippage auto-retry — one auto retry from build on the first
  // slippage failure (pending notice), then a slippage error view + settings auto-open on the second.
  const slippageRetry = useSlippageAutoRetry({
    flow,
    flowName: "withdraw",
    strategyId: strategy.id,
    slippagePct: slippage,
    onOpenSettings: () => setSettingsOpen(true),
  });
  // POO-461 R3: kind-aware error body. POO-499 R3: the slippage error view swaps in the slippage copy.
  const genericErrorBody = useTxErrorBody(txError);
  const errorTitle = slippageRetry.slippageError
    ? t("flow.slippage.errorTitle")
    : t("flow.error.title");
  const errorBody = slippageRetry.slippageError
    ? t("flow.slippage.errorBody", { value: slippageRetry.slippagePct })
    : genericErrorBody;
  const stepLabels = resolveWalletSignSteps(WITHDRAW_SPEC, t);

  useEffect(() => {
    if (open) {
      track("strategy_withdraw_started", { strategy_id: strategy.id, position_id: position.id });
    }
  }, [open, track, strategy.id, position.id]);

  // On success, reflect the just-changed position without a manual reload.
  useEffect(() => {
    if (phase !== "success") return;
    postWriteRefresh();
  }, [phase, postWriteRefresh]);

  // Drive phase + analytics off the runner's outcome (started by the closed/confirm CTA / retry). The
  // build → send steps reflect their true settlement; a thrown step surfaces the real failure via
  // flow.error (real mode previously showed a blank generic error here).
  useEffect(() => {
    if (phase !== "pending") return;
    if (flow.status === "success") {
      if (flow.txHash) setTxHash(flow.txHash);
      // POO-810 R6: snapshot the decoded per-token amounts received for the receipt (real path only).
      setDecodedReceived(flow.context.decoded ?? null);
      setPhase("success");
      track("strategy_withdraw_completed", {
        strategy_id: strategy.id,
        position_id: position.id,
        value: youReceive,
        currency: "USD",
        usd_value_at_time: youReceive,
      });
      // POO-853 [R6]: record this remove-liquidity to the referral operation feed (best-effort).
      logReferralOp({
        operation: "REMOVE_LIQUIDITY",
        amountUsd: amount,
        txHash: flow.txHash ?? "",
        positionInfo: { strategyId: strategy.id, positionId: position.id },
      });
    } else if (flow.status === "error") {
      // POO-499 R2: the first slippage failure auto-retries — hold the pending phase (the notice
      // renders there), do not flip to the error view or emit the failure event yet.
      if (slippageRetry.autoRetrying) return;
      setTxError(flow.error);
      setPhase("error");
      track("strategy_withdraw_failed", {
        strategy_id: strategy.id,
        position_id: position.id,
        value: youReceive,
        currency: "USD",
        usd_value_at_time: youReceive,
      });
    }
  }, [
    flow.status,
    flow.txHash,
    flow.error,
    // POO-810 R6: the decoded per-token amounts snapshotted for the success receipt.
    flow.context.decoded,
    slippageRetry.autoRetrying,
    phase,
    track,
    strategy.id,
    position.id,
    youReceive,
    amount,
    logReferralOp,
  ]);

  // POO-574: drive the build outcome. The build settling into `awaiting` advances the spinner to the
  // Review (reading the built figures from flow.context); a build failure (initial or a Review
  // rebuild) surfaces the error view instead.
  useEffect(() => {
    if (phase === "building" && flow.status === "awaiting") {
      setPhase("review");
    } else if ((phase === "building" || phase === "review") && flow.status === "error") {
      setTxError(flow.error);
      setPhase("error");
    }
  }, [phase, flow.status, flow.error]);

  function handleOpenChange(next: boolean) {
    // POO-419 R3: no dismissal while provisioning is executing (ESC / overlay / X are all blocked).
    if (!next && gate.locked) return;
    onOpenChange(next);
    if (!next) {
      setSettingsOpen(false);
      setConfirmClose(false);
      flow.reset();
      setTimeout(() => {
        setPhase(initialPhase);
        setMethod("regular");
        setDecodedReceived(null);
        // POO-844 R3: the reset seed is sanitized too (and R4 re-seeds again on the next open).
        setAmountText(
          sanitizeAmountFor(String(position.currentValue), "usd", position.currentValue),
        );
        setUnit("usd");
        setTxHash(null);
        gate.reset();
        // POO-513 R2: the gear settings reset to the flow defaults on close (universal policy,
        // mirroring Invest/Collect/Compound), so a reopened Withdraw never carries a stale custom
        // slippage or receive-as choice into the build.
        setSlippage(DEFAULT_SLIPPAGE_PCT);
        setDeadlineMins(30);
        setReceiveAs(receiveOptions[0] ?? "USDC");
      }, 150);
    }
  }

  // POO-803 R7/R8: the Review's arrival line — the min-received indicator that replaced the old
  // "You receive at least" / "Total received (min)" rows. Lock-up first; the pair payout never
  // fabricates a USDC figure; mock keeps the method-driven walk (Regular = 2 business days); REAL
  // shows "≈ X USDC · Arrives instantly" only off the BUILT minimum (POO-799 directive #1).
  const reviewArrival = locked
    ? t("withdraw.review.footerLocked", {
        amount: formatTokenAmount(totalReceivedMin, "USDC"),
        days: lockupDays,
      })
    : receivingPair
      ? null
      : !isReal && !isClosedPosition && method === "regular"
        ? t("withdraw.review.footerRegular", {
            amount: formatTokenAmount(totalReceivedMin, "USDC"),
          })
        : // POO-844 R2: real shows the line only off a PLAUSIBLE built minimum (absent or
          // implausibly low → no line, POO-799 directive #1).
          isReal && !builtMinPlausible
          ? null
          : t("flow.review.footerInstant", {
              amount: formatTokenAmount(totalReceivedMin, "USDC"),
            });

  // POO-434 R3: a locked-strategy withdrawal is "initiated" (funds arrive after the lock-up); an
  // instant one (no lock-up, incl. real mode) is "successful". A closed-position exit keeps its own
  // instant "complete" copy.
  // POO-847 R4: an owned close reports what actually happened — the strategy CLOSED — never a
  // "sent to your balance" claim (the close pays out the token pair).
  const successTitle = closingPool
    ? tManager("manage.close.successTitle")
    : isClosedPosition
      ? t("withdraw.closed.completeTitle")
      : locked
        ? t("withdraw.success.title")
        : t("withdraw.success.completeTitle");
  // POO-844 R1: the DECODED figure supersedes the pre-broadcast youReceive on the instant bodies +
  // the receipt figures ONLY when EVERY decoded leg is USDC — usdcUsd is then the ALL-IN payout
  // (principal + the fees this withdraw collected). A mixed/pair payout's USDC leg alone would
  // UNDERSTATE the total (the non-USDC legs carry no USD), nothing decoded keeps the R9 fallback,
  // and the locked flow keeps the estimate (funds arrive after the lock-up). The owned close
  // (POO-847) pays the token pair, so it is never all-USDC and keeps its own estimate body.
  //
  // POO-844 (raw-values fix): every decoded leg must be present AND priced. `hasUnpricedLeg` guards
  // the case a leg's meta failed to resolve — it is now kept as a raw base-unit row (no `usd`)
  // instead of silently dropped, so an X/USDC pair whose non-USDC leg went unpriced can no longer
  // masquerade as all-USDC and collapse Total to the USDC leg. The `every(usd != null)` check
  // already blocks that raw row (it carries no `usd`); `!hasUnpricedLeg` makes the intent explicit.
  const decodedAllUsdc =
    decodedReceived != null &&
    decodedReceived.rows.length > 0 &&
    !decodedReceived.hasUnpricedLeg &&
    decodedReceived.rows.every((row) => row.usd != null);
  const receivedUsd =
    decodedAllUsdc && decodedReceived != null ? decodedReceived.usdcUsd : youReceive;
  const successBody = closingPool
    ? tManager("manage.close.successBody", { amount: formatUsd(youReceive) })
    : isClosedPosition
      ? t("withdraw.closed.sentInstant", { amount: formatUsd(receivedUsd) })
      : locked
        ? t("withdraw.success.body", { amount: formatUsd(youReceive) })
        : // POO-504 R1: the instant-success copy follows the receive-as choice.
          receivingPair && pairTokens
          ? t("withdraw.success.completeBodyPair", {
              amount: formatUsd(youReceive),
              token0: pairTokens[0],
              token1: pairTokens[1],
            })
          : t("withdraw.success.completeBody", { amount: formatUsd(receivedUsd) });
  // POO-505 R2/R3: the receipt hash is real-only in real mode (mock keeps the settle hash); the
  // explorer link (ExplorerTxLink, POO-514 R2) derives from the strategy's network and renders only
  // when both network and hash exist.
  const receiptHash = txHash ?? (!isReal ? settleTxHash() : null);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        {phase === "closed" ? (
          <>
            {/* POO-445 R1: shared header — gear (slippage + deadline + receive-as) next to the X. */}
            <TransactionModalHeader
              title={t("withdraw.title")}
              onSettings={() => setSettingsOpen(true)}
              settingsLabel={t("invest.settings.title")}
            />
            <StrategyMiniHeader strategy={strategy} />

            <div className="mt-2 flex flex-col items-center gap-3 text-center">
              <p className="text-muted-foreground text-sm">{t("withdraw.closed.fullBalance")}</p>
              <p className="font-bold text-4xl text-foreground">{formatUsd(amount)}</p>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 font-medium text-success text-xs">
                <Zap className="size-3.5" aria-hidden="true" />
                {t("withdraw.closed.instant")}
              </span>
              <p className="text-muted-foreground text-xs">
                {/* POO-481: the pair label ("ETH / USDC") is not a token symbol, so stamping it via
                    formatTokenAmount produces nonsense ("... ETH / USDC") on a USD amount. When the
                    pair is selected show the plain USD figure; the single-token path is unchanged. */}
                {t("withdraw.closed.equals", {
                  amount: receivingPair ? formatUsd(amount) : formatTokenAmount(amount, receiveAs),
                })}
              </p>
            </div>

            {/* POO-570 R3 + POO-574: a closed exit builds the tx, then the Review (with the built
                figures) precedes signing. R6: the submitted event fires once, from the Review's
                approve — this button only starts the build. */}
            <Button
              className="w-full"
              size="lg"
              onClick={() => {
                setPhase("building");
                void flow.run();
              }}
            >
              {t("withdraw.continue")}
            </Button>
          </>
        ) : null}

        {phase === "building" ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>{t("flow.processing")}</DialogTitle>
            </DialogHeader>
            <StrategyMiniHeader strategy={strategy} />
            {/* POO-574 / POO-595: the server builds the tx here; on settle the flow pauses (awaiting)
                and the effect advances to the Review with the built figures. */}
            <BuildingStep label={t("flow.processing")} />
          </>
        ) : null}

        {phase === "method" ? (
          <>
            {/* POO-570 R1: the settings gear (slippage + deadline + receive-as) lives on this input
                step, next to the Dialog X — not on the Review (reverses POO-386 R1). */}
            <TransactionModalHeader
              title={t("withdraw.title")}
              onSettings={() => setSettingsOpen(true)}
              settingsLabel={t("invest.settings.title")}
            />
            <StrategyMiniHeader strategy={strategy} />

            <div className="mt-2 flex flex-col gap-5">
              <p className="text-center text-muted-foreground text-sm">
                {t("withdraw.amountLabel")}
              </p>
              {/* POO-424 R2: large centered hero like Invest/Add, keeping the $ / % unit toggle (the
                  hero prefix is $ in USD mode, the figure carries % in percent mode) and the round
                  quick presets. */}
              <div className="flex flex-col items-center gap-3">
                <div className="flex items-center justify-center gap-1 text-foreground">
                  {unit === "usd" ? <span className="font-bold text-3xl">$</span> : null}
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amountText}
                    onChange={(event) => setAmountText(sanitizeAmount(event.target.value))}
                    placeholder="0"
                    // POO-803 R2: a sub-floor balance locks the input (full exit only).
                    disabled={belowFloor}
                    aria-label={t("withdraw.amountLabel")}
                    className="w-40 bg-transparent text-center font-bold text-4xl text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
                  />
                  {unit === "pct" ? <span className="font-bold text-3xl">%</span> : null}
                </div>
                <fieldset
                  className="m-0 flex rounded-lg border border-border p-0"
                  aria-label={t("withdraw.unitToggle")}
                >
                  {(["usd", "pct"] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => toggleUnit(u)}
                      aria-pressed={unit === u}
                      className={cn(
                        "px-3 py-1.5 font-medium text-sm transition-colors first:rounded-l-lg last:rounded-r-lg",
                        unit === u
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {u === "usd" ? "$" : "%"}
                    </button>
                  ))}
                </fieldset>
              </div>
              {/* Round quick presets + Max — centered ghost chips (matches Invest). POO-403 R8: a
                  sub-$5 position can only exit in full, so the partial presets are dropped. */}
              <div className="flex flex-wrap justify-center gap-2">
                {belowFloor
                  ? null
                  : [0.25, 0.5, 0.75].map((frac) => {
                      const pct = Math.round(frac * 100);
                      const usd = roundPreset(frac * position.currentValue);
                      return (
                        <button
                          key={frac}
                          type="button"
                          onClick={() =>
                            setAmountText(sanitizeAmount(String(unit === "pct" ? pct : usd)))
                          }
                          className="rounded-full border border-border px-3 py-1.5 font-medium text-muted-foreground text-sm transition-colors hover:bg-surface-raised hover:text-foreground"
                        >
                          {unit === "pct" ? `${pct}%` : formatUsd(usd)}
                        </button>
                      );
                    })}
                <button
                  type="button"
                  // POO-844 R3: Max writes through the sanitizer (a raw balance float caps at the
                  // 6-decimal $ precision instead of landing 15+ characters in the input).
                  onClick={() =>
                    setAmountText(
                      sanitizeAmount(String(unit === "pct" ? 100 : position.currentValue)),
                    )
                  }
                  className="rounded-full border border-border px-3 py-1.5 font-medium text-muted-foreground text-sm transition-colors hover:bg-surface-raised hover:text-foreground"
                >
                  {t("withdraw.max")}
                </button>
              </div>
              {/* POO-846 R3: tapping the invested total fills the amount with the unit-aware max,
                  mirroring the Max chip (and the InvestModal balance line, PP-STR-MOD-001) so the
                  balance line doubles as a "fill everything" affordance. */}
              <button
                type="button"
                onClick={() => setAmountText(String(unit === "pct" ? 100 : position.currentValue))}
                className="mx-auto rounded-md text-center text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("withdraw.invested", { amount: formatUsd(position.currentValue) })}
              </button>

              {/* POO-847 R4: an owned full/dust exit CLOSES the pool — the destructive close alert
                  + investors note replace the plain dust notice (POO-804 R2 parity). */}
              {closingPool ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-xs">
                  <p>{t("withdraw.ownedCloseAlert")}</p>
                  <p className="mt-1 text-destructive/80">
                    {tManager("manage.remove.investorsNote")}
                  </p>
                </div>
              ) : dust || belowFloor ? (
                /* Dust rule (POO-313): leaving < $5 promotes to a full withdraw. POO-403 R8: a
                   sub-$5 position shows the alert immediately on open (the whole balance must go). */
                <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-warning text-xs">
                  {t("withdraw.dustAlert", { floor: formatUsd(DUST_FLOOR_USD) })}
                </p>
              ) : null}

              {/* Real mode is an instant, fee-free withdrawal — no method choice. The lockup
                  note still applies when the strategy locks principal. */}
              {isReal ? (
                locked ? (
                  <p className="rounded-lg bg-surface-raised px-3 py-2 text-muted-foreground text-xs">
                    {t("withdraw.lockedNote", { days: lockupDays })}
                  </p>
                ) : null
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="font-medium text-foreground text-sm">
                    {t("withdraw.chooseMethod")}
                  </p>
                  <div className="flex flex-col gap-2">
                    <MethodOption
                      selected={method === "regular"}
                      title={t("withdraw.regular.title")}
                      desc={t("withdraw.regular.desc")}
                      fee={t("withdraw.regular.fee")}
                      onSelect={() => setMethod("regular")}
                    />
                    {locked ? (
                      <p className="rounded-lg bg-surface-raised px-3 py-2 text-muted-foreground text-xs">
                        {t("withdraw.lockedNote", { days: lockupDays })}
                      </p>
                    ) : (
                      <MethodOption
                        selected={method === "instant"}
                        title={t("withdraw.instant.title")}
                        desc={t("withdraw.instant.desc")}
                        fee={t("withdraw.instant.fee", { fee: "1%" })}
                        onSelect={() => setMethod("instant")}
                      />
                    )}
                  </div>
                </div>
              )}

              <Button
                className="w-full"
                size="lg"
                variant={closingPool ? "destructive" : "primary"}
                disabled={!valid}
                onClick={() => {
                  // POO-847 R4: an owned close confirms deliberately first (POO-804 R3 parity).
                  if (closingPool) {
                    setConfirmClose(true);
                    return;
                  }
                  // POO-574: Continue builds the tx; the Review shows the built figures before signing.
                  setPhase("building");
                  void flow.run();
                }}
              >
                {closingPool ? tManager("manage.remove.close") : t("withdraw.continue")}
              </Button>
            </div>
          </>
        ) : null}

        {phase === "review" ? (
          <>
            {/* POO-570 R1: the gear moved OFF the Review to the input step (method for an active exit,
                the closed step for a closed one), so this header only carries Back. Back returns to
                whichever input step opened the review (R3). */}
            <TransactionModalHeader
              title={t("withdraw.review.title")}
              onBack={() => setPhase(isClosedPosition ? "closed" : "method")}
              backLabel={t("withdraw.review.back")}
            />
            <StrategyMiniHeader strategy={strategy} />

            {/* POO-574 R3: the visible re-quote countdown — the built figures refresh when it hits 0. */}
            <p className="flex items-center justify-center gap-1.5 text-muted-foreground text-xs">
              <RefreshCw className="size-3.5" aria-hidden="true" />
              {t("flow.review.refreshIn", { seconds: countdown })}
            </p>
            {/* POO-885 R2/R4: subtle stale-quote hint after 3 consecutive background re-quote
                failures (non-fatal; the countdown keeps retrying with the last good quote). */}
            {flow.quoteStale ? (
              <p className="text-center text-warning text-xs">{t("flow.review.quoteStale")}</p>
            ) : null}

            {/* POO-803 R5-R8: the shared withdraw-family Review card — Amount requested + Fees
                available (per-token + logos on the pair payout, R6) visible; Est. fee (canonical
                tooltip) / Max. slippage (Auto badge) / Price impact behind Show more; Receive as +
                caption + the arrival line (the min-received indicator) below. The old
                You-receive-at-least / Remaining-invested / Amount / Total-received-(min) rows are
                gone (R5). */}
            <WithdrawReviewCard
              amountUsd={amount}
              feesAvailableUsd={feesAvailableUsd}
              amountTokens={toTokenRows(amountRequestedSplit)}
              feesTokens={toTokenRows(feesAvailableSplit)}
              network={strategy.network}
              receiveAs={receiveAs}
              receivingPair={receivingPair}
              slippagePct={slippage}
              slippageIsDefault={slippage === DEFAULT_SLIPPAGE_PCT}
              networkFeeUsd={networkFeeUsd}
              protocolFeeUsd={swapInfo?.protocolFee}
              priceImpactPct={swapInfo?.priceImpactPercentage}
              arrival={reviewArrival}
            />

            {remaining > 0 ? (
              <p className="rounded-md bg-success/10 px-3 py-2 text-success text-xs">
                {t("withdraw.confirm.stillEarning")}
              </p>
            ) : null}

            {/* POO-1011 [R2]: the funds-at-risk gate, always visible above the CTA. */}
            <PriceImpactGate
              priceImpactPct={swapInfo?.priceImpactPercentage}
              acknowledged={impactGate.acknowledged}
              onAcknowledgedChange={impactGate.setAcknowledged}
            />

            <Button
              className="w-full"
              size="lg"
              disabled={impactGate.blocked}
              onClick={() => {
                // POO-888 R3: suspend the re-quote countdown SYNCHRONOUSLY before anything else, so
                // a zero-crossing in this same tick cannot race the send.
                suspendCountdown();
                // POO-803 R11: snapshot the accrued-fees figure for the receipt (the post-write
                // refresh zeroes position.totalYield while the receipt is still open).
                setReceiptFeesUsd(feesAvailableUsd);
                track("strategy_withdraw_submitted", {
                  strategy_id: strategy.id,
                  position_id: position.id,
                  value: amount,
                  currency: "USD",
                });
                // POO-419: if the wallet is short on gas / the right network, provision first, then
                // resume this withdraw. Gas-only op (a withdraw spends no USDC) → no amount arg.
                if (gate.evaluate("withdraw", strategy)) {
                  setPhase("provision");
                  return;
                }
                // POO-574: the tx is already built (we paused after build); approving resumes into
                // the wallet send/sign step. The build is not re-run here.
                setPhase("pending");
                void flow.resume();
              }}
              variant={closingPool ? "destructive" : "primary"}
            >
              {/* POO-847 R4: the owned close signs behind a deliberate, destructive Close CTA. */}
              {closingPool ? tManager("manage.remove.close") : t("withdraw.review.cta")}
            </Button>
          </>
        ) : null}

        {phase === "provision" && gate.input ? (
          <>
            {/* POO-419: pre-flight gate — swap the review view for the provisioning panel, then
                resume the original withdraw on success. Cancel returns to review. */}
            <DialogHeader className="sr-only">
              <DialogTitle>{t("provisioning.plan.title")}</DialogTitle>
            </DialogHeader>
            <StrategyMiniHeader strategy={strategy} />
            <ProvisioningPanel
              input={gate.input}
              opLabel={t(provisioningOpLabelKey("withdraw"), { strategy: strategy.name })}
              onDone={() => {
                gate.setLocked(false);
                setPhase("pending");
                // POO-574 handshake: the withdraw flow is paused after the build; resume it into the
                // wallet sign step (do NOT flow.run(), which would rebuild the tx from scratch).
                void flow.resume();
              }}
              onCancel={() => setPhase("review")}
              onLockChange={gate.setLocked}
            />
          </>
        ) : null}

        {phase === "pending" ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>{t("flow.processing")}</DialogTitle>
            </DialogHeader>
            <StrategyMiniHeader strategy={strategy} />
            {/* POO-499 R2: the auto-retry notice sits in the pending view while the flow re-runs. */}
            {slippageRetry.autoRetrying ? (
              <p className="rounded-md bg-warning/10 px-3 py-2 text-center text-warning text-sm">
                {t("flow.slippage.retryNotice", { value: slippageRetry.slippagePct })}
              </p>
            ) : null}
            <WalletSteps
              steps={stepLabels}
              activeStep={flow.activeStep}
              statuses={flow.statuses}
              txHashes={flow.txHashes}
            />
          </>
        ) : null}

        {phase === "success" ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>{successTitle}</DialogTitle>
            </DialogHeader>
            <TransactionStatus phase="success" title={successTitle} body={successBody}>
              {/* POO-803 R9/R11: the shared withdraw-family receipt — Strategy · Amount Received ·
                  Fees collected · Total received visible; the final Fee (canonical) + Slippage +
                  Price impact behind Show more; Date + Transaction never collapse. POO-810 R6/R9:
                  Amount Received is the REAL per-token decode (USDC leg as USD) when the receipt
                  decoded, falling back to the confirm-time USD snapshot (`amountReceivedUsd`) when
                  nothing decoded (mock walk / unavailable logs). */}
              <WithdrawReceiptCard
                strategyName={strategy.name}
                // POO-844 R1: the all-USDC decode IS the all-in payout (fees included), so Total
                // received shows it VERBATIM — adding the fee snapshot on top would double-count.
                // Without a usable decode the estimate composition (amount + fees) stands.
                amountReceivedUsd={receivedUsd}
                receivedTokenRows={decodedReceived?.rows ?? null}
                network={strategy.network}
                feesCollectedUsd={receiptFeesUsd ?? undefined}
                // POO-844: on the all-USDC branch the fee is ALREADY inside Total received, so the
                // fee line reads "Fees collected (included)" (never "adds on top").
                feesIncludedInTotal={decodedAllUsdc}
                totalReceivedUsd={
                  decodedAllUsdc
                    ? receivedUsd
                    : receiptFeesUsd != null
                      ? youReceive + receiptFeesUsd
                      : undefined
                }
                slippagePct={slippage}
                networkFeeUsd={networkFeeUsd}
                protocolFeeUsd={swapInfo?.protocolFee}
                priceImpactPct={swapInfo?.priceImpactPercentage}
                date={format.dateTime(new Date(), { dateStyle: "medium", timeStyle: "short" })}
                txHashShort={receiptHash ? formatTxHash(receiptHash) : null}
              />
              <Button className="w-full" size="lg" onClick={() => handleOpenChange(false)}>
                {t("flow.done")}
              </Button>
              {/* POO-514 R2 (was POO-505 R2, closed-only): EVERY withdraw receipt links the real tx
                  on the strategy's network; with no hash (real mode whose flow yielded none) or an
                  unknown network the shared component renders nothing. */}
              <ExplorerTxLink network={strategy.network} hash={receiptHash} />
            </TransactionStatus>
          </>
        ) : null}

        {phase === "error" ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>{errorTitle}</DialogTitle>
            </DialogHeader>
            <TransactionStatus phase="error" title={errorTitle} body={errorBody}>
              <TransactionErrorActions
                onRetry={() => {
                  // POO-887 R1/R2: a pre-Review failure (e.g. a failed build) retries back THROUGH
                  // the Review gate ("building" re-engages awaiting → review); post-Review keeps
                  // the pending stepper.
                  setPhase(flow.retryWillPause ? "building" : "pending");
                  // POO-499 R3: after a slippage error, Try again re-runs from build with the new
                  // slippage; R4: a non-slippage failure keeps resume-from-failed-step.
                  if (slippageRetry.slippageError) void flow.retryFrom("build");
                  else void flow.retry();
                }}
                error={txError ?? undefined}
              />
            </TransactionStatus>
          </>
        ) : null}
      </DialogContent>
      {/* POO-847 R4 (POO-804 R3 parity): the owned close confirms deliberately — Continue starts
          the build, Keep the strategy returns to the amount step untouched. */}
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={tManager("manage.remove.confirmTitle")}
        body={tManager("manage.remove.confirmBody")}
        confirmLabel={tManager("manage.remove.confirmContinue")}
        cancelLabel={tManager("manage.remove.confirmKeep")}
        onConfirm={() => {
          setPhase("building");
          void flow.run();
        }}
      />
      {/* POO-847/POO-804 R1: an owned position's receive-as is a FIXED pair display (no USDC
          choice — the manager payout never swaps); other positions keep the picker. */}
      <TransactionSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        slippage={slippage}
        onSlippageChange={setSlippage}
        deadlineMins={deadlineMins}
        onDeadlineChange={setDeadlineMins}
        receiveAs={ownedManaged ? pairOption : receiveAs}
        onReceiveAsChange={ownedManaged ? undefined : setReceiveAs}
        receiveOptions={ownedManaged ? (pairOption ? [pairOption] : undefined) : receiveOptions}
      />
    </Dialog>
  );
}
