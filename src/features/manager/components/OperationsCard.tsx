/**
 * @id PP-MGR-CMP-017
 * @name OperationsCard
 * @implements-rules-version v2 (POO-804 rules v1)
 *
 * The manage-detail Operations rail: the Show-in-Explore discovery toggle plus the V1 manage
 * actions (Pause/Resume deposits, Collect fees, Move range, Close strategy). Pause/Resume/Close
 * confirm through the shared ConfirmDialog; Collect opens the investor Collect dialog in manager
 * mode (POO-286 R1) and Move range opens the POO-242 MoveRangeModal (POO-286 R2). The mandate and
 * the pool are fixed after creation, so there is deliberately no edit affordance here.
 *
 * POO-804 R3: the Close-strategy confirmation shares the RemoveLiquidityModal's close copy + the
 * [Continue] / [Keep the strategy] labels (one confirmation language for both close entries; the
 * old "investors keep their positions" body contradicted the close semantics and is gone).
 *
 * POO-501: threads the position's raw reserve block + pool-value anchor (detail.aum) into the Move
 * Range target (mirroring the Remove/Close threading), so the modal renders per-token estimated
 * amounts + logos; omitted when the detail lacks the block (R4).
 *
 * POO-520: the Add-liquidity InvestModal is flagged `depositOrigin="manager"`, so an
 * insufficient-funds Deposit & invest returns here (/manager?manage=<id>&invest=<amount>) instead of
 * the investor detail; `investResume` (threaded from that deep link) re-arms the modal once at the
 * Confirm & sign step with the preserved amount (POO-494 resume rules).
 */
"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Toggle } from "@/components/ui/Toggle";
import { CollectModal, type ManagedCollect } from "@/features/strategies/components/CollectModal";
import { InvestModal } from "@/features/strategies/components/InvestModal";
import { useInvest } from "@/features/strategies/hooks/useInvest";
import { useAccountService } from "@/lib/account/useAccountService";
import { networkToChainId } from "@/lib/chains/config";
import { MIN_AMOUNT_FOR_ADD_LIQUIDITY } from "@/lib/config/operationMinimums";
import type { ManagerStrategyDetail, Strategy } from "@/lib/schemas";
import { isMockMode, type MoveRangeResult } from "@/lib/services";
import { cn } from "@/lib/utils/cn";
import { formatPercent } from "@/lib/utils/format";
import { MoveRangeModal } from "./MoveRangeModal";
import { RemoveLiquidityModal } from "./RemoveLiquidityModal";

/** The confirmable operations. */
type Operation = "pause" | "resume" | "close";

/**
 * Adapts the manage-detail to the investor {@link InvestModal}'s {@link Strategy} shape, so the
 * manager adds liquidity to their own pool through the SAME flow as an investor (murilo 2026-06-29).
 * Only the fields the modal + the invest tx-build read carry weight (id / name / network / pool /
 * pair / min / est return); the rest are filled truthfully from the detail.
 */
function toInvestStrategy(detail: ManagerStrategyDetail): Strategy {
  return {
    id: detail.id,
    name: detail.name,
    manager: detail.name,
    riskLevel: detail.riskLevel,
    minInvestment: MIN_AMOUNT_FOR_ADD_LIQUIDITY,
    tvl: detail.aum,
    investors: detail.investors,
    estReturn: detail.apy,
    rateType: "APR",
    // The manage view never renders for a draft, so the status is active / paused / closed.
    status: detail.status === "draft" ? "active" : detail.status,
    network: detail.pool.network,
    pool: detail.pool.address,
    poolPair: { token0: detail.pool.token0, token1: detail.pool.token1 },
  };
}

