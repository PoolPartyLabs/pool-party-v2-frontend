/**
 * @id PP-MGR-MOD-003 (POO-312)
 * @name RemoveLiquidityModal
 * @implements-rules-version v11 (POO-804 rules v1) · v1 (POO-842 rules v1)
 *
 * Manager remove-liquidity dialog: pick a removal percentage (presets), preview the new position
 * amount. The manager rule (POO-312): a percentage > 50, or a removal that would leave < $5 (dust),
 * promotes the action to a full **close** — the modal shows an inline alert and the action button
 * becomes a deliberate "Close strategy".
 *
 * POO-804 (rules v1, decision #12): the whole manager remove family receives the TOKEN PAIR ONLY —
 * the collect-as-USDC choice is gone from partial AND close (R1; supersedes POO-509's close-only
 * force and voids its "re-enable close-as-USDC" plan). The gear's receive-as is a fixed display.
 * The accrued fees render as per-token rows (POO-324 item 2, real `fees0`/`fees1` via `feeTokens`)
 * by default, which also fixes the small-balance partial dropping both breakdowns (R5). A
 * form-promoted close (typed or dust) raises a Continue / Keep-the-strategy ConfirmDialog before
 * building (R3); the close alert carries the expanded copy + the investors note (R2); presets
 * follow the $/% unit in value AND label (R4); the amount input caps decimals at 6 ($) / 1 (%) and
 * clamps at the stake / 100% (R7, POO-803 R3 parity); the console gas note left the form (R6).
 * In real mode it runs `useManagerRemoveLiquidity` (remove-liquidity-tx vs close-pool-tx); mock
 * mode closes via `managerService.closeStrategy` and treats a partial as an optimistic success.
 *
 * POO-502 (POO-483 rules v2): when the raw reserve block (`target.reserves`) is present, the
 * LIQUIDITY leg also splits into per-token rows (R2), the fee rows gain a client-ESTIMATED USD from
 * the split price (Expansion 2), and the close Review "You receive (min)" breaks into per-token
 * rows (Expansion 1 / R7) — all via the pure `positionTokenSplit` / `splitUsdAmount` lib
 * (PP-CORE-LIB-022), SAME path mock & real. Absent block → today's honest single USD figures (R4,
 * zero visual diff). PP-INTEGRATION-POINT (POO-325): this per-token USD is a client-side estimate
 * from the on-chain reserves + pool-value anchor; the backend's verified reserve-in-USD replaces it
 * when it lands, with this split kept as the check.
 *
 * Close-strategy entry (POO-388): the warning ConfirmDialog (PP-MGR-MOD-002, rendered by the
 * OperationsCard, PP-MGR-CMP-017) confirms, then opens this modal (PP-MGR-MOD-003) with `closeMode`,
 * which skips the amount form and runs the Withdraw-style Review → Pending → Confirmed sequence at
 * 100% (Remaining invested $0.00, CTA "Close strategy", Confirmed = "Strategy closed"). The dashboard
 * close is applied when the manager taps Done.
 *
 * v4 (POO-514 rules v1): the close Confirmed receipt shows the transaction row — the MINED
 * flow.txHash in real mode (previously dropped), the mock settle hash in mock mode — plus the shared
 * ExplorerTxLink (PP-CORE-CMP-050) targeting /tx/{hash} on the position's network.
 *
 * POO-517 (rules v1; file v5): the PARTIAL remove path gains the same Withdraw-style Review before
 * signing — amount summary, "You'll receive at least" off the gear slippage, ONE consolidated Fee
 * row via the shared buildFeeRow (POO-445 R4/R5), a display-only receive-as row and the
 * lock-up-aware arrival footer — plus a success RECEIPT (amount received + the mined tx hash with
 * an explorer link, the POO-505 Collect precedent). A form-promoted close (typed > 50% or the dust
 * promotion) routes through the SAME close Review as the OperationsCard Close button; no path goes
 * form → signing directly (R2). Every outcome now applies upstream on Done/dismiss: a close reports
 * `closed`, a partial reports the reduced stake for the manage view's optimistic patch (R3).
 *
 * POO-515 R2 (v6): a token-pair payout skips the stable swap, so the Est. fee drops the Max slippage
 * component (and any DEX fee) and the min-received math follows; the caption drops the slippage
 * qualifier. Only the network gas remains. POO-804 R1 makes the pair the ONLY payout, so this
 * applies to every path (the POO-612 swap rows are gone with the swap).
 *
 * POO-547: the settings gear's custom slippage is now uniform (0.1-100%) — the old 5% cap
 * (`slippageMax={5}`) is dropped, so the field falls back to the shared 100 default. 5% stays the seed.
 *
 * POO-596 (rules v1): the build->review->sign handshake (POO-574 rolled out from Withdraw). The
 * `build` step now runs BEFORE the Review (the flow pauses via `pauseAfterKey`), so the Review shows
 * the BUILT figures (gas = `flow.context.built?.estimatedGasInUsd`, else the gasCostUsd estimate) with
 * a 10s re-quote countdown (shared useReviewCountdown); the wallet send is only called on the Review
 * approve (flow.resume). A partial starts the build from the form CTA; a close (closeMode) auto-runs
 * the build on open. Uses the shared BuildingStep + `flow.review.refreshIn` key (POO-595).
 *
 * POO-612 (rules v1, superseded by POO-804 R1): the Review used to read the REAL swap figures
 * (swapInfo) on the USDC payout. The pair-only family never swaps, so the price-impact /
 * protocol-fee rows and the min-in-stable override are gone with the USDC path.
 *
 * POO-800 (rules v1, R5/R6): the close Review's "Est. fees" row goes through the shared buildFeeRow
 * (FeeBreakdown) like the partial path already did — the hand-rolled CloseFeesTooltipBody + flat
 * label are gone, same lines and values. POO-923 R3: the pair-forced close/partial payouts swap
 * nothing, so the shared card drops the "after fees" caption on this manager surface too.
 *
 * POO-803 (rules v1, 0710 overhaul, POO-799 decision #10): BOTH Reviews (close + partial) and BOTH
 * receipts render the SHARED withdraw-family cards (WithdrawFlowCards, same as WithdrawModal) —
 * the ~90% duplicated hand-rolled blocks are gone. The old You-receive-at-least rows left (R5);
 * the arrival line is the min indicator (lock-up first; the pair payout and a real build without a
 * minimum show none, R8); the receipts show Amount received / Fees collected (approve-time
 * snapshot) / Total received with the final canonical Fee + Date (R9/R11). The console gas
 * estimate is mock-only (real hides the line, POO-799 directive #1).
 */
