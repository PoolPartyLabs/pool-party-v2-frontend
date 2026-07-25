/**
 * @id PP-MGR-MOD-001
 * @name MoveRangeModal
 * @implements-rules-version v7 (POO-877 + POO-881 + POO-900 rules v1) · v1 (POO-842 rules v1)
 *
 * Confirm dialog for the manager's **Move Range** action on a live Uniswap v3 position: set a new
 * price range (manual min/max nudged by tick steppers, ±5/±10/±20/Full presets, or re-center on the
 * current price), read prices token-by-token in either orientation (an invert pill flips the base
 * token), preview the estimated token balance for the new range, then step through an explicit Review
 * before signing. The manager pays the network gas. On success it reports the applied range to the
 * parent ({@link LivePositionCard}).
 *
 * Flow (POO-387, 2026-06-28 redesign): Form → ⚙ Settings → Review → Pending → Confirmed → Error.
 * The form CTA advances to Review; the Review CTA ("Confirm & move range") runs the signing flow.
 *
 * In real mode (POO-310) confirm runs the on-chain rebalance: price→ticks (POO-282) → optimize →
 * complete routing → build/move-range-tx → sign + send, all behind the one busy spinner. Mock mode
 * keeps `managerService.moveRange`. The real path needs the pool's network slug + token decimals,
 * carried on the manage-detail and passed through {@link MoveRangeTarget}.
 *
 * The Full-range preset rebalances to the widest usable ticks (POO-394): in real mode its run input
 * carries `fullRange: true`, so the same optimize → route → build → send pipeline runs and success is
 * reported only on a real tx hash. Mock mode keeps `managerService.moveRange`.
 *
 * POO-518 (@implements-rules-version v1 of POO-518): a full move reports the bounds it actually
 * applied — the prices derived from the widest usable ticks (`fullRangePrices`, respecting token
 * decimals) with `full: true` on the {@link MoveRangeResult} — never the seeded current band, in
 * BOTH modes (R1). The parents (operate notice, manage-view range patch) render those derived
 * bounds or their full-range representation (R2).
 *
 * POO-501 (@implements-rules-version v1 of POO-501): the Estimated balance legend gains token logos
 * (resolveTokenLogo, R1) and estimated per-token amount + USD sub-lines for the new range on BOTH the
 * form and the Review (R2), plus a Current balance row per token on the form (R3). All figures derive
 * from the whole pool position's raw reserves + pool-value anchor via the shared split lib
 * (positionTokenSplit, PP-CORE-LIB-022 / POO-498), the SAME path mock & real; absent block → the
 * percent-only legend (R4). The estimate is computed canonical, so the invert pill flips presentation
 * only, never the numbers (R5), and recomputes live with the range inputs (R7).
 *
 * POO-513 R2: the gear settings (slippage / deadline) reset to the manager defaults whenever the
 * dialog (re)opens, joining the universal reset-on-close policy (seeding on reopen covers every
 * close path, incl. the success auto-close).
 *
 * POO-515 R4 (v2): the Review's network-gas row carries a gas-only breakdown tooltip (buildFeeRow,
 * parity with the other modals' Fee rows); the ETH protocol fee row stays tooltip-less.
 *
 * POO-547: the settings gear's custom slippage is now uniform (0.1-100%) — the old 5% manager cap
 * (`SLIPPAGE_CAP`) is dropped, so the field falls back to the shared 100 default. 5% stays the seed.
 *
 * POO-597 (rules v1): the build->review->sign handshake (POO-574 rolled out from Withdraw). The form
 * CTA now BUILDS the tx first (the flow pauses via `pauseAfterKey`), so the Review shows the BUILT
 * figures (network gas = `flow.context.built?.estimatedGasInUsd`, else the gasCostUsd estimate) with a
 * 10s re-quote countdown (shared useReviewCountdown); the wallet send is only called on the Review
 * approve (flow.resume). Uses the shared BuildingStep + `flow.review.refreshIn` key (POO-595).
 *
 * POO-612 (rules v1): the Review reads the REAL swap figures from the built quote (swapInfo). A move
 * range always swaps to rebalance, so the Review carries the real price-impact row of the rebalancing
 * swap (R1).
 *
 * POO-860 (rules v1, R4): the new range must span at least MIN_RANGE_SPACINGS usable ticks. `valid`
 * now folds in `isRangeWideEnough`, so an inverted / equal / too-tight band disables the Move CTA and
 * shows an inline error up front (shared range guard with the create-strategy Build step).
 *
 * POO-877 (rules v1, R1/R4): the ± steppers move the underlying TICK (stepPriceForPool), not the
 * display string, so on tickSpacing-1 pools `+`/`-` never lock on a fixed point or skip a tick — the
 * same shared-grid fix as the create-strategy Build step.
 *
 * POO-881 (rules v1, R5/R6/R8): input-level max>min enforcement on top of the POO-860 CTA gate (R7).
 * On blur (snapBound) and on every ± step (nudge) the edited bound is clamped (clampRangeBound) so it
 * can never invert or over-narrow the new range — pinned at least the 2-tick minimum off the opposite
 * bound. The CTA gate + inline error stay as the backstop for the transient (typed, un-blurred) state.
 *
 * POO-900 (rules v1, R1/R2/R5-R7): at exactly 2 tick-spacings the NARROWING steppers (displayed-min
 * "+", displayed-max "−") are disabled (`atMinWidth`, plain disabled buttons - the inline rangeError
 * copy already explains the 2-tick minimum, R10); widening is never disabled (R5) and orientation
 * needs no special-casing (R6). A typed violating value snaps on blur to the exactly-2-spacings
 * boundary (R2, via the POO-900 clampRangeBound pin). The clamp inside `nudge` stays as an idempotent
 * safety net; narrowing is monotonic - no 3-tick sawtooth at the boundary (R7). Same wiring as the
 * create-strategy Build step.
 */
"use client";