/** Public props for {@link OperationsCard}. */
export interface OperationsCardProps {
  /** The strategy being managed. */
  detail: ManagerStrategyDetail;
  /** Flips the Explore listing (already-confirmed UI; optimistic in the parent). */
  onToggleExplore: (visible: boolean) => void;
  /** Pause (true) / resume (false) new deposits. Called after the user confirms. */
  onSetPaused: (paused: boolean) => Promise<void>;
  /**
   * Collect the claimable fees. Runs inside the Collect dialog's pending phase. `collectAsTokenPair`
   * carries the receive-as choice (POO-417 R2); `slippageTolerance` carries the gear's slippage
   * (POO-478 R2) so the manager collect-as-USDC swap uses it. Resolving with the mined hash lets the
   * receipt link the real transaction (POO-505 R4); undefined keeps the mock settle hash.
   */
  onCollect: (
    collectAsTokenPair: boolean,
    slippageTolerance: number,
  ) => Promise<{ hash: string } | undefined>;
  /**
   * POO-802 R0: real-mode handshake steps for the managed collect (useManagerCollect.buildSteps
   * shaped) — the build step pauses the Review on REAL figures, the confirm step only signs +
   * sends. Absent → the mock console's `onCollect` fold.
   */
  collectBuildSteps?: ManagedCollect["buildSteps"];
  /**
   * Refresh the detail after a successful Move range (the modal already ran the mutation). Receives
   * the applied range so the caller can reflect the new bounds in place (POO-462).
   */
  onRangeMoved: (result: MoveRangeResult) => void | Promise<void>;
  /**
   * Refresh after a successful remove-liquidity; `closed` is true when the position was closed. A
   * partial passes the reduced stake (`newStakeUsd`, USD) for the optimistic patch (POO-517 R3).
   */
  onRemoved: (closed: boolean, newStakeUsd?: number) => void | Promise<void>;
  /** Refresh after the manager adds liquidity through the investor Invest flow. */
  onLiquidityAdded?: () => void | Promise<void>;
  /**
   * Amount returning from a manager-origin Deposit & invest top-up (POO-520 R1). When set, the
   * Add-liquidity InvestModal opens once armed at Confirm & sign with this amount (POO-494 resume
   * rules). Null/absent leaves the rail untouched.
   */
  investResume?: number | null;
}

/**
 * POO-738: wraps an inert control with a "coming soon" tooltip on hover/focus (a setting with no
 * backend yet, POO-314). A CSS tooltip (role="tooltip", always in the DOM, opacity-toggled) mirrors
 * the wallet ActionButton pattern (POO-285). The child must stay keyboard-FOCUSABLE (soft-disabled:
 * `aria-disabled` + inert click, NOT native `disabled`) so `group-focus-within` reveals the hint on
 * keyboard focus, not only on mouse hover; a natively-`disabled` child would drop out of the tab
 * order and leave the reason unreachable by keyboard (a11y).
 *
 * POO-840 R4: iOS taps neither hover nor focus a button, so hover/focus alone left these controls
 * as silent dead taps on touch — a tap (bubbling up from the inert child) now reveals the hint
 * explicitly, and a tap outside dismisses it.
 */
