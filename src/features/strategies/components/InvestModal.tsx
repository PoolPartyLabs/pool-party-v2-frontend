/**
 * @id PP-STR-MOD-001
 * @name InvestModal (amount → building → review → sign)
 * @implements-rules-version v11 (POO-1043 rules v1) · v10 (POO-801 rules v1) · v1 (POO-819: top-level lockupDays source) · v1 (POO-842 rules v1) · v1 (POO-905: served-rate protocol fee estimate) · v1 (POO-1025 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The invest flow as a single dialog: enter an amount → confirm & sign → pending → success.
 * Amount step branches on the spendable balance: funded (balance ≥ amount) keeps the gold "Invest"
 * CTA; needs-deposit (balance < amount) shows the shortfall and flips the CTA to "Deposit & invest"
 * (POO-1025: that CTA now consults the provisioning gate FIRST, so a wallet holding funds on another
 * chain funds the invest from what it already has instead of being sent to buy more fiat; the deposit
 * deep link remains the fallback when there is nothing to provision from);
 * below-minimum disables the CTA with a hint. The effective minimum is the platform's $10 floor or
 * the manager's, whichever is higher (POO-184 R1). Costs (network fee, lock-up) appear only on
 * the confirm step (per the fees-at-confirmation rule); single-pool strategies also show the zap
 * line there — USDC in, auto-converted into the pool's two tokens (POO-184 R2). Combines
 * PP-STR-MOD-001 + PP-STR-MOD-002.
 *
 * POO-514 (rules v1): the success receipt's transaction row is real-only in real mode (the constant
 * mock settleTxHash() never leaks past mock mode) and gains the shared ExplorerTxLink
 * (PP-CORE-CMP-050) targeting /tx/{hash} on the strategy's own network.
 *
 * POO-520 (rules v1): `depositOrigin="manager"` (the console Add-liquidity) flags the Deposit &
 * invest deep link with `origin=manager` so the resume returns to the console manage view; investor
 * launches keep the origin-free URL.
 *
 * POO-515 R1 (v6): the confirm step carries a slippage-protected minimum line ("You will deploy at
 * least"), the gear-slippage haircut on the invested amount, mirroring Compound/Withdraw.
 *
 * POO-598 (rules v2, v7): the POO-574 build→review→sign handshake, in the "depois" ordering forced by
 * the real invest build consuming the Permit2 signature (useInvest's build step needs ctx.permit +
 * ctx.signature, so it CANNOT run before the permit without a backend change). The step order is
 * therefore UNCHANGED — [approve:USDC, permit, build, confirm:invest] — and the flow simply PAUSES
 * after `build` (pauseAfterKey). Tapping "Invest" runs approve → Permit2 sign → build in a `building`
 * phase (the WalletSteps stepper, NOT a bare spinner, because two real wallet prompts happen here),
 * then the flow pauses in `awaiting` and the modal advances to a `review` — the single confirmation
 * surface (the old pre-sign `confirm` step is removed), reading the BUILT figures (real gas via
 * flow.context.built.estimatedGasInUsd) + a 10s re-quote countdown. The Review's "Confirm" CTA
 * resumes the paused flow into the `confirm:invest` send (the money-move). Because approve/permit run
 * before the review, the provisioning gate + `strategy_invest_submitted` stay on the "Invest" CTA
 * (R7) — NOT on the review approve, unlike Withdraw — so gas is ensured before the approve tx.
 *
 * POO-606 (rules v1, v8): the Review's "You will invest at least" now uses the server's authoritative
 * minimum. The invest build already returns `swapInfo.minAmountInStable` (the slippage-protected min
 * deployed, in USD, net of slippage + protocol fee); `builtTxSchema` (POO-610) parses it tolerantly.
 * `deployAtLeast` reads `flow.context.built.swapInfo.minAmountInStable` when present (> 0), degrading
 * to the client gear-slippage estimate before the build / on a degenerate 0. In mock mode the build
 * attaches a real-shaped `settleSwapInfo(...)` (POO-611) exactly like Withdraw/Remove (POO-612), so
 * the mock Review shows the mock server min rather than the bare client estimate. This is the
 * completion POO-515 R1 anticipated ("the real minimum comes from the server build's swap quote when
 * it lands"). No backend change — the field was always in the response.
 *
 * POO-800 (rules v1, R4): the Review now carries the shared price-impact row (buildPriceImpactRow,
 * amber >= 2%) read from the built quote's `swapInfo.priceImpactPercentage` — the one swap-bearing
 * Review that lacked it. Hidden until the build lands a real figure; nothing is fabricated.
 *
 * POO-801 (rules v1, 0710 overhaul): Review + Receipt on the shared collapsible card
 * (CollapsibleReceiptRows): summary [You invest · Est. annual yield · You will invest at least ·
 * Lock-up], detail behind Show more [Est. fee · Max. slippage (Auto badge on the default) · Price
 * impact]. "Pay from" and "Deployed as" rows are gone (R1/R2, the reworded zap note carries the
 * pair); the fee tooltip is the canonical set (buildCanonicalFeeLines) reading ONLY real built
 * figures — protocol fee from `swapInfo.protocolFee`, gas from `estimatedGasInUsd`; the hardcoded
 * DEX/protocol percent math is gone (POO-521 will add the DEX route fee) and the $0.30 gas default
 * is mock-only (real mode hides the line instead, POO-799 directive #1). The receipt shows "Amount
 * Invested" and drops the Done button (close via X / View position, decision #4).
 *
 * POO-810 (rules v1, R4, supersedes POO-801's dormant-in-real behavior): the receipt's deployed
 * figure is now the REAL executed amount in real mode — `deployed = requested − USDC refunded to the
 * wallet` (decoded from the mined receipt via `flow.context.decoded.usdcUsd`). A partial fill leaves a
 * USDC remainder, so `deployed < requested` activates the partial-investment banner truthfully. Mock
 * mode keeps the `settleDeployedUsd` walk; the R9 fallback (no decoded USDC refund) = the full
 * requested figure, banner dormant (never blank / $0).
 *
 * POO-853 (referral parity, rules v1): on a confirmed invest, [R6] logs the ADD_LIQUIDITY to the
 * referral operation feed (`useReferralOperationLog`, real-only + deduped) and [R5] re-fires the
 * idempotent apply when a `pp_ref` is still pending and the invest cleared the 20-USDC floor.
 *
 * POO-905 (rules v1): the Review's protocol-fee line no longer waits for the build — it ESTIMATES
 * from the API-served rate (`strategy.protocolFeePct`, the pp-api PROTOCOL_FEE constant on v2 rows):
 * `amount × pct / 100` [R3]. The built `swapInfo.protocolFee` stays authoritative and replaces the
 * estimate the moment it exists; an absent rate keeps today's no-line behavior [R4] — never a
 * client-side constant (POO-799 directive #1).
 */