"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { TokenAmountRows } from "@/components/data-display/TokenAmountRows";
import { BuildingStep } from "@/components/ui/BuildingStep";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { ExplorerTxLink } from "@/components/ui/ExplorerTxLink";
import { TransactionModalHeader } from "@/components/ui/TransactionModalHeader";
import { ProvisioningPanel } from "@/features/strategies/components/ProvisioningPanel";
import {
  MOCK_BUILT_TX,
  settleOutcomeForSlippage,
  settleTxError,
  settleTxHash,
} from "@/features/strategies/components/settle";
import {
  TransactionErrorActions,
  useTxErrorBody,
} from "@/features/strategies/components/TransactionErrorActions";
import { TransactionSettingsDialog } from "@/features/strategies/components/TransactionSettingsDialog";
import { TransactionStatus } from "@/features/strategies/components/TransactionStatus";
import { resolveWalletSignSteps } from "@/features/strategies/components/WalletSignModal";
import { WalletSteps } from "@/features/strategies/components/WalletSteps";
import {
  WithdrawReceiptCard,
  WithdrawReviewCard,
} from "@/features/strategies/components/WithdrawFlowCards";
import type { WalletSignSpec } from "@/features/strategies/components/walletSignSteps";
import { useProvisioningGate } from "@/features/strategies/hooks/useProvisioningGate";
import { useReviewCountdown } from "@/features/strategies/hooks/useReviewCountdown";
import { useSlippageAutoRetry } from "@/features/strategies/hooks/useSlippageAutoRetry";
import { type FlowStep, useWalletSignFlow } from "@/features/strategies/hooks/useWalletSignFlow";
import { provisioningOpLabelKey } from "@/features/strategies/lib/buildProvisioningInput";
import { MANAGER_DEFAULT_SLIPPAGE_PCT } from "@/features/strategies/lib/slippage";
import type { ClaimableFeeToken } from "@/lib/schemas";
import { isMockMode, managerService } from "@/lib/services";
import { type PositionSplit, positionTokenSplit, splitUsdAmount } from "@/lib/uniswap";
import { cn } from "@/lib/utils/cn";
import { formatIdentityLabel, formatTxHash, formatUsd } from "@/lib/utils/format";
import {
  type ManagerRemoveCtx,
  type ManagerRemoveRunInput,
  useManagerRemoveLiquidity,
} from "../hooks/useManagerRemoveLiquidity";
import { CLOSE_THRESHOLD_PCT, planRemoval } from "../lib/removalPlan";

/** Removal percentage presets. */
const PRESETS = [25, 50, 75, 100] as const;

/** Per-step mock duration so the stepper visibly walks in mock mode. */
const MOCK_STEP_MS = 350;

/** POO-596 R4: the Review re-quotes (flow.rebuild) this many seconds after each build settles. */
const REVIEW_REFRESH_SECS = 10;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The slice of a managed strategy the remove dialog needs. */
export interface RemoveLiquidityTarget {
  /** The strategy / on-chain position id. */
  strategyId: string;
  /** Display name for the unified receipt's Strategy row (POO-803 R11); id fallback when absent. */
  name?: string;
  /** API network slug (real mode only). */
  network?: string;
  /** The manager's stake in USD (drives the preview + dust → close). */
  stakeUsd: number;
  /** Accrued, uncollected pool fees in USD — shown beside the liquidity so the manager always sees
   * what's in the pool (POO-324 item 3). */
  feesUsd?: number;
  /**
   * Per-token breakdown of the accrued fees (token0/token1 amount) — real data from the position's
   * `fees0`/`fees1` (POO-417), the same source the Collect modal uses. The manager always receives
   * the token pair (POO-804 R1), so when present the fees line renders one {@link TokenAmountRows}
   * row per token instead of the single USD figure (POO-324 item 2); absent → the USD figure stays.
   * Each fee row gains a client-ESTIMATED USD from {@link reserves} when present (POO-502).
   */
  feeTokens?: ClaimableFeeToken[];
  /**
   * Raw reserve block of the manager's pool position for the client-side value split (POO-502 /
   * POO-483 v2 R2): the two pool token symbols, the reserves (`totalSupply0/1`, raw base units), the
   * current tick, and the token decimals. When present, the liquidity leg renders per-token rows
   * and the fee rows gain estimated USD (the pair is the only payout, POO-804 R1); absent → the
   * honest single USD figure (R4). This is REAL on-chain data (not fabrication), so it respects the
   * no-mock-in-real-mode rule.
   * PP-INTEGRATION-POINT (POO-325): this per-token USD is a client-side ESTIMATE from the on-chain
   * reserves + the pool-value anchor; the backend's verified reserve-in-USD / per-position split
   * REPLACES it when it lands, with this split kept as the cross-check.
   */
  reserves?: {
    token0: string;
    token1: string;
    totalSupply0: string;
    totalSupply1: string;
    tickCurrent: number;
    decimals0: number;
    decimals1: number;
  };
  /**
   * The whole pool position value in USD (= `detail.aum`), the anchor for the value split — the
   * fraction withdrawn is `usdAmount / poolValueUsd` (POO-502 / POO-483 v2 R2, anchor confirmed).
   */
  poolValueUsd?: number;
  /** Estimated network gas in USD (the manager pays gas). */
  gasCostUsd: number;
  /** Strategy lock-up in days (0 / undefined = none) — makes the close Review arrival footer lock-up
   *  aware, mirroring the investor Withdraw (POO-424 R6). PP-INTEGRATION-POINT: thread from the
   *  manage-detail once it carries the lock-up (ManagerStrategyDetail has none today → footer defaults
   *  to ~2 business days, which matches V1's no-lock-up reality). */
  lockupDays?: number;
}

/** Public props for {@link RemoveLiquidityModal}. */
export interface RemoveLiquidityModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: RemoveLiquidityTarget;
  /**
   * Called when the receipt is dismissed (Done or the X) after a successful removal: `closed` is
   * true for a full close; a partial passes the reduced stake (`newStakeUsd`, USD) so the caller
   * can patch it optimistically (POO-517 R3).
   */
  onRemoved: (closed: boolean, newStakeUsd?: number) => void;
  /** Percentage to seed the amount with on each open (e.g. 100 when launched from Close strategy). */
  initialPercentage?: number;
  /**
   * Close-strategy mode (POO-388): skip the amount form and open straight into the Review at 100%,
   * with a "Strategy closed" Confirmed screen. Launched from the OperationsCard warning dialog.
   */
  closeMode?: boolean;
}

