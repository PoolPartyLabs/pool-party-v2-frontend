/**
 * @id PP-MGR-SCR-004 (POO-453, POO-750)
 * @name StrategyManageView
 * @implements-rules-version v9 · v1 (POO-897: composition per-token split) · v1 (POO-901: referral-aware share link)
 *
 * POO-901 v1 [R2]: the header share link carries the manager's referral code once one exists —
 * `strategyReferralUrl(publicStrategyId, code)` (the owned StrategyDetailScreen precedent) — and
 * falls back to the plain {@link publicStrategyUrl} while the shared `useReferral` state has no
 * code, upgrading in place when it resolves. Display + copy always use the same resolved URL [R5].
 *
 * v8 (POO-656): the Range card is ordered ABOVE the About card (was About → Composition → Allocation
 * → Range; now Range → Composition → Allocation → About).
 *
 * v7 (POO-649): the share pill deep-links the PUBLIC strategy page (`/strategies/<publicStrategyId>`)
 * via {@link publicStrategyUrl}, not the private console id under `/m/<handle>/<id>` (which had no
 * route → 404). The `handle` prop is gone (it only drove the old link); URL building moved to
 * `@/lib/urls`.
 *
 * The per-strategy manage detail, opened client-side from the Manage-strategies list (no route
 * change, murilo 2026-06-10): header (identity + fixed pool + share link), Performance with period
 * tabs, the Range card, Recent activity, and the Operations / Investors rail. Drafts collapse to a
 * continue-setup notice; closed strategies go read-only. Mutations run through `managerService`
 * (mock session state) and bubble up via `onDetailChange` so the list stays in sync.
 *
 * v2 (POO-453 R8): every op's success path now also calls `handleSettled()` -> `usePostWriteRefresh`
 * in BOTH mock and real mode, so after a manage mutation the Explore catalog, the Manage-strategies
 * list, and the investor portfolio refresh too, not just this open detail. Previously the mock branch
 * updated only local detail state and the list views went stale until a hard reload.
 *
 * v3 (POO-468 R4): the real-mode collect optimistic patch zeroes the per-token `claimableFeeTokens`
 * amounts alongside `claimableFeesUsd`, so the receive-as pair rows can't offer already-collected
 * fees while the indexer catches up.
 *
 * v4 (POO-518 R2): the move-range success patches the applied range onto the open detail in BOTH
 * modes (previously mock refetched a detail whose range the mock service never changed, so the
 * Range card silently kept the old band). A full move lands as the Range card's full-range
 * representation (`full: true`, no bounds — the reported bounds are the fullRangeTicks-derived
 * prices), and the in/out-of-range status re-derives with the band.
 *
 * v5 (POO-517 R3): the real-mode remove/close optimistic patches are SNAPSHOT-GUARDED (the investor
 * POO-468 precedent): a close zeroes the claimable (USD + per-token) alongside `status: "closed"`
 * (the close collects the accrued fees); a partial remove patches the reduced `managerStakeUsd`.
 * While armed, the patch renders OVER the incoming detail, so a stale refetch still equal to the
 * pre-write snapshot never resurrects the old figures; the guard yields to the FIRST server value
 * that differs from the snapshot.
 *
 * v6 (POO-520 R1): `investResume` (the amount returning from a manager-origin Deposit & invest
 * top-up) threads through to the Operations rail, which re-arms the Add-liquidity modal with it.
 *
 * v7 (POO-558, @implements-rules-version v1): the AUM chart is history-aware. R1: no `performance` series → the explicit
 * no-history state (no chart, no tabs, no pill), replacing the old flat 2-point mock line. R2: an
 * absent/undefined change renders NO pill (never a coerced +0.0%). R3: the pill is PERIOD-AWARE, it
 * recomputes the signed % over the SELECTED tab's calendar window from `performance.all` rather than
 * a fixed trailing-30d. R4: a tab whose calendar window holds <2 points is disabled (date-less mock
 * series keep every tab live). R5: when the headline live-TVL (`detail.aum`) and the series' last
 * daily snapshot diverge, a note annotates the mismatch.
 */
"use client";

