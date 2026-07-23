/**
 * @id PP-STR-SCR-002
 * @name Strategy Detail (Discovery + Owned)
 * @implements-rules-version v6 · v1 (POO-819: top-level lockupDays source) · v1 (POO-897: composition per-token split) · v1 (POO-902: performance-fee tile replaces Investors) · v1 (POO-903: composition + mandate collapsed by default)
 *
 * The strategy detail prospectus (presentational; data fetched by the route). One responsive screen
 * serving both the Discovery (not invested) and Owned (invested) states. Sections: hero → (owned)
 * "Your position" → performance → 2×2 metrics → about → composition → investment mandate → risk
 * limits & terms → fees. Actions live in a sticky right rail on desktop and a prominent in-flow
 * block on mobile (the app's bottom tab bar already owns the screen's bottom edge): Invest for
 * Discovery; Invest · Collect · Withdraw for Owned (withdraw red-tinted to discourage). A paused
 * strategy shows an amber notice and offers "Notify me" / "View other strategies" instead of Invest.
 * A closed strategy (manager ended it) shows the closed banner, a final-value position card and a
 * single light-red Withdraw entry CTA (flow confirms stay gold) — the withdraw itself is instant
 * and fee-free (POO-185; frames promoted to the real pages, mobile 5369:317 / desktop 5406:725).
 * Costs never appear here — only inside the invest/withdraw confirm steps. Combines SCR-002 + SCR-003.
 *
 * v2 (POO-468 R1-R3): after a confirmed investor Collect, every claimable-fee figure (Available
 * cell, Collect CTA amount, Compound gate, per-token claimable rows) resets optimistically to $0
 * via a snapshot-guarded `effectivePosition` override, armed ONLY by the modal's once-fired
 * `onCollected`. The override yields to the first refetched totalYield that DIFFERS from the
 * collect-time snapshot; an equal stale refetch never resurrects the old figure. Client-side only
 * (no mock-service mutation): in mock mode the open screen reads $0 too, a route re-entry re-reads
 * the fixture (accepted, R2).
 *
 * v3 (POO-511 R1): in REAL mode the Compound CTA renders SHOWN-DISABLED (visible, not hidden) with
 * coming-soon helper text, and CompoundModal is not mounted, so no real-mode path can reach its
 * mock settle. Mock mode keeps the full compound flow untouched.
 *
 * v4 (POO-557 R2/R3): the period tabs window the value series by CALENDAR DAYS (7/30/90/365/all)
 * from each point's ISO date; a tab whose window holds <2 points or adds nothing over the previous
 * tab is disabled (aria-disabled + dimmed), All stays enabled, and an invalidated selection coerces
 * to All. A series with <2 points renders an explicit no-history state instead of a chart. Date-less
 * mock series keep the legacy trailing-point slicing with every tab live (R4).
 *
 * v5 (POO-794 R1-R3, rules v2): the DUPLICATE manager avatar was removed from the hero attribution
 * subline (it already renders in the right-rail / mobile ManagerCard). The inline text credit under
 * the name ("by @handle" else masked wallet) + verified badge stay — a lightweight one-line credit,
 * no photo. The `card.by` / `detail.managerVerified` i18n keys are unchanged.
 *
 * v6 (POO-843 R1): the performance period tabs (1W/1M/3M/1Y/All) are available on MOBILE — the
 * tablist dropped its `hidden ... sm:flex` gate (phones were locked to the default window), and the
 * heading row wraps so the tabs fall to their own line when the width is tight, mirroring the Home
 * hero (PortfolioChartCard) which already renders the same five tabs at 375px. Desktop is unchanged.
 *
 * POO-902 (rules v1): the metrics grid swaps the Investors count for the strategy's Performance fee
 * on every variant — real mode reads the top-level `performanceFeePct` (mapStrategyV2 ← v2
 * `managerFee` bps), mock mode falls back to `detail.fees.performancePct`; an absent fee omits the
 * tile entirely (never fabricated, POO-799).
 *
 * POO-903 (rules v1): the Composition + Investment mandate cards start COLLAPSED. Real mode
 * inherits it from SinglePoolProspectus ([R1]); the mock/multi-pool Sections here became
 * CollapsibleCards with `defaultOpen={false}` and unchanged bodies ([R2]). Per-visit local state,
 * no persistence ([R3]); the primitive's aria-expanded header carries the semantics ([R4]).
 */
"use client";

