/**
 * @id PP-STR-MOD-003
 * @name CollectModal
 * @implements-rules-version v11 (POO-827 rules v1; POO-923 R3: no "after fees" caption on the pair payout)
 *
 * Claim the available yield from an owned position: confirm → pending → success. Collect takes only
 * the earned yield and leaves the principal invested (made explicit in the copy), then routes the
 * proceeds to the wallet's USDC balance. The network fee (gas) is paid by the user.
 *
 * Also serves the MANAGER collecting a strategy's accrued pool fees (POO-286 R1) via `managed`:
 * same dialog, manager data, no performance-fee row (the manager doesn't pay it to themselves),
 * the real gas estimate as the network fee, and the actual service mutation during "pending".
 *
 * 2026-06-28 redesign (POO-384): the breakdown's first row is "Amount" (R2); fees collapse into a
 * single "Fees" line with an info tooltip splitting DEX + Protocol fee (0.25%) + Total (R3); "You
 * receive" shows the USDC amount with the USD value discreet (R5); the investor ⚙ offers Slippage +
 * Deadline + Receive as (R6, intentionally restoring what POO-280 R5d had removed).
 *
 * 2026-06-30 (POO-417): the receive-as choice is now USDC ↔ the pool TOKEN PAIR, wired for real on
 * BOTH the investor and manager paths. Choosing the pair flips the build-tx `shouldSwapFees` to false
 * (R2) and turns "You receive" into the per-token rows (token0/token1 amount, amounts only — no
 * per-token USD; R3) via {@link TokenAmountRows}; no swap means no DEX fee (R4). The manager gear is
 * ungated when its pool exposes the per-token claimable (`managed.feeTokens`); it stays hidden
 * otherwise (and for any path with no per-token data, the dialog degrades to USDC-only, R6c). This
 * supersedes POO-384 R7's even-split strategy-token mock.
 *
 * v4 (POO-468 R1): `onCollected` fires EXACTLY ONCE per collect when an INVESTOR collect reaches
 * success, so the detail screen can arm its optimistic claimable reset. Deliberately separate from
 * `onChanged`: usePostWriteRefresh re-invokes that on every poll tick, so it must never arm the
 * override. Managed mode never fires it (the console owns its own optimistic patch).
 *
 * v5 (POO-478 R1/R2): SUPERSEDES POO-384 R6 / POO-417 R1's manager-gearless collect. The settings
 * gear now renders for BOTH investor and manager (a manager collect-as-USDC swaps the pool fees, so
 * slippage matters). The gear always exposes Max slippage + Transaction deadline; the manager path
 * SEEDS MANAGER_DEFAULT_SLIPPAGE_PCT (5), the investor DEFAULT_SLIPPAGE_PCT (2). POO-547: the custom
 * slippage input is now uniform (0.1-100%) for both roles — 5% is the manager seed, not a cap.
 * `managed.onCollect` gains a `slippageTolerance` arg, threaded from the gear into the manager collect
 * build (buildCollectFeesTxAction).
 *
 * v6 (POO-525 R2): the managed gear NEVER loses its Receive-as section. When the managed detail
 * lacks per-token fee data (no pair label), the section renders as a FIXED, non-interactive
 * USDC-only display (TransactionSettingsDialog without onReceiveAsChange) instead of disappearing;
 * the interactive USDC-vs-pair picker still requires the per-token data (POO-417 R1).
 *
 * v7 (POO-516 R1/R2/R4): "You receive at least" on the USDC-swap path is now a REAL minimum,
 * claimable x (1 - slippage) - DEX fee - 0.25% protocol fee, recomputed live from the gear slippage
 * in effect for the role and on the receive-as toggle — both roles (investor + manager). The DEX
 * fee's INTERIM source is the strategy pool's own fee tier (investor `strategy.poolFeeBps`, manager
 * `managed.feeBps`), falling back to the mocked DEX_FEE_PCT; the real value is the swap ROUTE's fee
 * tier from the build/simulation response (POO-521). The pair path applies no DEX fee and no
 * slippage haircut (R4). The CTA, the `confirmedAmount` receipt snapshot and analytics keep the
 * CLAIMABLE figure — the minimum is a confirm-view display only.
 *
 * v8 (POO-615, rules v1): the build->review->sign handshake (POO-574, rolled out from Withdraw via
 * the Remove/Move Range analogs). The `build` step now runs BEFORE the Review — the flow pauses via
 * `pauseAfterKey`, so the Review shows the BUILT figures (gas = `flow.context.built?.estimatedGasInUsd`,
 * else the honest NETWORK_FEE_USD / managed gas estimate) with a 10s re-quote countdown (the shared
 * useReviewCountdown); the wallet send is only called on the Review approve (flow.resume), and the
 * POO-419 gas gate moves off the confirm CTA onto that approve (build ungated → gate → resume). The
 * confirm CTA starts the build (flow.run); the Review's price-impact row + folded protocol-fee / min
 * come from the mock build's real-shaped `swapInfo` (settleSwapInfo, USDC-swap path only — the
 * token-pair payout has no swap so swapInfo stays undefined, POO-417 R4). Uses the shared
 * BuildingStep + `flow.review.refreshIn` / `flow.review.priceImpact` keys (POO-595 / POO-613).
 * POO-600: the Review header carries ONLY Back — the settings gear stays on the confirm step.
 *
 * v9 (POO-802, rules v1, 0710 overhaul): the REAL executors are SPLIT (R0) — `buildCollectSteps`
 * (investor, useCollectFees.buildSteps) / `managed.buildSteps` (useManagerCollect.buildSteps)
 * supply [build, confirm:collect] where build sets `ctx.built` from the real server build, so the
 * Review pauses on REAL gas/protocol/price-impact/min instead of the mock walk; the mock walk
 * stays for mock mode only. The confirm view drops "You receive at least" + "Est. fee" (R1); the
 * Review adopts the shared collapsible card (R4): "Amount requested" (R3) visible, Est. fee /
 * Max. slippage (Auto badge) / Price impact behind Show more, Receive as + the cross-flow captions
 * ("after fees…" + "≈ X USDC · Arrives instantly", the min-received indicator replacing the old
 * row, R2) below. The receipt (R6/R7/R9) shows "Amount Received" + the final "Fee" (canonical
 * breakdown; the performance fee joins from the backend, POO-811) behind Show more, and drops the
 * "$X was added to your balance" body (R8). The hardcoded PROTOCOL_FEE_PCT/DEX_FEE_PCT client math
 * is gone (POO-799 decision #1; the DEX line returns from the build route via POO-521); the $0.30
 * gas figure is mock-only. R10: collects under MIN_COLLECT_USD ($0.10 PROD) disable the CTA.
 *
 * v10 (POO-827, rules v1): the canonical fee tooltip consumes the build's `performanceFeeInUsd`
 * estimate (POO-811) — the Performance line renders after Protocol on the investor's Review +
 * receipt tooltips; absent field (manager collect / no fee) = no line; the mock build attaches a
 * deterministic settlePerformanceFeeUsd cut so mock mode demos it.
 *
 * POO-853 [R6] (referral parity, rules v1): on a confirmed INVESTOR collect (never a manager collect),
 * logs COLLECT_FEES to the referral operation feed (`useReferralOperationLog`, real-only + deduped).
 */