import { ArrowLeft, Check, Copy, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { MaskableValue } from "@/components/data-display/MaskableValue";
import { PerformanceChart } from "@/components/data-display/PerformanceChart";
import { StrategyLogo } from "@/components/data-display/StrategyLogo";
import { AprTooltip } from "@/components/ui/AprTooltip";
import { Button } from "@/components/ui/Button";
import { CollapsibleCard } from "@/components/ui/CollapsibleCard";
import { EyeToggle } from "@/components/ui/EyeToggle";
import { toast } from "@/components/ui/Toast";
import { useReferral } from "@/features/rewards/useReferral";
import { SinglePoolProspectus } from "@/features/strategies/components/SinglePoolProspectus";
import { useRouter } from "@/i18n/navigation";
import { EphemeralMaskProvider } from "@/lib/hooks/maskValue";
import type { ManagePeriod, ManagerStrategyDetail } from "@/lib/schemas";
import { isMockMode, managerService } from "@/lib/services";
import {
  changePctOfPoints,
  managePeriodEnabled,
  PERIOD_WINDOW_DAYS,
} from "@/lib/timeseries/manageSeries";
import { usePostWriteRefresh } from "@/lib/tx/usePostWriteRefresh";
import {
  absoluteUrl,
  publicStrategyUrl,
  strategyReferralUrl,
  uniswapPositionUrl,
} from "@/lib/urls";
import { cn } from "@/lib/utils/cn";
import { formatPercent, formatUsd } from "@/lib/utils/format";
import { getRangeStatus } from "@/lib/utils/rangeStatus";
import { useManagerCollect } from "../hooks/useManagerCollect";
import { ActivityCard } from "./ActivityCard";
import { AllocationCard } from "./AllocationCard";
import { CommentsCard } from "./CommentsCard";
import { OperationsCard } from "./OperationsCard";
import { RangeCard } from "./RangeCard";
import { StrategyStatusChip } from "./StrategyStatusChip";

/** The selectable chart periods, in display order. */
const PERIODS: ManagePeriod[] = ["7d", "30d", "90d", "all"];

/**
 * POO-897 R1: the Composition card's per-token split, read from the ALREADY-computed allocation
 * (buildManagerAllocation over the position's reserves): no second derivation. Label-matched to the
 * pool's token order (never index-assumed); no allocation or an unmatched pair → undefined, and the
 * card keeps the single "Liquidity pool 100%" row (R4, never fabricated).
 */
function allocationSplit(
  allocation: ManagerStrategyDetail["allocation"],
  pool: ManagerStrategyDetail["pool"],
): { pct0: number; pct1: number } | undefined {
  const token0 = allocation?.tokens.find((slice) => slice.label === pool.token0);
  const token1 = allocation?.tokens.find((slice) => slice.label === pool.token1);
  return token0 && token1 ? { pct0: token0.pct, pct1: token1.pct } : undefined;
}

/**
 * POO-517 R3: numeric tolerance for the snapshot-guard comparison (mirrors the investor POO-468
 * precedent) — the indexer re-serializes floats (~1e-13 noise) and that must NOT count as a fresh
 * server value; any real change is cents-scale, far above this.
 */
const RECONCILE_EPSILON = 1e-9;

/** POO-517 R3: epsilon-tolerant equality for the guarded scalar fields. */
function guardValueEquals(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= RECONCILE_EPSILON;
  return a === b;
}

/** POO-517 R3: one guarded scalar of the remove/close optimistic patch. */
interface GuardedField {
  key: "status" | "managerStakeUsd" | "claimableFeesUsd";
  /** The server value at write time (the pre-write snapshot the patch masks). */
  was: ManagerStrategyDetail["status"] | number | undefined;
  /** The optimistically patched value. */
  now: ManagerStrategyDetail["status"] | number;
}

/**
 * POO-517 R3: the armed remove/close optimistic patch. Rendered OVER the incoming detail until the
 * guard yields to the first differing server value (see the effect in {@link StrategyManageView}).
 */
interface RemoveGuard {
  patch: Partial<ManagerStrategyDetail>;
  fields: GuardedField[];
}

/** Public props for {@link StrategyManageView}. */
export interface StrategyManageViewProps {
  /** The strategy's manage-detail payload. */
  detail: ManagerStrategyDetail;
  /** Returns to the Manage-strategies list. */
  onBack: () => void;
  /** Bubbles every mutation up so the console list reflects it. */
  onDetailChange: (detail: ManagerStrategyDetail) => void;
  /**
   * Re-fetches the console payload after a mutation (real mode), so the source data reflects the new
   * on-chain state once the modal's optimistic patch ages out. Absent in mock mode.
   */
  onConsoleRefresh?: () => void;
  /**
   * Amount returning from a manager-origin Deposit & invest top-up (POO-520 R1), threaded to the
   * Operations rail so the Add-liquidity modal re-arms at Confirm & sign with it.
   */
  investResume?: number | null;
}

/** The manage-detail view for one strategy. */
export function StrategyManageView({
  detail: serverDetail,
  onBack,
  onDetailChange,
  onConsoleRefresh,
  investResume,
}: StrategyManageViewProps) {
  const t = useTranslations("manager");
  const router = useRouter();
  // Post-write freshness: refetch the console + catalog + re-render, with a bounded poll (POO-364).
  const postWriteRefresh = usePostWriteRefresh(onConsoleRefresh);
  // Real mode collects on-chain (reuses the investor collect-fees build-tx); mock keeps the mock
  // service. The executor is mock-safe (no-op in mock mode), so it is always called.
  const realMode = !isMockMode;
  const collect = useManagerCollect();
  const [period, setPeriod] = useState<ManagePeriod>("30d");
  const [copied, setCopied] = useState(false);
  // POO-517 R3: the armed remove/close optimistic patch + its pre-write snapshot (real mode only).
  const [removeGuard, setRemoveGuard] = useState<RemoveGuard | null>(null);
  // While the guard is armed, render the patch OVER the incoming detail — a stale refetch (still
  // equal to the pre-write snapshot) can never resurrect the pre-remove figures.
  const detail = removeGuard ? { ...serverDetail, ...removeGuard.patch } : serverDetail;

  // POO-517 R3: the guard yields to the FIRST server value that differs from BOTH the pre-write
  // snapshot and the patch itself. A value equal to the snapshot is a stale refetch (stays masked);
  // one equal to the patch is our own write-through echo or the server catching up (stays armed,
  // zero visual diff); anything else is fresh server truth and wins immediately.
  useEffect(() => {
    if (!removeGuard) return;
    const fresh = removeGuard.fields.some(
      (field) =>
        !guardValueEquals(serverDetail[field.key], field.was) &&
        !guardValueEquals(serverDetail[field.key], field.now),
    );
    if (fresh) setRemoveGuard(null);
  }, [removeGuard, serverDetail]);
  // POO-649: deep-link the PUBLIC strategy page (`/strategies/<publicStrategyId>`); the private console
  // `detail.id` has no public route. `publicStrategyId` is the mapped investor-catalog id.
  // POO-901 [R2]: once the manager has created a referral code (shared useReferral state), the link
  // carries ?ref=<code> (strategyReferralUrl — the owned StrategyDetailScreen precedent); plain URL
  // until then, upgrading in place when the code resolves.
  const { program: referralProgram } = useReferral();
  const shareUrl = referralProgram?.code
    ? strategyReferralUrl(detail.publicStrategyId, referralProgram.code)
    : publicStrategyUrl(detail.publicStrategyId);
  // POO-558 R1: no performance series (real path, <2-point analytics) → the explicit no-history
  // state (no chart, no tabs, no pill). Mock mode always carries a series so it never hits this.
  const performance = detail.performance;
  const hasHistory = performance !== undefined;
  // POO-558 R4: the full dated series drives per-tab enablement. `performance.all` carries each
  // point's ISO date in real mode (mapTimeseries) and is date-less in mock mode (every tab stays
  // live). A tab whose calendar window holds <2 points is disabled below.
  const fullSeries = performance?.all ?? [];
  // POO-558: a selection that turned invalid (short history disabled it) coerces to the always-live
  // "all" tab instead of silently widening the window.
  const effectivePeriod: ManagePeriod =
    hasHistory && !managePeriodEnabled(fullSeries, period) ? "all" : period;
  // POO-558 R3: the pill's signed % tracks the SELECTED period — first→last of THAT period's already
  // windowed series (built per period for real, pre-shaped for mock), so it never reads a fixed 30d
  // figure. `PERIOD_WINDOW_DAYS.all` = the whole slice's change. Undefined (a <2-point slice or no
  // series) → no pill (R2, no coerced +0.0%).
  const periodChangePct =
    hasHistory && performance
      ? changePctOfPoints(performance[effectivePeriod], PERIOD_WINDOW_DAYS.all)
      : detail.aumChangePct;
  const showPill = periodChangePct !== undefined;
  const positive = (periodChangePct ?? 0) >= 0;
  // POO-558 R5: the headline AUM is the live pp_api TVL; the chart's last point is a daily snapshot.
  // They can diverge (the snapshot lags intraday flows). Annotate it so the two figures don't read
  // as a bug. Only for a real (dated) series — a date-less mock has no snapshot semantics.
  const lastSnapshot = fullSeries.at(-1);
  const snapshotDiverges =
    hasHistory &&
    lastSnapshot?.date !== undefined &&
    Math.abs(detail.aum - lastSnapshot.value) > 0.005;
  // Literal t() calls (the i18n usage scan is static — no dynamic keys).
  const periodLabels: Record<ManagePeriod, string> = {
    "7d": t("manage.performance.periods.7d"),
    "30d": t("manage.performance.periods.30d"),
    "90d": t("manage.performance.periods.90d"),
    all: t("manage.performance.periods.all"),
  };
  // POO-558 R3: the pill names the window it measures (the selected tab), not a fixed "30d".
  const periodWindowLabel = periodLabels[effectivePeriod];

  /** Copies the public share link to the clipboard. */
  async function handleCopyShare() {
    await navigator.clipboard.writeText(absoluteUrl(shareUrl));
    setCopied(true);
    toast.success(t("manage.shareCopied"));
  }

  /** Runs a service mutation and bubbles the updated detail. */
  // PP-FIXME(SEV:MED) POO-314: Explore-visibility, pause/resume and the soft-close have no real
  // backend yet. In real mode they MUST NOT route through the mock `managerService` (it would
  // overwrite the real on-chain detail with fabricated mock-session data); instead patch the field
  // optimistically (no persistence — reverts on reload) until the real mutations land. Mock mode
  // keeps the full mock-service round-trip.
  async function mutate(
    run: () => Promise<ManagerStrategyDetail>,
    realPatch: Partial<ManagerStrategyDetail>,
  ) {
    if (realMode) {
      onDetailChange({ ...detail, ...realPatch });
      handleSettled();
      return;
    }
    onDetailChange(await run());
    // Mock mode too: bust the catalog + portfolio tags so the Explore/Manage LIST and the investor
    // portfolio reflect the mutation, not just this open detail (POO-453 R8).
    handleSettled();
  }

  /**
   * [R8] A manage mutation (collect/pause/close/move-range/remove/add + show-in-explore) settled:
   * invalidate the tagged catalog + positions caches BEFORE refreshing the route, then re-fetch the
   * console payload so the source data catches up to the optimistic patch. Called on EVERY op success
   * in both mock and real mode, so the LIST views (Explore, Manage-strategies, investor portfolio)
   * reflect the change and never stay stale. Mirrors the investor modals' success path.
   */
  function handleSettled() {
    postWriteRefresh();
  }

  const header = (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="flex w-fit items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("manage.back")}
      </button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <StrategyLogo
            url={detail.logoUrl}
            name={detail.name}
            initials={detail.initials}
            className="size-11 text-sm"
          />
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-foreground text-xl">{detail.name}</h2>
              <StrategyStatusChip status={detail.status} />
            </div>
            {/* Strategy descriptor (Figma 5526:922): the category, e.g. "Stablecoin yield". */}
            <p className="text-muted-foreground text-sm">{detail.category}</p>
            <p className="text-muted-foreground text-xs">
              {detail.pool.token0}/{detail.pool.token1} ·{" "}
              {t("operate.feeTier", { pct: formatPercent(detail.pool.feeBps / 100, 2) })} ·{" "}
              {detail.pool.networkName}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={handleCopyShare}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-muted-foreground text-xs transition-colors hover:text-foreground"
          >
            <span className="break-all">{shareUrl}</span>
            {copied ? (
              <Check className="size-3.5 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className="sr-only">{t("manage.share")}</span>
          </button>
          {/* Deep link to the CREATED position on Uniswap (POO-750): positions/v3/<network>/<tokenId>.
              The chain slug matches Uniswap's path. The tokenId changes on a move-range (a new NFT is
              minted), so it is read fresh from the detail on each load (postWriteRefresh re-fetches).
              Hidden when absent (pending/closed) — never the pool URL, which is the wrong target. */}
          {detail.pool.network && detail.pool.nftPositionId ? (
            <a
              href={uniswapPositionUrl(detail.pool.network, detail.pool.nftPositionId)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground"
            >
              <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
              {t("manage.viewOnUniswap")}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );

  // Drafts have nothing to manage yet: notice + continue-setup CTA (POO-181 R8).
  if (detail.status === "draft") {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border border-dashed px-6 py-12 text-center">
          <h3 className="font-medium text-foreground">{t("manage.draft.title")}</h3>
          <p className="max-w-sm text-muted-foreground text-sm">{t("manage.draft.body")}</p>
          <Button size="lg" onClick={() => router.push("/manager/new")}>
            {t("manage.draft.cta")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <EphemeralMaskProvider>
      <div className="flex flex-col gap-6">
        {header}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_20rem]">
          <div className="flex flex-col gap-4">
            {/* Performance */}
            <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-foreground">{t("manage.performance.title")}</h3>
                  {/* Hide-values eye (manager surface: covered by default), beside the Performance
                      label so it sits next to the masked numbers (murilo 2026-06-29). */}
                  <EyeToggle label={t("dashboard.hideValues")} />
                </div>
                {/* POO-558 R1/R4: tabs render only with a plottable series; a tab whose calendar
                    window holds <2 points is disabled (never silently widened to full history). */}
                {hasHistory && performance ? (
                  <div
                    role="tablist"
                    aria-label={t("manage.performance.title")}
                    className="flex items-center gap-1 rounded-lg bg-surface-raised p-0.5"
                  >
                    {PERIODS.map((key) => {
                      const enabled = managePeriodEnabled(performance.all, key);
                      return (
                        <button
                          key={key}
                          type="button"
                          role="tab"
                          disabled={!enabled}
                          aria-disabled={!enabled}
                          aria-selected={effectivePeriod === key}
                          onClick={() => setPeriod(key)}
                          className={cn(
                            "rounded-md px-2.5 py-1 text-xs transition-colors",
                            effectivePeriod === key
                              ? "bg-surface font-medium text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                            "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted-foreground",
                          )}
                        >
                          {periodLabels[key]}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="font-semibold text-2xl text-foreground">
                  {formatUsd(detail.aum)}
                </span>
                {/* POO-558 R2: no pill when the (period) change is undefined — never a coerced
                    +0.0%. R3: the change + its label track the SELECTED period, not a fixed 30d. */}
                {showPill ? (
                  <span
                    data-testid="aum-change-pill"
                    className={cn(
                      "rounded-full px-2 py-0.5 font-medium text-xs",
                      positive
                        ? "bg-success/10 text-success"
                        : "bg-destructive/10 text-destructive",
                    )}
                  >
                    {positive ? "+" : "−"}
                    {formatPercent(Math.abs(periodChangePct ?? 0))} · {periodWindowLabel}
                  </span>
                ) : null}
              </div>
              {/* POO-558 R5: the headline AUM is the live pp_api TVL; the chart's last point is a
                  daily snapshot that can lag intraday flows. Annotate the divergence. */}
              {snapshotDiverges ? (
                <p data-testid="aum-snapshot-note" className="text-muted-foreground text-xs">
                  {t("manage.performance.snapshotNote")}
                </p>
              ) : null}
              {/* POO-558 R1: a real detail with no series renders the explicit no-history state
                  instead of a chart or a fabricated flat line. */}
              {hasHistory && performance ? (
                <PerformanceChart
                  data={performance[effectivePeriod]}
                  ariaLabel={t("manage.performance.chartLabel")}
                />
              ) : (
                <div className="flex h-40 flex-col items-center justify-center gap-1 rounded-lg border border-border border-dashed px-4 text-center">
                  <p className="font-medium text-foreground text-sm">
                    {t("manage.performance.noHistoryTitle")}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t("manage.performance.noHistoryBody")}
                  </p>
                </div>
              )}
              {/* POO-434 R1: "Your fees" (all-time + 30d) dropped from the strip — the manager's
                  collectable LP fees live in the "Your allocation" card below. Keep Net APY + Yield. */}
              <dl className="grid grid-cols-2 gap-3 border-border border-t pt-4">
                <div className="flex flex-col">
                  <dt className="text-muted-foreground text-xs">
                    <AprTooltip net>{t("manage.performance.netApy")}</AprTooltip>
                  </dt>
                  <dd className="font-medium text-foreground text-sm">
                    {formatPercent(detail.apy)}
                  </dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-muted-foreground text-xs">{t("manage.performance.yield")}</dt>
                  <dd className="font-medium text-foreground text-sm">
                    {formatUsd(detail.yieldGenerated)}
                  </dd>
                </div>
              </dl>
            </section>

            {/* Range — moved ABOVE About (POO-656, murilo): the range is the primary managing
                context, so it leads; the About description drops below the composition. */}
            <RangeCard detail={detail} />

            {/* Composition + Investment mandate — derived from the real pool, shared with the
                investor strategy detail (SinglePoolProspectus). POO-897 R1: the Composition card
                mirrors the per-token proportion the Allocation card already computes (consistent
                card on all three variants; the mild duplication with AllocationCard is accepted). */}
            <SinglePoolProspectus
              tokens={detail.pool}
              networkName={detail.pool.networkName}
              network={detail.pool.network}
              split={allocationSplit(detail.allocation, detail.pool)}
            />

            {detail.allocation ? (
              <AllocationCard allocation={detail.allocation} network={detail.pool.network} />
            ) : null}

            {/* About — the manager's real description, moved out of the header into its own card. */}
            {detail.description ? (
              <CollapsibleCard title={t("manage.about")}>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {detail.description}
                </p>
              </CollapsibleCard>
            ) : null}
            {/* POO-737 R2: real mode has no activity feed yet (POO-380), so show a "coming soon"
                placeholder there; mock mode keeps the fixture events. */}
            <ActivityCard activity={detail.activity} comingSoon={realMode} />
            {detail.comments ? (
              <CommentsCard comments={detail.comments} total={detail.commentsTotal} />
            ) : null}
          </div>

          <aside className="flex flex-col gap-4">
            <OperationsCard
              detail={detail}
              investResume={investResume}
              onToggleExplore={(visible) =>
                mutate(() => managerService.setShowInExplore(detail.id, visible), {
                  showInExplore: visible,
                })
              }
              onSetPaused={(paused) =>
                mutate(() => managerService.setDepositsPaused(detail.id, paused), {
                  status: paused ? "paused" : "active",
                })
              }
              onCollect={async () => {
                // MOCK console fold (POO-802 R0 moved the real path to `collectBuildSteps`). The
                // Collect dialog's success view is the feedback (POO-286 R1) — no toast here.
                await managerService.collectFees(detail.id);
                const updated = await managerService.getStrategyDetail(detail.id);
                if (updated) onDetailChange(updated);
                handleSettled();
                // The mock console has no tx, so there is no hash for the receipt (POO-505 R4).
                return undefined;
              }}
              collectBuildSteps={
                realMode
                  ? (collectAsTokenPair, slippageTolerance) => {
                      // POO-802 R0: the split handshake — the build step pauses the Review on the
                      // REAL figures; the confirm step signs + sends. POO-417 R2 / POO-478 R2: the
                      // receive-as choice + gear slippage thread into the server build.
                      if (!detail.pool.network) {
                        throw new Error("This strategy has no network configured");
                      }
                      const steps = collect.buildSteps({
                        network: detail.pool.network,
                        positionId: detail.id,
                        collectAsTokenPair,
                        slippageTolerance,
                      });
                      // Keep the optimistic patch on the SEND's success (was inside the old fold):
                      // collect zeroes the uncollected fees + per-token breakdown (POO-468 R4)
                      // without waiting for a refetch, then refreshes the console overview.
                      return steps.map((step) =>
                        step.key === "confirm:collect"
                          ? {
                              ...step,
                              run: async (ctx: Parameters<typeof step.run>[0]) => {
                                const out = await step.run(ctx);
                                onDetailChange({
                                  ...detail,
                                  claimableFeesUsd: 0,
                                  claimableFeeTokens: detail.claimableFeeTokens?.map((token) => ({
                                    ...token,
                                    amount: 0,
                                  })),
                                });
                                handleSettled();
                                return out;
                              },
                            }
                          : step,
                      );
                    }
                  : undefined
              }
              onRangeMoved={(result) => {
                // The move already applied (on-chain in real mode, mock service in mock). Reflect
                // the new range in the open detail immediately by patching the applied bounds
                // (POO-462) in BOTH modes — a real re-fetch would lag the on-chain indexer, and the
                // mock refetch used to read back the untouched fixture band, leaving the Range card
                // stale with no feedback (POO-518 R2). A full move lands as the Range card's
                // full-range representation (full: true, no bounds; the reported bounds are the
                // fullRangeTicks-derived prices), and in/out-of-range re-derives with the band.
                // handleSettled still refreshes the console overview. currentPrice is unchanged by
                // a range move.
                const range = {
                  ...detail.range,
                  full: result.full,
                  minPrice: result.full ? null : result.rangeMin,
                  maxPrice: result.full ? null : result.rangeMax,
                };
                onDetailChange({
                  ...detail,
                  range,
                  inRange: getRangeStatus(range.currentPrice, range) === "in",
                  // POO-750 R3/R4: a move-range mints a NEW Uniswap NFT, so the current tokenId now
                  // points at a burned position. Clear it optimistically so "View on Uniswap" HIDES
                  // until postWriteRefresh re-fetches the new id — never link to a dead NFT.
                  pool: { ...detail.pool, nftPositionId: undefined },
                });
                handleSettled();
              }}
              onRemoved={async (closed, newStakeUsd) => {
                // The modal already ran the mutation. Real mode patches the open detail
                // optimistically, snapshot-guarded (POO-517 R3): a close zeroes the claimable (USD
                // + per-token, POO-468 R4 parity — the close collects the accrued fees) alongside
                // status closed; a partial patches the reduced stake. Both write through so the
                // console list reflects it, and both yield to the first differing server value
                // (see the guard effect above). Mock mode refetches the mock source of truth.
                if (realMode) {
                  if (closed) {
                    const patch: Partial<ManagerStrategyDetail> = {
                      status: "closed",
                      claimableFeesUsd: 0,
                      claimableFeeTokens: serverDetail.claimableFeeTokens?.map((token) => ({
                        ...token,
                        amount: 0,
                      })),
                    };
                    setRemoveGuard({
                      patch,
                      fields: [
                        { key: "status", was: serverDetail.status, now: "closed" },
                        {
                          key: "claimableFeesUsd",
                          was: serverDetail.claimableFeesUsd,
                          now: 0,
                        },
                      ],
                    });
                    onDetailChange({ ...detail, ...patch });
                  } else if (newStakeUsd != null) {
                    const patch: Partial<ManagerStrategyDetail> = {
                      managerStakeUsd: newStakeUsd,
                    };
                    setRemoveGuard({
                      patch,
                      fields: [
                        {
                          key: "managerStakeUsd",
                          was: serverDetail.managerStakeUsd,
                          now: newStakeUsd,
                        },
                      ],
                    });
                    onDetailChange({ ...detail, ...patch });
                  }
                  handleSettled();
                  return;
                }
                const updated = await managerService.getStrategyDetail(detail.id);
                if (updated) onDetailChange(updated);
                handleSettled();
              }}
              onLiquidityAdded={async () => {
                // The investor Invest flow already ran the on-chain add; refresh like move/remove.
                if (realMode) {
                  handleSettled();
                  return;
                }
                const updated = await managerService.getStrategyDetail(detail.id);
                if (updated) onDetailChange(updated);
                handleSettled();
              }}
            />
            {/* Your allocation — the manager's own stake + collectable LP fees (excludes the
                performance fee), split out of Investors (murilo 2026-06-29). */}
            <CollapsibleCard title={t("manage.investors.allocated")}>
              <p className="font-semibold text-2xl text-foreground">
                <MaskableValue>{formatUsd(detail.managerStakeUsd ?? 0)}</MaskableValue>
              </p>
              <div className="flex flex-col gap-0.5 border-border border-t pt-3">
                <span className="text-muted-foreground text-xs">
                  {t("manage.availableToCollect")}
                </span>
                <span className="font-medium text-foreground text-sm">
                  <MaskableValue>{formatUsd(detail.claimableFeesUsd)}</MaskableValue>
                </span>
              </div>
            </CollapsibleCard>
            <CollapsibleCard title={t("manage.investors.title")}>
              <dl className="grid grid-cols-2 gap-3">
                <div className="flex flex-col">
                  <dt className="text-muted-foreground text-xs">{t("manage.investors.total")}</dt>
                  <dd className="font-medium text-foreground text-sm">
                    {detail.investorStats.total.toLocaleString("en-US")}
                  </dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-muted-foreground text-xs">{t("manage.investors.active")}</dt>
                  <dd className="font-medium text-foreground text-sm">
                    <MaskableValue>
                      {detail.investorStats.active.toLocaleString("en-US")}
                    </MaskableValue>
                  </dd>
                </div>
              </dl>
            </CollapsibleCard>
          </aside>
        </div>
      </div>
    </EphemeralMaskProvider>
  );
}