import { BadgeCheck, ChevronLeft, Share2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { MetricTile } from "@/components/data-display/MetricTile";
import { type ChartPoint, PerformanceChart } from "@/components/data-display/PerformanceChart";
import { StrategyLogo } from "@/components/data-display/StrategyLogo";
import { AprTooltip } from "@/components/ui/AprTooltip";
import { CollapsibleCard } from "@/components/ui/CollapsibleCard";
import { ManagerLink } from "@/features/manager/components/ManagerLink";
import { useReferral } from "@/features/rewards/useReferral";
import { Link } from "@/i18n/navigation";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { useTrackView } from "@/lib/analytics/useTrackView";
import type { StrategyFinancials } from "@/lib/financials/financialsSchema";
import type { Position, PositionEarnings, Strategy } from "@/lib/schemas";
import { isMockMode } from "@/lib/services";
import { publicStrategyUrl, strategyReferralUrl } from "@/lib/urls";
import { cn } from "@/lib/utils/cn";
import { formatPercent, formatPoolTvl, formatSignedUsd, formatUsd } from "@/lib/utils/format";
import { CollectModal } from "./components/CollectModal";
import { CompoundModal } from "./components/CompoundModal";
import { InvestModal } from "./components/InvestModal";
import { ManagerCard } from "./components/ManagerCard";
import { RiskMeter } from "./components/RiskMeter";
import { ShareYieldModal } from "./components/ShareYieldModal";
import { SinglePoolProspectus } from "./components/SinglePoolProspectus";
import { WithdrawModal } from "./components/WithdrawModal";
import { useCollectFees } from "./hooks/useCollectFees";
import { useInvest } from "./hooks/useInvest";
import { useWithdraw } from "./hooks/useWithdraw";
import { strategyCompositionSplit } from "./lib/compositionSplit";

/** Cycling palette for the composition stacked bar + legend. */
const COMPOSITION_COLORS = [
  "bg-primary",
  "bg-info",
  "bg-success",
  "bg-brand-mango",
  "bg-brand-grape",
] as const;

/** Risk band → soft avatar tint. Literal classes so Tailwind generates them. */
const RISK_TINT: Record<number, string> = {
  1: "bg-risk-1/15 text-risk-1",
  2: "bg-risk-2/15 text-risk-2",
  3: "bg-risk-3/15 text-risk-3",
  4: "bg-risk-4/15 text-risk-4",
  5: "bg-risk-5/15 text-risk-5",
};

/** Calendar days per period tab (week · month · quarter · year · all), POO-557 R2. */
const PERIOD_WINDOW_DAYS = [7, 30, 90, 365, Number.POSITIVE_INFINITY] as const;

/** Index of the "All" tab (always enabled; the coercion target when a selection turns invalid). */
const PERIOD_ALL = PERIOD_WINDOW_DAYS.length - 1;

const DAY_MS = 86_400_000;

/**
 * PP-MOCK: trailing-point tails for DATE-LESS series only. Mock chart data (buildStrategyChartData)
 * carries no ISO dates, so it keeps the legacy slicing look (POO-557 R4); every REAL series carries
 * `date` (mapTimeseries) and is windowed by calendar time instead.
 */
const MOCK_PERIOD_TAIL = [5, 8, 12, 18, Number.POSITIVE_INFINITY];

/** Every point's date as epoch ms, or `null` when the series is date-less (mock) or empty. */
function seriesDates(chartData: readonly { date?: string }[]): number[] | null {
  if (chartData.length === 0) return null;
  const parsed = chartData.map((point) => (point.date ? Date.parse(point.date) : Number.NaN));
  return parsed.every(Number.isFinite) ? parsed : null;
}

/** How many points fall inside the period's window, anchored at the LAST point's date. */
function pointsInWindow(dates: number[], period: number): number {
  const windowDays = PERIOD_WINDOW_DAYS[period] ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(windowDays)) return dates.length;
  const anchor = dates[dates.length - 1] ?? 0;
  return dates.filter((date) => anchor - date < windowDays * DAY_MS).length;
}

/**
 * The value series windowed to the selected period (POO-557 R2). A dated series is filtered by
 * calendar days counted back from its LAST point (so a lagging indexer still windows sensibly);
 * a date-less (mock) series falls back to the legacy trailing-point slice. Exported for tests.
 */
export function periodSeries<T extends { date?: string }>(chartData: T[], period: number): T[] {
  const dates = seriesDates(chartData);
  if (!dates) return chartData.slice(-(MOCK_PERIOD_TAIL[period] ?? chartData.length));
  const windowDays = PERIOD_WINDOW_DAYS[period] ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(windowDays)) return chartData;
  const anchor = dates[dates.length - 1] ?? 0;
  return chartData.filter((_, index) => anchor - (dates[index] ?? 0) < windowDays * DAY_MS);
}

/**
 * Whether a period tab is selectable (POO-557 R2): "All" always is; a dated series disables a tab
 * whose window holds <2 points (nothing to plot) or adds no points over the previous, smaller tab
 * (it would render identical, faking depth the history does not have). A date-less (mock) series
 * keeps every tab live (R4). Exported for tests.
 */
export function periodEnabled(chartData: readonly { date?: string }[], period: number): boolean {
  if (period === PERIOD_ALL) return true;
  const dates = seriesDates(chartData);
  if (!dates) return true;
  const count = pointsInWindow(dates, period);
  if (count < 2) return false;
  return period === 0 || count > pointsInWindow(dates, period - 1);
}

/**
 * The strategy-detail share link (POO-853 [R4]). An explicit `referralLinkProp` (SSR/test override)
 * wins; otherwise the POOL-SCOPED referral deep link when the user has a code (attribution stays
 * account-wide, the id only deep-links the destination); otherwise the plain strategy URL so the yield
 * receipt is still shareable without a code. Exported for tests (mirrors {@link periodSeries}).
 */
export function resolveStrategyShareLink(
  referralLinkProp: string | null,
  code: string | null,
  strategyId: string,
): string {
  return (
    referralLinkProp ??
    (code ? strategyReferralUrl(strategyId, code) : publicStrategyUrl(strategyId))
  );
}

/** A titled section card. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="mb-3 font-semibold text-base text-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** A label / value line. */
function DataRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "destructive";
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-right font-medium",
          tone === "destructive" ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Public props for {@link StrategyDetailScreen}. */
export interface StrategyDetailScreenProps {
  /** The strategy being viewed. */
  strategy: Strategy;
  /** The investor's position in this strategy, or `null` when not invested (Discovery state). */
  position: Position | null;
  /** Spendable USDC balance, in USD (passed to the invest flow). */
  balance: number;
  /** Labelled performance value series for the hero chart. */
  chartData: ChartPoint[];
  /** Per-period earned amounts for the share-yield card (owned only; POO-275). */
  earnings?: PositionEarnings | null;
  /**
   * PP-CORE-LIB-048: the per-strategy C1 `/financials` block for this position. When present (real mode,
   * this position covered), it is the SOURCE OF TRUTH for the "Your position" DISPLAY figures (invested
   * / current value / total yield / available), and it DISABLES the POO-468 zeroed-override ([R3]) —
   * collected + claimable move in the same 4h cycle, so a fresh post-collect read already reflects the
   * reduced claimable without the optimistic zeroing. A served NULL figure renders "not available yet",
   * never $0 ([R5]). Null (financials unavailable / this position uncovered) → the pp_api position-sourced
   * card + the POO-468 override. (The pp_api `/portfolio` position is NOT a legacy analytics source — the
   * only legacy leg, the `/metrics` share-card fallback, was removed in the data loader.)
   */
  positionFinancials?: StrategyFinancials | null;
  /** The user's referral link for the share card [R3], e.g. `app.pool-party.xyz?ref=maria2026`. */
  referralLink?: string | null;
  /**
   * Called after a successful invest/withdraw/collect/compound so the owner's position state
   * refreshes (real mode). The loader wires this to `usePositions().refresh()`.
   */
  onPositionChanged?: () => void;
}