/** Manager remove-liquidity / close dialog (PP-MGR-MOD-003). */
export function RemoveLiquidityModal({
  open,
  onOpenChange,
  target,
  onRemoved,
  initialPercentage = 25,
  closeMode = false,
}: RemoveLiquidityModalProps) {
  const t = useTranslations("manager");
  // Locale-aware receipt dates (the shared receipt card takes a pre-formatted string).
  const format = useFormatter();
  // Wallet-step labels + the shared error UI live in the strategies namespace; form copy stays manager.
  const tSign = useTranslations("strategies");
  const realMode = !isMockMode;
  const remove = useManagerRemoveLiquidity();
  // The typed amount is the source of truth; `percentage` (the canonical unit for planRemoval + the
  // executor) is derived from it and the chosen $/% unit, so the dust/close rules are untouched.
  // POO-548 R2: the amount opens in DOLLAR ($) mode (mirrors the investor Withdraw), seeded to the
  // USD equivalent of `initialPercentage`. The $/% toggle + presets stay; the derived percentage
  // math is preserved.
  const [unit, setUnit] = useState<"pct" | "usd">("usd");
  const [amountText, setAmountText] = useState(
    String(round2((initialPercentage / 100) * target.stakeUsd)),
  );
  // POO-804 R3: the Continue / Keep-the-strategy confirmation raised by a form-promoted close.
  const [confirmOpen, setConfirmOpen] = useState(false);
  // POO-424 R3/R7: slippage + deadline + receive-as now live behind a ⚙ gear in the close Review
  // (mirrors the investor Withdraw). The gear's slippage drives the estimated slippage cost below
  // AND the real close tx (POO-463 R4). Manager default 5% (POO-463 R2) = this flow's cap.
  const [slippage, setSlippage] = useState<number>(MANAGER_DEFAULT_SLIPPAGE_PCT);
  const [deadlineMins, setDeadlineMins] = useState(30);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The dialog lifecycle: pick the amount (form), the Review (the close review OR the partial
  // withdraw review, POO-517 R1/R2 — every path passes through here), the multistep wallet handoff
  // (pending), the Confirmed receipt (success — "Strategy closed" for a close, the withdraw receipt
  // for a partial) and the failure view (error). `formError` is a pre-flight inline error (e.g. a
  // missing network).
  // POO-596: `building` runs the server build (pauseAfterKey) before the Review; the Review shows the
  // built figures + a 10s re-quote countdown, and the wallet send is only called on the Review approve.
  // POO-419: "provision" is the pre-flight gas top-up gate (dark-launched flag), inserted before the
  // wallet handoff — the close is gas-only, so the gate tops up gas then resumes into pending.
  const [phase, setPhase] = useState<
    "form" | "building" | "review" | "provision" | "pending" | "success" | "error"
  >("form");
  const [formError, setFormError] = useState<string | null>(null);
  // POO-419: pre-flight gate — decides review/form → provision → pending.
  // POO-1042 [R2]: this modal used to pass NO op context at all, so its gate ran against a chain
  // nobody chose. The target's own network is now the gate's target chain; without one the gate
  // stays inert rather than guessing.
  const gate = useProvisioningGate({ op: "close", network: target.network, enabled: open });
  // The mined tx hash for the partial receipt (POO-517 R1): the real hash from the run step in real
  // mode, the mock settle hash in mock mode (POO-505 R3 parity — the mock hash never leaks into
  // real mode because the mock steps only run there).
  const [txHash, setTxHash] = useState<string | null>(null);

  // Whitelist digits + a single decimal point (drop any extra dots after the first), per the
  // number-formatting numeric-input-safety guidance — same pattern as the investor WithdrawModal.
  const numeric = (value: string) => value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
  // POO-804 R7 (POO-803 R3 parity): after the whitelist, cap the decimals (6 in $ mode = USDC
  // precision; 1 in % mode) and CLAMP at the exact maximum (the stake / 100%) — a typed or preset
  // amount can never exceed what the position holds.
  const sanitizeAmount = (value: string, u: "pct" | "usd" = unit): string => {
    const clean = numeric(value);
    const [head, tail] = clean.split(".");
    const capped = tail != null ? `${head}.${tail.slice(0, u === "usd" ? 6 : 1)}` : clean;
    const max = u === "usd" ? target.stakeUsd : 100;
    const parsed = Number.parseFloat(capped);
    // The clamped text floors the max to the same decimal cap, so a raw stake float (e.g.
    // 1234.5678901) never leaks more precision than the cap promises and never exceeds the max.
    return Number.isFinite(parsed) && parsed > max
      ? String(u === "usd" ? Math.floor(max * 1e6) / 1e6 : max)
      : capped;
  };
  const typed = Number.parseFloat(amountText);
  const percentage =
    unit === "pct"
      ? Number.isFinite(typed)
        ? Math.min(100, Math.max(0, typed))
        : 0
      : target.stakeUsd > 0 && Number.isFinite(typed)
        ? Math.min(100, Math.max(0, (typed / target.stakeUsd) * 100))
        : 0;

  /** Switch unit, converting the current value so the equivalent amount is preserved. The converted
   * text re-runs the sanitizer against the NEXT unit's caps (R7: e.g. 33.33% would carry 2 decimals). */
  function toggleUnit(next: "pct" | "usd") {
    if (next === unit) return;
    setAmountText(
      sanitizeAmount(
        next === "usd"
          ? String(round2((percentage / 100) * target.stakeUsd))
          : String(round2(percentage)),
        next,
      ),
    );
    setUnit(next);
  }

  const plan = planRemoval(percentage, target.stakeUsd);
  const closing = plan.closing;
  // Distinguish the two close reasons for the alert copy.
  const dust = closing && percentage <= CLOSE_THRESHOLD_PCT;
  // The USD the chosen percentage removes (= full stake on a close, since newAmountUsd is 0).
  const removeUsd = target.stakeUsd - plan.newAmountUsd;

  // POO-804 R1 (decision #12; supersedes POO-509's close-only force): the manager remove family
  // receives the TOKEN PAIR only — partial and close alike, no USDC swap ever builds.
  // The fees line renders as per-token rows (the real fees0/fees1 breakdown, same source as
  // Collect, POO-324 item 2) whenever the data is present; absent data keeps the USD figure.
  const feeTokens = target.feeTokens;
  const receivingPair = feeTokens != null && feeTokens.length > 0;

  // POO-502 (POO-483 v2 R2): the pure client-side value split of the pool position's raw reserves.
  // Null when the raw block is absent / degenerate → the caller degrades to the honest USD figure
  // (R4). The split anchor is the whole pool value (target.poolValueUsd = detail.aum, matching
  // totalSupply0/1). PP-INTEGRATION-POINT (POO-325): backend-verified per-token figures replace this
  // estimate when they land; the lib stays a cross-check.
  const reserves = target.reserves;
  const pairSplit = useMemo(() => (reserves ? positionTokenSplit(reserves) : null), [reserves]);
  // Per-token USD price recovered from the split + the pool-value anchor (real data, no token1==USD
  // assumption): usdPerToken_i = share_i * poolValueUsd / reserve_i. Drives the fee-row estimated USD
  // (Expansion 2) — the fee amounts are independent of the liquidity split, so they need a price.
  const tokenUsdPrice = useMemo(
    () => perTokenUsdPrice(pairSplit, target.poolValueUsd),
    [pairSplit, target.poolValueUsd],
  );
  // Show the per-token liquidity + fee-USD rows only when the pair is selected AND the split resolved.
  const showPairSplit =
    receivingPair && pairSplit != null && tokenUsdPrice != null && reserves != null;

  // Real-mode remove/close input; null until the network is present (real mode) or nothing's selected.
  const removeInput = useMemo<ManagerRemoveRunInput | null>(() => {
    if (!realMode || !target.network || percentage <= 0) return null;
    return {
      network: target.network,
      positionId: target.strategyId,
      percentage,
      stakeUsd: target.stakeUsd,
      // POO-804 R1: the whole family is token-pair only (partial AND close), never USDC.
      collectAsUsdc: false,
      // POO-463 R4: what the gear shows is what the close tx builds with (no silent server fallback).
      slippageTolerance: slippage,
    };
  }, [realMode, target, percentage, slippage]);

  // The signing sequence (build → send) driven by the runner; mock mode runs a 2-step mock flow that
  // closes via managerService.closeStrategy (a partial is an optimistic success, no service call).
  const removeSteps = useMemo<FlowStep<ManagerRemoveCtx>[]>(() => {
    if (realMode) return removeInput ? remove.buildSteps(removeInput) : [];
    const beat = () => new Promise((resolve) => setTimeout(resolve, MOCK_STEP_MS));
    return [
      {
        key: "build",
        run: async () => {
          await beat();
          // POO-804 R1: the pair payout never swaps, so the mock build carries no swapInfo (the
          // POO-611 demo figures were USDC-swap rows); gas stays the honest console estimate.
          return { built: { tx: MOCK_BUILT_TX } };
        },
      },
      {
        key: "confirm:removeLiquidity",
        run: async () => {
          await beat();
          // POO-499 R6 (PP-MOCK): a gear slippage <= 0.1% fails deterministically with the canned
          // slippage error so the auto-retry -> slippage view -> auto-open path is demoable in mock mode.
          if (settleOutcomeForSlippage(slippage) === "error") {
            const mockError = settleTxError();
            throw Object.assign(new Error(mockError.message), { code: mockError.code });
          }
          if (closing) await managerService.closeStrategy(target.strategyId);
          // POO-514 R3 / POO-517 R1 (PP-MOCK): mock mode keeps the mock settle hash so the receipt
          // row + explorer link render (the partial receipt's tx row, like the Collect mock path);
          // real mode gets the real hash from the executor's send step instead.
          return { txHash: settleTxHash() };
        },
      },
    ];
  }, [realMode, removeInput, remove, closing, target.strategyId, slippage]);
  // POO-596: the flow now PAUSES after the build (pauseAfterKey), so the Review renders the BUILT
  // figures before signing; resume() sends, rebuild() re-quotes only the build (POO-574 handshake).
  const flow = useWalletSignFlow(removeSteps, {
    fallbackErrorCode: "REMOVE_LIQUIDITY_FAILED",
    pauseAfterKey: "build",
  });
  // POO-596 R3 reshaped by POO-803: the network-fee line reads the BUILT gas. Mock mode keeps the
  // honest console estimate; real mode NEVER falls back to it — a real build without
  // `estimatedGasInUsd` hides the line instead of fabricating a figure (POO-799 directive #1).
  const networkFeeUsd =
    flow.context.built?.estimatedGasInUsd ?? (realMode ? undefined : target.gasCostUsd);
  // POO-596 R4: the shared Review re-quote countdown; at 0 it re-quotes via flow.rebuild() + resets.
  // POO-888 R3: the Review approve suspends it synchronously (same-tick zero-cross vs send race).
  const { seconds: countdown, suspend: suspendCountdown } = useReviewCountdown({
    active: phase === "review",
    seconds: REVIEW_REFRESH_SECS,
    onRefresh: flow.rebuild,
  });

  // Close-mode Review figures (POO-388 R2): a full wind-down, so the requested amount is the whole
  // stake and nothing stays invested. The close also collects the accrued, uncollected pool fees
  // ("Removes all your liquidity and collects accrued fees"), so the minimum received is principal +
  // accrued fees − costs. Costs = estimated max-0.5% slippage + network gas.
  // PP-INTEGRATION-POINT: the real swap quote replaces this estimate (the executor returns the
  // actual received amount + gas; POO-312 close-pool-tx).
  const accruedFeesUsd = target.feesUsd ?? 0;
  // POO-515 R2 + POO-804 R1: the token-pair payout (the ONLY payout now) skips the fee→USDC stable
  // swap entirely, so the Max slippage component, any DEX fee and the POO-612 swap figures (price
  // impact / protocol fee / min-in-stable) are all gone; only the network gas remains.
  const estFeesUsd = networkFeeUsd ?? 0;
  const totalReceivedMin = Math.max(0, target.stakeUsd + accruedFeesUsd - estFeesUsd);

  // POO-517 R1: the PARTIAL-remove Review/receipt figures. Every remove also collects the accrued
  // fees (POO-548 R3, snapshotted as "Fees collected" on the receipt), so the minimum matches the
  // close math: removed slice + accrued fees − network gas; no slippage haircut on the pair payout
  // (POO-515 R2). PP-INTEGRATION-POINT: the real remove quote replaces this estimate (the executor
  // returns the actual received amount + gas; POO-312 remove-liquidity-tx).
  const removeReceivedMin = Math.max(0, removeUsd + accruedFeesUsd - (networkFeeUsd ?? 0));

  // POO-502 R2: the liquidity leg's per-token amounts + estimated USD — the manager's stake split
  // across the two tokens (usdAmount = stakeUsd, anchor = the whole pool value). CLAMPED at f = 1.
  const liquidityAmounts = showPairSplit
    ? splitUsdAmount(pairSplit, target.stakeUsd, target.poolValueUsd ?? 0)
    : null;
  // POO-548 R4: the Review "Amount requested" per-token split — the GROSS requested amount across
  // the two tokens via the same value shares. On the close path the whole stake is requested; on a
  // partial the removed slice (removeUsd). Same anchor + split lib as the liquidity leg (POO-502).
  const closeAmountRequested = showPairSplit
    ? splitUsdAmount(pairSplit, target.stakeUsd, target.poolValueUsd ?? 0)
    : null;
  const removeAmountRequested = showPairSplit
    ? splitUsdAmount(pairSplit, removeUsd, target.poolValueUsd ?? 0)
    : null;

  // POO-803: adapt the pair splits into the shared card's per-token rows (amount + est. USD).
  const closeAmountTokens =
    showPairSplit && closeAmountRequested && reserves
      ? [
          {
            symbol: reserves.token0,
            amount: closeAmountRequested.amount0,
            usd: closeAmountRequested.usd0,
          },
          {
            symbol: reserves.token1,
            amount: closeAmountRequested.amount1,
            usd: closeAmountRequested.usd1,
          },
        ]
      : null;
  const removeAmountTokens =
    showPairSplit && removeAmountRequested && reserves
      ? [
          {
            symbol: reserves.token0,
            amount: removeAmountRequested.amount0,
            usd: removeAmountRequested.usd0,
          },
          {
            symbol: reserves.token1,
            amount: removeAmountRequested.amount1,
            usd: removeAmountRequested.usd1,
          },
        ]
      : null;
  // The accrued-fees per-token rows (estimated USD from the split price when present; POO-324:
  // amounts only otherwise, never a fabricated USD).
  const feesTokenRows =
    receivingPair && feeTokens
      ? feeTokens.map((token) => ({
          symbol: token.symbol,
          amount: token.amount,
          usd: tokenUsdPrice
            ? token.amount * priceForSymbol(token.symbol, reserves, tokenUsdPrice)
            : undefined,
        }))
      : null;
  // POO-803 R11: the receipt's "Fees collected" snapshots at the Review approve (the optimistic
  // patch zeroes the claimable while the receipt is still open).
  const [receiptFeesUsd, setReceiptFeesUsd] = useState<number | null>(null);
  // POO-803 R7/R8: the Review arrival — lock-up first; the pair payout (the only payout, POO-804
  // R1) never fabricates a USDC arrival figure, so without a lock-up there is no line and the
  // locked line carries a USD VALUE estimate, not a USDC denomination.
  const reviewMinUsd = closing ? totalReceivedMin : removeReceivedMin;
  const reviewArrival =
    target.lockupDays && target.lockupDays > 0
      ? t("manage.close.footerLocked", {
          amount: formatUsd(reviewMinUsd),
          days: target.lockupDays,
        })
      : null;

  // POO-499 (POO-467 R2/R3): shared slippage auto-retry — one auto retry from the build step on the
  // first slippage failure (pending notice, no error view), then a slippage error view + settings
  // auto-open on the second. Non-slippage failures pass through untouched (R4).
  const slippageRetry = useSlippageAutoRetry({
    flow,
    flowName: "removeLiquidity",
    strategyId: target.strategyId,
    slippagePct: slippage,
    onOpenSettings: () => setSettingsOpen(true),
  });
  // POO-461 R3: kind-aware error body. POO-499 R3: the slippage error view swaps in the slippage copy.
  const genericErrorBody = useTxErrorBody(flow.error);
  const errorTitle = slippageRetry.slippageError
    ? tSign("flow.slippage.errorTitle")
    : tSign("flow.error.title");
  const errorBody = slippageRetry.slippageError
    ? tSign("flow.slippage.errorBody", { value: slippageRetry.slippagePct })
    : genericErrorBody;
  // The confirm label flips to "Close position" when the plan promotes to a full close.
  const removeSpec: WalletSignSpec = {
    build: true,
    confirm: closing ? "closePosition" : "removeLiquidity",
  };
  const stepLabels = resolveWalletSignSteps(removeSpec, tSign);

  // Re-seed the form + reset the flow whenever the dialog (re)opens — so launching from "Close
  // strategy" lands at 100% (a full close) and a reopened dialog never shows a stale value. Close
  // mode skips the amount form and opens straight into the Review (POO-388 R2).
  useEffect(() => {
    if (open) {
      // POO-548 R2: re-open in $ mode seeded to the USD equivalent of initialPercentage (so a Close
      // launch at 100% lands on the full stake; a partial default at 25% lands on 25% of the stake).
      setUnit("usd");
      setAmountText(String(round2((initialPercentage / 100) * target.stakeUsd)));
      setConfirmOpen(false);
      setSlippage(MANAGER_DEFAULT_SLIPPAGE_PCT);
      setDeadlineMins(30);
      setSettingsOpen(false);
      setFormError(null);
      setTxHash(null);
      // POO-596: closeMode opens straight into the build (no form), then the Review with built figures;
      // a partial starts on the form. The build is kicked off by the auto-build effect below.
      setPhase(closeMode ? "building" : "form");
      flow.reset();
    }
  }, [open, initialPercentage, target.stakeUsd, closeMode, flow.reset]);

  // POO-596: closeMode has no form CTA — auto-run the build once the dialog has opened into `building`
  // with the seed applied (a fresh render where removeSteps reflects the 100% close). Real mode needs
  // the network to build; when it's absent surface the inline error instead of running an empty flow.
  useEffect(() => {
    if (!open || !closeMode || phase !== "building" || flow.status !== "idle") return;
    if (realMode && removeInput == null) {
      setFormError(t("operate.error"));
      return;
    }
    void flow.run();
  }, [open, closeMode, phase, flow.status, flow.run, realMode, removeInput, t]);

  // POO-596: the build settling into `awaiting` advances the spinner to the Review (reading the built
  // figures from flow.context); a build failure (initial or a Review rebuild) surfaces the error view.
  useEffect(() => {
    if (phase === "building" && flow.status === "awaiting") {
      setPhase("review");
    } else if ((phase === "building" || phase === "review") && flow.status === "error") {
      setPhase("error");
    }
  }, [phase, flow.status]);

  // Drive the outcome off the runner: EVERY successful run parks on a receipt (POO-517 R1) — the
  // close on the Confirmed "Strategy closed" screen (POO-388 R2), the partial on the withdraw
  // receipt (amount received + mined tx). Nothing settles silently anymore; the outcome is applied
  // upstream when the receipt is dismissed (Done or the X). A thrown step routes to the error view
  // (retry resumes from the failed step).
  useEffect(() => {
    if (phase !== "pending") return;
    if (flow.status === "success") {
      if (flow.txHash) setTxHash(flow.txHash);
      setPhase("success");
    } else if (flow.status === "error") {
      // POO-499 R2: the first slippage failure auto-retries — hold the pending phase, no error view yet.
      if (slippageRetry.autoRetrying) return;
      setPhase("error");
    }
  }, [phase, flow.status, flow.txHash, slippageRetry.autoRetrying]);

  /**
   * Form CTA (POO-517 R2 + POO-596): every path goes through the build → Review handshake before
   * signing — a promoted close (typed > 50% or dust) and a partial both start the build here, then
   * land on the SAME Review (built figures) before signing. No path goes form → signing directly.
   * Real mode needs the network slug to build; when it's missing, surface it inline and never run.
   */
  function startBuild() {
    if (percentage <= 0) return;
    if (realMode && removeInput == null) {
      setFormError(t("operate.error"));
      return;
    }
    setFormError(null);
    // POO-596: the build is NOT gated — building runs first so the Review shows the built figures.
    // POO-419: the provisioning gate moved to the Review approve (see `approve()`), mirroring
    // WithdrawModal: the tx is built before any gas top-up, then the gate gates the send/sign.
    setPhase("building");
    // reset() rebuilds the per-step arrays for the current input before the run starts.
    flow.reset();
    void flow.run();
  }

  /**
   * Review approve CTA (POO-596): the tx is already built (we paused after build), so approving
   * resumes into the wallet send step — the build is not re-run here.
   *
   * POO-419: the pre-flight gas top-up gate is evaluated HERE (not on the form CTA), mirroring
   * WithdrawModal's review-approve: if the wallet is short on gas / on the wrong network, provision
   * first, then resume the already-built tx. POO-1042 [R2]/[R3]: the op context now rides on the hook
   * (the target's network); the close spends no USDC, so `evaluate` carries no amount. When the gate
   * passes (flag off / nothing to provision) the send resumes immediately, identical to the pre-gate
   * handshake.
   */
  function approve() {
    // POO-888 R3: suspend the re-quote countdown SYNCHRONOUSLY before anything else, so a
    // zero-crossing in this same tick cannot race the send.
    suspendCountdown();
    setFormError(null);
    // POO-803 R11: snapshot the accrued-fees figure for the receipt before the patch zeroes it.
    setReceiptFeesUsd(accruedFeesUsd);
    if (gate.evaluate()) {
      setPhase("provision");
      return;
    }
    setPhase("pending");
    void flow.resume();
  }

  /** Close handler that also resets the flow + phase (so a reopen starts clean). */
  function handleOpenChange(next: boolean) {
    // POO-419: no dismissal while provisioning is executing (ESC / overlay / X are all blocked).
    if (!next && gate.locked) return;
    if (!next) {
      // Dismissing the receipt (Done or the X) applies the outcome upstream: a close reports closed
      // (POO-388 R2), a partial reports the reduced stake so the manage view can patch it
      // optimistically (POO-517 R1/R3).
      if (phase === "success") {
        if (closing) onRemoved(true);
        else onRemoved(false, plan.newAmountUsd);
      }
      flow.reset();
      gate.reset(); // POO-419: clear the pre-flight gate state on close.
      setPhase("form");
      setFormError(null);
      setTxHash(null);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        {phase === "form" ? (
          <>
            {/* POO-570 R1: the settings gear (slippage + deadline + receive-as) lives on this form
                (input) step, next to the Dialog X — not on the partial-remove Review (reverses
                POO-548 R1). The close path has no form step, so its Review keeps the gear (R2). */}
            <TransactionModalHeader
              title={t("manage.remove.title")}
              onSettings={() => setSettingsOpen(true)}
              settingsLabel={tSign("invest.settings.title")}
            />
            <p className="text-muted-foreground text-sm">{t("manage.remove.desc")}</p>

            {/* What's in the pool — liquidity and accrued fees shown separately, always (POO-324 #3).
                POO-804 R1: the pair is the only payout, so both split per token whenever the raw
                reserve block is present: the liquidity leg via the client-side value split (POO-502
                R2), the fees from the real fees0/fees1 breakdown gaining estimated USD (POO-502
                Expansion 2). Absent block → the honest single USD figures (R4).
                PP-INTEGRATION-POINT (POO-325): the per-token USD here is a client-side ESTIMATE from
                the on-chain reserves + pool-value anchor; the backend's verified reserve-in-USD
                replaces it when it lands (this split stays a check). */}
            <div className="flex flex-col gap-1.5 rounded-lg bg-surface-raised px-3 py-2.5 text-sm">
              <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                {t("manage.remove.poolContents")}
              </p>
              <div className="flex items-start justify-between gap-6">
                <span className="text-muted-foreground">{t("manage.remove.liquidity")}</span>
                {showPairSplit && liquidityAmounts && reserves ? (
                  // POO-502 R2: the liquidity leg as per-token rows (amount + de-emphasized USD + logo).
                  <PairSplitRows
                    testId="remove-liquidity-tokens"
                    token0={reserves.token0}
                    token1={reserves.token1}
                    amount0={liquidityAmounts.amount0}
                    amount1={liquidityAmounts.amount1}
                    usd0={liquidityAmounts.usd0}
                    usd1={liquidityAmounts.usd1}
                    network={target.network}
                  />
                ) : (
                  <span className="font-medium text-foreground">{formatUsd(target.stakeUsd)}</span>
                )}
              </div>
              <div className="flex items-start justify-between gap-6">
                <span className="text-muted-foreground">{t("manage.remove.fees")}</span>
                {receivingPair && feeTokens ? (
                  <FeeTokenRows
                    testId="remove-fee-tokens"
                    feeTokens={feeTokens}
                    reserves={reserves}
                    tokenUsdPrice={tokenUsdPrice}
                    network={target.network}
                  />
                ) : (
                  <span className="font-medium text-foreground">
                    {formatUsd(target.feesUsd ?? 0)}
                  </span>
                )}
              </div>
            </div>

            {/* Amount to remove — typed value with a $ / % unit toggle, plus quick presets. */}
            <div className="flex flex-col gap-2">
              <span className="font-medium text-foreground text-sm">
                {t("manage.remove.amountLabel")}
              </span>
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center rounded-lg border border-border bg-surface px-3">
                  {unit === "usd" ? <span className="text-muted-foreground text-sm">$</span> : null}
                  <input
                    inputMode="decimal"
                    value={amountText}
                    // POO-804 R7: decimal cap (6 in $, 1 in %) + hard clamp at the stake / 100%.
                    onChange={(event) => setAmountText(sanitizeAmount(event.target.value))}
                    placeholder="0"
                    aria-label={t("manage.remove.amountLabel")}
                    // POO-848 R3: 16px below sm (iOS zooms on focused inputs under 16px).
                    className="w-full min-w-0 bg-transparent py-2 text-right text-base text-foreground outline-none placeholder:text-muted-foreground/70 sm:text-sm"
                  />
                  {unit === "pct" ? (
                    <span className="pl-1 text-muted-foreground text-sm">%</span>
                  ) : null}
                </div>
                <fieldset
                  className="m-0 flex min-w-0 shrink-0 rounded-lg border border-border p-0"
                  aria-label={t("manage.remove.unitToggle")}
                >
                  {(["pct", "usd"] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => toggleUnit(u)}
                      aria-pressed={unit === u}
                      className={cn(
                        "px-3 py-2 font-medium text-sm transition-colors first:rounded-l-lg last:rounded-r-lg",
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
              {/* POO-842 R1: 2x2 below sm — in $ mode (the POO-548 default) a 4-figure stake's
                  formatUsd labels need ~75-85px per chip while 4 columns give ~59px at 375px,
                  clipping the last chip. Labels stay the full formatUsd value (POO-804 R4
                  invariant: label and set value always match). */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PRESETS.map((preset) => {
                  // POO-804 R4: the presets follow the unit in VALUE and LABEL — $ mode shows the
                  // dollar equivalent of each percentage chip (the value it sets on click). The
                  // 100% chip floors at the stake so round2 can never label/set above the max.
                  const presetUsd = Math.min(
                    round2((preset / 100) * target.stakeUsd),
                    Math.floor(target.stakeUsd * 100) / 100,
                  );
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() =>
                        setAmountText(
                          sanitizeAmount(unit === "pct" ? String(preset) : String(presetUsd)),
                        )
                      }
                      aria-pressed={Math.round(percentage) === preset}
                      className={cn(
                        "rounded-lg border px-2 py-2 font-medium text-sm transition-colors",
                        Math.round(percentage) === preset
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-foreground hover:bg-surface-raised",
                      )}
                    >
                      {unit === "pct" ? `${preset}%` : formatUsd(presetUsd)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Removed value (the $ the chosen % corresponds to) + the new position amount preview. */}
            {percentage > 0 ? (
              <div className="flex items-center justify-between rounded-lg bg-surface-raised px-3 py-2 text-sm">
                <span className="text-muted-foreground">{t("manage.remove.removeValue")}</span>
                <span className="font-medium text-foreground">≈ {formatUsd(removeUsd)}</span>
              </div>
            ) : null}
            <div className="flex items-center justify-between rounded-lg bg-surface-raised px-3 py-2 text-sm">
              <span className="text-muted-foreground">{t("manage.remove.newAmount")}</span>
              <span className="font-medium text-foreground">{formatUsd(plan.newAmountUsd)}</span>
            </div>

            {/* POO-445 R3: the "Collect as …" choice now lives only in the ⚙ settings gear (removed
                the inline toggle that duplicated it). */}

            {/* Inline close alert (>50% or dust) — POO-804 R2: the expanded copy (close +
                withdraw-all + collect fees in one sentence; the dust promotion keeps its own first
                line + the fees note) plus the investors note on both variants. */}
            {closing ? (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
                <TriangleAlert className="size-5 shrink-0 text-destructive" aria-hidden="true" />
                <div className="flex flex-col gap-1">
                  <p className="text-destructive text-sm">
                    {dust ? t("manage.remove.dustAlert") : t("manage.remove.closeAlert")}
                  </p>
                  {dust ? (
                    <p className="text-destructive/80 text-xs">
                      {t("manage.remove.closeFeesNote")}
                    </p>
                  ) : null}
                  <p className="text-destructive/80 text-xs">{t("manage.remove.investorsNote")}</p>
                </div>
              </div>
            ) : null}

            {/* POO-804 R6: the console gas note left the form (the estimate still feeds the
                mock-mode fee line via target.gasCostUsd). */}
            {formError ? <p className="text-destructive text-xs">{formError}</p> : null}

            <DialogFooter>
              <Button variant="secondary" onClick={() => handleOpenChange(false)}>
                {t("operate.cancel")}
              </Button>
              <Button
                variant={closing ? "destructive" : "primary"}
                // POO-804 R3: a form-promoted close (typed > 50% or dust) confirms before building.
                onClick={() => (closing ? setConfirmOpen(true) : startBuild())}
                disabled={percentage <= 0}
              >
                {closing ? t("manage.remove.close") : t("manage.remove.remove")}
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {phase === "building" ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>
                {closing ? t("manage.remove.busyClose") : t("manage.remove.busyRemove")}
              </DialogTitle>
            </DialogHeader>
            {/* POO-596: the server builds the tx here; on settle the flow pauses (awaiting) and the
                effect advances to the Review with the built figures. */}
            <BuildingStep label={tSign("flow.processing")} />
            {formError ? <p className="text-center text-destructive text-xs">{formError}</p> : null}
          </>
        ) : null}

        {phase === "review" && closing ? (
          <>
            {/* POO-388 R2: the close Review mirrors the Withdraw review — full balance, $0.00
                remaining, "Close strategy" CTA. POO-517 R2: the form-promoted close (typed > 50% or
                dust) lands here too — Back returns to the amount form; from the OperationsCard
                entry (closeMode) Back cancels (the warning is the prior step). */}
            {/* POO-445 R1 (was POO-424 R3): shared header — back + gear next to the X. */}
            <TransactionModalHeader
              title={t("manage.close.reviewTitle")}
              onBack={() => (closeMode ? handleOpenChange(false) : setPhase("form"))}
              backLabel={t("manage.close.back")}
              onSettings={() => setSettingsOpen(true)}
              settingsLabel={tSign("invest.settings.title")}
            />

            {/* POO-596 R4: the visible re-quote countdown — the built figures refresh when it hits 0. */}
            <p className="flex items-center justify-center gap-1.5 text-muted-foreground text-xs">
              <RefreshCw className="size-3.5" aria-hidden="true" />
              {tSign("flow.review.refreshIn", { seconds: countdown })}
            </p>
            {/* POO-885 R2/R4: subtle stale-quote hint after 3 consecutive background re-quote
                failures (non-fatal; the countdown keeps retrying with the last good quote). */}
            {flow.quoteStale ? (
              <p className="text-center text-warning text-xs">{tSign("flow.review.quoteStale")}</p>
            ) : null}

            {/* POO-803 R5-R8: the SHARED withdraw-family Review card (same as WithdrawModal) —
                Amount requested + Fees available (per-token + logos on the pair, R6) visible;
                Est. fee (canonical) / Max. slippage (Auto badge) / Price impact behind Show more;
                Receive as + caption + the arrival line below. The old You-receive-at-least row is
                gone (R5) — the arrival line is the min indicator. */}
            <WithdrawReviewCard
              amountUsd={target.stakeUsd}
              feesAvailableUsd={accruedFeesUsd}
              amountTokens={closeAmountTokens}
              feesTokens={feesTokenRows}
              network={target.network}
              // POO-804 R1: locked to the token pair — no swap, so no protocol-fee / price-impact rows.
              receiveAs={t("manage.close.receiveTokens")}
              receivingPair
              slippagePct={slippage}
              slippageIsDefault={slippage === MANAGER_DEFAULT_SLIPPAGE_PCT}
              networkFeeUsd={networkFeeUsd}
              arrival={reviewArrival}
            />

            {formError ? <p className="text-destructive text-xs">{formError}</p> : null}

            <DialogFooter>
              <Button variant="destructive" className="w-full" size="lg" onClick={approve}>
                {t("manage.close.cta")}
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {phase === "review" && !closing ? (
          <>
            {/* POO-517 R1: the PARTIAL remove gets the same Withdraw-style Review before signing —
                amount summary, the minimum received off the gear slippage, ONE consolidated neutral
                Fee row (buildFeeRow, POO-445 R4/R5), the display-only receive-as row (the gear owns
                the choice) and the lock-up-aware arrival footer. */}
            {/* POO-570 R1: the gear moved to the form (input) step; this partial-remove Review header
                only carries Back. (The close Review above keeps the gear — no form step, R2.) */}
            <TransactionModalHeader
              title={t("manage.close.reviewTitle")}
              onBack={() => setPhase("form")}
              backLabel={t("manage.close.back")}
            />

            {/* POO-596 R4: the visible re-quote countdown — the built figures refresh when it hits 0. */}
            <p className="flex items-center justify-center gap-1.5 text-muted-foreground text-xs">
              <RefreshCw className="size-3.5" aria-hidden="true" />
              {tSign("flow.review.refreshIn", { seconds: countdown })}
            </p>
            {/* POO-885 R2/R4: subtle stale-quote hint after 3 consecutive background re-quote
                failures (non-fatal; the countdown keeps retrying with the last good quote). */}
            {flow.quoteStale ? (
              <p className="text-center text-warning text-xs">{tSign("flow.review.quoteStale")}</p>
            ) : null}

            {/* POO-803: the same shared Review card as the close path / WithdrawModal (POO-799
                decision #10) — partial figures (removed slice + accrued fees). */}
            <WithdrawReviewCard
              amountUsd={removeUsd}
              feesAvailableUsd={accruedFeesUsd}
              amountTokens={removeAmountTokens}
              feesTokens={feesTokenRows}
              network={target.network}
              // POO-804 R1: locked to the token pair — no swap, so no protocol-fee / price-impact rows.
              receiveAs={t("manage.close.receiveTokens")}
              receivingPair
              slippagePct={slippage}
              slippageIsDefault={slippage === MANAGER_DEFAULT_SLIPPAGE_PCT}
              networkFeeUsd={networkFeeUsd}
              arrival={reviewArrival}
            />

            {formError ? <p className="text-destructive text-xs">{formError}</p> : null}

            <DialogFooter>
              <Button className="w-full" size="lg" onClick={approve}>
                {t("manage.remove.remove")}
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {/* POO-419: pre-flight gas top-up gate, between the CTA and the wallet handoff. */}
        {phase === "provision" && gate.input ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>{tSign("provisioning.plan.title")}</DialogTitle>
            </DialogHeader>
            <ProvisioningPanel
              input={gate.input}
              context={gate.context}
              // opLabel + plan.title come from the strategies namespace (tSign); the close is gas-only.
              // POO-841 R3: the plan card shows the strategy name, or a truncated id as the belt.
              opLabel={tSign(provisioningOpLabelKey("close"), {
                strategy: target.name ?? formatIdentityLabel(target.strategyId),
              })}
              onDone={() => {
                gate.setLocked(false);
                setPhase("pending");
                // POO-596 handshake: the remove/close flow is paused after the build; resume it into
                // the wallet send step (do NOT flow.run(), which would rebuild the tx from scratch),
                // mirroring WithdrawModal's provision onDone.
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
              <DialogTitle>
                {closing ? t("manage.remove.busyClose") : t("manage.remove.busyRemove")}
              </DialogTitle>
            </DialogHeader>
            {/* POO-499 R2: the auto-retry notice sits in the pending view while the flow re-runs. */}
            {slippageRetry.autoRetrying ? (
              <p className="rounded-md bg-warning/10 px-3 py-2 text-center text-warning text-sm">
                {tSign("flow.slippage.retryNotice", { value: slippageRetry.slippagePct })}
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

        {phase === "success" && closing ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>{t("manage.close.successTitle")}</DialogTitle>
            </DialogHeader>
            {/* POO-388 R2 Confirmed: "Strategy closed" receipt. Done applies the close upstream.
                POO-517 R2: the form-promoted close parks here too (same sequence as closeMode). */}
            <TransactionStatus
              phase="success"
              title={t("manage.close.successTitle")}
              // POO-804 R1: the payout is the token pair — the body carries a USD VALUE estimate,
              // never a fabricated USDC denomination.
              body={t("manage.close.successBody", {
                amount: formatUsd(totalReceivedMin),
              })}
            >
              {/* POO-803 R9/R11: the SHARED withdraw-family receipt (same as WithdrawModal) —
                  Strategy · Amount received · Fees collected · Total received; the final Fee +
                  Slippage + Price impact behind Show more; Date + Transaction never collapse.
                  PP-INTEGRATION-POINT: the REAL executed figures (POO-810 / PR #537) replace the
                  confirm-time snapshots when they land. */}
              <WithdrawReceiptCard
                strategyName={target.name ?? target.strategyId}
                amountReceivedUsd={target.stakeUsd}
                feesCollectedUsd={receiptFeesUsd ?? undefined}
                totalReceivedUsd={totalReceivedMin}
                slippagePct={slippage}
                networkFeeUsd={networkFeeUsd}
                date={format.dateTime(new Date(), { dateStyle: "medium", timeStyle: "short" })}
                txHashShort={flow.txHash ? formatTxHash(flow.txHash) : null}
              />
              <Button className="w-full" size="lg" onClick={() => handleOpenChange(false)}>
                {t("manage.close.done")}
              </Button>
              {/* POO-514 R2: the shared explorer link on the position's network (/tx/{hash}). */}
              <ExplorerTxLink network={target.network} hash={flow.txHash} />
            </TransactionStatus>
          </>
        ) : null}

        {phase === "success" && !closing ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>{tSign("withdraw.success.completeTitle")}</DialogTitle>
            </DialogHeader>
            {/* POO-517 R1: the PARTIAL-remove receipt — the amount received plus the mined tx row
                with an explorer link (the POO-505 Collect precedent). Done applies the reduced
                stake upstream (R3). */}
            <TransactionStatus
              phase="success"
              title={tSign("withdraw.success.completeTitle")}
              // POO-804 R1: pair payout — USD value estimate, no fabricated USDC denomination.
              body={t("manage.close.successBody", {
                amount: formatUsd(removeReceivedMin),
              })}
            >
              {/* POO-803 R9/R11: the same shared receipt as the close path / WithdrawModal. */}
              <WithdrawReceiptCard
                strategyName={target.name ?? target.strategyId}
                amountReceivedUsd={removeUsd}
                feesCollectedUsd={receiptFeesUsd ?? undefined}
                totalReceivedUsd={removeReceivedMin}
                slippagePct={slippage}
                networkFeeUsd={networkFeeUsd}
                date={format.dateTime(new Date(), { dateStyle: "medium", timeStyle: "short" })}
                txHashShort={txHash ? formatTxHash(txHash) : null}
              />
              <Button className="w-full" size="lg" onClick={() => handleOpenChange(false)}>
                {t("manage.close.done")}
              </Button>
              <ExplorerTxLink network={target.network} hash={txHash} />
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
                  // POO-887 R1/R2: a pre-Review failure (the build is step 0 here) retries back
                  // THROUGH the Review gate ("building" re-engages awaiting → review); post-Review
                  // keeps the pending stepper.
                  setPhase(flow.retryWillPause ? "building" : "pending");
                  // POO-499 R3: after a slippage error, re-run from build with the new slippage;
                  // R4: a non-slippage failure keeps resume-from-failed-step.
                  if (slippageRetry.slippageError) void flow.retryFrom("build");
                  else void flow.retry();
                }}
                error={flow.error ?? undefined}
              />
              <Button variant="ghost" className="w-full" onClick={() => handleOpenChange(false)}>
                {t("operate.cancel")}
              </Button>
            </TransactionStatus>
          </>
        ) : null}
      </DialogContent>
      {/* POO-804 R3: the Continue / Keep-the-strategy confirmation raised by the form CTA when the
          plan promotes to a close (typed > 50% or dust). Continue starts the build → close Review;
          Keep the strategy returns to the form untouched. (The OperationsCard Close-button entry
          confirms with the same copy BEFORE opening this modal, so closeMode never re-confirms.) */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("manage.remove.confirmTitle")}
        body={t("manage.remove.confirmBody")}
        confirmLabel={t("manage.remove.confirmContinue")}
        cancelLabel={t("manage.remove.confirmKeep")}
        onConfirm={startBuild}
      />
      {/* POO-424 R3: the shared settings sheet — slippage + deadline; deadline is display-only for
          now (the close tx doesn't consume it yet). POO-804 R1: receive-as is a FIXED token-pair
          display (POO-525 R2 pattern) — the manager remove family has no payout choice. */}
      <TransactionSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        slippage={slippage}
        onSlippageChange={setSlippage}
        // POO-547: the custom slippage is uniform (0.1-100%) — no per-flow cap; 5% stays the seed.
        // PP-INTEGRATION-POINT: deadlineMins is collected but not yet threaded into the close tx (mirrors MoveRangeModal)
        deadlineMins={deadlineMins}
        onDeadlineChange={setDeadlineMins}
        receiveAs={t("manage.close.receiveTokens")}
        receiveOptions={[t("manage.close.receiveTokens")]}
      />
    </Dialog>
  );
}

/**
 * Per-token USD price recovered from a value split + the pool-value anchor (POO-502 Expansion 2),
 * using only real on-chain data (no token1==USD assumption): `usdPerToken_i = share_i * anchor /
 * reserve_i`. Null when the split is null, the anchor is non-positive, or a reserve is zero (so the
 * caller degrades to amounts-only, R4).
 */
function perTokenUsdPrice(
  split: PositionSplit | null,
  poolValueUsd: number | undefined,
): { price0: number; price1: number } | null {
  if (!split || poolValueUsd == null || !(poolValueUsd > 0)) return null;
  if (!(split.reserve0 > 0) || !(split.reserve1 > 0)) return null;
  return {
    price0: (split.share0 * poolValueUsd) / split.reserve0,
    price1: (split.share1 * poolValueUsd) / split.reserve1,
  };
}

/** Pick the USD price for a fee-token symbol (token0 vs token1 of the pool). */
function priceForSymbol(
  symbol: string,
  reserves: RemoveLiquidityTarget["reserves"],
  price: { price0: number; price1: number },
): number {
  return reserves && symbol === reserves.token1 ? price.price1 : price.price0;
}

/**
 * Two per-token rows (amount + de-emphasized USD + logo) for the manager Remove/Close split legs
 * (POO-502): the Liquidity leg (R2) and the close Review "You receive (min)" total (Expansion 1 /
 * R7). Amounts + USD come from the pure reserve split (positionTokenSplit / splitUsdAmount), the SAME
 * path in mock and real mode, mirroring the investor Withdraw PairReceiveRows for cross-surface
 * consistency. The USD figures are pre-execution estimates. PP-INTEGRATION-POINT (POO-325):
 * backend-verified per-token figures replace these estimates when they land.
 */
function PairSplitRows({
  testId,
  token0,
  token1,
  amount0,
  amount1,
  usd0,
  usd1,
  network,
}: {
  testId: string;
  token0: string;
  token1: string;
  amount0: number;
  amount1: number;
  usd0: number;
  usd1: number;
  network: string | undefined;
}) {
  const rows = [
    { symbol: token0, amount: amount0, usd: usd0 },
    { symbol: token1, amount: amount1, usd: usd1 },
  ];
  return <TokenAmountRows rows={rows} network={network} testId={testId} />;
}

/**
 * Per-token fee rows (amount + client-ESTIMATED USD + logo) for the token-pair path (POO-324 item 2 /
 * POO-502 Expansion 2). Shared by the pool-contents "Fees" line and the POO-548 R4 Review
 * "Fees available to collect" row so both read the SAME per-token fee split. The estimated USD comes
 * from the split price when the raw reserve block is present; absent → amounts only (the POO-324
 * degrade), never a fabricated USD.
 */
function FeeTokenRows({
  testId,
  feeTokens,
  reserves,
  tokenUsdPrice,
  network,
}: {
  testId: string;
  feeTokens: ClaimableFeeToken[];
  reserves: RemoveLiquidityTarget["reserves"];
  tokenUsdPrice: { price0: number; price1: number } | null;
  network: string | undefined;
}) {
  // The estimated USD comes from the split price when present; absent → amounts only (POO-324),
  // never a fabricated USD. POO-482 R2: TokenAmountRows resolves the real token logo per row.
  const rows = feeTokens.map((token) => ({
    symbol: token.symbol,
    amount: token.amount,
    usd: tokenUsdPrice
      ? token.amount * priceForSymbol(token.symbol, reserves, tokenUsdPrice)
      : undefined,
  }));
  return <TokenAmountRows rows={rows} network={network} testId={testId} />;
}