import { ArrowLeftRight, Minus, Plus, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { TokenAmountRow } from "@/components/data-display/TokenAmountRow";
import { BuildingStep } from "@/components/ui/BuildingStep";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { ReceiptRows } from "@/components/ui/ReceiptRows";
import { TransactionModalHeader } from "@/components/ui/TransactionModalHeader";
import { buildFeeRow, buildPriceImpactRow } from "@/features/strategies/components/FeeBreakdown";
// POO-419: pre-flight provisioning gate (dark-launched) — shared with the investor modals.
import {
  PriceImpactGate,
  usePriceImpactGate,
} from "@/features/strategies/components/PriceImpactGate";
import { ProvisioningPanel } from "@/features/strategies/components/ProvisioningPanel";
import {
  MOCK_BUILT_TX,
  settleOutcomeForSlippage,
  settleSwapInfo,
  settleTxError,
} from "@/features/strategies/components/settle";
import {
  TransactionErrorActions,
  useTxErrorBody,
} from "@/features/strategies/components/TransactionErrorActions";
import { TransactionSettingsDialog } from "@/features/strategies/components/TransactionSettingsDialog";
import { TransactionStatus } from "@/features/strategies/components/TransactionStatus";
import { resolveWalletSignSteps } from "@/features/strategies/components/WalletSignModal";
import { WalletSteps } from "@/features/strategies/components/WalletSteps";
import type { WalletSignSpec } from "@/features/strategies/components/walletSignSteps";
import { useProvisioningGate } from "@/features/strategies/hooks/useProvisioningGate";
import { useReviewCountdown } from "@/features/strategies/hooks/useReviewCountdown";
import { useSlippageAutoRetry } from "@/features/strategies/hooks/useSlippageAutoRetry";
import { type FlowStep, useWalletSignFlow } from "@/features/strategies/hooks/useWalletSignFlow";
import { provisioningOpLabelKey } from "@/features/strategies/lib/buildProvisioningInput";
import { MANAGER_DEFAULT_SLIPPAGE_PCT } from "@/features/strategies/lib/slippage";
import { nativeSymbol } from "@/lib/chains";
import { fullRangePrices } from "@/lib/manager/fullRangeTicks";
import { MIN_RANGE_SPACINGS } from "@/lib/manager/tickPrice";
import { isMockMode, type MoveRangeResult, managerService } from "@/lib/services";
import { resolveTokenLogo } from "@/lib/tokens/tokenLogo";
import { type PositionSplit, type PositionSplitInput, positionTokenSplit } from "@/lib/uniswap";
import { cn } from "@/lib/utils/cn";
import { formatPercent, formatTokenAmount, formatUsd } from "@/lib/utils/format";
import { getRangeStatus } from "@/lib/utils/rangeStatus";
import { type MoveRangeCtx, type MoveRangeRunInput, useMoveRange } from "../hooks/useMoveRange";
import { invert, toCanonicalBounds, toDisplayBounds } from "../lib/invertPrice";
import {
  clampRangeBound,
  isRangeWideEnough,
  rangeSpacingsForPool,
  snapPriceForPool,
  stepPriceForPool,
} from "../lib/poolTickSnap";
import { RANGE_PRESETS } from "../lib/presets";
import { fmtPrice, roundPrice } from "../lib/priceFormat";
import { tokenSplit } from "../lib/rangeMath";
import { RangeStatusLine } from "./RangeStatusLine";
import { TokenSplitBar } from "./TokenSplitBar";

/** The move-range signing sequence: server build (price→ticks → optimize → route → build) → send. */
const MOVE_RANGE_SPEC: WalletSignSpec = { build: true, confirm: "moveRange" };

/** Per-step mock duration so the stepper visibly walks in mock mode. */
const MOCK_STEP_MS = 350;

/** POO-597 R4: the Review re-quotes (flow.rebuild) this many seconds after each build settles. */
const REVIEW_REFRESH_SECS = 10;

/** token0 symbol fallback when the target doesn't carry it (mock detail) — only labels the pair. */
const DEFAULT_TOKEN0 = "ETH";
/** Estimated time to migrate the position in place (mock). PP-INTEGRATION-POINT: gas-estimator ETA. */
const EST_TIME = "~1 min";

/**
 * The fixed fee Pool Party charges to execute a Move Range, shown in the Review (POO-406 R3). This is
 * a REAL fee (not mock): a flat amount of the network's NATIVE token, so the amount is constant but
 * the symbol varies by network (ETH on the EVM L2s, POL on Polygon — resolved via `nativeSymbol`,
 * POO-540 R1/R3). The displayed value is composed at render as `${MOVE_RANGE_FEE_NATIVE_AMOUNT}
 * ${nativeSymbol(position.network)}`.
 *
 * PP-INTEGRATION-POINT (POO-540): the per-network native Move Range fee amount should come from env
 * once Rafael confirms the source (flat 0.001 everywhere vs per-network config / an endpoint). Until
 * then the FE default stays 0.001 (POO-540 R2). Route any env through the config/features layer — do
 * not read process.env.NEXT_PUBLIC_* here.
 */
const MOVE_RANGE_FEE_NATIVE_AMOUNT = 0.001;

/**
 * POO-501 R2/R3: the per-token USD PRICES recovered from a value split + the pool-value anchor, using
 * only real on-chain data (no token1==USD assumption): `usdPerToken_i = share_i * anchor / reserve_i`.
 * Same derivation the manager Remove/Close modal uses (POO-502 `perTokenUsdPrice`). Null when the
 * split is null, the anchor is non-positive, or a reserve is zero, so the caller degrades (R4).
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

/** A per-token amount + estimated USD leg (both in human units). */
interface TokenLeg {
  amount: number;
  usd: number;
}

/**
 * POO-501 R2: the ESTIMATED per-token balance for the NEW range. The value each token holds after the
 * move is `usd_i = poolValueUsd * pct_i / 100` (pct from the canonical {@link tokenSplit} of the new
 * range), and the amount is `usd_i / price_iUsd`, where the per-token USD price comes from the current
 * reserves + anchor (`perTokenUsdPrice`). A range fully above the current price gives pct0 = 100 → all
 * token0 (R7); Full range gives ~50/50. Null when the value block is missing/degenerate (R4). These
 * are DISPLAY estimates (execution happens at tx price under the user's slippage), never signing
 * amounts. PP-INTEGRATION-POINT (POO-325): backend-verified figures replace this derived pricing.
 */
function estimateNewRangeLegs(
  split: PositionSplit | null,
  poolValueUsd: number | undefined,
  pct0: number,
  pct1: number,
): { token0: TokenLeg; token1: TokenLeg } | null {
  const price = perTokenUsdPrice(split, poolValueUsd);
  if (!price || poolValueUsd == null) return null;
  const usd0 = (poolValueUsd * pct0) / 100;
  const usd1 = (poolValueUsd * pct1) / 100;
  return {
    token0: { amount: price.price0 > 0 ? usd0 / price.price0 : 0, usd: usd0 },
    token1: { amount: price.price1 > 0 ? usd1 / price.price1 : 0, usd: usd1 },
  };
}

/**
 * POO-501 R3: the CURRENT per-token balance of the position (form Current range block). Amounts are
 * the reserves themselves (human units); USD is each token's share of the anchor (`share_i * anchor`),
 * so usd0 + usd1 ≈ poolValueUsd. Null when the value block is missing/degenerate (R4).
 */
function currentBalanceLegs(
  split: PositionSplit | null,
  poolValueUsd: number | undefined,
): { token0: TokenLeg; token1: TokenLeg } | null {
  if (!split || poolValueUsd == null || !(poolValueUsd > 0)) return null;
  return {
    token0: { amount: split.reserve0, usd: split.share0 * poolValueUsd },
    token1: { amount: split.reserve1, usd: split.share1 * poolValueUsd },
  };
}

/** Format a token leg as an approx-marked "~amount SYMBOL (~$usd)" sub-line (mirrors TokenAmountRow). */
function formatLeg(leg: TokenLeg, symbol: string): string {
  return `~${formatTokenAmount(leg.amount, symbol, 8)} (~${formatUsd(leg.usd)})`;
}

/**
 * The slice of a live position Move Range needs. Structurally satisfied by {@link ManagerPosition}
 * (operate surface) and by a manage-detail mapping (Operations rail, POO-286 R2).
 */
export interface MoveRangeTarget {
  /** The strategy whose range is being moved. */
  strategyId: string;
  /** Current pool price: token1 per 1 token0. */
  currentPrice: number;
  /** Fee tier in basis points (drives the tick-spacing nudge). */
  feeBps: number;
  /** Base token symbol (token0), for the pair label + token-by-token price (R1). Optional on mock. */
  token0?: string;
  /** Quote token symbol, for price labels. */
  token1: string;
  /** Estimated network gas in USD (the manager pays gas). */
  gasCostUsd: number;
  /** API network slug (real mode only) — needed to build the on-chain move-range. */
  network?: string;
  /** token0 decimals (real mode only) — needed for price→tick. */
  decimals0?: number;
  /** token1 decimals (real mode only) — needed for price→tick. */
  decimals1?: number;
  /**
   * POO-501 R2: the WHOLE pool position's raw reserves (`totalSupply0/1` in base units + `tickCurrent`
   * + `decimals0/1`), for the client-side per-token value split of the estimated new-range balance and
   * the current-balance rows. Present only when the manage-detail carries the block (real position or
   * seeded mock); absent → the modal renders the percent-only legend (R4). The pool token symbols +
   * decimals mirror the pool fields above so the split is self-contained. SAME split lib as the manager
   * Remove/Close modal (`positionTokenSplit`, PP-CORE-LIB-022 / POO-498).
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
   * POO-501 R2: the USD anchor for the split — the whole pool position value (detail.aum / poolTvlUsd),
   * matching `totalSupply0/1`. The per-token USD prices derive from `share_i * poolValueUsd / reserve_i`.
   * Absent → percent-only legend (R4). PP-INTEGRATION-POINT (POO-325): backend-verified per-token USD
   * replaces this derived pricing when it lands.
   */
  poolValueUsd?: number;
}

/** Public props for {@link MoveRangeModal}. */
export interface MoveRangeModalProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void;
  /** The position being repositioned. */
  position: MoveRangeTarget;
  /** The position's current range lower bound (seeds the form). */
  currentMin: number;
  /** The position's current range upper bound (seeds the form). */
  currentMax: number;
  /** Called with the applied range once the move succeeds. */
  onMoved: (result: MoveRangeResult) => void;
}