"use client";

import { RefreshCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CollapsibleReceiptRows } from "@/components/ui/CollapsibleReceiptRows";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { ExplorerTxLink } from "@/components/ui/ExplorerTxLink";
import type { ReceiptRowItem } from "@/components/ui/ReceiptRows";
import { TransactionModalHeader } from "@/components/ui/TransactionModalHeader";
import { applyReferralCodeAction } from "@/features/rewards/actions";
import { useReferralOperationLog } from "@/features/rewards/hooks/useReferralOperationLog";
import { useRouter } from "@/i18n/navigation";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { MIN_AMOUNT_FOR_ADD_LIQUIDITY } from "@/lib/config/operationMinimums";
import { qualifiesForApplyRetry, readPendingReferralCode } from "@/lib/rewards/pendingReferralCode";
import type { Strategy } from "@/lib/schemas";
import type { TxError } from "@/lib/tx/diagnostics";
import { usePostWriteRefresh } from "@/lib/tx/usePostWriteRefresh";
import {
  formatIdentityLabel,
  formatSignedUsd,
  formatTokenAmount,
  formatTxHash,
  formatUsd,
  formatUsdPrecise,
} from "@/lib/utils/format";
import type { InvestCtx } from "../hooks/useInvest";
import { useProvisioningGate } from "../hooks/useProvisioningGate";
import { useReviewCountdown } from "../hooks/useReviewCountdown";
import { useSlippageAutoRetry } from "../hooks/useSlippageAutoRetry";
import { type FlowStep, useWalletSignFlow } from "../hooks/useWalletSignFlow";
import { provisioningOpLabelKey } from "../lib/buildProvisioningInput";
import { DEFAULT_SLIPPAGE_PCT } from "../lib/slippage";
import { AmountField, amountToText } from "./AmountField";
import {
  buildCanonicalFeeLines,
  buildFeeRow,
  buildMaxSlippageRow,
  buildPriceImpactRow,
} from "./FeeBreakdown";
import { PriceImpactGate, usePriceImpactGate } from "./PriceImpactGate";
import { ProvisioningPanel } from "./ProvisioningPanel";
import { StrategyMiniHeader } from "./StrategyMiniHeader";
import {
  MOCK_BUILT_TX,
  settleDeployedUsd,
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
import type { WalletSignSpec } from "./walletSignSteps";

/** Flow phases for the invest dialog (pending shows the multistep wallet handoff, POO-295). */
// POO-598: `building` runs approve → Permit2 → build (pauseAfterKey) before the Review; the Review
// shows the built figures + a 10s re-quote countdown, and the wallet send is only called on approve.
// POO-419: `provision` (the pre-flight gate) sits between the "Invest" CTA and `building` (R7).
type Phase = "amount" | "building" | "review" | "provision" | "pending" | "success" | "error";

/**
 * PP-MOCK: mock-mode network gas (the mock build carries no `estimatedGasInUsd`). MOCK ONLY —
 * real mode reads the built gas and HIDES the line when the build omits it, never this figure
 * (POO-801 / POO-799 global directive #1).
 */
const NETWORK_FEE_USD = 0.3;

/** POO-598 R4: the Review re-quotes (flow.rebuild) this many seconds after each build settles. */
const REVIEW_REFRESH_SECS = 10;

/** The invest signing sequence: approve USDC (self-skips) → Permit2 → server build → send. */
const INVEST_SPEC: WalletSignSpec = {
  approvals: ["USDC"],
  permit2: true,
  build: true,
  confirm: "invest",
};

/** Per-step mock duration so the stepper visibly walks in mock mode. */
const MOCK_STEP_MS = 350;

/**
 * Mock invest steps: the 4-step sequence animates, then the final step settles success/error.
 * POO-499 R6: the confirm step reads the CURRENT gear slippage via `slippageRef` so a <= 0.1% setting
 * forces the canned slippage failure deterministically on every attempt (demoing the auto-retry ->
 * slippage view -> auto-open path in mock mode); any higher slippage keeps the happy path.
 * POO-606: the `build` step attaches a real-shaped `swapInfo` (mirroring the Withdraw/Remove mock,
 * POO-611/POO-612) so the Review's "You will invest at least" reads the mock server min in mock mode.
 */
function mockInvestSteps(
  slippageRef: { current: number },
  amountUsd: number,
): FlowStep<InvestCtx>[] {
  const beat = () => new Promise((resolve) => setTimeout(resolve, MOCK_STEP_MS));
  return [
    {
      key: "approve:USDC",
      run: async () => {
        await beat();
        return {};
      },
    },
    {
      key: "permit",
      run: async () => {
        await beat();
        return {};
      },
    },
    {
      key: "build",
      run: async () => {
        await beat();
        // POO-606: the mock build now carries a real-shaped swapInfo so the Review's "You will deploy
        // at least" reads the mock server min (minAmountInStable) in mock mode, matching the Withdraw
        // precedent (POO-611/POO-612); gas stays the honest estimate (no estimatedGasInUsd here).
        // PP-INTEGRATION-POINT: real values come from the API `TxResponseWithSwap` on the build-tx
        // response (see builtTxSchema); this PP-MOCK stands in until that path is exercised.
        return {
          built: {
            tx: MOCK_BUILT_TX,
            swapInfo: settleSwapInfo(amountUsd, { slippagePct: slippageRef.current }),
          },
        };
      },
    },
    {
      key: "confirm:invest",
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

/** Public props for {@link InvestModal}. */
export interface InvestModalProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void;
  /** The strategy being invested in. */
  strategy: Strategy;
  /** The investor's spendable USDC balance, in USD. */
  balance: number;
  /**
   * Real-mode step builder (approve → Permit2 → server build → send), driven by the wallet-sign
   * runner. When provided it replaces the mock settle; when absent the dialog runs the mock steps.
   */
  buildInvestSteps?: (amountUsd: number, slippage: number) => FlowStep<InvestCtx>[];
  /** Called once the invest succeeds, so the detail screen refreshes into the owned state. */
  onInvested?: () => void;
  /**
   * Amount to resume at the "Confirm & sign" step when the dialog opens — set by the parent after a
   * Deposit & invest top-up (?invest=) so the investor returns straight to confirm without retyping
   * (POO-281 R3). A normal open (null/undefined) starts at the amount step as usual.
   */
  resumeAmount?: number | null;
  /**
   * Where this invest flow was launched from (POO-520). "manager" (the console's Add-liquidity)
   * flags the Deposit & invest deep link with `origin=manager`, so the post-deposit resume returns
   * to the console manage view instead of the investor strategy detail. Absent/"investor" keeps the
   * current investor round-trip (R2).
   */
  depositOrigin?: "investor" | "manager";
}

/** Invest-amount + confirm dialog. */
export function InvestModal({
  open,
  onOpenChange,
  strategy,
  balance,
  buildInvestSteps,
  onInvested,
  resumeAmount,
  depositOrigin,
}: InvestModalProps) {
  const t = useTranslations("strategies");
  // Receipt dates render in the ACTIVE locale (a hard-coded en-US date on a pt-BR receipt is the
  // semantic-i18n class i18n:check cannot catch).
  const format = useFormatter();
  const router = useRouter();
  const { track } = useAnalytics();
  // POO-853 [R6]: log a referred wallet's add-liquidity to the referral operation feed (real-only,
  // deduped, fire-and-forget); no-ops for non-referred wallets and in mock mode.
  const logReferralOp = useReferralOperationLog();
  const [phase, setPhase] = useState<Phase>("amount");
  const [amountText, setAmountText] = useState("");
  const [slippage, setSlippage] = useState<number>(DEFAULT_SLIPPAGE_PCT);
  // POO-419: pre-flight gate (dark-launched flag) — decides confirm → provision → pending.
  // POO-1042 [R2]: the operation's own network rides in, so the gate reads live balances for THIS
  // strategy's chain rather than a default. `enabled` keeps the read to while the sheet is open.
  const gate = useProvisioningGate({
    op: "invest",
    network: strategy.network,
    enabled: open,
    slippagePct: slippage,
  });
  const [deadlineMins, setDeadlineMins] = useState(30);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [txError, setTxError] = useState<TxError | null>(null);
  // The on-chain hash (mock path uses settleTxHash()).
  const [txHash, setTxHash] = useState<string | null>(null);
  // POO-383 R9: the USD actually deployed (mock = full via settleDeployedUsd; real = the
  // add-liquidity result). When it lands below the requested amount, success shows a partial banner.
  const [deployedUsd, setDeployedUsd] = useState<number | null>(null);
  // Post-write freshness: refetch positions + catalog + re-render, with a bounded poll (POO-364).
  const postWriteRefresh = usePostWriteRefresh(onInvested);

  // On success, surface the owned state without a manual reload.
  useEffect(() => {
    if (phase !== "success") return;
    postWriteRefresh();
  }, [phase, postWriteRefresh]);

  const amount = Number.parseFloat(amountText) || 0;
  // Platform-wide minimum (env-configurable, default 10; dev lowers it). Managers may require more,
  // never less (POO-184 R1).
  const effectiveMin = Math.max(MIN_AMOUNT_FOR_ADD_LIQUIDITY, strategy.minInvestment);
  const belowMin = amount > 0 && amount < effectiveMin;
  const needsDeposit = amount > balance;
  const shortfall = Math.max(0, amount - balance);
  const meetsMin = amount >= effectiveMin;
  const estYield = (amount * strategy.estReturn) / 100;
  // POO-819 R4: real mode carries the lock-up TOP-LEVEL (the mapper never sets `detail`), so read it
  // top-level first and fall back to the mock prospectus `detail.lockupDays` for mock parity.
  const lockupDays = strategy.lockupDays ?? strategy.detail?.lockupDays ?? 0;
  // POO-481 R3: real mode carries the pair top-level only (the mapper never sets `detail`).
  const poolPair = strategy.detail?.poolPair ?? strategy.poolPair;

  // The gear slippage read at run time by the mock confirm step (POO-499 R6), kept out of the step deps.
  const slippageRef = useRef(slippage);
  slippageRef.current = slippage;
  // Real per-step progression via the runner (FU-001): approve (self-skips) → permit → build → send
  // in real mode, or the mock 4-step walk in mock mode. Steps rebuild when amount / slippage change.
  const investSteps = useMemo<FlowStep<InvestCtx>[]>(
    () =>
      buildInvestSteps ? buildInvestSteps(amount, slippage) : mockInvestSteps(slippageRef, amount),
    [amount, slippage, buildInvestSteps],
  );
  // POO-598: the flow PAUSES after the `build` step (pauseAfterKey), so the Review renders the built
  // figures before the send. approve + Permit2 necessarily run before the pause (the build consumes
  // the permit signature), during the `building` phase.
  const flow = useWalletSignFlow(investSteps, {
    fallbackErrorCode: "INVEST_FAILED",
    pauseAfterKey: "build",
  });
  // POO-514 R3 (mirrors WithdrawModal / POO-505 R3): real mode is any provided step builder.
  const isReal = buildInvestSteps != null;
  // POO-598 R3 reshaped by POO-801 R6: the network-fee line reads the BUILT gas. Mock mode (whose
  // build carries no estimate) keeps the honest PP-MOCK figure; real mode NEVER falls back to it —
  // a real build without `estimatedGasInUsd` hides the line instead of fabricating $0.30
  // (POO-799 global directive #1).
  const networkFeeUsd =
    flow.context.built?.estimatedGasInUsd ?? (isReal ? undefined : NETWORK_FEE_USD);
  // POO-606: "You will invest at least" — the slippage-protected minimum that lands in the pool. Once
  // the build has run, use the server's authoritative figure (`swapInfo.minAmountInStable`, in USD,
  // already net of slippage + protocol fee), which POO-515 R1 always intended to consume ("the real
  // minimum comes from the server build's swap quote when it lands"). In mock mode the build attaches
  // a real-shaped `settleSwapInfo(...)` (POO-611, mirroring Withdraw/Remove POO-612), so this reads the
  // mock server min too. Before the build (no `built` yet) / on a degenerate 0 it degrades to the
  // client gear-slippage estimate (fees kept out of that estimate to avoid double-counting the
  // informational Fee row). The `> 0` guard keeps a missing/zero quote on the estimate.
  const builtMinDeployUsd = flow.context.built?.swapInfo?.minAmountInStable;
  const deployAtLeast =
    builtMinDeployUsd != null && builtMinDeployUsd > 0
      ? builtMinDeployUsd
      : Math.max(0, amount * (1 - slippage / 100));
  // POO-800 R4: the swap figures behind the Review's price-impact row. Only the BUILT quote feeds it
  // (real server build, or the real-shaped mock settleSwapInfo) — pre-build there is no row, never a
  // fabricated figure (POO-799 global directive #1).
  const swapInfo = flow.context.built?.swapInfo;
  // POO-1011: the catastrophic price-impact gate (>= 10% blocks the Review CTA behind an explicit
  // funds-at-risk acknowledgment; the 2% amber row is unchanged).
  const impactGate = usePriceImpactGate(swapInfo?.priceImpactPercentage, phase === "review");
  // POO-905 R3/R4: pre-build, the protocol fee is ESTIMATED from the API-served rate
  // (`strategy.protocolFeePct`, percent — the pp-api PROTOCOL_FEE constant on v2 rows). Absent rate
  // (older backend / the v1 fallback, which serves none) → undefined → no line, exactly the prior
  // behavior: never a client-side constant fallback (POO-799 global directive #1).
  const protocolFeeEstimateUsd =
    strategy.protocolFeePct != null ? (amount * strategy.protocolFeePct) / 100 : undefined;
  // POO-801 R6: the ONE canonical fee tooltip (POO-800 R2) — protocol fee in USD from the built
  // `swapInfo.protocolFee` (mock mode's settleSwapInfo is real-shaped), gas from the built estimate.
  // The hardcoded DEX/protocol percent math is gone. POO-905 R3: until the build lands a swapInfo
  // with the authoritative figure, the served-rate estimate fills the line; the built figure wins
  // as soon as it exists (`??`, so a built $0 still wins over the estimate).
  // PP-INTEGRATION-POINT: `dexUsd` joins from the build's swap-route fee when POO-521 lands
  // (POO-799 decision #1 — never a hardcoded stand-in). Invest is same-chain: no bridge line.
  const feeLines = buildCanonicalFeeLines({
    labels: {
      dex: t("flow.feesTooltip.dex"),
      network: t("flow.feesTooltip.network"),
      protocol: t("flow.feesTooltip.protocol"),
      performance: t("flow.feesTooltip.performance"),
      bridge: t("flow.feesTooltip.bridge"),
      comingSoon: t("flow.feesTooltip.comingSoon"),
    },
    networkUsd: networkFeeUsd,
    protocolUsd: swapInfo?.protocolFee ?? protocolFeeEstimateUsd,
  });
  // POO-445 R4/R5: one neutral (never red) consolidated fee row; hidden when no figure exists.
  const estFeeRow =
    feeLines.length > 0
      ? [
          buildFeeRow({
            label: t("invest.confirm.fee"),
            lines: feeLines,
            totalLabel: t("flow.feesTooltip.total"),
          }),
        ]
      : [];
  // The receipt's final "Fee" (R10): same canonical lines — what was actually charged.
  const receiptFeeRow =
    feeLines.length > 0
      ? [
          buildFeeRow({
            label: t("flow.receipt.fee"),
            lines: feeLines,
            totalLabel: t("flow.feesTooltip.total"),
          }),
        ]
      : [];
  // POO-801 R4 (POO-799 decision #7): the gear slippage as a detail row — "Auto" badge while the
  // default applies, plain percent once customized.
  const maxSlippageRow = buildMaxSlippageRow({
    label: t("flow.review.maxSlippage"),
    slippagePct: slippage,
    autoLabel: slippage === DEFAULT_SLIPPAGE_PCT ? t("flow.review.slippageAuto") : undefined,
  });
  // POO-800 R4 / POO-613: the swap's price impact (amber >= 2%) — hidden until a real figure exists.
  const priceImpactRow =
    swapInfo != null
      ? [buildPriceImpactRow(t("flow.review.priceImpact"), swapInfo.priceImpactPercentage)]
      : [];
  // POO-598 R4: the shared Review re-quote countdown — active on the Review; on each zero-crossing it
  // re-quotes via flow.rebuild() (re-runs ONLY the build, reusing the signed approve/permit) + resets.
  // POO-888 R3: the Confirm click suspends it synchronously (a same-tick zero-crossing must not fire
  // a re-quote against the just-dispatched send).
  const { seconds: countdown, suspend: suspendCountdown } = useReviewCountdown({
    active: phase === "review",
    seconds: REVIEW_REFRESH_SECS,
    onRefresh: flow.rebuild,
  });
  // POO-499 (POO-467 R2/R3): the shared slippage auto-retry orchestration — one automatic retry from
  // the build step on the first slippage failure (pending notice, no error view), then a slippage
  // error view + settings auto-open on the second. Owns the one-shot; the modal only contributes its
  // gear slippage + the settings opener. Non-slippage failures pass through untouched (R4).
  const slippageRetry = useSlippageAutoRetry({
    flow,
    flowName: "invest",
    strategyId: strategy.id,
    slippagePct: slippage,
    onOpenSettings: () => setSettingsOpen(true),
  });
  // POO-461 R3: kind-aware error body (generic copy when the failure didn't classify). POO-499 R3:
  // the second slippage failure swaps in the slippage-specific copy (interpolating the gear value).
  const genericErrorBody = useTxErrorBody(txError);
  const errorTitle = slippageRetry.slippageError
    ? t("flow.slippage.errorTitle")
    : t("flow.error.title");
  const errorBody = slippageRetry.slippageError
    ? t("flow.slippage.errorBody", { value: slippageRetry.slippagePct })
    : genericErrorBody;
  const stepLabels = resolveWalletSignSteps(INVEST_SPEC, t);
  // POO-514 R3: the receipt hash is real-only in real mode — the constant mock settleTxHash()
  // never renders there; mock mode keeps it. The explorer link (ExplorerTxLink, R2) derives from
  // the strategy's network and renders only when both exist.
  const receiptHash = txHash ?? (!isReal ? settleTxHash() : null);

  // Track the invest flow opening (once per open).
  useEffect(() => {
    if (open) track("strategy_invest_started", { strategy_id: strategy.id });
  }, [open, track, strategy.id]);

  // Resume after a Deposit & invest top-up: the chosen amount comes back from the parent (?invest=),
  // so the investor lands on the AMOUNT step with it prefilled instead of retyping (POO-281 R3).
  // POO-598 R6: it stays on the amount step (NOT auto-building) — tapping "Invest" starts the
  // approve/permit signatures, so a resume must not auto-trigger the wallet. Runs once per open; a
  // normal open (no resumeAmount) is untouched.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      resumedRef.current = false;
      return;
    }
    if (resumedRef.current || !resumeAmount || resumeAmount <= 0) return;
    resumedRef.current = true;
    setAmountText(amountToText(resumeAmount, 6));
    // POO-494 R6: the round-trip resume is a distinct funnel step, tracked once per resume.
    track("strategy_invest_resumed", {
      strategy_id: strategy.id,
      value: resumeAmount,
      currency: "USD",
      usd_value_at_time: resumeAmount,
    });
  }, [open, resumeAmount, track, strategy.id]);

  // POO-598: drive the build outcome. approve → Permit2 → build run in `building`; when the build
  // settles the flow pauses (`awaiting`) and we advance to the Review reading the built figures. A
  // failure at any pre-send step (a rejected approve/permit, or a failed build/rebuild) surfaces the
  // error view instead of a blank dead-end.
  useEffect(() => {
    if (phase === "building" && flow.status === "awaiting") {
      setPhase("review");
    } else if ((phase === "building" || phase === "review") && flow.status === "error") {
      setTxError(flow.error);
      setPhase("error");
      // A pre-send failure (rejected approve/permit, or a failed build/rebuild) is still a failed
      // invest attempt after `submitted` fired — emit it, mirroring the old all-in-pending behavior.
      // Build steps never carry a slippage code (nothing executed on-chain yet), so the send-only
      // slippage auto-retry does not apply here.
      track("strategy_invest_failed", {
        strategy_id: strategy.id,
        value: amount,
        currency: "USD",
        usd_value_at_time: amount,
      });
    }
  }, [phase, flow.status, flow.error, track, strategy.id, amount]);

  // Drive phase + analytics off the runner's outcome (the send resumed by the Review CTA / retry).
  // Each real step reflects its true settlement; a thrown send surfaces the real failure via
  // flow.error rather than a blank dead-end.
  useEffect(() => {
    if (phase !== "pending") return;
    if (flow.status === "success") {
      if (flow.txHash) setTxHash(flow.txHash);
      // POO-810 R4 (supersedes POO-801's dormant-in-real behavior): the REAL deployed USD =
      // requested − USDC refunded to the wallet (decoded from the receipt). A partial fill (market
      // movement / slippage) leaves a remainder that stays in the wallet, so deployed < requested and
      // the partial-fill banner activates truthfully. When the logs are unavailable / nothing decoded
      // (no USDC refund leg), or in mock mode, fall back to the pre-broadcast figure via
      // settleDeployedUsd (never blank / $0; R9 → full fill, banner dormant).
      const refundUsd = isReal ? flow.context.decoded?.usdcUsd : undefined;
      setDeployedUsd(
        refundUsd != null ? Math.max(0, amount - refundUsd) : settleDeployedUsd(amount),
      );
      setPhase("success");
      track("strategy_invest_completed", {
        strategy_id: strategy.id,
        value: amount,
        currency: "USD",
        usd_value_at_time: amount,
      });
      // POO-853 [R6]: record this add-liquidity to the referral operation feed (best-effort).
      logReferralOp({
        operation: "ADD_LIQUIDITY",
        amountUsd: amount,
        txHash: flow.txHash ?? "",
        positionInfo: { strategyId: strategy.id },
      });
      // POO-853 [R5]: belt-and-braces — if a referral code is still pending and this first invest cleared
      // the 20-USDC floor, re-run the idempotent apply so a missed visit-time capture still counts.
      if (isReal && qualifiesForApplyRetry(amount, readPendingReferralCode() !== null)) {
        void applyReferralCodeAction().catch(() => {});
      }
    } else if (flow.status === "error") {
      // POO-499 R2: the FIRST slippage failure auto-retries — keep the pending phase (the notice
      // renders there), do not flip to the error view and do not emit the failure event yet.
      if (slippageRetry.autoRetrying) return;
      setTxError(flow.error);
      setPhase("error");
      track("strategy_invest_failed", {
        strategy_id: strategy.id,
        value: amount,
        currency: "USD",
        usd_value_at_time: amount,
      });
    }
  }, [
    flow.status,
    flow.txHash,
    flow.error,
    // POO-810 R4: the decoded USDC refund drives the real deployed figure on success.
    flow.context.decoded,
    isReal,
    slippageRetry.autoRetrying,
    phase,
    track,
    strategy.id,
    amount,
    logReferralOp,
  ]);

  function handleOpenChange(next: boolean) {
    // POO-419 R3: no dismissal while provisioning is executing (ESC / overlay / X are all blocked).
    if (!next && gate.locked) return;
    onOpenChange(next);
    if (!next) {
      setSettingsOpen(false);
      flow.reset();
      // Reset for the next open (after the close animation).
      setTimeout(() => {
        setPhase("amount");
        setAmountText("");
        setSlippage(DEFAULT_SLIPPAGE_PCT);
        setDeadlineMins(30);
        setTxHash(null);
        setDeployedUsd(null);
        gate.reset();
      }, 150);
    }
  }

  /**
   * POO-598 R1/R5/R7: fired once at the flow-start CTA (NOT the Review approve), because
   * approve/permit run before the review. POO-1025 R4: an invest is only "submitted" when one
   * actually starts, so the deposit bailout below does not fire it.
   */
  function trackInvestSubmitted() {
    track("strategy_invest_submitted", {
      strategy_id: strategy.id,
      value: amount,
      currency: "USD",
    });
  }

  function handlePrimary() {
    // POO-1025 R1: when the wallet is short on this chain, consult the provisioning gate BEFORE the
    // deposit round trip. Previously this early-returned to /deposit and the gate at the bottom of
    // this function was never reached for a short wallet, so the invest USDC/network branch was dead
    // code: a user holding funds on another chain was told to go buy more fiat instead of being
    // offered the money they already have.
    if (needsDeposit) {
      if (gate.evaluate(amount)) {
        trackInvestSubmitted();
        setPhase("provision");
        return;
      }
      // POO-1025 R2/R3: nothing to provision from, so the deposit deep link stays the fallback, with
      // its query contract untouched. Carry the shortfall (prefill) + the CHOSEN amount so the
      // post-payment "Invest now" returns with the full amount (POO-281 R2/R3). POO-520 R1: a
      // manager-console launch carries its origin so the resume returns to the console manage view;
      // the investor URL stays origin-free (R2).
      handleOpenChange(false);
      const originParam = depositOrigin === "manager" ? "&origin=manager" : "";
      router.push(
        `/deposit?strategy=${strategy.id}&amount=${shortfall}&invest=${amount}${originParam}`,
      );
      return;
    }
    trackInvestSubmitted();
    // POO-419: the wallet holds enough USDC here, but may still be short on gas or on the wrong
    // network. Provision first, then run the invest with its original amount + slippage (params
    // preserved, R2).
    if (gate.evaluate(amount)) {
      setPhase("provision");
      return;
    }
    setPhase("building");
    void flow.run();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        {phase === "amount" ? (
          <>
            {/* POO-570 R1: the settings gear (slippage + deadline) lives on this input step, next to
                the Dialog X — not on the confirm/review step. */}
            <TransactionModalHeader
              title={t("invest.title")}
              onSettings={() => setSettingsOpen(true)}
              settingsLabel={t("invest.settings.title")}
            />
            <StrategyMiniHeader strategy={strategy} />

            <div className="mt-2 flex flex-col gap-5">
              <div className="text-center">
                <p className="text-muted-foreground text-sm">{t("invest.amountLabel")}</p>
              </div>
              <AmountField
                value={amountText}
                onValueChange={setAmountText}
                increments={[50, 100, 250]}
                maxValue={balance}
                maxLabel={t("invest.max")}
                ariaLabel={t("invest.amountLabel")}
                // USDC has 6 decimals: Max fills the exact wallet balance (e.g. 38.005424), so the
                // Permit2 signs what the user actually holds, not a 2dp truncation (POO-303).
                maxFractionDigits={6}
              />
              {/* Tapping the wallet balance fills the amount with the full spendable balance — same
                  as the Max chip (6dp = USDC decimals, so it signs the exact amount; POO-303). */}
              <button
                type="button"
                onClick={() => setAmountText(amountToText(balance, 6))}
                className="mx-auto rounded-md text-center text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("invest.balance", { amount: formatUsdPrecise(balance) })}
              </button>

              {belowMin ? (
                <p className="rounded-md bg-warning/10 px-3 py-2 text-center text-warning text-sm">
                  {t("invest.belowMin", { min: formatUsd(effectiveMin) })}
                </p>
              ) : null}
              {!belowMin && needsDeposit ? (
                <p className="rounded-md bg-warning/10 px-3 py-2 text-center text-warning text-sm">
                  {t("invest.needMore", { amount: formatUsd(shortfall) })}
                </p>
              ) : null}

              <Button className="w-full" size="lg" disabled={!meetsMin} onClick={handlePrimary}>
                {needsDeposit ? t("invest.cta.deposit") : t("invest.cta.invest")}
              </Button>
            </div>
          </>
        ) : null}

        {phase === "building" ? (
          <>
            {/* POO-598 R2: approve → Permit2 → build run here. The WalletSteps stepper (NOT a bare
                spinner) keeps the two real wallet prompts legible; when the build settles the flow
                pauses and the effect advances to the Review. */}
            <DialogHeader className="sr-only">
              <DialogTitle>{t("flow.processing")}</DialogTitle>
            </DialogHeader>
            <StrategyMiniHeader strategy={strategy} />
            <WalletSteps
              steps={stepLabels}
              activeStep={flow.activeStep}
              statuses={flow.statuses}
              txHashes={flow.txHashes}
            />
          </>
        ) : null}

        {phase === "review" ? (
          <>
            {/* POO-598 R3: the single confirmation surface (the old pre-sign confirm is gone). The gear
                stays on the amount step (POO-570); this header only carries Back → amount. */}
            <TransactionModalHeader
              title={t("invest.review.title")}
              onBack={() => setPhase("amount")}
              backLabel={t("invest.confirm.back")}
            />
            <StrategyMiniHeader strategy={strategy} />

            {/* POO-598 R4: the visible re-quote countdown — the built figures refresh when it hits 0. */}
            <p className="flex items-center justify-center gap-1.5 text-muted-foreground text-xs">
              <RefreshCw className="size-3.5" aria-hidden="true" />
              {t("flow.review.refreshIn", { seconds: countdown })}
            </p>
            {/* POO-885 R2: subtle stale-quote hint after 3 consecutive background re-quote failures
                (the flow keeps the last good quote and retries each window; nothing is fatal). */}
            {flow.quoteStale ? (
              <p className="text-center text-warning text-xs">{t("flow.review.quoteStale")}</p>
            ) : null}

            {/* POO-279 ReceiptRows (main) + POO-280 R6 (this branch): no "Receive as" on invest —
                investing deploys into the pool's tokens, there is nothing to choose. */}
            {/* POO-801 R7 (reshapes the POO-383 redesign): the shared collapsible card — the hero
                summary stays visible; the fee detail (Est. fee · Max. slippage · Price impact)
                sits behind Show more. R1/R2: the "Pay from" and "Deployed as" rows are gone. */}
            <CollapsibleReceiptRows
              className="mt-2"
              summary={[
                [
                  {
                    label: t("invest.confirm.youInvest"),
                    value: (
                      // POO-842 R5: flex-wrap + justify-end — the 6dp amount plus the ≈USD suffix
                      // overflowed the card at 375px with Max-filled balances; wrapping keeps the
                      // receipt value right-aligned instead of clipping.
                      <span className="inline-flex flex-wrap items-baseline justify-end gap-1.5">
                        {/* 6dp = USDC decimals: show the full signed amount, not a 4dp truncation,
                            so the hero matches what Permit2 signs (e.g. 38.005424, POO-303). */}
                        {formatTokenAmount(amount, "USDC", 6)}
                        <span className="text-muted-foreground text-xs">
                          {t("invest.confirm.approxUsd", { usd: formatUsd(amount) })}
                        </span>
                      </span>
                    ),
                  },
                  {
                    label: t("invest.confirm.estYield"),
                    value: formatSignedUsd(estYield),
                    tone: "positive",
                  },
                  {
                    // POO-515 R1 / POO-801 R3: the slippage-protected minimum ("You will invest at
                    // least"), the server's authoritative figure once built.
                    label: t("invest.confirm.deployAtLeast"),
                    value: t("invest.confirm.approxValue", {
                      amount: formatTokenAmount(deployAtLeast, "USDC"),
                      usd: formatUsd(deployAtLeast),
                    }),
                    tone: "emphasis",
                  } satisfies ReceiptRowItem,
                ],
                [
                  {
                    label: t("invest.confirm.lockup"),
                    value:
                      lockupDays > 0
                        ? t("detail.lockup.days", { days: lockupDays })
                        : t("detail.lockup.none"),
                  },
                ],
              ]}
              details={[[...estFeeRow, maxSlippageRow, ...priceImpactRow]]}
              showMoreLabel={t("flow.review.showMore")}
              showLessLabel={t("flow.review.showLess")}
            />

            {/* POO-1011 [R2]: the funds-at-risk gate renders ABOVE the fold (never inside the
                collapsible details, where the POO-1010 incident's 92.41% was hidden). */}
            <PriceImpactGate
              priceImpactPct={swapInfo?.priceImpactPercentage}
              acknowledged={impactGate.acknowledged}
              onAcknowledgedChange={impactGate.setAcknowledged}
            />

            {poolPair ? (
              <p className="rounded-md bg-surface-raised px-3 py-2 text-muted-foreground text-xs">
                {t("invest.confirm.zapNote", {
                  token0: poolPair.token0,
                  token1: poolPair.token1,
                })}
              </p>
            ) : null}

            <Button
              className="mt-2 w-full"
              size="lg"
              disabled={impactGate.blocked}
              onClick={() => {
                // POO-598 R5: the tx is already built (we paused after build); approving resumes into
                // the wallet send step. The build is not re-run, and the submitted event + gate
                // already fired on the amount "Invest" CTA (R1/R7) — not here.
                // POO-888 R3: suspend the re-quote countdown SYNCHRONOUSLY before anything else, so a
                // zero-crossing in this same tick cannot race the send.
                suspendCountdown();
                setPhase("pending");
                void flow.resume();
              }}
            >
              {t("invest.review.cta")}
            </Button>
          </>
        ) : null}

        {/* POO-419: pre-flight provisioning — top up gas / USDC / switch network, then run the invest. */}
        {phase === "provision" && gate.input ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>{t("provisioning.plan.title")}</DialogTitle>
            </DialogHeader>
            <StrategyMiniHeader strategy={strategy} />
            <ProvisioningPanel
              input={gate.input}
              context={gate.context}
              // POO-1043 [R7]: what the recovery journal records this funding route as, so a killed
              // tab mid-bridge has an in-flight record that names the operation it was funding.
              operation={{ kind: "invest", strategyId: strategy.id }}
              opLabel={t(provisioningOpLabelKey("invest"), { strategy: strategy.name })}
              onDone={() => {
                gate.setLocked(false);
                // POO-598 R7: build first (approve → permit → build), then pause at the Review — do
                // NOT jump straight to signing the send.
                // POO-1043 [R1]/[R2]/[R4]: `run()` and not `resume()`, which is what makes all three
                // true at once. The steps are memoised on the ORIGINAL amount + slippage, so they
                // resume unchanged [R1]; the send is the last step and only the Review's CTA reaches
                // it [R2]; and a full run rebuilds, so a provisioning wait of any length (a bridge is
                // minutes) can never leave a build older than MAX_BUILT_TX_AGE_MS to be signed [R4].
                setPhase("building");
                void flow.run();
              }}
              onCancel={() => setPhase("amount")}
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
            {/* POO-499 R2: the auto-retry notice sits in the pending view (the flow re-runs from build;
                the notice makes the possible wallet re-prompt legible). */}
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
              <DialogTitle>{t("invest.success.title")}</DialogTitle>
            </DialogHeader>
            <TransactionStatus
              phase="success"
              title={t("invest.success.title")}
              body={t("invest.success.body", {
                amount: formatUsd(deployedUsd ?? amount),
                name: strategy.name,
              })}
            >
              {/* POO-383 R9: partial-investment banner when less than the requested amount deployed
                  (market movement + slippage left a remainder in the wallet). */}
              {deployedUsd != null && deployedUsd < amount ? (
                <p className="rounded-md bg-warning/10 px-3 py-2 text-warning text-sm">
                  {t("invest.success.partial", {
                    deployed: formatUsd(deployedUsd),
                    requested: formatUsd(amount),
                  })}
                </p>
              ) : null}
              {/* POO-801 R9/R10/R12 (reshapes POO-279 R7/R8): the shared collapsible receipt —
                  Strategy + "Amount Invested" visible; the final Fee + Slippage + Price impact
                  behind Show more; Date + Transaction never collapse. */}
              <CollapsibleReceiptRows
                summary={[
                  [
                    {
                      label: t("flow.receipt.strategy"),
                      value: formatIdentityLabel(strategy.name),
                    },
                    {
                      // PP-INTEGRATION-POINT: the real executed deployed USD (POO-810 / POO-397)
                      // replaces the requested figure here and unlocks the "why less" tooltip (R9).
                      label: t("invest.receipt.amountInvested"),
                      value: formatUsd(deployedUsd ?? amount),
                    },
                  ],
                ]}
                details={[
                  [
                    ...receiptFeeRow,
                    buildMaxSlippageRow({
                      label: t("flow.receipt.slippage"),
                      slippagePct: slippage,
                    }),
                    ...priceImpactRow,
                  ],
                ]}
                after={[
                  [
                    {
                      label: t("flow.receipt.date"),
                      value: format.dateTime(new Date(), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }),
                    },
                    // POO-514 R1/R3: always the truncated flow hash — never the mock constant in
                    // real mode (a real flow without a hash yields no row, no fabricated tx).
                    ...(receiptHash
                      ? [
                          {
                            label: t("flow.receipt.transaction"),
                            value: formatTxHash(receiptHash),
                          } satisfies ReceiptRowItem,
                        ]
                      : []),
                  ],
                ]}
                showMoreLabel={t("flow.review.showMore")}
                showLessLabel={t("flow.review.showLess")}
              />
              {/* POO-801 R11 (POO-799 decision #4): no Done button — the receipt closes via the X
                  (or navigates via View position). */}
              <Button
                className="w-full"
                size="lg"
                onClick={() => {
                  handleOpenChange(false);
                  // Land on (or stay on) the strategy detail, now showing the owned position.
                  router.push(`/strategies/${strategy.id}`);
                }}
              >
                {t("flow.viewPosition")}
              </Button>
              {/* POO-514 R2: the shared explorer link on the strategy's network (/tx/{hash}). */}
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
                  // POO-887 R1/R2: a pre-Review failure (e.g. a cancelled permit) retries back
                  // THROUGH the Review gate - phase "building" re-engages the awaiting → review
                  // mapping while the flow re-pauses. A post-Review retry keeps the pending stepper.
                  setPhase(flow.retryWillPause ? "building" : "pending");
                  // POO-499 R3: after a slippage error + raising the gear, Try again re-runs from the
                  // build step with the rebuilt steps carrying the new slippage. R4: a non-slippage
                  // failure keeps today's resume-from-failed-step.
                  if (slippageRetry.slippageError) void flow.retryFrom("build");
                  else void flow.retry();
                }}
                error={txError ?? undefined}
              />
            </TransactionStatus>
          </>
        ) : null}
      </DialogContent>
      {/* No "Receive as" here: investing deploys into the pool's tokens, there is nothing to choose
          (POO-280 R6). Collect keeps the section. */}
      <TransactionSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        slippage={slippage}
        onSlippageChange={setSlippage}
        deadlineMins={deadlineMins}
        onDeadlineChange={setDeadlineMins}
      />
    </Dialog>
  );
}