"use client";

import { RefreshCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { StrategyLogo } from "@/components/data-display/StrategyLogo";
import { TokenAmountRows } from "@/components/data-display/TokenAmountRows";
import { BuildingStep } from "@/components/ui/BuildingStep";
import { Button } from "@/components/ui/Button";
import { CollapsibleReceiptRows } from "@/components/ui/CollapsibleReceiptRows";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { ExplorerTxLink } from "@/components/ui/ExplorerTxLink";
import { type ReceiptRowItem, ReceiptRows } from "@/components/ui/ReceiptRows";
import { TransactionModalHeader } from "@/components/ui/TransactionModalHeader";
import { useReferralOperationLog } from "@/features/rewards/hooks/useReferralOperationLog";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { MIN_COLLECT_USD } from "@/lib/config/operationMinimums";
import type { ClaimableFeeToken, Position, Strategy } from "@/lib/schemas";
import type { TxError } from "@/lib/tx/diagnostics";
import type { ReceivedLegsResult } from "@/lib/tx/receivedAmounts";
import { usePostWriteRefresh } from "@/lib/tx/usePostWriteRefresh";
import {
  formatIdentityLabel,
  formatTokenAmount,
  formatTxHash,
  formatUsd,
} from "@/lib/utils/format";
import type { CollectCtx } from "../hooks/useCollectFees";
import { useProvisioningGate } from "../hooks/useProvisioningGate";
import { useReviewCountdown } from "../hooks/useReviewCountdown";
import { useSlippageAutoRetry } from "../hooks/useSlippageAutoRetry";
import { type FlowStep, useWalletSignFlow } from "../hooks/useWalletSignFlow";
import { provisioningOpLabelKey } from "../lib/buildProvisioningInput";
import { DEFAULT_SLIPPAGE_PCT, MANAGER_DEFAULT_SLIPPAGE_PCT } from "../lib/slippage";
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
  settleOutcomeForSlippage,
  settlePerformanceFeeUsd,
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

/** Flow phases for the collect dialog (pending shows the multistep wallet handoff, POO-295). */
// POO-419: "provision" is the pre-flight gate step inserted between confirm and pending.
// POO-615: `building` runs the server build (pauseAfterKey) before the Review; the Review shows the
// built figures + a 10s re-quote countdown, and the wallet send is only called on the Review approve.
type Phase = "confirm" | "building" | "review" | "provision" | "pending" | "success" | "error";

/**
 * PP-MOCK: mock-mode network gas, investor path (the mock build carries no `estimatedGasInUsd`;
 * the managed mock uses the console's own estimate). MOCK ONLY — real mode reads the built gas and
 * HIDES the line when the build omits it, never this figure (POO-802 / POO-799 directive #1).
 */
const NETWORK_FEE_USD = 0.3;

/** The receive-as value standing for "the pool token pair" (vs the literal "USDC"). */
const USDC = "USDC";

/** POO-615 R4: the Review re-quotes (flow.rebuild) this many seconds after each build settles. */
const REVIEW_REFRESH_SECS = 10;

/** Per-step mock duration so the build + confirm steps visibly walk in mock mode. */
const MOCK_STEP_MS = 350;

/** The collect signing sequence: server build → send (no client signature is consumed). */
const COLLECT_SPEC: WalletSignSpec = { build: true, confirm: "collect" };

/** Manager-context source for the dialog (POO-286 R1): a strategy's accrued pool fees. */
export interface ManagedCollect {
  /** The managed strategy's id. */
  strategyId: string;
  /** Strategy display name (mini-header). */
  name: string;
  /** Avatar initials fallback. */
  initials: string;
  /** Optional strategy logo. */
  logoUrl?: string;
  /** Pool identity sub-line, e.g. "ETH/USDC · 0.30% · Base". */
  poolLabel: string;
  /** API network slug (e.g. "base"), for non-major token-logo resolution (POO-482 R2). */
  network?: string | undefined;
  /** Accrued, uncollected pool fees in USD. */
  availableUsd: number;
  /** Network gas estimate in USD (the manager pays gas). */
  gasEstimateUsd: number;
  /**
   * Per-token claimable fees (token0/token1 amount) for the "receive as token pair" rows (POO-417
   * R3/R5). Absent → the manager dialog stays USDC-only (no receive-as gear, R6c).
   */
  feeTokens?: ClaimableFeeToken[];
  /**
   * The pool's fee tier in basis points (30 = 0.30%) — the INTERIM DEX-fee source for the POO-516
   * minimum math (R2) until the build/simulation exposes the swap route's fee tier (POO-521).
   * Absent → the mocked DEX_FEE_PCT fallback.
   */
  feeBps?: number;
  /**
   * Runs the MOCK-console collect mutation during the confirm step; resolution/rejection drives
   * success/error. `collectAsTokenPair` carries the receive-as choice (POO-417 R2);
   * `slippageTolerance` the gear's slippage (POO-478 R2). POO-802 R0: the REAL console supplies
   * `buildSteps` instead — when present, this fold is never called.
   */
  onCollect: (
    collectAsTokenPair: boolean,
    slippageTolerance: number,
  ) => Promise<{ hash: string } | undefined>;
  /**
   * POO-802 R0: real-mode handshake steps (useManagerCollect.buildSteps) — [build, confirm:collect]
   * where build sets `ctx.built` from the REAL server build (the Review pauses on real figures) and
   * confirm only signs + sends. Absent → the mock walk + `onCollect` fold (mock console).
   */
  buildSteps?: (collectAsTokenPair: boolean, slippageTolerance: number) => FlowStep<CollectCtx>[];
}

/** Public props for {@link CollectModal}. */
export interface CollectModalProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void;
  /** The strategy the position belongs to (investor mode). */
  strategy?: Strategy;
  /** The owned position whose yield is being collected (investor mode). */
  position?: Position;
  /**
   * POO-802 R0: real-mode investor handshake steps (useCollectFees.buildSteps) — [build,
   * confirm:collect] where build sets `ctx.built` from the REAL server build (so the Review pauses
   * on real gas/protocol/price-impact/min) and confirm only signs + sends. When provided it
   * replaces the mock walk; when absent the dialog runs the always-success mock (mock mode).
   * `collectAsTokenPair` carries the receive-as choice (POO-417 R2); `slippageTolerance` the gear
   * slippage (POO-463 R4). Supersedes the folded `onCollect` executor prop.
   */
  buildCollectSteps?: (
    collectAsTokenPair: boolean,
    slippageTolerance: number,
  ) => FlowStep<CollectCtx>[];
  /** Manager mode: collect the strategy's pool fees instead of an investor position. */
  managed?: ManagedCollect;
  /**
   * Called once an investor collect succeeds, so the detail screen refreshes the owner's position.
   * Manager mode (`managed`) owns its own refresh in the console, so this stays investor-only.
   */
  onChanged?: () => void;
  /**
   * Fired EXACTLY ONCE per collect when an investor collect reaches success (never in managed
   * mode), so the detail screen can arm its optimistic claimable reset (POO-468 R1). Distinct from
   * `onChanged`: usePostWriteRefresh re-invokes that on every poll tick, so it must never arm the
   * override.
   */
  onCollected?: () => void;
}