/** Move Range confirm dialog (PP-MGR-MOD-001). */
export function MoveRangeModal({
  open,
  onOpenChange,
  position,
  currentMin,
  currentMax,
  onMoved,
}: MoveRangeModalProps) {
  const t = useTranslations("manager");
  // The wallet-step labels + shared error UI live in the strategies namespace (the runner renders
  // strategies-scoped UI); the form copy stays in the manager namespace.
  const tSign = useTranslations("strategies");
  // Real mode runs the on-chain rebalance (build orchestration → send) through the wallet-sign runner;
  // mock keeps the mock service. The executor is mock-safe (no-op in mock mode), so it is always called.
  const realMode = !isMockMode;
  const moveRange = useMoveRange();
  // POO-419: pre-flight gate (dark-launched flag) — decides review → provision → pending. The
  // opLabel + plan title live in the strategies namespace, so reuse tSign (already scoped there).
  // POO-1042 [R2]: this modal used to pass NO op context at all, so its gate ran against a chain
  // nobody chose. The position's own network is now the gate's target chain; a position with no
  // network (mock data) yields none, and the gate stays inert rather than guessing one.
  const gate = useProvisioningGate({
    op: "move-range",
    network: position.network,
    enabled: open,
  });
  // The range is held as DISPLAYED text in the current orientation (so decimal entry is lossless);
  // canonical (token1 per token0) is derived at the edges below. Inversion is purely a display/input
  // transform (invertPrice.ts) — the on-chain path always consumes canonical bounds.
  // Pool grid for the usable-tick snap: exact (on-chain tick) when token decimals are known (POO-408).
  const grid = {
    currentPrice: position.currentPrice,
    feeBps: position.feeBps,
    decimals0: position.decimals0,
    decimals1: position.decimals1,
  };
  // Seed the form from the position's current range. In real mode (decimals known) the seed snaps to
  // the exact usable tick — idempotent, since the current range is already tick-derived; in mock mode
  // it passes through (no on-chain ticks to align to) — POO-408 R3.
  const snapSeed = (price: number) =>
    grid.decimals0 != null && grid.decimals1 != null
      ? roundPrice(snapPriceForPool(price, grid), position.currentPrice)
      : String(price);
  const [min, setMin] = useState(() => snapSeed(currentMin));
  const [max, setMax] = useState(() => snapSeed(currentMax));
  // Full-range mode: no min/max, ~50/50 split, no needle band (RangeBar/getRangeStatus handle full).
  const [full, setFull] = useState(false);
  const [activePreset, setActivePreset] = useState<number | "full" | null>(null);
  // Price-orientation toggle: the on-chain pool is canonical token1/token0, but the manager can flip
  // the editor to read/set the range the other way (e.g. USDC-per-ETH). View-only — canonical stays
  // canonical (see canonBounds) so the flow + status + split are unaffected.
  const [inverted, setInverted] = useState(false);
  // POO-463 R2: the manager default (5%) matches the old product's global default and this flow's cap.
  const [slippage, setSlippage] = useState<number>(MANAGER_DEFAULT_SLIPPAGE_PCT);
  // Deadline matches the standard settings sheet (slippage + deadline for swap flows). PP-INTEGRATION-
  // POINT: thread it into the real move-range tx (useMoveRange) — today only slippage is wired on-chain.
  const [deadlineMins, setDeadlineMins] = useState(30);
  // The dialog lifecycle: edit the range (form), confirm the move (review), the multistep wallet
  // handoff (pending), the failure view (error). `formError` is a pre-flight inline error in the form
  // (e.g. missing on-chain data).
  // POO-597: `building` runs the server build (pauseAfterKey) before the Review; the Review shows the
  // built figures + a 10s re-quote countdown, and the wallet send is only called on the Review approve.
  // POO-419: "provision" sits between the Review approve and pending — the pre-flight top-up when the
  // wallet is short on gas for the move-range; on cancel it returns to review.
  const [phase, setPhase] = useState<
    "form" | "building" | "review" | "provision" | "pending" | "error"
  >("form");
  const [formError, setFormError] = useState<string | null>(null);
  // Slippage lives behind a settings gear (#9) rather than inline.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Mock-mode move result, captured by the mock confirm step and reported to onMoved on success.
  const mockResultRef = useRef<MoveRangeResult | null>(null);

  const token0 = position.token0 ?? DEFAULT_TOKEN0;
  const token1 = position.token1;
  const pairLabel = inverted ? `${token1}/${token0}` : `${token0}/${token1}`;
  // The unit string for a price reading in the current orientation (R1: "{token1} per {token0}").
  const priceUnit = inverted ? `${token0} per ${token1}` : `${token1} per ${token0}`;

  // Displayed numbers in the current orientation.
  const dispMinNum = Number.parseFloat(min);
  const dispMaxNum = Number.parseFloat(max);
  const dispCurrent = inverted ? invert(position.currentPrice) : position.currentPrice;

  // Canonical bounds (token1 per token0) for status / split / RangeBar / the on-chain input. When
  // inverted the displayed bounds are reciprocated AND swapped to recover the canonical pair.
  const canon = toCanonicalBounds(
    Number.isFinite(dispMinNum) ? dispMinNum : Number.NaN,
    Number.isFinite(dispMaxNum) ? dispMaxNum : Number.NaN,
    inverted,
  );
  const canonMin = canon.min;
  const canonMax = canon.max;
  // POO-860 R4: the new range is valid when full, or when it spans at least the 2-tick minimum on the
  // pool's grid (isRangeWideEnough already rejects max<=min and non-positive/NaN bounds). This gates
  // the Move CTA and drives the inline error, matching the create-pool tick backstop.
  const valid = full || isRangeWideEnough(canonMin, canonMax, grid);
  // POO-900 R1: once the band sits at (or, mid-edit, below) the 2-spacing minimum, the steppers that
  // would narrow it further - displayed-min "+" and displayed-max "−" - are disabled. Measured on the
  // canonical bounds, so it is orientation-independent (R6: inversion flips the mapped side AND the
  // step direction, so the displayed narrowing pair is the same). The clamp inside `nudge` stays as
  // an idempotent safety net; widening is never disabled (R5).
  const widthSpacings = full ? null : rangeSpacingsForPool(canonMin, canonMax, grid);
  const atMinWidth = widthSpacings !== null && widthSpacings <= MIN_RANGE_SPACINGS;

  // Live in/out-of-range for the NEW range vs the current price (#6) — always computed canonical.
  const status = getRangeStatus(position.currentPrice, {
    full,
    minPrice: full ? null : Number.isFinite(canonMin) ? canonMin : null,
    maxPrice: full ? null : Number.isFinite(canonMax) ? canonMax : null,
  });
  // Estimated value split between the two tokens for the new range (#5 / R5) — pure math, canonical.
  const split = tokenSplit(
    position.currentPrice,
    full ? null : Number.isFinite(canonMin) ? canonMin : null,
    full ? null : Number.isFinite(canonMax) ? canonMax : null,
    full,
  );

  // POO-501: the per-token value split of the WHOLE pool position from its raw reserves (canonical),
  // the SAME lib as the manager Remove/Close modal (positionTokenSplit, PP-CORE-LIB-022). Null when
  // the target carries no reserve block (mock LivePositionCard target / lean real read) → the legend
  // degrades to percent-only (R4). Recomputed only when the reserves change (not per keystroke).
  const reserveSplit = useMemo<PositionSplit | null>(() => {
    const r = position.reserves;
    if (!r) return null;
    const input: PositionSplitInput = {
      totalSupply0: r.totalSupply0,
      totalSupply1: r.totalSupply1,
      tickCurrent: r.tickCurrent,
      decimals0: r.decimals0,
      decimals1: r.decimals1,
    };
    return positionTokenSplit(input);
  }, [position.reserves]);

  // POO-501 R2/R7: estimated per-token amount + USD for the NEW range, derived from the canonical
  // tokenSplit percentages applied to the pool-value anchor. Recomputes live with the range inputs
  // (the split above is recomputed per render). Null → percent-only legend (R4).
  const newRangeLegs = useMemo(
    () => estimateNewRangeLegs(reserveSplit, position.poolValueUsd, split.pct0, split.pct1),
    [reserveSplit, position.poolValueUsd, split.pct0, split.pct1],
  );
  // POO-501 R3: current per-token balance (reserves + USD share of the anchor). Range-independent.
  const currentLegs = useMemo(
    () => currentBalanceLegs(reserveSplit, position.poolValueUsd),
    [reserveSplit, position.poolValueUsd],
  );

  // POO-518 R1: the bounds a FULL move reports are the prices derived from the widest usable ticks
  // (fullRangeTicks, POO-394) — never the seeded current band. Token decimals shift the human price
  // by 10^(decimals0 - decimals1); mock targets without decimals fall back to the same-decimals
  // read (the raw 1.0001^tick bounds), and the parents render the full-range representation anyway.
  const fullPrices = useMemo(
    () => fullRangePrices(position.feeBps, position.decimals0 ?? 0, position.decimals1 ?? 0),
    [position.feeBps, position.decimals0, position.decimals1],
  );

  // Real-mode move-range input (network + decimals + the entered range); null until they're present
  // (the manage-detail carries them) and the range is valid. The mock path drives a 2-step mock flow.
  const moveRangeInput = useMemo<MoveRangeRunInput | null>(() => {
    if (!realMode || !valid) return null;
    if (position.network == null || position.decimals0 == null || position.decimals1 == null) {
      return null;
    }
    const base = {
      network: position.network,
      positionId: position.strategyId as `0x${string}`,
      feeBps: position.feeBps,
      decimals0: position.decimals0,
      decimals1: position.decimals1,
      slippagePct: slippage,
    };
    // Full-range (POO-394): the widest usable ticks, no bounds. Otherwise the entered canonical range.
    return full
      ? { ...base, fullRange: true }
      : { ...base, minPrice: canonMin, maxPrice: canonMax };
  }, [realMode, full, valid, position, canonMin, canonMax, slippage]);

  // The signing sequence (build orchestration → send) driven by the runner; mock mode runs a 2-step
  // mock flow that ends by calling managerService.moveRange so the parent gets a real result.
  const moveRangeSteps = useMemo<FlowStep<MoveRangeCtx>[]>(() => {
    if (realMode) return moveRangeInput ? moveRange.buildSteps(moveRangeInput) : [];
    const beat = () => new Promise((resolve) => setTimeout(resolve, MOCK_STEP_MS));
    return [
      {
        key: "build",
        run: async () => {
          await beat();
          // POO-611: the mock build carries a real-shaped swapInfo (price impact / protocol fee / min
          // received) so the Review demos real figures in mock mode; gas stays the honest estimate. The
          // whole pool value is the swap-size proxy for the rebalance (falls back when the anchor is absent).
          return {
            built: {
              tx: MOCK_BUILT_TX,
              swapInfo: settleSwapInfo(position.poolValueUsd ?? 10_000, { slippagePct: slippage }),
            },
          };
        },
      },
      {
        key: "confirm:moveRange",
        run: async () => {
          await beat();
          // POO-499 R6 (PP-MOCK): a gear slippage <= 0.1% fails deterministically with the canned
          // slippage error so the auto-retry -> slippage view -> auto-open path is demoable in mock mode.
          if (settleOutcomeForSlippage(slippage) === "error") {
            const mockError = settleTxError();
            throw Object.assign(new Error(mockError.message), { code: mockError.code });
          }
          // PP-INTEGRATION-POINT: mock move-range; real path runs the on-chain rebalance above.
          // POO-518 R1: a full move carries the fullRangeTicks-derived bounds + full (never the
          // seeded band), matching what the real reposition emits on-chain.
          mockResultRef.current = await managerService.moveRange(position.strategyId, {
            rangeMin: full ? fullPrices.minPrice : canonMin,
            rangeMax: full ? fullPrices.maxPrice : canonMax,
            full,
            slippagePct: slippage,
          });
          return {};
        },
      },
    ];
  }, [
    realMode,
    moveRangeInput,
    moveRange,
    position.strategyId,
    position.poolValueUsd,
    full,
    fullPrices,
    canonMin,
    canonMax,
    slippage,
  ]);
  // POO-597: the flow now PAUSES after the build (pauseAfterKey), so the Review renders the BUILT
  // figures before signing; resume() sends, rebuild() re-quotes only the build (POO-574 handshake).
  const flow = useWalletSignFlow(moveRangeSteps, {
    fallbackErrorCode: "MOVE_RANGE_FAILED",
    pauseAfterKey: "build",
  });
  // POO-597 R3: the real gas from the built tx once the build has run; the honest gasCostUsd estimate
  // otherwise (pre-build, and in mock mode where the build returns no figure).
  const builtGasUsd = flow.context.built?.estimatedGasInUsd ?? position.gasCostUsd;
  // POO-612 R1: the real price impact from the built quote. A move range always swaps to rebalance,
  // so it shows whenever the build has run. No min-received (nothing is paid out, the position migrates
  // in place); the swap protocol fee is NOT folded here since the USD row is gas-specific (unlike the
  // Withdraw/Remove combined "Est. fees" row) and swapInfo.protocolFee is unconfirmed vs the native
  // move-range fee (POO-521) — revisit when the disambiguation lands.
  const swapInfo = flow.context.built?.swapInfo;
  // POO-1011: the catastrophic price-impact gate (>= 10% blocks the Review CTA behind an explicit
  // funds-at-risk acknowledgment).
  const impactGate = usePriceImpactGate(swapInfo?.priceImpactPercentage, phase === "review");
  // POO-597 R4: the shared Review re-quote countdown; at 0 it re-quotes via flow.rebuild() + resets.
  // POO-888 R3: the Review approve suspends it synchronously (same-tick zero-cross vs send race).
  const { seconds: countdown, suspend: suspendCountdown } = useReviewCountdown({
    active: phase === "review",
    seconds: REVIEW_REFRESH_SECS,
    onRefresh: flow.rebuild,
  });
  // POO-499 (POO-467 R2/R3): shared slippage auto-retry — one auto retry from the build step on the
  // first slippage failure (pending notice, no error view), then a slippage error view + settings
  // auto-open on the second. Non-slippage failures pass through untouched (R4).
  const slippageRetry = useSlippageAutoRetry({
    flow,
    flowName: "moveRange",
    strategyId: position.strategyId,
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
  const stepLabels = resolveWalletSignSteps(MOVE_RANGE_SPEC, tSign);

  // Reset to the form whenever the dialog (re)opens. POO-513 R2: the gear settings also reset to
  // the manager defaults (universal reset-on-close policy; seeding on reopen covers every close
  // path, including the success auto-close, mirroring RemoveLiquidityModal), so a stale custom
  // slippage never carries into the next move-range build.
  useEffect(() => {
    if (open) {
      setPhase("form");
      setFormError(null);
      setSlippage(MANAGER_DEFAULT_SLIPPAGE_PCT);
      setDeadlineMins(30);
      setSettingsOpen(false);
      flow.reset();
    }
  }, [open, flow.reset]);

  // Drive the outcome off the runner: success reports the applied range + closes; a thrown step routes
  // to the error view (retry resumes from the failed step).
  useEffect(() => {
    if (phase !== "pending") return;
    if (flow.status === "success") {
      // POO-518 R1: a full move reports the fullRangeTicks-derived bounds + full: true (the actual
      // applied range), never the seeded band; a band move reports the entered canonical bounds.
      const applied = full
        ? { rangeMin: fullPrices.minPrice, rangeMax: fullPrices.maxPrice, full: true }
        : { rangeMin: canonMin, rangeMax: canonMax, full: false };
      const result: MoveRangeResult = realMode
        ? { ...applied, gasCostUsd: position.gasCostUsd }
        : (mockResultRef.current ?? { ...applied, gasCostUsd: position.gasCostUsd });
      onMoved(result);
      // Close + reset (the guard above + the idle status block a re-fire on the next render).
      flow.reset();
      setPhase("form");
      setFormError(null);
      onOpenChange(false);
    } else if (flow.status === "error") {
      // POO-499 R2: the first slippage failure auto-retries — hold the pending phase (the notice
      // renders there), do not flip to the error view yet.
      if (slippageRetry.autoRetrying) return;
      setPhase("error");
    }
  }, [
    phase,
    flow.status,
    flow.reset,
    slippageRetry.autoRetrying,
    realMode,
    full,
    fullPrices,
    canonMin,
    canonMax,
    position.gasCostUsd,
    onMoved,
    onOpenChange,
  ]);

  // POO-597: the build settling into `awaiting` advances the spinner to the Review (reading the built
  // figures from flow.context); a build failure (initial or a Review rebuild) surfaces the error view.
  useEffect(() => {
    if (phase === "building" && flow.status === "awaiting") {
      setPhase("review");
    } else if ((phase === "building" || phase === "review") && flow.status === "error") {
      setPhase("error");
    }
  }, [phase, flow.status]);

  const minLabel = t("mandate.rangeMin");
  const maxLabel = t("mandate.rangeMax");
  const numeric = (value: string) => value.replace(/[^\d.]/g, "");

  /** Nudge a displayed bound by one tick step. The grid lives in canonical space, so when inverted
   *  the displayed bound maps to the OPPOSITE canonical bound and raising it LOWERS the canonical one
   *  (the reciprocal is decreasing) — both the side and the direction flip. */
  function nudge(which: "min" | "max", dir: 1 | -1) {
    const canonWhich: "min" | "max" = inverted ? (which === "min" ? "max" : "min") : which;
    const canonDir = (inverted ? -dir : dir) as 1 | -1;
    const base = canonWhich === "min" ? canonMin : canonMax;
    const from = Number.isFinite(base) && base > 0 ? base : position.currentPrice;
    const stepped = stepPriceForPool(from, grid, canonDir);
    const nextCanon = {
      min: Number.isFinite(canonMin) ? canonMin : position.currentPrice,
      max: Number.isFinite(canonMax) ? canonMax : position.currentPrice,
    };
    // POO-881 R6/R8: hard-stop — a step can never invert or over-narrow the range. Clamp the stepped
    // bound to stay at least the 2-tick minimum off the (unchanged) opposite bound.
    const opposite = canonWhich === "min" ? nextCanon.max : nextCanon.min;
    nextCanon[canonWhich] =
      opposite > 0 ? clampRangeBound(stepped, opposite, canonWhich, grid) : stepped;
    const disp = toDisplayBounds(nextCanon.min, nextCanon.max, inverted);
    setFull(false);
    setActivePreset(null);
    if (which === "min") setMin(roundPrice(disp.min, dispCurrent));
    else setMax(roundPrice(disp.max, dispCurrent));
  }

  function recenter() {
    setFull(false);
    setActivePreset(null);
    const width =
      Number.isFinite(canonMin) && Number.isFinite(canonMax) && canonMax > canonMin
        ? canonMax - canonMin
        : position.currentPrice * 0.16;
    const half = width / 2;
    const disp = toDisplayBounds(
      snapPriceForPool(position.currentPrice - half, grid),
      snapPriceForPool(position.currentPrice + half, grid),
      inverted,
    );
    setMin(roundPrice(disp.min, dispCurrent));
    setMax(roundPrice(disp.max, dispCurrent));
  }

  /** Set a symmetric ±pct range around the current price (#5). The band is symmetric in canonical
   *  space, then re-expressed in the displayed orientation. */
  function applyPreset(pct: number) {
    setFull(false);
    setActivePreset(pct);
    const disp = toDisplayBounds(
      snapPriceForPool(position.currentPrice * (1 - pct / 100), grid),
      snapPriceForPool(position.currentPrice * (1 + pct / 100), grid),
      inverted,
    );
    setMin(roundPrice(disp.min, dispCurrent));
    setMax(roundPrice(disp.max, dispCurrent));
  }

  /** Snap a manually-typed bound onto the pool's usable-tick grid (called on blur). Snapping is in
   *  canonical space (the displayed bound re-derives), so it is orientation-agnostic (POO-408 R2). */
  function snapBound(which: "min" | "max") {
    const dispRaw = which === "min" ? dispMinNum : dispMaxNum;
    if (!Number.isFinite(dispRaw) || dispRaw <= 0) return;
    const canonWhich: "min" | "max" = inverted ? (which === "min" ? "max" : "min") : which;
    const target = canonWhich === "min" ? canonMin : canonMax;
    if (!Number.isFinite(target) || target <= 0) return;
    const snapped = snapPriceForPool(target, grid);
    const nextCanon = {
      min: Number.isFinite(canonMin) ? canonMin : position.currentPrice,
      max: Number.isFinite(canonMax) ? canonMax : position.currentPrice,
    };
    // POO-881 R5/R8: snap the blurred field back to the nearest VALID bound — min can't exceed max
    // (nor max fall below min), keeping the 2-tick minimum against the opposite bound.
    const opposite = canonWhich === "min" ? nextCanon.max : nextCanon.min;
    nextCanon[canonWhich] =
      opposite > 0 ? clampRangeBound(snapped, opposite, canonWhich, grid) : snapped;
    const disp = toDisplayBounds(nextCanon.min, nextCanon.max, inverted);
    if (which === "min") setMin(roundPrice(disp.min, dispCurrent));
    else setMax(roundPrice(disp.max, dispCurrent));
  }

  /** Switch to full-range mode (#4 / R4 — POO-339 debt resolved): no bounds, ~50/50, always in range. */
  function applyFull() {
    setFull(true);
    setActivePreset("full");
  }

  /** Flip the displayed price orientation (canonical ⇄ reciprocal), re-expressing the displayed bounds
   *  so they keep representing the same canonical range (R2). Full-range has no orientation to flip. */
  function toggleInverted() {
    if (full) {
      setInverted((prev) => !prev);
      return;
    }
    const next = !inverted;
    const refDisp = next ? invert(position.currentPrice) : position.currentPrice;
    const disp = toDisplayBounds(canonMin, canonMax, next);
    setActivePreset(null);
    if (Number.isFinite(disp.min)) setMin(roundPrice(disp.min, refDisp));
    if (Number.isFinite(disp.max)) setMax(roundPrice(disp.max, refDisp));
    setInverted(next);
  }

  /** Form CTA (POO-597): validate + build the tx, then the Review (built figures) precedes signing.
   *  Real mode needs the network slug + token decimals; when they're missing the input can't be built,
   *  so surface it inline and never advance. */
  function startBuild() {
    if (!valid) return;
    if (realMode && moveRangeInput == null) {
      setFormError(t("operate.error"));
      return;
    }
    setFormError(null);
    // POO-597: building is NEVER gated — the pre-flight gas gate is checked only at the Review approve
    // (see `approve`), mirroring WithdrawModal. Continuing here just builds the tx (pauseAfterKey), so
    // the Review can show the built figures before the wallet is called.
    setPhase("building");
    // reset() rebuilds the per-step arrays for the current input before the run starts.
    flow.reset();
    void flow.run();
  }

  /** Review approve CTA (POO-597 handshake + POO-419 gate): the tx is already built (we paused after
   *  the build), so approving resumes into the wallet send step — the build is not re-run here. POO-419:
   *  if the wallet is short on gas for the move-range (a gas-only op, no amount), provision first, then
   *  resume from the provision panel's onDone. POO-1042 [R2]/[R3]: the op context now rides on the
   *  hook (the position's network); the move spends no USDC, so `evaluate` carries no amount. */
  function approve() {
    // POO-888 R3: suspend the re-quote countdown SYNCHRONOUSLY before anything else, so a
    // zero-crossing in this same tick cannot race the send.
    suspendCountdown();
    if (gate.evaluate()) {
      setPhase("provision");
      return;
    }
    setPhase("pending");
    void flow.resume();
  }

  /** Close handler that also resets the flow + phase (so a reopen starts clean). */
  function handleOpenChange(next: boolean) {
    // POO-419 R3: no dismissal while provisioning is executing (ESC / overlay / X are all blocked).
    if (!next && gate.locked) return;
    if (!next) {
      flow.reset();
      setPhase("form");
      setFormError(null);
      gate.reset();
    }
    onOpenChange(next);
  }

  const stepper =
    "inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-border text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1.5 font-medium text-sm transition-colors",
      active
        ? "border-primary bg-primary/10 text-foreground"
        : "border-border text-muted-foreground hover:text-foreground",
    );

  /** Render a canonical [min, max] band as "{min} – {max} {token1} per {token0}" in the current
   *  orientation: when inverted the bounds are reciprocated + swapped so the reading stays min < max.
   *  Uses the magnitude-aware fmtPrice (not a fixed 4dp), so inverted ETH-class bounds stay distinct
   *  rather than collapsing to identical "0.0003 – 0.0003" strings (mirrors BuildStep's fmtPrice). */
  function rangeLabel(cMin: number, cMax: number): string {
    const disp = toDisplayBounds(cMin, cMax, inverted);
    return `${fmtPrice(disp.min)} – ${fmtPrice(disp.max)} ${priceUnit}`.replace(/\s+/g, " ").trim();
  }
  /** The position's existing range, token-by-token in the current orientation (R1). */
  const currentRangeLabel = rangeLabel(currentMin, currentMax);
  /** New range, rendered token-by-token in the current orientation (or "Full range"). */
  const newRangeLabel =
    full || !Number.isFinite(canonMin) || !Number.isFinite(canonMax)
      ? t("mandate.rangeFull")
      : rangeLabel(canonMin, canonMax);

  // POO-501 R1/R5: logos + per-token estimated sub-lines for the Estimated balance legend, resolved by
  // SYMBOL so they follow the invert pill. Majors (ETH/USDC/…) resolve without a network slug (R1);
  // an unresolved symbol renders the icon-less legend entry (never a broken img). The sub-lines are the
  // estimated new-range amounts (R2); undefined when the value block is absent → percent-only (R4). The
  // estimate is always computed canonical (token0/token1), so inversion swaps sides + presentation only,
  // never the numbers (R5).
  const iconCanon0 = resolveTokenLogo(token0, position.network);
  const iconCanon1 = resolveTokenLogo(token1, position.network);

  // POO-540 R1: the Move Range protocol fee is a flat native-token amount; compose the displayed
  // value with the network's native symbol (ETH on the L2s, POL on Polygon). An absent/unknown
  // network degrades to the ETH default via `nativeSymbol` (R4), matching the previous behavior.
  const moveRangeFee = `${MOVE_RANGE_FEE_NATIVE_AMOUNT} ${nativeSymbol(position.network)}`;
  const subCanon0 = newRangeLegs ? formatLeg(newRangeLegs.token0, token0) : undefined;
  const subCanon1 = newRangeLegs ? formatLeg(newRangeLegs.token1, token1) : undefined;
  /** Estimated-balance legend props, oriented to the current invert state (canonical when not). */
  const splitBarProps = {
    pct0: inverted ? split.pct1 : split.pct0,
    pct1: inverted ? split.pct0 : split.pct1,
    token0: inverted ? token1 : token0,
    token1: inverted ? token0 : token1,
    icon0: inverted ? iconCanon1 : iconCanon0,
    icon1: inverted ? iconCanon0 : iconCanon1,
    sub0: inverted ? subCanon1 : subCanon0,
    sub1: inverted ? subCanon0 : subCanon1,
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          {phase === "form" ? (
            <>
              {/* POO-445 R1: shared header — gear (slippage + deadline) next to the Dialog X. */}
              <TransactionModalHeader
                title={t("operate.moveRange")}
                onSettings={() => setSettingsOpen(true)}
                settingsLabel={t("operate.settings")}
              />
              <p className="text-muted-foreground text-sm">{t("operate.moveRangeDesc")}</p>

              {/* Current price, token-by-token in the current orientation (R1). */}
              <div className="flex items-center justify-between rounded-lg bg-surface-raised px-3 py-2 text-sm">
                <span className="text-muted-foreground">{t("operate.currentPrice")}</span>
                <span className="font-medium text-foreground">
                  {`${fmtPrice(dispCurrent)} ${priceUnit}`}
                </span>
              </div>

              {/* The position's existing range, read-only, token-by-token (#4 / R1). */}
              <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-raised px-3 py-2 text-sm">
                <span className="text-muted-foreground">{t("operate.currentRange")}</span>
                <span className="text-right font-medium text-foreground">{currentRangeLabel}</span>
              </div>

              {/* POO-501 R3: current per-token balance (amount + USD + logo), from the reserve value
                  block. Shown only when the block is present; absent → omitted (R4). The rows read the
                  CANONICAL token symbols (this is the position's actual composition, not a directional
                  reading), so they don't flip with the invert pill. */}
              {currentLegs ? (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-raised px-3 py-2 text-sm">
                  <span className="shrink-0 text-muted-foreground">
                    {t("operate.currentBalance")}
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <TokenAmountRow
                      symbol={token0}
                      amount={currentLegs.token0.amount}
                      usd={formatUsd(currentLegs.token0.usd)}
                      iconUrl={iconCanon0}
                    />
                    <TokenAmountRow
                      symbol={token1}
                      amount={currentLegs.token1.amount}
                      usd={formatUsd(currentLegs.token1.usd)}
                      iconUrl={iconCanon1}
                    />
                  </span>
                </div>
              ) : null}

              {/* Invert pill with the pair label, below Current range (R2). */}
              <button
                type="button"
                onClick={toggleInverted}
                aria-pressed={inverted}
                aria-label={t("operate.invert", { pair: pairLabel })}
                title={t("operate.invert", { pair: pairLabel })}
                className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border px-3 py-1 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground"
              >
                <ArrowLeftRight className="size-3.5" aria-hidden="true" />
                {pairLabel}
              </button>

              {/* Two-row range visual (POO-406 R1): the position's current range (muted) above the
                  new range (coloured), each with the price needle — matching the Figma. */}
              {valid && !full ? (
                <MoveRangePreview
                  currentMin={currentMin}
                  currentMax={currentMax}
                  newMin={canonMin}
                  newMax={canonMax}
                  price={position.currentPrice}
                  inRange={status === "in"}
                  currentLabel={t("operate.currentRange")}
                  newLabel={t("operate.rangeNew")}
                />
              ) : null}

              {/* Quick ± presets centered on the current price + a Full chip (#5 / R4). */}
              <div className="flex flex-wrap gap-2">
                {RANGE_PRESETS.map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => applyPreset(pct)}
                    aria-pressed={!full && activePreset === pct}
                    className={chip(!full && activePreset === pct)}
                  >
                    ±{pct}%
                  </button>
                ))}
                {/* Full-range preset — wired on-chain (POO-394): in real mode its MoveRangeRunInput
                    carries `fullRange: true`, so the same optimize → route → build → send pipeline
                    runs and success is reported only on a real tx hash (enabled in both modes). */}
                <button
                  type="button"
                  onClick={applyFull}
                  aria-pressed={full}
                  className={chip(full)}
                >
                  {t("mandate.rangeFull")}
                </button>
              </div>

              {full ? (
                <p className="text-muted-foreground text-xs">{t("mandate.rangeFullNote")}</p>
              ) : (
                // POO-842 R4: stack the bound editors below sm — two 40px steppers per bound in a
                // 2-column grid leave ~40px of visible text at 375px, hiding 4+ digit prices while
                // the onBlur tick-snap can rewrite digits the manager cannot see.
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(["min", "max"] as const).map((which) => {
                    const label = which === "min" ? minLabel : maxLabel;
                    const set = which === "min" ? setMin : setMax;
                    return (
                      <div key={which} className="flex flex-col gap-1.5">
                        <span className="font-medium text-foreground text-sm">{label}</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label={`${label} −`}
                            onClick={() => nudge(which, -1)}
                            disabled={atMinWidth && which === "max"}
                            className={stepper}
                          >
                            <Minus className="size-4" aria-hidden="true" />
                          </button>
                          <Input
                            value={which === "min" ? min : max}
                            inputMode="decimal"
                            aria-label={label}
                            className="flex-1 text-center"
                            onChange={(event) => {
                              setFull(false);
                              setActivePreset(null);
                              set(numeric(event.target.value));
                            }}
                            onBlur={() => snapBound(which)}
                          />
                          <button
                            type="button"
                            aria-label={`${label} +`}
                            onClick={() => nudge(which, 1)}
                            disabled={atMinWidth && which === "min"}
                            className={stepper}
                          >
                            <Plus className="size-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* POO-860 R4: inline error when the (non-full) new range is inverted, equal, or narrower
                  than the 2-tick minimum. The Move CTA is disabled while this shows. */}
              {!full && !valid ? (
                <p className="text-destructive text-xs">{t("build.config.rangeError")}</p>
              ) : null}

              {/* Estimated balance: the value split between the two tokens for the new range (R5),
                  with logos + estimated per-token amount/USD sub-lines when the value block is present
                  (POO-501 R1/R2); degrades to the percent-only legend otherwise (R4). */}
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised/40 p-3">
                <p className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                  {t("operate.estimatedBalance")}
                </p>
                <TokenSplitBar {...splitBarProps} />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={recenter}
                  className="text-primary text-sm hover:underline"
                >
                  {t("operate.recenter")}
                </button>
                {/* Live in/out-of-range for the NEW range (#6) — directionless; the bar shows the side. */}
                <RangeStatusLine status={status} />
              </div>

              {/* POO-406 R2: the form gas note was removed — the Review shows the network fee. */}
              {formError ? <p className="text-destructive text-xs">{formError}</p> : null}

              <DialogFooter>
                <Button variant="secondary" onClick={() => handleOpenChange(false)}>
                  {t("operate.cancel")}
                </Button>
                <Button onClick={startBuild} disabled={!valid}>
                  {t("operate.moveRange")}
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {phase === "building" ? (
            <>
              <DialogHeader className="sr-only">
                <DialogTitle>{t("operate.applying")}</DialogTitle>
              </DialogHeader>
              {/* POO-597: the server builds the tx here; on settle the flow pauses (awaiting) and the
                  effect advances to the Review with the built figures. */}
              <BuildingStep label={tSign("flow.processing")} />
            </>
          ) : null}

          {phase === "review" ? (
            <>
              {/* POO-570 R1: the gear lives on the form (input) step; this Review header only carries
                  Back (the redundant Review gear was removed). */}
              <TransactionModalHeader
                title={t("operate.reviewTitle")}
                onBack={() => setPhase("form")}
                backLabel={t("operate.reviewBack")}
              />

              {/* POO-597 R4: the visible re-quote countdown — the built figures refresh when it hits 0. */}
              <p className="flex items-center justify-center gap-1.5 text-muted-foreground text-xs">
                <RefreshCw className="size-3.5" aria-hidden="true" />
                {tSign("flow.review.refreshIn", { seconds: countdown })}
              </p>
              {/* POO-885 R2/R4: subtle stale-quote hint after 3 consecutive background re-quote
                  failures (non-fatal; the countdown keeps retrying with the last good quote). */}
              {flow.quoteStale ? (
                <p className="text-center text-warning text-xs">
                  {tSign("flow.review.quoteStale")}
                </p>
              ) : null}

              {/* Current range → New range. */}
              <div className="flex flex-col gap-2 rounded-lg bg-surface-raised px-3 py-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t("operate.currentRange")}</span>
                  <span className="text-right font-medium text-foreground">
                    {currentRangeLabel}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t("operate.rangeNew")}</span>
                  <span className="text-right font-medium text-foreground">{newRangeLabel}</span>
                </div>
              </div>

              {/* Estimated balance for the new range (R5/R6), with logos + per-token estimated
                  amounts in the Review too (POO-501 R2/R3); degrades to percent-only (R4). */}
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised/40 p-3">
                <p className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                  {t("operate.estimatedBalance")}
                </p>
                <TokenSplitBar {...splitBarProps} />
              </div>

              {/* POO-445 R6: fee block on the shared ReceiptRows. The move range fee (a native-token
                  amount, POO-540 R1) stays on its own row — it can't be summed with the USD gas (R4
                  exception) and carries NO tooltip (POO-515 R4). Network gas is the sole USD fee and
                  gets a gas-only breakdown tooltip (POO-515 R4, parity with the other modals' Fee
                  rows); both render neutral, never red (R5). Max slippage moved to the ⚙ gear. */}
              <ReceiptRows
                groups={[
                  [
                    { label: t("operate.fee"), value: moveRangeFee },
                    buildFeeRow({
                      label: t("operate.networkFee"),
                      lines: [
                        {
                          key: "network",
                          label: t("operate.feesTooltip.network"),
                          usd: builtGasUsd,
                        },
                      ],
                      totalLabel: t("operate.feesTooltip.total"),
                    }),
                    // POO-612 R1 / POO-613: the real price impact of the rebalancing swap; amber >= 2%.
                    ...(swapInfo != null
                      ? [
                          buildPriceImpactRow(
                            tSign("flow.review.priceImpact"),
                            swapInfo.priceImpactPercentage,
                          ),
                        ]
                      : []),
                    // PP-MOCK: ETA placeholder until the gas estimator returns a real time.
                    { label: t("operate.estTime"), value: EST_TIME },
                  ],
                ]}
              />

              {/* Assurance: investors keep their exposure; the position migrates in place (R6). */}
              <p className="rounded-lg bg-surface-raised/60 px-3 py-2.5 text-muted-foreground text-xs">
                {t("operate.reviewAssurance")}
              </p>

              {/* POO-1011 [R2]: the funds-at-risk gate, always visible above the CTA. */}
              <PriceImpactGate
                priceImpactPct={swapInfo?.priceImpactPercentage}
                acknowledged={impactGate.acknowledged}
                onAcknowledgedChange={impactGate.setAcknowledged}
              />

              {/* POO-406 R5: no bottom Back button — the top-left back arrow returns to the form. */}
              <DialogFooter>
                <Button className="w-full" onClick={approve} disabled={impactGate.blocked}>
                  {t("operate.reviewConfirm")}
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {/* POO-419: pre-flight top-up before signing the move-range (gas-only). onDone resumes the
              original transition into pending; onCancel returns to review. */}
          {phase === "provision" && gate.input ? (
            <>
              <DialogHeader className="sr-only">
                <DialogTitle>{tSign("provisioning.plan.title")}</DialogTitle>
              </DialogHeader>
              <ProvisioningPanel
                input={gate.input}
                context={gate.context}
                opLabel={tSign(provisioningOpLabelKey("move-range"), { strategy: pairLabel })}
                onDone={() => {
                  gate.setLocked(false);
                  setPhase("pending");
                  // POO-597 handshake: the move-range flow is paused after the build; resume it into
                  // the wallet send step (do NOT flow.run(), which would rebuild the tx from scratch).
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
                <DialogTitle>{t("operate.applying")}</DialogTitle>
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
      </Dialog>

      {/* Settings: the standard shared sheet — slippage presets + custom (0.1-100%, POO-547) + deadline. */}
      <TransactionSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        slippage={slippage}
        onSlippageChange={setSlippage}
        deadlineMins={deadlineMins}
        onDeadlineChange={setDeadlineMins}
      />
    </>
  );
}

/**
 * Two stacked price tracks (POO-406 R1): the position's existing range (muted) above the chosen new
 * range (green in range / amber out), each with the current-price needle and an inline dotted label.
 * Both tracks share one domain so the needle lines up. Replaces the single overlaid RangeBar + legend
 * to match the Figma. Canonical bounds in, purely presentational (orientation is handled upstream).
 */
function MoveRangePreview({
  currentMin,
  currentMax,
  newMin,
  newMax,
  price,
  inRange,
  currentLabel,
  newLabel,
}: {
  currentMin: number;
  currentMax: number;
  newMin: number;
  newMax: number;
  price: number;
  inRange: boolean;
  currentLabel: string;
  newLabel: string;
}) {
  const lo = Math.min(currentMin, newMin, price);
  const hi = Math.max(currentMax, newMax, price);
  const pad = hi > lo ? (hi - lo) * 0.15 : Math.max(hi * 0.05, 1);
  const domainLo = lo - pad;
  const domain = hi + pad - domainLo || 1;
  const pos = (x: number) => Math.min(100, Math.max(0, ((x - domainLo) / domain) * 100));

  /** One labelled track: a dotted label above, then the band + price needle. */
  function row(
    label: string,
    bandMin: number,
    bandMax: number,
    bandClass: string,
    dotClass: string,
  ) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className={cn("size-2 rounded-full", dotClass)} aria-hidden="true" />
          {label}
        </span>
        <div className="relative h-2 w-full rounded-full bg-surface-raised">
          <div
            className={cn("absolute inset-y-0 rounded-full", bandClass)}
            style={{ left: `${pos(bandMin)}%`, right: `${100 - pos(bandMax)}%` }}
          />
          <div
            className={cn("absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full", dotClass)}
            style={{ left: `${pos(price)}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="move-range-preview"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised/40 p-3"
      aria-hidden="true"
    >
      {row(
        currentLabel,
        currentMin,
        currentMax,
        "bg-muted-foreground/25",
        "bg-muted-foreground/60",
      )}
      {row(
        newLabel,
        newMin,
        newMax,
        inRange ? "bg-success/30" : "bg-warning/30",
        inRange ? "bg-success" : "bg-warning",
      )}
    </div>
  );
}