/** Strategy detail prospectus + invest/manage actions. */
export function StrategyDetailScreen({
  strategy,
  position,
  balance,
  chartData,
  earnings = null,
  positionFinancials = null,
  referralLink: referralLinkProp = null,
  onPositionChanged,
}: StrategyDetailScreenProps) {
  const t = useTranslations("strategies");
  // POO-936 [R5]: the "not available yet" affordance for a served-NULL financials figure.
  const tCommon = useTranslations("common");
  const { track } = useAnalytics();
  useTrackView("strategy_detail_viewed", {
    strategy_id: strategy.id,
    risk_level: strategy.riskLevel as 1 | 2 | 3 | 4 | 5,
  });
  // Real-mode operation executors (build + sign + send); no-op in mock mode.
  const collect = useCollectFees();
  const withdraw = useWithdraw();
  const invest = useInvest();
  const [investOpen, setInvestOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [compoundOpen, setCompoundOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [notified, setNotified] = useState(false);
  const [period, setPeriod] = useState(1);
  // POO-468 R1: the collect-time totalYield snapshot. Non-null = the optimistic claimable reset is
  // armed (every claimable figure reads $0). Armed ONLY by the modal's once-fired onCollected,
  // NEVER by onPositionChanged: usePostWriteRefresh re-invokes that on every poll tick and would
  // re-arm the override.
  const [collectedAtYield, setCollectedAtYield] = useState<number | null>(null);

  const searchParams = useSearchParams();
  // POO-554: Back returns to where the user came from — Portfolio when the position link carried
  // `?from=portfolio` (PositionLink), else the Explore/Strategies list (the default from discovery).
  const backHref = searchParams.get("from") === "portfolio" ? "/portfolio" : "/strategies";
  const [investResumeAmount, setInvestResumeAmount] = useState<number | null>(null);
  const investResumeHandled = useRef(false);
  // Returning from a Deposit & invest top-up: /strategies/<id>?invest=<amount> reopens Invest at the
  // Confirm & sign step with the chosen amount (POO-281 R3). Handle once, then strip the param so a
  // refresh or back navigation doesn't reopen it.
  useEffect(() => {
    if (investResumeHandled.current) return;
    const raw = searchParams.get("invest");
    const amount = raw ? Number.parseFloat(raw) : Number.NaN;
    if (!Number.isFinite(amount) || amount <= 0) return;
    investResumeHandled.current = true;
    setInvestResumeAmount(amount);
    setInvestOpen(true);
    // Strip ONLY the `invest` param, preserving any other query params, so a refresh or back
    // navigation doesn't reopen the flow while unrelated params survive.
    const params = new URLSearchParams(window.location.search);
    params.delete("invest");
    window.history.replaceState(
      null,
      "",
      params.size ? `${window.location.pathname}?${params}` : window.location.pathname,
    );
  }, [searchParams]);

  // POO-543 [R5]: a Withdraw deep-link — /strategies/<id>?withdraw=1 — auto-opens the canonical
  // Withdraw flow for an OWNED position. Home routes a closed position here (instead of duplicating
  // the flow) so the WithdrawModal + its post-write refresh are reused. Handle once, then strip only
  // the `withdraw` param so a refresh/back doesn't reopen it. Mirrors the `?invest=` resume above.
  const withdrawDeepLinkHandled = useRef(false);
  useEffect(() => {
    if (withdrawDeepLinkHandled.current) return;
    if (searchParams.get("withdraw") === null) return;
    // Withdraw needs an owned position; in real mode the loader adds it after mount, so this re-runs
    // on `position` and opens once it resolves (a discovery/unknown id stays null and is ignored).
    if (!position) return;
    withdrawDeepLinkHandled.current = true;
    setWithdrawOpen(true);
    const params = new URLSearchParams(window.location.search);
    params.delete("withdraw");
    window.history.replaceState(
      null,
      "",
      params.size ? `${window.location.pathname}?${params}` : window.location.pathname,
    );
  }, [searchParams, position]);

  // POO-936 [R3]: a covered C1 `/financials` position retires the POO-468 zeroed-override. With the
  // ledger serving layer, collected + claimable move in the SAME 4h cycle, so a fresh post-collect read
  // already reflects the reduced claimable — the optimistic zeroing is unnecessary (and would fight the
  // served figures). When `positionFinancials` is present the override is disabled entirely.
  const overrideActive = positionFinancials === null;
  // POO-468 R1/R3 (pp_api position-sourced path only, when C1 does not cover this position): while the
  // reset is armed, render a zeroed override of the position. totalYield backs BOTH the Available figure
  // and the Total yield row, and zeroing both matches the post-index backend truth (the FE must not
  // fabricate a lifetime accumulator). The per-token claimable rows zero with it.
  const effectivePosition =
    overrideActive && collectedAtYield !== null && position
      ? {
          ...position,
          totalYield: 0,
          claimableFeeTokens: position.claimableFeeTokens?.map((token) => ({
            ...token,
            amount: 0,
          })),
        }
      : position;

  // POO-468 R1: the override yields to the FIRST fresh server value whose totalYield differs from
  // the collect-time snapshot (fresh accrual is never masked). A stale refetch still equal to the
  // snapshot keeps the override armed, so the pre-collect figure never resurrects. The comparison is
  // epsilon-tolerant: the indexer re-serializes floats (e.g. 290.4 vs 290.40000000000003, differing
  // by ~1e-13), and that re-serialization noise must NOT count as a fresh value and prematurely
  // disarm the reset. Any real accrual is cents-scale, far above RECONCILE_EPSILON, so it still clears.
  const RECONCILE_EPSILON = 1e-9;
  useEffect(() => {
    if (collectedAtYield === null) return;
    if (position === null || Math.abs(position.totalYield - collectedAtYield) > RECONCILE_EPSILON) {
      setCollectedAtYield(null);
    }
  }, [collectedAtYield, position]);

  const detail = strategy.detail;
  // The "About" text is the manager's real description (served with the name, real mode included),
  // falling back to the mock prospectus `about` in mock mode. Renders independently of the rest of
  // `detail`, so the description shows even when the full prospectus has no backend source yet.
  const about = strategy.description ?? detail?.about ?? null;
  const isOwned = position !== null;
  const isPaused = strategy.status === "paused";
  const isClosed = strategy.status === "closed" || position?.status === "closed";
  const tint = RISK_TINT[strategy.riskLevel] ?? RISK_TINT[3];
  const riskLabels: Record<number, string> = {
    1: t("risk.level1"),
    2: t("risk.level2"),
    3: t("risk.level3"),
    4: t("risk.level4"),
    5: t("risk.level5"),
  };
  const periods = [
    t("detail.periods.week"),
    t("detail.periods.month"),
    t("detail.periods.quarter"),
    t("detail.periods.year"),
    t("detail.periods.all"),
  ];
  // POO-557 R3: <2 points is unplottable — show the explicit no-history state instead of a chart.
  // Real mode reaches this via the loader's honest-empty series (analytics 404/empty/error); mock
  // mode never does (buildStrategyChartData always yields a full series, R4).
  const hasHistory = chartData.length >= 2;
  // POO-557 R2: a selection that turned invalid (short history disables the default 1M) coerces to
  // the always-enabled "All" tab instead of silently widening the window.
  const effectivePeriod = periodEnabled(chartData, period) ? period : PERIOD_ALL;
  // PP-INTEGRATION-POINT: per-period value series, windowed client-side from the full series — real
  // (dated) data by calendar window, mock data by trailing-point slice. Per-investor series: POO-368.
  const series = periodSeries(chartData, effectivePeriod);
  // POO-819 R4: read the lock-up TOP-LEVEL first (the real v2 mapper carries `lockupDays` and never
  // fabricates `detail`), falling back to the mock prospectus `detail.lockupDays` for mock parity.
  const lockupDays = strategy.lockupDays ?? detail?.lockupDays ?? 0;
  const lockupValue =
    lockupDays > 0 ? t("detail.lockup.days", { days: lockupDays }) : t("detail.lockup.none");
  // POO-902 R2/R3: the performance fee percent — real mode carries it top-level (mapStrategyV2,
  // `managerFee` bps → %), mock mode falls back to the prospectus fee. Undefined (v1 fallback /
  // lean payload) omits the tile entirely — never fabricated (POO-799). Zero is a real "0%" fee.
  const performanceFeePct = strategy.performanceFeePct ?? detail?.fees.performancePct;

  // Shared button class helpers (kept local so the action group is uniform across rail + in-flow).
  const btnBase =
    "inline-flex h-11 items-center justify-center gap-2 rounded-md px-4 font-medium text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const btnGold = cn(
    btnBase,
    "bg-primary font-semibold text-primary-foreground hover:bg-primary/90",
  );
  const btnOutline = cn(btnBase, "border border-border text-foreground hover:bg-surface-raised");
  const btnWithdraw = cn(
    btnBase,
    "border border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10",
  );

  // Share-yield entry (POO-275): owned + not closed, and only once the route provided the data.
  // A closed position keeps Withdraw as its single action (POO-185 R4).
  // The server-fetched link misses a code created in THIS session (separate mock runtime);
  // fall back to the shared client referral state so the share entry appears (POO-290 x POO-275).
  const { program: referralProgram } = useReferral();
  const referralLink = resolveStrategyShareLink(
    referralLinkProp,
    referralProgram?.code ?? null,
    strategy.id,
  );
  const canShare = isOwned && !isClosed && earnings !== null && referralLink !== null;
  const openShare = () => {
    setShareOpen(true);
    track("strategy_share_opened", { strategy_id: strategy.id, position_id: position?.id });
  };

  /** The Discovery invest CTA (single gold action). */
  const investButton = (
    <button type="button" className={cn(btnGold, "w-full")} onClick={() => setInvestOpen(true)}>
      {t("detail.actions.invest")}
    </button>
  );

  /** The paused-strategy actions (Notify + View other strategies). */
  const pausedActions = (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={notified}
        className={cn(btnGold, "w-full disabled:opacity-60")}
        onClick={() => setNotified(true)}
      >
        {notified ? t("detail.paused.notified") : t("detail.paused.notify")}
      </button>
      <Link href="/strategies" className={cn(btnOutline, "w-full")}>
        {t("detail.paused.viewOthers")}
      </Link>
    </div>
  );

  /**
   * Closed strategy: the single Withdraw entry CTA (owned) or a way back to Explore (discovery).
   * The entry CTA is the light-red tint, NOT gold (murilo 2026-06-11): red marks the exit action;
   * gold stays on the withdraw-flow confirm buttons. Grape was rejected — reserved for Rewards.
   */
  const closedActions = isOwned ? (
    <button
      type="button"
      className={cn(btnWithdraw, "w-full")}
      onClick={() => setWithdrawOpen(true)}
    >
      {t("detail.actions.withdraw")}
    </button>
  ) : (
    <Link href="/strategies" className={cn(btnOutline, "w-full")}>
      {t("detail.paused.viewOthers")}
    </Link>
  );

  // Former-interface parity (POO-286 R1): Collect claims the position's CLAIMABLE FEES, not the
  // withdrawable balance. The API's per-position `totalFeesInUsd` (surfaced as `totalYield`) is the
  // "Your Claimable fees" figure and is shown AS-IS — the backend already nets the manager
  // performance fee, so there is no client-side haircut (supersedes POO-280 R3 for the collect path).
  // Reads the POO-468 override, so a just-collected position gates Collect/Compound off at $0. The
  // CTA gating stays on the position's OWN claimable (the amount actually collectable on-chain), NOT
  // the served financials figure — a served-NULL available must not silently gate the CTA.
  const claimableFees = effectivePosition?.totalYield ?? 0;

  // POO-936 [R1][R5]: the "Your position" DISPLAY figures. When the /financials cutover is on and this
  // position is covered, the card shows the served ledger values (a NULL renders "not available yet",
  // never $0); otherwise it shows the position-sourced values (the legacy path, incl. the POO-468
  // override when armed). `usdOrUnavailable` formats a served-nullable USD value.
  const usdOrUnavailable = (value: number | null): string =>
    value === null ? tCommon("unavailable") : formatUsd(value);
  const signedUsdOrUnavailable = (value: number | null): string =>
    value === null ? tCommon("unavailable") : formatSignedUsd(value);
  const cardInvested = positionFinancials
    ? usdOrUnavailable(positionFinancials.invested)
    : effectivePosition
      ? formatUsd(effectivePosition.invested)
      : "";
  const cardCurrentValue = positionFinancials
    ? usdOrUnavailable(positionFinancials.currentValue)
    : effectivePosition
      ? formatUsd(effectivePosition.currentValue)
      : "";
  const cardTotalYield = positionFinancials
    ? signedUsdOrUnavailable(positionFinancials.totalYield)
    : effectivePosition
      ? formatSignedUsd(effectivePosition.totalYield)
      : "";
  // The Total-yield tone: negative only when a real number is negative (unavailable stays neutral).
  const cardTotalYieldNegative = positionFinancials
    ? positionFinancials.totalYield !== null && positionFinancials.totalYield < 0
    : (effectivePosition?.totalYield ?? 0) < 0;
  // The "Available" cell: a closed position shows its final value; an open one shows the served
  // available (financials) or the position claimable (legacy).
  const cardAvailable = positionFinancials
    ? isClosed
      ? usdOrUnavailable(positionFinancials.currentValue)
      : usdOrUnavailable(positionFinancials.available)
    : isClosed
      ? formatUsd(effectivePosition?.currentValue ?? 0)
      : formatUsd(claimableFees);

  /** The owned "Manage" actions. Collect/Withdraw always available; Invest only when active. */
  const manageActions = (
    <div className="flex flex-col gap-2">
      {!isPaused ? (
        <button type="button" className={cn(btnGold, "w-full")} onClick={() => setInvestOpen(true)}>
          {t("detail.actions.investMore")}
        </button>
      ) : null}
      {effectivePosition && claimableFees > 0 ? (
        <button
          type="button"
          className={cn(isPaused ? btnGold : btnOutline, "w-full")}
          onClick={() => setCollectOpen(true)}
        >
          {t("detail.actions.collectAmount", { amount: formatUsd(claimableFees) })}
        </button>
      ) : null}
      {effectivePosition && claimableFees > 0 ? (
        // POO-511 R1: compound has no real on-chain executor yet (CompoundModal settles a mock).
        // In real mode the CTA stays visible but disabled, with coming-soon helper text, so no
        // path can reach the mock settle. Mock mode keeps the full flow.
        // PP-TODO(POO-511 R2): enable in real mode once the real compound executor lands
        // (blocked by POO-489).
        isMockMode ? (
          <button
            type="button"
            className={cn(btnOutline, "w-full")}
            onClick={() => setCompoundOpen(true)}
          >
            {t("detail.actions.compound")}
          </button>
        ) : (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              disabled
              title={t("detail.actions.compoundComingSoon")}
              className={cn(btnOutline, "w-full disabled:cursor-not-allowed disabled:opacity-60")}
            >
              {t("detail.actions.compound")}
            </button>
            <p className="text-center text-muted-foreground text-xs">
              {t("detail.actions.compoundComingSoon")}
            </p>
          </div>
        )
      ) : null}
      {canShare ? (
        <button type="button" className={cn(btnOutline, "w-full")} onClick={openShare}>
          <Share2 className="size-4" aria-hidden="true" />
          {t("detail.actions.share")}
        </button>
      ) : null}
      <button
        type="button"
        className={cn(btnWithdraw, "w-full")}
        onClick={() => setWithdrawOpen(true)}
      >
        {t("detail.actions.withdraw")}
      </button>
    </div>
  );

  /** The "Your position" summary (lime-tinted), shown for owned strategies (POO-468 override). */
  const positionCard = effectivePosition ? (
    <div className="rounded-xl border border-success/40 bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-base text-foreground">
          {t("detail.yourPosition.title")}
        </h2>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs",
            isClosed || isPaused ? "bg-muted text-muted-foreground" : "bg-success/10 text-success",
          )}
        >
          {isClosed
            ? t("detail.yourPosition.closed")
            : isPaused
              ? t("detail.yourPosition.paused")
              : t("detail.yourPosition.active")}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <p className="text-muted-foreground text-xs">{t("detail.yourPosition.invested")}</p>
          {/* POO-936 [R1][R5]: served ledger figure (null → "not available yet"), else legacy. */}
          <p className="font-semibold text-foreground">{cardInvested}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">
            {isClosed ? t("detail.yourPosition.finalValue") : t("detail.yourPosition.currentValue")}
          </p>
          <p className="font-semibold text-foreground">{cardCurrentValue}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">
            {isClosed
              ? t("detail.yourPosition.totalYieldRealized")
              : t("detail.yourPosition.totalYield")}
          </p>
          <p
            className={cn(
              "font-semibold",
              cardTotalYieldNegative ? "text-destructive" : "text-success",
            )}
          >
            {cardTotalYield}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">
            {isClosed
              ? t("detail.yourPosition.availableToWithdraw")
              : t("detail.yourPosition.available")}
          </p>
          <p className="font-semibold text-success">{cardAvailable}</p>
        </div>
      </div>
    </div>
  ) : null;

  // Discovery rail panel: min + est. return + the gold Invest CTA.
  const investPanel = (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      <DataRow label={t("detail.metrics.min")} value={formatUsd(strategy.minInvestment)} />
      <DataRow
        label={t("card.estReturn")}
        value={
          <span className="text-success">
            {formatPercent(strategy.estReturn)} <AprTooltip>{strategy.rateType}</AprTooltip>
          </span>
        }
      />
      {investButton}
    </div>
  );

  // The manager card (Figma 4727:916): who runs the strategy + a link to their public profile.
  // POO-771 R6/R8: the verified badge + avatar now come from the backend-embedded manager identity
  // (mapper output), not from the prospectus `detail` — so both render in real mode too.
  const managerCard = (
    <ManagerCard
      name={strategy.manager}
      verified={strategy.managerVerified ?? false}
      handle={strategy.managerHandle}
      address={strategy.managerAddress}
      avatarUrl={strategy.managerAvatarUrl}
      managerStakeUsd={detail?.managerStakeUsd}
    />
  );

  // Resolve the action group once (avoids nested ternaries in JSX). Closed wins: only Withdraw.
  let mobileActions: ReactNode = investButton;
  if (isClosed) mobileActions = closedActions;
  else if (isOwned) mobileActions = manageActions;
  else if (isPaused) mobileActions = pausedActions;

  let railActions: ReactNode = investPanel;
  if (isClosed)
    railActions = isOwned ? (
      closedActions
    ) : (
      <div className="rounded-xl border border-border bg-surface p-5">{closedActions}</div>
    );
  else if (isOwned) railActions = manageActions;
  else if (isPaused)
    railActions = (
      <div className="rounded-xl border border-border bg-surface p-5">{pausedActions}</div>
    );

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={backHref}
        className="inline-flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        {t("detail.back")}
      </Link>

      {/* Mobile is one full-width column; the 2/3 + rail split kicks in at lg. `grid-cols-1`
          (not a bare `grid`) makes the mobile track `minmax(0,1fr)` so it fills — never content-sizes —
          the viewport, and `min-w-0` lets the column shrink below its content min-width, so a wide
          child (long name, prospectus rows) can't blow the column out past the screen. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          {/* Hero */}
          <section className="rounded-xl border border-border bg-surface p-5 lg:p-6">
            <div className="flex items-start gap-4">
              {/* POO-740: the manager-uploaded logo (StrategyLogo), mirroring Home; the risk tint is
                  kept for the no-image initials fallback. Fixes the hero that only showed a letter. */}
              <StrategyLogo
                url={strategy.logoUrl}
                name={strategy.name}
                className={cn("size-12 text-lg font-semibold", tint)}
              />
              <div className="min-w-0 flex-1">
                <h1 className="break-words font-bold text-foreground text-xl">{strategy.name}</h1>
                <p className="mt-0.5 flex items-center gap-1 text-muted-foreground text-sm">
                  {/* POO-794 R1/R2: the DUPLICATE manager avatar was removed from this subline (the
                      photo already renders in the right-rail / mobile ManagerCard). The inline text
                      credit ("by @handle" else masked wallet) + verified badge stay as a lightweight
                      one-line attribution under the name. */}
                  <ManagerLink
                    handle={strategy.managerHandle}
                    address={strategy.managerAddress}
                    className="truncate"
                  >
                    {t("card.by", { manager: strategy.manager })}
                  </ManagerLink>
                  {/* POO-771 R6: the verified badge is gated on the backend-derived managerVerified
                      (the single badge source). */}
                  {strategy.managerVerified === true ? (
                    <BadgeCheck
                      className="size-4 shrink-0 text-info"
                      aria-label={t("detail.managerVerified")}
                    />
                  ) : null}
                </p>
                {/* Pool pair + protocol — the strategy's underlying Uniswap v3 pool. "Uniswap v3" is
                    a protocol name (not translated); V1 is single-protocol (POO-323 items 15, 19). */}
                {detail?.poolPair ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-border px-2.5 py-0.5 font-medium text-foreground text-xs">
                      {detail.poolPair.token0} / {detail.poolPair.token1}
                    </span>
                    <span className="rounded-full border border-border px-2.5 py-0.5 text-muted-foreground text-xs">
                      Uniswap v3
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="text-right">
                <p className="font-bold text-2xl text-success">
                  {formatPercent(strategy.estReturn)}
                </p>
                <p className="text-[10px] text-muted-foreground uppercase">
                  <AprTooltip>{strategy.rateType}</AprTooltip>
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <RiskMeter level={strategy.riskLevel} />
              <span className="text-muted-foreground text-xs">
                {riskLabels[strategy.riskLevel]}
              </span>
            </div>
          </section>

          {/* Closed banner: the manager ended the strategy; funds are ready to withdraw. */}
          {isClosed ? (
            <div className="rounded-xl border border-warning/40 bg-warning/10 p-4">
              <p className="font-semibold text-foreground text-sm">{t("detail.closed.title")}</p>
              <p className="mt-1 text-muted-foreground text-sm">
                {t("detail.closed.body", { manager: strategy.manager })}
              </p>
            </div>
          ) : null}

          {/* Owned position (mobile shows it here; desktop shows it in the rail) */}
          {positionCard ? <div className="lg:hidden">{positionCard}</div> : null}

          {/* Paused notice */}
          {isPaused ? (
            <div className="rounded-xl border border-warning/40 bg-warning/10 p-4">
              <p className="font-semibold text-foreground text-sm">
                {t("detail.paused.title", { name: strategy.name })}
              </p>
              <p className="mt-1 text-muted-foreground text-sm">{t("detail.paused.body")}</p>
            </div>
          ) : null}

          {/* Mobile action block (desktop uses the rail) */}
          <div className="lg:hidden">{mobileActions}</div>

          {/* Manager card (mobile shows it here; desktop shows it in the rail) */}
          <div className="lg:hidden">{managerCard}</div>

          {/* Performance (pool value). POO-557 R2: tabs are date-based windows; one whose window
              exceeds the available history is disabled (aria-disabled + dimmed), never rendered
              identical to a smaller tab. R3: <2 points → the explicit no-history state. */}
          <section className="rounded-xl border border-border bg-surface p-5">
            {/* POO-843 R1: wrap so the tablist drops to its own line on a narrow phone (mirrors the
                Home hero) instead of being hidden below sm. */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold text-base text-foreground">{t("detail.performance")}</h2>
              {hasHistory ? (
                <div
                  className="flex items-center gap-1 rounded-lg border border-border p-1"
                  role="tablist"
                  aria-label={t("detail.performance")}
                >
                  {periods.map((label, index) => {
                    const enabled = periodEnabled(chartData, index);
                    return (
                      <button
                        key={label}
                        type="button"
                        role="tab"
                        disabled={!enabled}
                        aria-disabled={!enabled}
                        aria-selected={index === effectivePeriod}
                        onClick={() => setPeriod(index)}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-xs transition-colors",
                          index === effectivePeriod
                            ? "bg-surface-raised font-medium text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                          "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted-foreground",
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            {hasHistory ? (
              <div className="mt-4 h-32 lg:h-40">
                <PerformanceChart data={series} ariaLabel={t("detail.performance")} />
              </div>
            ) : (
              <div className="mt-4 flex h-32 flex-col items-center justify-center gap-1 rounded-lg border border-border border-dashed px-4 text-center lg:h-40">
                <p className="font-medium text-foreground text-sm">
                  {t("detail.chart.noHistoryTitle")}
                </p>
                <p className="text-muted-foreground text-xs">{t("detail.chart.noHistoryBody")}</p>
              </div>
            )}
          </section>

          {/* 2×2 metrics */}
          <section className="grid grid-cols-2 gap-3">
            <MetricTile label={t("detail.metrics.min")} value={formatUsd(strategy.minInvestment)} />
            <MetricTile
              label={t("detail.metrics.tvl")}
              value={formatPoolTvl(strategy.uniswapPoolTvlUsd)}
            />
            <MetricTile label={t("detail.metrics.lockup")} value={lockupValue} />
            {/* POO-902 R1-R3: the Performance fee tile replaces the Investors count. Whole-number
                fees render bare ("10%", "0%"); a fractional fee keeps one decimal ("12.5%") rather
                than rounding into a figure the manager never set. Absent fee → no tile. */}
            {performanceFeePct !== undefined ? (
              <MetricTile
                label={t("detail.metrics.performanceFee")}
                value={formatPercent(
                  performanceFeePct,
                  Number.isInteger(performanceFeePct) ? 0 : 1,
                )}
              />
            ) : null}
          </section>

          {/* About — the manager's real description (renders in real mode, not gated on `detail`). */}
          {about ? (
            <Section title={t("detail.about")}>
              <p className="text-muted-foreground text-sm leading-relaxed">{about}</p>
            </Section>
          ) : null}

          {detail ? (
            <>
              {/* Composition — collapsed by default (POO-903 [R2]); the body (incl. the POO-897
                  proportions bar) is unchanged, wrapped in one div to keep its spacing. */}
              <CollapsibleCard title={t("detail.composition")} defaultOpen={false}>
                <div>
                  <div className="flex h-3 w-full overflow-hidden rounded-full">
                    {detail.composition.map((slice, index) => (
                      <span
                        key={slice.label}
                        className={COMPOSITION_COLORS[index % COMPOSITION_COLORS.length]}
                        style={{ width: `${slice.weight}%` }}
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                  <ul className="mt-4 flex flex-col gap-2">
                    {detail.composition.map((slice, index) => (
                      <li
                        key={slice.label}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="flex items-center gap-2 text-foreground">
                          <span
                            className={cn(
                              "size-2.5 rounded-full",
                              COMPOSITION_COLORS[index % COMPOSITION_COLORS.length],
                            )}
                            aria-hidden="true"
                          />
                          {slice.label}
                        </span>
                        <span className="font-medium text-muted-foreground">
                          {formatPercent(slice.weight, 0)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CollapsibleCard>

              {/* Investment mandate — collapsed by default (POO-903 [R2]), body unchanged. */}
              <CollapsibleCard title={t("detail.mandate.title")} defaultOpen={false}>
                <div>
                  <p className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {t("detail.mandate.assets")}
                  </p>
                  <div className="flex flex-col divide-y divide-border">
                    {detail.mandate.assets.map((asset) => (
                      <DataRow
                        key={asset.label}
                        label={asset.label}
                        value={formatPercent(asset.maxPct, 0)}
                      />
                    ))}
                  </div>
                  <p className="mt-4 mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {t("detail.mandate.protocols")}
                  </p>
                  <div className="flex flex-col divide-y divide-border">
                    {detail.mandate.protocols.map((protocol) => (
                      <DataRow
                        key={protocol.label}
                        label={protocol.label}
                        value={formatPercent(protocol.maxPct, 0)}
                      />
                    ))}
                  </div>
                  <p className="mt-4 mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {t("detail.mandate.networks")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {detail.mandate.networks.map((network) => (
                      <span
                        key={network}
                        className="rounded-full border border-border px-3 py-1 text-foreground text-xs"
                      >
                        {network}
                      </span>
                    ))}
                  </div>
                </div>
              </CollapsibleCard>

              {/* Risk limits & terms */}
              <Section title={t("detail.riskLimits.title")}>
                <p className="mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  {t("detail.riskLimits.maxDrawdown")}
                </p>
                <div className="flex flex-col divide-y divide-border">
                  {detail.riskLimits.maxDrawdown.map((band) => (
                    <DataRow
                      key={band.period}
                      label={band.period}
                      value={formatPercent(band.pct)}
                      tone="destructive"
                    />
                  ))}
                </div>
                <div className="mt-3 flex flex-col divide-y divide-border border-border border-t">
                  <DataRow
                    label={t("detail.riskLimits.leverage")}
                    value={detail.riskLimits.leverage}
                  />
                  <DataRow
                    label={t("detail.riskLimits.rebalancing")}
                    value={detail.riskLimits.rebalancing}
                  />
                  <DataRow
                    label={t("detail.riskLimits.liquidity")}
                    value={detail.riskLimits.liquidity}
                  />
                  <DataRow
                    label={t("detail.riskLimits.strategyType")}
                    value={detail.riskLimits.strategyType}
                  />
                  <DataRow
                    label={t("detail.riskLimits.benchmark")}
                    value={detail.riskLimits.benchmark}
                  />
                  <DataRow
                    label={t("detail.riskLimits.custody")}
                    value={detail.riskLimits.custody}
                  />
                </div>
              </Section>

              {/* Fees */}
              <Section title={t("detail.fees.title")}>
                <div className="flex flex-col divide-y divide-border">
                  <DataRow
                    label={t("detail.fees.management")}
                    value={
                      detail.fees.managementPct > 0
                        ? formatPercent(detail.fees.managementPct)
                        : t("detail.fees.none")
                    }
                  />
                </div>
              </Section>
            </>
          ) : (
            // Real mode (no mock prospectus): derive Composition + Investment mandate from the real
            // pool, or show "not available" when the pair is unknown — never fabricate (#244).
            // POO-897 R1/R2: the Composition card shows the per-token proportion: the invested
            // variant splits from the position's reserve block, the non-invested one from the
            // strategy's onchain block (range-math tick fallback, R4/R5); unresolvable → null keeps
            // the single "Liquidity pool 100%" row.
            <SinglePoolProspectus
              tokens={strategy.poolPair ?? null}
              networkName={
                strategy.network
                  ? strategy.network.charAt(0).toUpperCase() + strategy.network.slice(1)
                  : null
              }
              network={strategy.network ?? null}
              split={strategyCompositionSplit(strategy, position)}
            />
          )}
        </div>

        {/* Desktop sticky rail */}
        <aside className="hidden min-w-0 lg:col-span-1 lg:block">
          <div className="sticky top-6 flex flex-col gap-4">
            {positionCard}
            {railActions}
            {managerCard}
          </div>
        </aside>
      </div>

      {/* Transactional flows */}
      <InvestModal
        open={investOpen}
        onOpenChange={(next) => {
          setInvestOpen(next);
          if (!next) setInvestResumeAmount(null);
        }}
        strategy={strategy}
        balance={balance}
        resumeAmount={investResumeAmount}
        onInvested={onPositionChanged}
        buildInvestSteps={
          isMockMode
            ? undefined
            : (amountUsd, slippage) => invest.buildSteps(strategy, amountUsd, slippage)
        }
      />
      {position && effectivePosition ? (
        <>
          <CollectModal
            open={collectOpen}
            onOpenChange={setCollectOpen}
            strategy={strategy}
            position={effectivePosition}
            buildCollectSteps={
              isMockMode
                ? undefined
                : // POO-802 R0: the handshake steps — the build step pauses the Review on REAL
                  // figures, the confirm step only signs + sends. POO-417 R2 / POO-463 R4: the
                  // receive-as choice + gear slippage thread into the server build.
                  (collectAsTokenPair, slippageTolerance) =>
                    collect.buildSteps(strategy, position, slippageTolerance, collectAsTokenPair)
            }
            onChanged={onPositionChanged}
            // POO-468 R1: fired ONCE per collect success. Snapshot the claimable AT collect time
            // (the still-stale prop) and arm the optimistic $0 override above. POO-936 [R3]: a no-op
            // when the /financials cutover is on (the override is retired; the served figures already
            // move collected + claimable together).
            onCollected={
              overrideActive ? () => setCollectedAtYield(position.totalYield) : undefined
            }
          />
          {/* POO-511 R1: mock-mode only. CompoundModal settles a mock; not mounting it in real
              mode guarantees no real-mode path reaches that settle (the CTA above is disabled). */}
          {isMockMode ? (
            <CompoundModal
              open={compoundOpen}
              onOpenChange={setCompoundOpen}
              strategy={strategy}
              position={effectivePosition}
              onChanged={onPositionChanged}
            />
          ) : null}
          <WithdrawModal
            open={withdrawOpen}
            onOpenChange={setWithdrawOpen}
            strategy={strategy}
            position={effectivePosition}
            buildWithdrawSteps={
              isMockMode
                ? undefined
                : // POO-481 R4: the receive-as choice rides along as shouldSwapFees = !pair.
                  (amountUsd, slippage, receiveAsPair) =>
                    withdraw.buildSteps(strategy, position, amountUsd, slippage, receiveAsPair)
            }
            onChanged={onPositionChanged}
          />
          {canShare && earnings && referralLink ? (
            <ShareYieldModal
              open={shareOpen}
              onOpenChange={setShareOpen}
              strategyId={strategy.id}
              strategyName={strategy.name}
              riskLabel={riskLabels[strategy.riskLevel] ?? ""}
              earnings={earnings}
              referralLink={referralLink}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