/** Collect-yield dialog. */
export function CollectModal({
  open,
  onOpenChange,
  strategy,
  position,
  buildCollectSteps,
  managed,
  onChanged,
  onCollected,
}: CollectModalProps) {
  const t = useTranslations("strategies");
  // Receipt dates render in the ACTIVE locale (a hard-coded en-US date on a pt-BR receipt is the
  // semantic-i18n class i18n:check cannot catch).
  const format = useFormatter();
  const { track } = useAnalytics();
  // POO-853 [R6]: log a referred INVESTOR's fee-collect to the referral operation feed (real-only,
  // deduped, fire-and-forget). Fired only on the investor path below, never for a manager collect.
  const logReferralOp = useReferralOperationLog();
  const [phase, setPhase] = useState<Phase>("confirm");
  // POO-419: pre-flight gate (dark-launched flag) — decides confirm → provision → pending.
  const gate = useProvisioningGate();
  const [txError, setTxError] = useState<TxError | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // POO-384 R6: the ⚙ exposes Slippage + Deadline (a swap occurs whenever the proceeds are received
  // as anything but the pool's payout asset). POO-478 R1/R2: this now applies to the manager path too
  // (a collect-as-USDC swaps the pool fees). The manager SEEDS MANAGER_DEFAULT_SLIPPAGE_PCT (5), the
  // investor DEFAULT_SLIPPAGE_PCT (2); POO-547: the custom input is uniform (0.1-100%), no per-role cap.
  const isManaged = managed != null;
  const defaultSlippage = isManaged ? MANAGER_DEFAULT_SLIPPAGE_PCT : DEFAULT_SLIPPAGE_PCT;
  const [slippage, setSlippage] = useState<number>(defaultSlippage);
  const [deadlineMins, setDeadlineMins] = useState(30);
  // POO-417 R1/R5: the receive-as choice is binary — USDC, or the pool token PAIR. The pair source is
  // the per-token claimable: the position's (investor) or the managed pool's (manager). Absent → the
  // user can only receive USDC (R6c). This binary model supersedes POO-403's display-only N-way swap-
  // target picker: the backend collect action only takes a `shouldSwapFees` boolean (no swap-target
  // token), so USDC-vs-raw-pair is the real wiring.
  const feeTokens = managed?.feeTokens ?? position?.claimableFeeTokens;
  // POO-482 R2: network scope for non-major token logos (majors resolve without it).
  const logoNetwork = managed?.network ?? strategy?.network;
  const pairLabel =
    feeTokens && feeTokens.length > 0 ? feeTokens.map((ft) => ft.symbol).join(" / ") : undefined;
  const receiveOptions = pairLabel ? [USDC, pairLabel] : [USDC];
  const [receiveAs, setReceiveAs] = useState(USDC);
  // POO-417 R2: any non-USDC selection means "receive the raw token pair" (no swap).
  const collectAsTokenPair = receiveAs !== USDC;
  // Keep the latest managed handlers out of effect deps so a parent re-render can't re-trigger
  // the in-flight mutation.
  const managedRef = useRef(managed);
  managedRef.current = managed;
  // Same identity guard for the real-mode step builders (the views pass inline arrows).
  const buildCollectStepsRef = useRef(buildCollectSteps);
  buildCollectStepsRef.current = buildCollectSteps;
  // The receive-as choice read at run time (POO-417 R2), kept out of the flow step's deps.
  const collectAsTokenPairRef = useRef(collectAsTokenPair);
  collectAsTokenPairRef.current = collectAsTokenPair;
  // The gear slippage read at run time (POO-463 R4), same out-of-deps guard.
  const slippageRef = useRef(slippage);
  slippageRef.current = slippage;
  // Real on-chain tx hash (real mode); the mock path uses settleTxHash().
  const [txHash, setTxHash] = useState<string | null>(null);
  // Post-write freshness for the investor path (managed mode refreshes via the console). POO-364.
  const postWriteRefresh = usePostWriteRefresh(onChanged);
  // POO-468 R1: the once-per-collect success callback, read via ref so a parent re-render can't
  // swap it mid-flight. The fired guard makes success-effect re-runs unable to double-fire; it
  // resets whenever the phase leaves success (modal restart), so a later collect fires again.
  const onCollectedRef = useRef(onCollected);
  onCollectedRef.current = onCollected;
  const collectedFiredRef = useRef(false);
  const strategyId = managed?.strategyId ?? strategy?.id ?? "";
  const positionId = position?.id ?? "";
  // Investor mode collects the position's CLAIMABLE FEES (the API's totalFeesInUsd, surfaced as
  // `totalYield`), not the withdrawable balance — former-interface parity (POO-286 R1).
  const available = managed?.availableUsd ?? position?.totalYield ?? 0;
  // The CLAIMABLE figure (backend already nets the manager performance fee; supersedes POO-280 R3
  // for the collect path): drives the CTA, the receipt snapshot and analytics. `minReceiveUsd` now
  // feeds only the footer arrival indicator ("≈ X USDC · Arrives instantly").
  const youReceive = available;
  // Snapshot at confirm: the managed mutation refreshes the parent detail (claimable → 0) while
  // the dialog is still open, so the success view must show what was actually collected.
  const [confirmedAmount, setConfirmedAmount] = useState<number | null>(null);
  const collectedAmount = confirmedAmount ?? youReceive;
  // POO-810 R5: the REAL per-token amounts received, decoded from the receipt (USDC leg as USD),
  // snapshotted at success. Null → the receipt falls back to the single claimable USD row (R9).
  const [decodedReceived, setDecodedReceived] = useState<ReceivedLegsResult | null>(null);

  // POO-615: the collect handshake is a two-step flow: BUILD (server prepares the tx) then CONFIRM
  // (the wallet send). The flow PAUSES after build (pauseAfterKey) so the Review renders the built
  // figures; resume() sends. Reads the latest executor + gear choices via refs so a parent re-render
  // can't swap them mid-flight. `available` is the only reactive dep so the mock build re-quotes
  // settleSwapInfo against the current claimable.
  // POO-802 R0: real mode delegates each step to the CURRENT handshake builder
  // (managed.buildSteps / buildCollectSteps, resolved at run time with the live gear choices) — the
  // build step sets ctx.built from the REAL server build, so the Review pauses on real
  // gas/protocol/price-impact/min; the confirm step only signs + sends. A Review re-quote
  // (flow.rebuild) therefore re-runs the REAL build at the current slippage/receive-as.
  const collectSteps = useMemo<FlowStep<CollectCtx>[]>(() => {
    const beat = () => new Promise((resolve) => setTimeout(resolve, MOCK_STEP_MS));
    const realSteps = (): FlowStep<CollectCtx>[] | undefined => {
      const builder = managedRef.current?.buildSteps ?? buildCollectStepsRef.current;
      return builder?.(collectAsTokenPairRef.current, slippageRef.current);
    };
    return [
      {
        key: "build",
        run: async (ctx) => {
          const real = realSteps();
          if (real) return await real[0]?.run(ctx);
          await beat();
          // PP-MOCK (POO-615): the mock build carries a real-shaped swapInfo (price impact /
          // protocol fee / min received) so the Review demos real figures in mock mode; gas stays
          // the honest estimate. POO-417 R4: the token-pair payout performs no swap, so its build
          // carries NO swapInfo — gated the SAME way the render gates the row.
          return {
            built: {
              tx: MOCK_BUILT_TX,
              swapInfo: collectAsTokenPairRef.current
                ? undefined
                : settleSwapInfo(available, { slippagePct: slippageRef.current }),
              // PP-MOCK (POO-827): the performance-fee estimate the real build carries (POO-811).
              // Applies to the yield regardless of the payout asset; the manager never pays it to
              // themselves, so the managed mock omits it (mirrors the API).
              performanceFeeInUsd: managedRef.current
                ? undefined
                : settlePerformanceFeeUsd(available),
            },
          };
        },
      },
      {
        key: "confirm:collect",
        run: async (ctx) => {
          const real = realSteps();
          if (real) return await real[1]?.run(ctx);
          const collectAsPair = collectAsTokenPairRef.current;
          const managedNow = managedRef.current;
          if (managedNow) {
            // The MOCK console's fold: run the mock service mutation on confirm (POO-478 R2 threads
            // the gear slippage; POO-505 R4 keeps a resolved hash when one exists).
            const result = await managedNow.onCollect(collectAsPair, slippageRef.current);
            return result?.hash ? { txHash: result.hash } : {};
          }
          await beat();
          // POO-499 R6: the mock confirm fails deterministically when the gear slippage is <= 0.1%.
          // This guard stays on the CONFIRM step (not the build), so a slippage failure throws AFTER
          // the Review — preserving the auto-retry path.
          if (settleOutcomeForSlippage(slippageRef.current) === "error") {
            const mockError = settleTxError();
            throw Object.assign(new Error(mockError.message), { code: mockError.code });
          }
          return { txHash: settleTxHash() };
        },
      },
    ];
  }, [available]);
  // POO-615: the flow PAUSES after the build step (pauseAfterKey), so the Review shows the BUILT
  // figures before signing; resume() sends, rebuild() re-quotes only the build (POO-574 handshake).
  const flow = useWalletSignFlow<CollectCtx>(collectSteps, {
    fallbackErrorCode: "COLLECT_FAILED",
    pauseAfterKey: "build",
  });
  // POO-802 R0: real mode is any provided handshake builder (investor or managed console).
  const isReal = buildCollectSteps != null || managed?.buildSteps != null;
  // POO-615 R3 reshaped by POO-802: the network-fee line reads the BUILT gas. Mock mode keeps the
  // honest estimates (managed console figure / PP-MOCK $0.30); real mode NEVER falls back to them —
  // a real build without `estimatedGasInUsd` hides the line (POO-799 directive #1).
  const networkFeeUsd =
    flow.context.built?.estimatedGasInUsd ??
    (isReal ? undefined : (managed?.gasEstimateUsd ?? NETWORK_FEE_USD));
  // POO-615: the real swap figures from the built quote. The token-pair payout skips the stable swap,
  // so swapInfo stays undefined and its price-impact / folded protocol-fee rows are hidden (POO-417 R4).
  const swapInfo = collectAsTokenPair ? undefined : flow.context.built?.swapInfo;
  // POO-1011: the catastrophic price-impact gate (>= 10% blocks the Review CTA behind an explicit
  // funds-at-risk acknowledgment; the token-pair payout never swaps, so no gate there, R4).
  const impactGate = usePriceImpactGate(swapInfo?.priceImpactPercentage, phase === "review");
  // POO-615 R4: the shared Review re-quote countdown; at 0 it re-quotes via flow.rebuild() + resets.
  // POO-888 R3: the Review CTA suspends it synchronously (same-tick zero-cross vs send race).
  const { seconds: countdown, suspend: suspendCountdown } = useReviewCountdown({
    active: phase === "review",
    seconds: REVIEW_REFRESH_SECS,
    onRefresh: flow.rebuild,
  });

  // POO-802 (POO-799 decision #1): the ONE canonical fee tooltip reading ONLY built figures. The
  // protocol fee is the built swap's `protocolFee` (managed pays none — netted server-side,
  // POO-286); the 0.25% client math and the pool-tier DEX interim are GONE.
  // PP-INTEGRATION-POINT: `dexUsd` joins from the build's swap-route fee when POO-521 lands.
  // POO-827: `performanceUsd` reads the build's `performanceFeeInUsd` estimate (POO-811, POO-799
  // decision #3) — absent (manager / no fee) means NO line. Same-chain flow: no bridge line.
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
    protocolUsd: isManaged ? undefined : swapInfo?.protocolFee,
    // Belt and braces: the BE already omits the manager's own cut (POO-280 abstraction kept).
    performanceUsd: isManaged ? undefined : flow.context.built?.performanceFeeInUsd,
  });
  // POO-445 R4/R5: one neutral consolidated fee row; hidden when no real figure exists.
  const estFeeRow =
    feeLines.length > 0
      ? [
          buildFeeRow({
            label: t("collect.fee"),
            lines: feeLines,
            totalLabel: t("flow.feesTooltip.total"),
          }),
        ]
      : [];
  // The receipt's final "Fee" (R7): the same canonical lines — what was actually charged.
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
  // POO-802 R4 (POO-799 decision #7): the gear slippage detail row — Auto badge on the role default.
  const maxSlippageRow = buildMaxSlippageRow({
    label: t("flow.review.maxSlippage"),
    slippagePct: slippage,
    autoLabel: slippage === defaultSlippage ? t("flow.review.slippageAuto") : undefined,
  });
  // POO-802 R2: the min-received indicator is the Review footer's "≈ X USDC · Arrives instantly"
  // line, read ONLY from the built swap's `minAmountInStable` (the old client estimate is gone —
  // the Review always renders post-build). The pair path has no swap, so no USDC minimum shows.
  const minReceiveUsd = swapInfo?.minAmountInStable;
  // POO-802 R10 (POO-799 decision #4): the $0.10 PROD collect floor — below it the CTA disables.
  const belowMin = available < MIN_COLLECT_USD;

  // POO-417 R3: receiving the token pair turns the payout into the per-token rows (amounts only).
  const receivingPair = collectAsTokenPair && feeTokens != null && feeTokens.length > 0;
  // POO-923 R3 (cross-flow with WithdrawReviewCard): the pair payout swaps nothing, so the
  // "after fees" caption is dropped — only the USDC payout keeps it. The min-received line renders
  // only off a REAL built minimum (the pair path fabricates none). When both are absent the footer
  // is left undefined so CollapsibleReceiptRows renders no stray bordered caption block.
  const reviewCaption = receivingPair ? null : (
    <p>{t("flow.review.caption", { rate: slippage })}</p>
  );
  const reviewMinLine =
    minReceiveUsd != null ? (
      <p>{t("flow.review.footerInstant", { amount: formatTokenAmount(minReceiveUsd, "USDC") })}</p>
    ) : null;
  const reviewFooter =
    reviewCaption != null || reviewMinLine != null ? (
      <>
        {reviewCaption}
        {reviewMinLine}
      </>
    ) : undefined;
  // POO-478 R1/R2: the ⚙ shows for EVERY collect (investor + manager) — every on-chain tx exposes
  // Max slippage + Transaction deadline (supersedes POO-384 R6 / POO-417 R1's manager-gearless
  // collect), so the gear + dialog render unconditionally. POO-525 R2: the receive-as section is
  // INTERACTIVE only when a choice exists — the investor always gets the picker (USDC by default,
  // POO-384 R6), the manager only when the pool exposes the token pair (POO-417 R1); a managed
  // detail without per-token data degrades to a fixed USDC-only display instead of hiding it.
  const receiveAsInteractive = !isManaged || pairLabel != null;
  // POO-499 (POO-467 R2/R3): shared slippage auto-retry. POO-802: with the split executors,
  // retryFrom("build") now re-runs the REAL build then the send (no more folded re-build).
  const slippageRetry = useSlippageAutoRetry({
    flow,
    flowName: "collect",
    strategyId,
    slippagePct: slippage,
    onOpenSettings: () => setSettingsOpen(true),
  });
  // POO-505 R3: the receipt shows the REAL mined hash; the mock settle hash never leaks into real
  // mode (no fabricated tx, a real flow without a hash yields no row and no link). The explorer
  // link renders via the shared ExplorerTxLink (POO-514 R2).
  const receiptHash = txHash ?? (!isReal && !isManaged ? settleTxHash() : null);
  // POO-461 R3: kind-aware error body. POO-499 R3: the slippage error view swaps in the slippage copy.
  const genericErrorBody = useTxErrorBody(txError);
  const errorTitle = slippageRetry.slippageError
    ? t("flow.slippage.errorTitle")
    : t("flow.error.title");
  const errorBody = slippageRetry.slippageError
    ? t("flow.slippage.errorBody", { value: slippageRetry.slippagePct })
    : genericErrorBody;

  useEffect(() => {
    // Investor analytics only — the manager console isn't in the investor event catalog.
    if (open && !managedRef.current) {
      track("strategy_collect_started", { strategy_id: strategyId, position_id: positionId });
    }
  }, [open, track, strategyId, positionId]);

  // On an investor collect success, refresh the owner's position state: re-fetch the client
  // positions (claimable → 0), drop the catalog cache, and re-run the server components. Manager
  // mode (`managed`) owns its own refresh in the console, so the catalog invalidate stays here.
  // POO-468 R1: the same success also fires onCollected EXACTLY ONCE (ref-guarded against effect
  // re-runs; the guard re-arms when the phase leaves success so a later collect fires again).
  useEffect(() => {
    if (phase !== "success" || isManaged) {
      collectedFiredRef.current = false;
      return;
    }
    // Arm the screen's override BEFORE kicking the refresh, so no refetch can land unsnapshotted.
    if (!collectedFiredRef.current) {
      collectedFiredRef.current = true;
      onCollectedRef.current?.();
    }
    postWriteRefresh();
  }, [phase, isManaged, postWriteRefresh]);

  // POO-615: the build settling into `awaiting` advances the spinner to the Review (reading the built
  // figures from flow.context); a build failure (initial or a Review rebuild) surfaces the error view.
  useEffect(() => {
    if (phase === "building" && flow.status === "awaiting") {
      setPhase("review");
    } else if ((phase === "building" || phase === "review") && flow.status === "error") {
      setTxError(flow.error);
      setPhase("error");
    }
  }, [phase, flow.status, flow.error]);

  // Drive phase + analytics off the runner's outcome (approved via the Review → resume). The confirm
  // step reflects the real settlement (active → done / error), so there is no cosmetic timer. The real
  // failure (backend reverts, pre-signature throws) surfaces via flow.error, never a blank dead-end.
  useEffect(() => {
    if (phase !== "pending") return;
    if (flow.status === "success") {
      if (flow.txHash) setTxHash(flow.txHash);
      // POO-810 R5: snapshot the decoded per-token amounts for the receipt (real investor path only).
      setDecodedReceived(flow.context.decoded ?? null);
      setPhase("success");
      // Investor + mock paths emit the investor event; the manager console isn't in that catalog.
      if (!managedRef.current) {
        track("strategy_collect_completed", {
          strategy_id: strategyId,
          position_id: positionId,
          value: youReceive,
          currency: "USD",
          usd_value_at_time: youReceive,
        });
        // POO-853 [R6]: record this fee-collect to the referral operation feed (investor path only).
        logReferralOp({
          operation: "COLLECT_FEES",
          amountUsd: youReceive,
          txHash: flow.txHash ?? "",
          positionInfo: { strategyId, positionId },
        });
      }
    } else if (flow.status === "error") {
      // POO-499 R2: the first slippage failure auto-retries — hold the pending phase, no error view /
      // failure event yet.
      if (slippageRetry.autoRetrying) return;
      setTxError(flow.error);
      setPhase("error");
      if (!managedRef.current) {
        track("strategy_collect_failed", {
          strategy_id: strategyId,
          position_id: positionId,
          value: youReceive,
          currency: "USD",
          usd_value_at_time: youReceive,
        });
      }
    }
  }, [
    flow.status,
    flow.txHash,
    flow.error,
    // POO-810 R5: the decoded per-token amounts snapshotted for the success receipt.
    flow.context.decoded,
    slippageRetry.autoRetrying,
    phase,
    track,
    strategyId,
    positionId,
    youReceive,
    logReferralOp,
  ]);

  function handleOpenChange(next: boolean) {
    // POO-419 R3: no dismissal while provisioning is executing (ESC / overlay / X are all blocked).
    if (!next && gate.locked) return;
    onOpenChange(next);
    if (!next) {
      setSettingsOpen(false);
      flow.reset();
      setTimeout(() => {
        setPhase("confirm");
        setConfirmedAmount(null);
        setDecodedReceived(null);
        setTxHash(null);
        // POO-478 R2: reset to the mode-aware default (manager 5% / investor 2%).
        setSlippage(defaultSlippage);
        setDeadlineMins(30);
        setReceiveAs(USDC);
        gate.reset();
      }, 150);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        {phase === "confirm" ? (
          <>
            {/* POO-445 R1: shared header. POO-478 R1/R2: the gear (slippage + deadline, plus receive-as
                when a pair exists) shows for EVERY collect — investor and manager alike. */}
            <TransactionModalHeader
              title={t("collect.title")}
              onSettings={() => setSettingsOpen(true)}
              settingsLabel={t("invest.settings.title")}
            />
            {managed ? (
              <ManagedMiniHeader managed={managed} />
            ) : strategy ? (
              <StrategyMiniHeader strategy={strategy} />
            ) : null}

            <div className="mt-2 flex flex-col items-center gap-1 rounded-xl border border-border bg-surface-raised p-5 text-center">
              <p className="text-muted-foreground text-sm">{t("collect.available")}</p>
              <p className="font-bold text-3xl text-success">{formatUsd(available)}</p>
              <p className="text-muted-foreground text-xs">
                {/* POO-504 R1: the destination copy follows the receive-as choice. */}
                {receivingPair && feeTokens && feeTokens.length >= 2
                  ? t("collect.destinationPair", {
                      token0: feeTokens[0]?.symbol ?? "",
                      token1: feeTokens[1]?.symbol ?? "",
                    })
                  : t("collect.destination")}
              </p>
            </div>

            {/* POO-802 R1 (reshapes POO-384): the confirm card keeps only the essentials — Amount
                (investor) + Receive as. The old "You receive at least" and "Est. fee" rows are gone;
                the Review (post-build) carries the real figures instead. */}
            <ReceiptRows
              groups={[
                // POO-384 R2 kept: the investor's "Amount" row. POO-280 R2: the manager view drops
                // it (the perf fee is abstracted server-side).
                ...(isManaged
                  ? []
                  : [
                      [
                        {
                          label: t("collect.amount"),
                          value: formatUsd(available),
                          tone: "positive" as const,
                        },
                      ],
                    ]),
                [
                  ...(receiveAsInteractive
                    ? [
                        {
                          // POO-403 R3: display-only — the header gear is the single settings entry.
                          label: t("invest.settings.receiveAsLabel"),
                          value: receiveAs,
                        } satisfies ReceiptRowItem,
                      ]
                    : []),
                ],
              ]}
            />

            {/* POO-802 R10 (POO-799 decision #4): the $0.10 PROD collect floor. */}
            {belowMin ? (
              <p className="text-center text-muted-foreground text-xs">
                {t("collect.minNotice", { amount: formatUsd(MIN_COLLECT_USD) })}
              </p>
            ) : null}
            <Button
              className="w-full"
              size="lg"
              disabled={belowMin}
              onClick={() => {
                // POO-615: the confirm CTA starts the BUILD (ungated) — the Review shows the built
                // figures before any gas top-up or signing. The POO-419 gate moved to the Review
                // approve (build ungated → gate → resume), mirroring WithdrawModal / RemoveLiquidityModal.
                setConfirmedAmount(youReceive);
                setPhase("building");
                void flow.run();
              }}
            >
              {t("collect.cta", { amount: formatUsd(youReceive) })}
            </Button>
          </>
        ) : null}

        {phase === "building" ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>{t("flow.processing")}</DialogTitle>
            </DialogHeader>
            {managed ? (
              <ManagedMiniHeader managed={managed} />
            ) : strategy ? (
              <StrategyMiniHeader strategy={strategy} />
            ) : null}
            {/* POO-615: the server builds the tx here; on settle the flow pauses (awaiting) and the
                effect advances to the Review with the built figures. */}
            <BuildingStep label={t("flow.processing")} />
          </>
        ) : null}

        {phase === "review" ? (
          <>
            {/* POO-615: the Review shows the BUILT figures before signing — the same receipt rows as
                the confirm view plus a price-impact row (USDC-swap path). POO-600: the header carries
                ONLY Back — the settings gear stays on the confirm step (the clear-signing window). */}
            <TransactionModalHeader
              title={t("withdraw.review.title")}
              onBack={() => setPhase("confirm")}
              backLabel={t("withdraw.review.back")}
            />
            {managed ? (
              <ManagedMiniHeader managed={managed} />
            ) : strategy ? (
              <StrategyMiniHeader strategy={strategy} />
            ) : null}

            {/* POO-615 R4: the visible re-quote countdown — the built figures refresh when it hits 0. */}
            <p className="flex items-center justify-center gap-1.5 text-muted-foreground text-xs">
              <RefreshCw className="size-3.5" aria-hidden="true" />
              {t("flow.review.refreshIn", { seconds: countdown })}
            </p>
            {/* POO-885 R2/R4: subtle stale-quote hint after 3 consecutive background re-quote
                failures (non-fatal; the countdown keeps retrying with the last good quote). */}
            {flow.quoteStale ? (
              <p className="text-center text-warning text-xs">{t("flow.review.quoteStale")}</p>
            ) : null}

            {/* POO-802 R2/R3/R4: the shared collapsible card — "Amount requested" visible; Est. fee
                / Max. slippage / Price impact behind Show more; Receive as (+ the pair's per-token
                payout) below the toggle; the cross-flow captions replace the old "You receive at
                least" row (the "≈ X USDC · Arrives instantly" line IS the min-received indicator,
                read from the built swap only). */}
            <CollapsibleReceiptRows
              summary={[
                ...(isManaged
                  ? []
                  : [
                      [
                        {
                          label: t("collect.amount"),
                          value: formatUsd(available),
                          tone: "positive" as const,
                        },
                      ],
                    ]),
              ]}
              details={[
                [
                  ...estFeeRow,
                  maxSlippageRow,
                  // POO-613 R1: the built swap's price impact (USDC-swap path only; hidden on the
                  // token-pair payout where swapInfo is undefined).
                  ...(swapInfo != null
                    ? [
                        buildPriceImpactRow(
                          t("flow.review.priceImpact"),
                          swapInfo.priceImpactPercentage,
                        ),
                      ]
                    : []),
                ],
              ]}
              after={[
                [
                  ...(receiveAsInteractive
                    ? [
                        {
                          label: t("invest.settings.receiveAsLabel"),
                          value: receiveAs,
                        } satisfies ReceiptRowItem,
                      ]
                    : []),
                  // POO-417 R3 kept: the pair payout's per-token amounts (with logos) stay visible.
                  ...(receivingPair && feeTokens
                    ? [
                        {
                          label: t("collect.youReceive"),
                          value: <PairReceiveList tokens={feeTokens} network={logoNetwork} />,
                          tone: "emphasis" as const,
                        } satisfies ReceiptRowItem,
                      ]
                    : []),
                ],
              ]}
              footer={reviewFooter}
              showMoreLabel={t("flow.review.showMore")}
              showLessLabel={t("flow.review.showLess")}
            />

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
                // POO-419: the pre-flight gas top-up gate is evaluated HERE (build ungated → gate →
                // resume). Managed mode has no Strategy, so it always signs directly (gate is
                // investor-only). POO-615: the tx is already built (paused after build), so approving
                // resumes into the wallet send step — the build is NOT re-run (flow.resume, not run).
                if (strategy && gate.evaluate("collect", strategy)) {
                  setPhase("provision");
                  return;
                }
                setPhase("pending");
                void flow.resume();
              }}
            >
              {t("collect.cta", { amount: formatUsd(youReceive) })}
            </Button>
          </>
        ) : null}

        {phase === "provision" && gate.input ? (
          <>
            {/* POO-419: pre-flight provisioning gate — top up gas / switch network, then resume collect. */}
            <DialogHeader className="sr-only">
              <DialogTitle>{t("provisioning.plan.title")}</DialogTitle>
            </DialogHeader>
            {managed ? (
              <ManagedMiniHeader managed={managed} />
            ) : strategy ? (
              <StrategyMiniHeader strategy={strategy} />
            ) : null}
            <ProvisioningPanel
              input={gate.input}
              opLabel={t(provisioningOpLabelKey("collect"), {
                strategy: managed?.name ?? strategy?.name ?? "",
              })}
              onDone={() => {
                gate.setLocked(false);
                setPhase("pending");
                // POO-615 handshake: the flow is paused after the build; resume it into the wallet
                // send step (do NOT flow.run(), which would rebuild from scratch), mirroring
                // WithdrawModal / RemoveLiquidityModal's provision onDone.
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
            {managed ? (
              <ManagedMiniHeader managed={managed} />
            ) : strategy ? (
              <StrategyMiniHeader strategy={strategy} />
            ) : null}
            {/* POO-499 R2: the auto-retry notice sits in the pending view while the flow re-runs. */}
            {slippageRetry.autoRetrying ? (
              <p className="rounded-md bg-warning/10 px-3 py-2 text-center text-warning text-sm">
                {t("flow.slippage.retryNotice", { value: slippageRetry.slippagePct })}
              </p>
            ) : null}
            {/* POO-615: the stepper now walks build → confirm:collect (the build is already done by
                the time we reach pending). Labels come from the shared resolver so they match the
                runner's step keys + order. */}
            <WalletSteps
              steps={resolveWalletSignSteps(COLLECT_SPEC, t)}
              activeStep={flow.activeStep}
              statuses={flow.statuses}
              txHashes={flow.txHashes}
            />
          </>
        ) : null}

        {phase === "success" ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>{t("collect.success.title")}</DialogTitle>
            </DialogHeader>
            {/* POO-802 R8: no "$X was added to your balance" body — the receipt carries the figure. */}
            <TransactionStatus phase="success" title={t("collect.success.title")}>
              {/* POO-802 R6/R7/R9 (reshapes POO-279 R7/R8): the shared collapsible receipt —
                  Strategy + "Amount Received" visible; the final Fee + Slippage + Price impact
                  behind Show more; Date + Transaction never collapse. */}
              <CollapsibleReceiptRows
                summary={[
                  [
                    {
                      label: t("flow.receipt.strategy"),
                      value: formatIdentityLabel(managed?.name ?? strategy?.name ?? ""),
                    },
                    {
                      label: t("collect.receipt.amountReceived"),
                      // POO-810 R5: the REAL per-token amounts received (USDC leg as USD) decoded
                      // from the mined receipt; otherwise the pre-execute claimable USD (R9 fallback,
                      // never blank/$0).
                      value:
                        decodedReceived && decodedReceived.rows.length > 0 ? (
                          <TokenAmountRows
                            rows={decodedReceived.rows}
                            network={logoNetwork}
                            testId="collect-received-amounts"
                          />
                        ) : (
                          formatUsd(collectedAmount)
                        ),
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
                    ...(swapInfo != null
                      ? [
                          buildPriceImpactRow(
                            t("flow.review.priceImpact"),
                            swapInfo.priceImpactPercentage,
                          ),
                        ]
                      : []),
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
              {/* Collect KEEPS the Done button (POO-799 decision #4 removes it from Invest only). */}
              <Button className="w-full" size="lg" onClick={() => handleOpenChange(false)}>
                {t("flow.done")}
              </Button>
              {/* POO-514 R2: the shared explorer link on the position's network (/tx/{hash}). */}
              <ExplorerTxLink network={logoNetwork} hash={receiptHash} />
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
                  // POO-499 R3: after a slippage error, Try again re-quotes from the build step
                  // (a post-Review retryFrom runs THROUGH the pause, re-building then re-confirming
                  // without stopping at the Review); R4: a non-slippage failure keeps
                  // resume-from-failed-step.
                  if (slippageRetry.slippageError) void flow.retryFrom("build");
                  else void flow.retry();
                }}
                error={txError ?? undefined}
              />
            </TransactionStatus>
          </>
        ) : null}
      </DialogContent>
      {/* POO-478 R1/R2: every collect (investor + manager) exposes Slippage + Deadline. POO-547: the
          custom slippage input is uniform (0.1-100%) for both roles — the manager path no longer caps
          at 5% (that stays the manager SEED via `defaultSlippage`). POO-525 R2: Receive as ALWAYS
          renders — interactive when the pool exposes a token-pair choice (POO-417 R1), otherwise a
          fixed USDC-only display (no handler). */}
      <TransactionSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        slippage={slippage}
        onSlippageChange={setSlippage}
        deadlineMins={deadlineMins}
        onDeadlineChange={setDeadlineMins}
        receiveAs={receiveAs}
        onReceiveAsChange={receiveAsInteractive ? setReceiveAs : undefined}
        receiveOptions={receiveOptions}
      />
    </Dialog>
  );
}

/**
 * The "receive as token pair" payout list (POO-417 R3): one row per pool token via
 * {@link TokenAmountRows} — token0/token1 amount, amounts only (the backend exposes no per-token
 * USD). The aggregate USD stays the "Amount" row above. Both legs render even when one amount is 0
 * (R6b). POO-482 R2: each row carries the real token logo (majors need no network; the list
 * fallback does).
 */
function PairReceiveList({
  tokens,
  network,
}: {
  tokens: ClaimableFeeToken[];
  network: string | undefined;
}) {
  // Amounts only: no per-token USD (POO-417 R3). The symbol is a stable key inside TokenAmountRows.
  const rows = tokens.map((token) => ({ symbol: token.symbol, amount: token.amount }));
  return <TokenAmountRows rows={rows} network={network} testId="collect-receive-tokens" />;
}

/** Compact identity header for the manager context: logo/initials + name + pool sub-line. */
function ManagedMiniHeader({ managed }: { managed: ManagedCollect }) {
  return (
    <div className="flex items-center gap-3 text-left">
      <StrategyLogo
        url={managed.logoUrl}
        name={managed.name}
        initials={managed.initials}
        className="size-10 font-semibold"
      />
      <div className="min-w-0">
        <p className="truncate font-semibold text-foreground">{managed.name}</p>
        <p className="truncate text-muted-foreground text-sm">{managed.poolLabel}</p>
      </div>
    </div>
  );
}