function ComingSoonHint({
  hint,
  className,
  children,
}: {
  hint: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users already reach the hint via group-focus-within on the focusable soft-disabled child; the click handler only adds the touch path (POO-840 R4).
    // biome-ignore lint/a11y/noStaticElementInteractions: same — the wrapper only catches the bubbled tap from the interactive child.
    <span
      ref={wrapRef}
      onClick={() => setOpen((v) => !v)}
      className={cn("group relative inline-flex", className)}
    >
      {children}
      <span
        role="tooltip"
        className={cn(
          "-top-8 -translate-x-1/2 pointer-events-none absolute left-1/2 z-10 whitespace-nowrap rounded-md border border-border bg-surface-raised px-2 py-1 text-foreground text-xs shadow-sm transition-opacity",
          open ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        {hint}
      </span>
    </span>
  );
}

/** The Operations rail card. */
export function OperationsCard({
  detail,
  onToggleExplore,
  onSetPaused,
  onCollect,
  collectBuildSteps,
  onRangeMoved,
  onRemoved,
  onLiquidityAdded,
  investResume,
}: OperationsCardProps) {
  const t = useTranslations("manager");
  // Add-liquidity settles on THIS strategy's chain, so the spendable balance is the wallet's USDC on
  // that one network (POO-303) — never the cross-network sum. Summing every chain would let the
  // Add-liquidity Permit2 authorize more than the wallet actually holds here (Permit2 must not
  // authorize across networks). Mirrors the investor invest flow (StrategyDetailDataLoader). The
  // stable getUsdcBalance callback (memoized on the wallet address) is the effect dep, not the whole
  // account-service object whose identity churns on every `chainChanged` event.
  const { getUsdcBalance } = useAccountService();
  // Real-mode invest (add-liquidity) executor — the SAME one the investor flow uses (POO-469). In
  // mock mode this returns a no-op executor (no Privy) and the modal keeps its mock walk.
  const invest = useInvest();
  const chainId = detail.pool.network ? networkToChainId(detail.pool.network) : undefined;
  // PP-INTEGRATION-POINT: per-network spendable USDC for the strategy's chain (real on-chain read in
  // real mode; mock balance in mock mode). Defaults to 0 until the read resolves / when no wallet.
  const [addBalance, setAddBalance] = useState(0);
  const [confirming, setConfirming] = useState<Operation | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  // The percentage the remove modal opens at — 100 when launched from Close (a full wind-down).
  const [removeSeed, setRemoveSeed] = useState(25);
  // True when the remove modal is launched from Close: it then opens straight into the Review →
  // Confirmed close sequence instead of the amount form (POO-388 R2).
  const [removeClosing, setRemoveClosing] = useState(false);
  const isClosed = detail.status === "closed";
  const isPaused = detail.status === "paused";
  // POO-520 R1: the deposit round-trip resume. Armed ONCE from the deep-linked amount (mirrors the
  // investor StrategyDetailScreen): the modal opens straight at Confirm & sign with it; closing the
  // modal clears the resume so a manual re-open starts at the amount step as usual.
  const [addResume, setAddResume] = useState<number | null>(null);
  const investResumeArmed = useRef(false);
  useEffect(() => {
    if (investResumeArmed.current || !investResume || investResume <= 0 || isClosed) return;
    investResumeArmed.current = true;
    setAddResume(investResume);
    setAddOpen(true);
  }, [investResume, isClosed]);

  useEffect(() => {
    let active = true;
    getUsdcBalance(chainId)
      .then((next) => {
        if (active) setAddBalance(next);
      })
      .catch(() => {
        // A failed read leaves the conservative 0 (needs-deposit) rather than crashing the rail; the
        // invest flow's own balance read is the authority at submit time.
        if (active) setAddBalance(0);
      });
    return () => {
      active = false;
    };
  }, [getUsdcBalance, chainId]);

  /** Copy + handler per confirmable operation (labels default to the generic Confirm/Cancel). */
  const dialogs: Record<
    Operation,
    {
      title: string;
      body: string;
      confirmLabel?: string;
      cancelLabel?: string;
      run: () => Promise<void>;
    }
  > = {
    pause: {
      title: t("manage.operations.pauseConfirmTitle"),
      body: t("manage.operations.pauseConfirmBody"),
      run: () => onSetPaused(true),
    },
    resume: {
      title: t("manage.operations.resumeConfirmTitle"),
      body: t("manage.operations.resumeConfirmBody"),
      run: () => onSetPaused(false),
    },
    close: {
      // POO-804 R3: the same close-confirmation copy + Continue / Keep-the-strategy labels as the
      // RemoveLiquidityModal's form-promoted close (one confirmation language for both entries).
      title: t("manage.remove.confirmTitle"),
      body: t("manage.remove.confirmBody"),
      confirmLabel: t("manage.remove.confirmContinue"),
      cancelLabel: t("manage.remove.confirmKeep"),
      // The warning leads into the close Review at 100% (remove all liquidity + collect fees).
      run: async () => {
        setRemoveSeed(100);
        setRemoveClosing(true);
        setRemoveOpen(true);
      },
    },
  };
  const dialog = confirming ? dialogs[confirming] : null;
  const poolLabel = `${detail.pool.token0}/${detail.pool.token1} · ${t("operate.feeTier", {
    pct: formatPercent(detail.pool.feeBps / 100, 2),
  })} · ${detail.pool.networkName}`;
  // Full-range positions have no bounds — seed the form around the current price (as RangeCard).
  const seedMin = detail.range.full
    ? detail.range.currentPrice * 0.5
    : (detail.range.minPrice ?? 0);
  const seedMax = detail.range.full
    ? detail.range.currentPrice * 1.5
    : (detail.range.maxPrice ?? seedMin + 1);
  // The manage-detail adapted to the investor InvestModal's Strategy shape — used both to render the
  // modal and (in real mode) to build the real add-liquidity steps, so both read identical data.
  const investStrategy = toInvestStrategy(detail);

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <h3 className="font-medium text-foreground">{t("manage.operations.title")}</h3>

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-medium text-foreground text-sm">
            {t("manage.operations.showInExplore")}
          </span>
          <span className="text-muted-foreground text-xs">
            {t("manage.operations.showInExploreNote")}
          </span>
        </div>
        {/* POO-738: listing on the public Strategies page has no backend yet (POO-314), so the toggle
            is soft-disabled (`blocked`: inert but keyboard-focusable) with a "coming soon" hint on
            hover/focus. `blocked` (not native `disabled`) keeps it in the tab order so the hint stays
            keyboard-reachable. */}
        <ComingSoonHint hint={t("operate.comingSoon")}>
          <Toggle
            checked={detail.showInExplore}
            onCheckedChange={onToggleExplore}
            label={t("manage.operations.showInExplore")}
            blocked
          />
        </ComingSoonHint>
      </div>

      {isClosed ? (
        <p className="rounded-lg bg-surface-raised p-3 text-muted-foreground text-xs">
          {t("manage.operations.closedNote")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Add liquidity — the manager tops up their own pool via the investor Invest flow, at the
              top of the list (murilo 2026-06-29). */}
          <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
            {t("manage.operations.addLiquidity")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCollectOpen(true)}
            disabled={detail.claimableFeesUsd <= 0}
          >
            {t("manage.operations.collect")}
          </Button>
          {/* POO-738: pausing/resuming deposits has no backend yet (POO-314), so the control is
              soft-disabled (`blocked`: inert but keyboard-focusable) with a "coming soon" hint on
              hover/focus. `blocked` (not native `disabled`) keeps it in the tab order so the hint
              stays keyboard-reachable. */}
          <ComingSoonHint hint={t("operate.comingSoon")} className="w-full">
            <Button variant="secondary" size="sm" blocked className="w-full">
              {isPaused ? t("manage.operations.resume") : t("manage.operations.pause")}
            </Button>
          </ComingSoonHint>
          {/* Move range is the manager's primary day-to-day action — gold CTA (murilo 2026-06-29). */}
          <Button variant="primary" size="sm" onClick={() => setMoveOpen(true)}>
            {t("operate.moveRange")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setRemoveSeed(25);
              setRemoveClosing(false);
              setRemoveOpen(true);
            }}
          >
            {t("manage.operations.removeLiquidity")}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setConfirming("close")}>
            {t("manage.operations.close")}
          </Button>
        </div>
      )}

      <InvestModal
        open={addOpen}
        onOpenChange={(next) => {
          setAddOpen(next);
          if (!next) setAddResume(null);
        }}
        strategy={investStrategy}
        balance={addBalance}
        // Real mode runs the real on-chain add-liquidity (approve → Permit2 → build → send) on the
        // strategy's own network; mock mode (undefined) keeps InvestModal's mock walk. Mirrors the
        // investor path (StrategyDetailScreen). Without this the manager Add-liquidity fabricated a
        // fake tx in real mode (POO-469).
        buildInvestSteps={
          isMockMode
            ? undefined
            : (amountUsd, slippage) => invest.buildSteps(investStrategy, amountUsd, slippage)
        }
        onInvested={() => void onLiquidityAdded?.()}
        // POO-520 R1: the console origin travels into the Deposit & invest deep link, and a
        // returning top-up resumes here at Confirm & sign with the preserved amount.
        depositOrigin="manager"
        resumeAmount={addResume}
      />

      <CollectModal
        open={collectOpen}
        onOpenChange={setCollectOpen}
        managed={{
          strategyId: detail.id,
          name: detail.name,
          initials: detail.initials,
          logoUrl: detail.logoUrl,
          poolLabel,
          // POO-482 R2: network scope for the token-logo resolution on the per-token rows.
          network: detail.pool.network,
          availableUsd: detail.claimableFeesUsd,
          gasEstimateUsd: detail.gasEstimateUsd,
          // Per-token claimable enables the manager's "receive as token pair" rows (POO-417 R3/R5).
          feeTokens: detail.claimableFeeTokens,
          // POO-516 R2: the pool's own fee tier — the INTERIM DEX-fee source for the minimum math.
          feeBps: detail.pool.feeBps,
          onCollect,
          // POO-802 R0: real mode runs the split handshake; mock keeps the onCollect fold.
          buildSteps: collectBuildSteps,
        }}
      />

      <MoveRangeModal
        open={moveOpen}
        onOpenChange={setMoveOpen}
        position={{
          strategyId: detail.id,
          currentPrice: detail.range.currentPrice,
          feeBps: detail.pool.feeBps,
          token0: detail.pool.token0,
          token1: detail.pool.token1,
          gasCostUsd: detail.gasEstimateUsd,
          // Real-mode on-chain identifiers (POO-310); undefined on mock detail.
          network: detail.pool.network,
          decimals0: detail.pool.decimals0,
          decimals1: detail.pool.decimals1,
          // POO-501 R2/R3: the raw reserve block + pool token symbols + decimals for the client-side
          // value split of the estimated new-range balance and the current-balance rows. Present only
          // when the detail carries the block (real position / seeded mock) — absent → the modal
          // degrades to the percent-only legend (R4). Mirrors the RemoveLiquidityModal threading; the
          // split anchor is the whole pool value (detail.aum), matching totalSupply0/1.
          reserves:
            detail.totalSupply0 != null &&
            detail.totalSupply1 != null &&
            detail.tickCurrent != null &&
            detail.pool.decimals0 != null &&
            detail.pool.decimals1 != null
              ? {
                  token0: detail.pool.token0,
                  token1: detail.pool.token1,
                  totalSupply0: detail.totalSupply0,
                  totalSupply1: detail.totalSupply1,
                  tickCurrent: detail.tickCurrent,
                  decimals0: detail.pool.decimals0,
                  decimals1: detail.pool.decimals1,
                }
              : undefined,
          poolValueUsd: detail.aum,
        }}
        currentMin={seedMin}
        currentMax={seedMax}
        onMoved={(result) => {
          void onRangeMoved(result);
        }}
      />

      <RemoveLiquidityModal
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        target={{
          strategyId: detail.id,
          // POO-841 R1: thread the strategy NAME so the remove/close receipt shows the name, never
          // the raw position id (the WithdrawReceiptCard falls back to strategyId without it).
          name: detail.name,
          network: detail.pool.network,
          stakeUsd: detail.managerStakeUsd ?? 0,
          feesUsd: detail.claimableFeesUsd,
          // Per-token fee breakdown enables the receive-as-pair rows (POO-324 item 2 / POO-417).
          feeTokens: detail.claimableFeeTokens,
          gasCostUsd: detail.gasEstimateUsd,
          // POO-502 (POO-483 v2 R2): the raw reserve block + pool token symbols + decimals for the
          // client-side value split of the liquidity leg. Present only when the detail carries the
          // block (real position / seeded mock) — absent → the modal degrades to USD (R4). The split
          // anchor is the whole pool value (detail.aum), matching totalSupply0/1.
          reserves:
            detail.totalSupply0 != null &&
            detail.totalSupply1 != null &&
            detail.tickCurrent != null &&
            detail.pool.decimals0 != null &&
            detail.pool.decimals1 != null
              ? {
                  token0: detail.pool.token0,
                  token1: detail.pool.token1,
                  totalSupply0: detail.totalSupply0,
                  totalSupply1: detail.totalSupply1,
                  tickCurrent: detail.tickCurrent,
                  decimals0: detail.pool.decimals0,
                  decimals1: detail.pool.decimals1,
                }
              : undefined,
          poolValueUsd: detail.aum,
        }}
        onRemoved={(closed, newStakeUsd) => {
          void onRemoved(closed, newStakeUsd);
        }}
        initialPercentage={removeSeed}
        closeMode={removeClosing}
      />

      {dialog ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(null);
          }}
          title={dialog.title}
          body={dialog.body}
          confirmLabel={dialog.confirmLabel ?? t("manage.operations.confirm")}
          cancelLabel={dialog.cancelLabel ?? t("manage.operations.cancel")}
          onConfirm={async () => {
            await dialog.run();
            setConfirming(null);
          }}
        />
      ) : null}
    </section>
  );
}
