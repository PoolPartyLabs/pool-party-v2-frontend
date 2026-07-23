/**
 * @id PP-PORT-SCR-001
 * @name Portfolio
 * @implements-rules-version v3 (POO-829 rules v2)
 *
 * Holdings & performance (presentational; data fetched by the route). Distinct from Home:
 * holdings-focused, leads with all-time earned + allocation-by-risk, no discovery feed, no referral.
 * Growth-first (withdrawal never promoted). Responsive: mobile = summary + allocation + KPI grid +
 * position cards; desktop = hero + chart, an aside (allocation + "put your money to work"), a KPI
 * row, and a positions table. Renders the empty/first-run state when there are no positions.
 *
 * POO-647 (rules v1): a closed position keeps only its "Closed" tag (the redundant green
 * "Available to withdraw" pill was dropped [R1]); on closed rows the desktop table's Rate column is
 * reclaimed for a Withdraw deep-link (/strategies/<id>?withdraw=1&from=portfolio) [R3] while the
 * mobile card still surfaces the Final APY. Mobile stays growth-first: the card taps through to the
 * owned detail [R4].
 *
 * POO-629 (rules v1, PR5 of the POO-623 windowed-virtualization epic): the positions (desktop table +
 * mobile cards) and the on-demand closed-strategies history window via document scroll
 * ({@link WindowedTableBody} / {@link WindowedCardList}, `useWindowVirtualizer`), so the hero/aside
 * layout and browser back-nav scroll restoration are preserved. Each list keys its rows by
 * `position.id`, so a 45s / focus refetch or a post-write refresh that yields a new array with the
 * SAME ids and changed values is a same-identity REFRESH, not a reset; the scroll offset survives
 * ([R1]/[R2]). The closed-pinned floor (portfolioViewModel canonical order) is part of that stable
 * order, not a reset trigger ([R3]). The lists fall back to the plain `.map()` baseline whenever the
 * gate is off (flag off, <= THRESHOLD, or no layout), so activeCount and the DOM are unchanged ([R4]).
 *
 * POO-829 (rules v2): the active "Your positions" columns are sortable, default Yield DESCENDING
 * ([R2]; Yield = `position.totalYield`, the signed USD PnL — not the Rate/APR column). [R3] in real
 * (paged) mode only columns with a POO-828 backend sort field (Invested / Current Value / Yield /
 * Rate) are interactive and forward the change to `paged.active.onSortChange` (server round-trip,
 * page-0 reset); Risk has NO backend field (POO-828 defers `riskLevel`), so its header renders as
 * plain text, mirroring POO-734's dead-header rule for Explore. The paged rows render in SERVER order
 * verbatim — never re-sorted client-side. [R6] mock mode sorts every column client-side with the
 * POO-457 closed-pinned floor as the PRIMARY key (the selected column is the secondary key). [R7] a
 * sort change emits `portfolio_sort_changed`. [R8] the mobile card list gets a "Sort by" control
 * (metric dropdown + direction toggle, lg:hidden, mirroring Explore's POO-843 pattern) writing the
 * SAME sort state as the desktop headers.
 */
"use client";

import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  ChevronDown,
  ChevronUp,
  Loader2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { MaskableValue } from "@/components/data-display/MaskableValue";
import { MetricTile } from "@/components/data-display/MetricTile";
import { type ChartPoint, PerformanceChart } from "@/components/data-display/PerformanceChart";
import { StrategyLogo } from "@/components/data-display/StrategyLogo";
import { AprTooltip } from "@/components/ui/AprTooltip";
import { EyeToggle } from "@/components/ui/EyeToggle";
import { FilterDropdown } from "@/components/ui/FilterDropdown";
import { ManagerLink } from "@/features/manager/components/ManagerLink";
import { RiskMeter } from "@/features/strategies/components/RiskMeter";
import { Link } from "@/i18n/navigation";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { INVESTOR_HIDE_VALUES_KEY, PersistedMaskProvider } from "@/lib/hooks/maskValue";
// Type-only: fetchPortfolioPage is server-only, but its sort TYPES are erased at compile time.
import type { PortfolioSort, PortfolioSortKey } from "@/lib/portfolio/fetchPortfolioPage";
import type { Position, Strategy } from "@/lib/schemas";
import { cn } from "@/lib/utils/cn";
import {
  formatPercent,
  formatSignedUsd,
  formatSignedUsdTile,
  formatUsd,
  formatUsdTile,
} from "@/lib/utils/format";
import { getClosedStrategiesAction } from "./actions";
import { AllocationByRisk, type AllocationSegment } from "./components/AllocationByRisk";
import { PositionCard } from "./components/PositionCard";
import { PositionLink } from "./components/PositionLink";
import { WindowedCardList, WindowedTableBody } from "./components/WindowedList";

/** An owned position joined with its strategy. */
export interface PortfolioViewPosition {
  position: Position;
  strategy: Strategy;
}

/**
 * POO-829 [R3]: the columns the BACKEND can sort in real (paged) mode — the keys mapped in
 * `fetchPortfolioPage`'s SORT_FIELD_BY_KEY (`yield` → totalYield, `invested` → invested, `value` →
 * currentValue, `rate` → feesApr; POO-828). `risk` stays OUT: POO-828 defers `riskLevel` (not carried
 * on the portfolio payload; the backend silently ignores it), so in paged mode its header renders as
 * plain, non-interactive text instead of a silent no-op button — POO-734's dead-header rule. Mock
 * mode sorts every column client-side, so all five stay interactive there. Kept as a literal (not
 * imported) because `fetchPortfolioPage` is a `server-only` module and this is a Client Component.
 */
const PAGED_SORTABLE_KEYS: ReadonlySet<PortfolioSortKey> = new Set([
  "invested",
  "value",
  "yield",
  "rate",
]);

/**
 * POO-829 [R8]: the sort keys the mobile sort dropdown offers, in the desktop table's column order.
 * In paged (real) mode it is narrowed to `PAGED_SORTABLE_KEYS`; mock mode shows all five.
 */
const SORT_KEY_ORDER: readonly PortfolioSortKey[] = ["risk", "invested", "value", "yield", "rate"];

/** POO-829 [R2]: the default sort — Yield (position PnL in USD) descending. */
const DEFAULT_SORT: PortfolioSort = { key: "yield", dir: "desc" };

/** Numeric value for a position row under a given sort column (mock-mode client sort, [R6]). */
function sortValue({ position, strategy }: PortfolioViewPosition, key: PortfolioSortKey): number {
  switch (key) {
    case "risk":
      return strategy.riskLevel;
    case "invested":
      return position.invested;
    case "value":
      return position.currentValue;
    case "yield":
      return position.totalYield;
    case "rate":
      return strategy.estReturn;
  }
}

/** The active "Your positions" list's "Load more" controls (POO-668 R1). */
export interface PortfolioActivePaging {
  /** Whether another active page exists after the loaded ones (short-page termination). */
  hasMore: boolean;
  /** True while an active page load is in flight (disables the button). */
  loading: boolean;
  /** Append the next active page. */
  onLoadMore: () => void;
  /**
   * A sort column/direction change (POO-829 R2/R3): a server round-trip that RESETS the pager to
   * page 0 with the new `sorting` tuple. Only backend-sortable columns reach this (dead headers
   * are non-interactive in paged mode).
   */
  onSortChange: (sort: PortfolioSort) => void;
}

/** The on-demand "Show closed strategies" list's reveal + "Load more" controls (POO-668 R2). */
export interface PortfolioClosedPaging {
  /**
   * The loaded closed entries in BACKEND ORDER (closed-with-balance-first, rendered verbatim). `null`
   * before the first reveal; `[]` once revealed with no closed strategies.
   */
  entries: PortfolioViewPosition[] | null;
  /** True while a closed page load (reveal or more) is in flight. */
  loading: boolean;
  /** Whether another closed page exists after the loaded ones (short-page termination). */
  hasMore: boolean;
  /** Load the FIRST closed page (called on the first expand of the section). */
  onReveal: () => void;
  /** Append the next closed page. */
  onLoadMore: () => void;
}

/**
 * Server-paging controls (POO-668). When supplied (real mode), the active positions + closed history
 * are server-paged with their own "Load more"; the accumulated pages render PLAINLY (the POO-629
 * windowing is superseded, R5). Absent (mock mode) → the current windowed lists + one-shot closed
 * toggle, unchanged. KPIs always render from the scalar props (the loader maps the grand aggregates in).
 */
export interface PortfolioPagedControls {
  /** The active "Your positions" list paging. */
  active: PortfolioActivePaging;
  /** The on-demand closed-history list paging. */
  closed: PortfolioClosedPaging;
}

/** Public props for {@link PortfolioView}. */
export interface PortfolioViewProps {
  totalValue: number;
  totalEarned: number;
  /**
   * `invested` / `totalYield`: `null` = the C1 `/financials` payload served this field honest-absent,
   * OR financials are unavailable (real mode; PP-CORE-LIB-048); the KPI tile renders the "not available
   * yet" affordance, NEVER $0 ([R5]). In mock mode these are always the mock-computed numbers.
   */
  invested: number | null;
  currentValue: number;
  totalYield: number | null;
  avgApy: number;
  /** Labelled value series for the hero chart. */
  chartData: ChartPoint[];
  /** Allocation totals per risk band. */
  allocation: AllocationSegment[];
  /** The investor's positions (joined with their strategies). In the paged path, the accumulated pages. */
  positions: PortfolioViewPosition[];
  /**
   * Real-mode server-paging controls (POO-668). Present → the active + closed lists are server-paged
   * with "Load more" and render plainly (windowing superseded). Absent → the mock-mode windowed +
   * one-shot behavior.
   */
  paged?: PortfolioPagedControls;
}

/** First-run state shown when the investor has no positions. */
function EmptyPortfolio() {
  const t = useTranslations("portfolio");
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-4 py-20 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-primary/15 text-primary">
        <TrendingUp className="size-7" aria-hidden="true" />
      </span>
      <div>
        <h2 className="font-semibold text-foreground text-xl">{t("empty.title")}</h2>
        <p className="mt-1 text-muted-foreground text-sm">{t("empty.body")}</p>
      </div>
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
        <Link
          href="/deposit"
          className="rounded-md bg-primary px-5 py-2.5 text-center font-semibold text-primary-foreground text-sm hover:bg-primary/90"
        >
          {t("empty.deposit")}
        </Link>
        <Link
          href="/strategies"
          className="rounded-md border border-border px-5 py-2.5 text-center font-medium text-foreground text-sm hover:bg-surface-raised"
        >
          {t("empty.explore")}
        </Link>
      </div>
    </div>
  );
}

/** The shared "Load more" button for the paged active + closed lists (POO-668). */
function LoadMoreButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  const t = useTranslations("portfolio");
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="rounded-lg border border-border bg-surface px-5 py-2.5 font-medium text-foreground text-sm transition-colors hover:bg-surface/70 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ring"
    >
      {loading ? t("loadingMore") : t("loadMore")}
    </button>
  );
}

/** Holdings & performance. */
export function PortfolioView(props: PortfolioViewProps) {
  const t = useTranslations("portfolio");
  const ts = useTranslations("strategies");
  const tc = useTranslations("common");
  const { track } = useAnalytics();
  const { totalValue, totalEarned, invested, currentValue, totalYield, avgApy } = props;
  const { chartData, allocation, positions, paged } = props;

  // POO-829 [R2]: the active-list sort, default Yield descending. The SINGLE writer is applySort,
  // shared by the desktop headers AND the mobile control (R8) so both drive the same state. In paged
  // (real) mode the server sorts (onSortChange resets the pager to page 0); mock mode re-sorts below.
  const [sort, setSort] = useState<PortfolioSort>(DEFAULT_SORT);

  // POO-829 [R7]: every sort change (headers or mobile control) emits the typed analytics event.
  function applySort(next: PortfolioSort) {
    track("portfolio_sort_changed");
    setSort(next);
    paged?.active.onSortChange(next);
  }

  // Desktop header: click a column → sort by it desc; click the active column again → flip direction.
  function toggleSort(key: PortfolioSortKey) {
    applySort(
      sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" },
    );
  }

  // POO-829 [R8] (mobile control, mirrors Explore's POO-843 pattern): the dropdown picks the metric
  // (a new metric starts descending; same metric = no-op), the toggle owns the direction.
  function selectSortKey(key: PortfolioSortKey) {
    if (key === sort.key) return;
    applySort({ key, dir: "desc" });
  }

  function toggleSortDir() {
    applySort({ key: sort.key, dir: sort.dir === "asc" ? "desc" : "asc" });
  }

  // POO-829 [R6]: the rendered list. Paged (real) mode renders the SERVER order verbatim (the backend
  // sorted the full holdings before slicing — never re-sorted client-side). Mock mode sorts client-
  // side with the POO-457 closed-pinned floor as the PRIMARY key and the selected column as the
  // SECONDARY key, preserving the mock ordering rule under any sort.
  const visiblePositions = useMemo(() => {
    if (paged) return positions;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...positions].sort((a, b) => {
      const pinned =
        Number(b.position.status === "closed") - Number(a.position.status === "closed");
      if (pinned !== 0) return pinned;
      return (sortValue(a, sort.key) - sortValue(b, sort.key)) * dir;
    });
  }, [paged, positions, sort]);

  // POO-829 [R8]: the mobile sort options reuse the desktop COLUMN labels so a metric reads exactly
  // like its column. Paged mode narrows to the backend-sortable set (same as the interactive headers).
  const sortColumnLabels: Record<PortfolioSortKey, string> = {
    risk: t("columns.risk"),
    invested: t("columns.invested"),
    value: t("columns.value"),
    yield: t("columns.yield"),
    rate: t("columns.rate"),
  };
  const mobileSortOptions = (
    paged ? SORT_KEY_ORDER.filter((key) => PAGED_SORTABLE_KEYS.has(key)) : SORT_KEY_ORDER
  ).map((key) => ({ value: key, label: sortColumnLabels[key] }));

  // "Show closed strategies" (POO-460): the fully-exited (already-withdrawn) closed strategies are
  // hidden by default and loaded on demand as read-only history. `null` = not loaded yet / loading.
  const [showClosed, setShowClosed] = useState(false);
  // The one-shot (mock) path keeps its local state; the paged (real) path reads paged.closed.entries.
  const [localClosedEntries, setLocalClosedEntries] = useState<PortfolioViewPosition[] | null>(
    null,
  );
  const [localClosedLoading, setLocalClosedLoading] = useState(false);

  // In the paged path the closed list is driven by the loader; otherwise by the local one-shot read.
  const closedEntries = paged ? paged.closed.entries : localClosedEntries;
  const closedLoading = paged ? paged.closed.loading : localClosedLoading;

  async function toggleClosed() {
    const next = !showClosed;
    setShowClosed(next);
    if (!next) return;
    if (paged) {
      // Paged (POO-668 R2): the reveal loads the FIRST closed page; the loader ignores a repeat reveal
      // once it already has entries, so this is safe to call on each expand.
      if (paged.closed.entries === null && !paged.closed.loading) paged.closed.onReveal();
      return;
    }
    // Mock one-shot: read the whole exited history once.
    if (localClosedEntries === null && !localClosedLoading) {
      setLocalClosedLoading(true);
      try {
        setLocalClosedEntries(await getClosedStrategiesAction());
      } finally {
        setLocalClosedLoading(false);
      }
    }
  }

  if (positions.length === 0) {
    return <EmptyPortfolio />;
  }

  /**
   * A desktop column header (POO-829 R3). In real (paged) mode a column with no backend sort field
   * (`risk`, POO-828-deferred) renders as plain, non-interactive text instead of a no-op sort button
   * (POO-734's dead-header rule); mock mode sorts every column client-side, so all stay interactive.
   */
  const sortableHeader = (key: PortfolioSortKey, label: string, align: "left" | "right") => {
    if (paged && !PAGED_SORTABLE_KEYS.has(key)) {
      return <span className="font-medium">{label}</span>;
    }
    const active = sort.key === key;
    return (
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className={cn(
          "inline-flex items-center gap-1 font-medium",
          align === "right" && "flex-row-reverse",
          active ? "text-primary" : "hover:text-foreground",
        )}
      >
        {label}
        {active ? (
          sort.dir === "asc" ? (
            <ChevronUp className="size-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden="true" />
          )
        ) : null}
      </button>
    );
  };

  return (
    <PersistedMaskProvider persistKey={INVESTOR_HIDE_VALUES_KEY}>
      <div className="flex flex-col gap-8">
        {/* Summary: hero + aside */}
        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface p-5 lg:col-span-2 lg:p-6">
            <div className="flex items-center gap-2">
              <p className="text-muted-foreground text-sm">{t("portfolioValue")}</p>
              <EyeToggle label={t("hideValues")} />
            </div>
            <p className="mt-1 font-bold text-3xl text-foreground lg:text-4xl">
              <MaskableValue>{formatUsd(totalValue)}</MaskableValue>
            </p>
            {/* POO-555 R6: sign-aware — zero renders neutrally, negatives destructively. */}
            <p
              className={cn(
                "mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs",
                totalEarned > 0 && "bg-success/10 text-success",
                totalEarned < 0 && "bg-destructive/10 text-destructive",
                totalEarned === 0 && "bg-surface-raised text-muted-foreground",
              )}
            >
              {totalEarned > 0 ? <TrendingUp className="size-3" aria-hidden="true" /> : null}
              {totalEarned < 0 ? <TrendingDown className="size-3" aria-hidden="true" /> : null}
              {t("allTimeEarned", { amount: formatSignedUsd(totalEarned) })}
            </p>
            <div className="mt-4 h-28 lg:h-40">
              <PerformanceChart data={chartData} ariaLabel={t("portfolioValue")} />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-surface p-5">
              <p className="mb-3 font-medium text-foreground text-sm">{t("allocationByRisk")}</p>
              <AllocationByRisk allocation={allocation} />
            </div>
            {/* Growth CTA — desktop only (replaces referral; never promotes withdrawal). */}
            <div className="hidden rounded-xl border border-border bg-surface p-5 lg:block">
              <p className="font-semibold text-foreground">{t("putToWork.title")}</p>
              <p className="mt-1 text-muted-foreground text-sm">{t("putToWork.body")}</p>
              <div className="mt-4 flex flex-col gap-2">
                <Link
                  href="/deposit"
                  className="rounded-md bg-primary px-4 py-2 text-center font-semibold text-primary-foreground text-sm hover:bg-primary/90"
                >
                  {t("putToWork.deposit")}
                </Link>
                <Link
                  href="/strategies"
                  className="rounded-md border border-border px-4 py-2 text-center font-medium text-foreground text-sm hover:bg-surface-raised"
                >
                  {t("putToWork.explore")}
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* KPI row */}
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricTile
            label={t("invested")}
            // POO-843 R4: compact past $1M so a 7-figure value fits the half-width tile at 375px.
            // POO-936 [R5]: a served NULL renders "not available yet", never $0.
            value={
              invested === null ? (
                tc("unavailable")
              ) : (
                <MaskableValue>{formatUsdTile(invested)}</MaskableValue>
              )
            }
          />
          <MetricTile
            label={t("currentValue")}
            value={<MaskableValue>{formatUsdTile(currentValue)}</MaskableValue>}
          />
          <MetricTile
            label={t("totalYield")}
            value={totalYield === null ? tc("unavailable") : formatSignedUsdTile(totalYield)}
            deltaTone={totalYield !== null && totalYield < 0 ? "negative" : "positive"}
          />
          <MetricTile
            label={<AprTooltip average>{t("avgApy")}</AprTooltip>}
            value={formatPercent(avgApy)}
          />
        </section>

        {/* Positions */}
        <section>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="font-semibold text-foreground text-lg">{t("yourPositions")}</h2>
            <span className="text-muted-foreground text-sm">
              {t("activeCount", {
                count: positions.filter(({ position }) => position.status === "active").length,
              })}
            </span>
          </div>

          {/* POO-829 R8: the mobile sort control. Desktop sorts via the table headers (hidden below
              lg), so this is lg:hidden; it drives the SAME `sort` state the headers do (selectSortKey
              / toggleSortDir → applySort → paged.active.onSortChange), so the two never diverge.
              Mirrors Explore's POO-843 "Sort by" pattern: FilterDropdown picks the metric, the toggle
              owns the direction. Labels reuse the strategies-namespace sort strings (shared copy). */}
          <div className="mb-3 flex items-center gap-2 lg:hidden">
            <span className="text-muted-foreground text-xs">{ts("explore.sortLabel")}</span>
            <FilterDropdown
              label={ts("explore.sortLabel")}
              options={mobileSortOptions}
              value={sort.key}
              onSelect={selectSortKey}
            />
            <button
              type="button"
              onClick={toggleSortDir}
              // Purpose-bearing accessible name (mirrors FilterDropdown's "label: value"): announced
              // as e.g. "Sort by: Descending", not a bare context-free adjective.
              aria-label={`${ts("explore.sortLabel")}: ${
                sort.dir === "asc" ? ts("explore.sortDir.asc") : ts("explore.sortDir.desc")
              }`}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {sort.dir === "asc" ? (
                <ArrowUp className="size-4" aria-hidden="true" />
              ) : (
                <ArrowDown className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>

          {/* Mobile: cards. Windowed by document scroll ([R1] — falls back to the plain flow list
              below THRESHOLD / flag off, byte-for-byte today's DOM). Keyed by position.id so a refetch
              is a refresh, not a reset. */}
          <div className="lg:hidden">
            <WindowedCardList
              items={visiblePositions}
              getItemKey={({ position }) => position.id}
              estimateSize={140}
              // POO-668 R5: the paged path renders the accumulated pages plainly (windowing superseded).
              disabled={!!paged}
              className="flex flex-col gap-3"
              renderItem={({ position, strategy }) => (
                <PositionCard position={position} strategy={strategy} />
              )}
            />
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-hidden rounded-xl border border-border lg:block">
            <table className="w-full text-sm">
              {/* POO-829 R3: sortable headers. Strategy was never a sort column (plain); Risk is
                  interactive only in mock mode (no POO-828 backend field → dead header when paged). */}
              <thead className="bg-surface text-muted-foreground text-xs">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium">
                    {t("columns.strategy")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">
                    {sortableHeader("risk", t("columns.risk"), "left")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    {sortableHeader("invested", t("columns.invested"), "right")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    {sortableHeader("value", t("columns.value"), "right")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    {sortableHeader("yield", t("columns.yield"), "right")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    {sortableHeader("rate", t("columns.rate"), "right")}
                  </th>
                </tr>
              </thead>
              {/* Windowed by document scroll (Technique A: in-flow spacer <tr>s, no absolute rows).
                  [R1] falls back to the plain <tbody> map below THRESHOLD / flag off. Keyed by
                  position.id so a 45s/focus refetch or post-write refresh is a refresh, not a reset. */}
              <WindowedTableBody
                items={visiblePositions}
                colSpan={6}
                estimateSize={57}
                // POO-668 R5: the paged path renders the accumulated pages plainly (windowing superseded).
                disabled={!!paged}
                getRowKey={({ position }) => position.id}
                rowClassName="border-border border-t"
                renderRow={({ position, strategy }) => (
                  <>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {/* POO-724: strategy logo with an initials monogram fallback (parity with
                            Home + the mobile PositionCard); real data via the v2 holdings catalog
                            (POO-721). Closed positions resolved from the position fallback have no
                            logo source, so they show the monogram — never a broken image. */}
                        <StrategyLogo
                          url={strategy.logoUrl}
                          name={strategy.name}
                          className="size-8 shrink-0 text-xs"
                        />
                        <div className="min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            <PositionLink
                              positionId={position.id}
                              strategyId={strategy.id}
                              from="portfolio"
                              className="font-medium text-foreground hover:underline"
                            >
                              {strategy.name}
                            </PositionLink>
                            {/* Strategies the investor manages (PP-INTEGRATION-POINT:
                                position.isPoolManager) get the "Owned" badge here too — mirrors Home
                                and the Strategies list. */}
                            {position.isPoolManager ? (
                              <span className="shrink-0 rounded-full px-2 py-0.5 font-medium text-primary text-xs ring-1 ring-primary/60 ring-inset">
                                {ts("explore.owned")}
                              </span>
                            ) : null}
                            {/* Desktop parity with the mobile PositionCard (POO-457 R6b): a closed
                                position shows its "Closed" status. POO-647 [R1] dropped the redundant
                                green "Available to withdraw" pill — the Rate column now carries the
                                Withdraw action (below) instead. */}
                            {position.status === "closed" ? (
                              <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-muted-foreground text-xs">
                                {t("status.closed")}
                              </span>
                            ) : null}
                          </span>
                          <p className="text-muted-foreground text-xs">
                            <ManagerLink
                              handle={strategy.managerHandle}
                              address={strategy.managerAddress}
                            >
                              {strategy.manager}
                              {/* POO-771 R7: the verified badge inline in the attribution cell. */}
                              {strategy.managerVerified === true ? (
                                <BadgeCheck
                                  className="ml-0.5 inline-block size-3.5 align-text-bottom text-info"
                                  aria-label={ts("detail.managerVerified")}
                                />
                              ) : null}
                            </ManagerLink>
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <RiskMeter level={strategy.riskLevel} />
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">
                      <MaskableValue>{formatUsd(position.invested)}</MaskableValue>
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">
                      <MaskableValue>{formatUsd(position.currentValue)}</MaskableValue>
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right",
                        position.totalYield < 0 ? "text-destructive" : "text-success",
                      )}
                    >
                      {formatSignedUsd(position.totalYield)}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">
                      {/* POO-647 [R3]: on closed rows the desktop Rate column is reclaimed for the
                          Withdraw action (the mobile PositionCard still surfaces the Final APY). The
                          link is a light red-tinted deep-link (as on Home) into the owned detail's
                          withdraw flow, with the portfolio back-context so the detail's back-link
                          returns here. Active rows keep the APR/APY value. */}
                      {position.status === "closed" ? (
                        <Link
                          href={`/strategies/${strategy.id}?withdraw=1&from=portfolio`}
                          className="inline-flex items-center rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1.5 font-medium text-destructive text-sm hover:bg-destructive/10"
                        >
                          {ts("detail.actions.withdraw")}
                        </Link>
                      ) : (
                        <>
                          {formatPercent(strategy.estReturn)}{" "}
                          <AprTooltip className="font-normal text-[10px] text-muted-foreground uppercase">
                            {strategy.rateType}
                          </AprTooltip>
                        </>
                      )}
                    </td>
                  </>
                )}
              />
            </table>
          </div>

          {/* POO-668 R1: the active list "Load more" (real mode). Short-page termination hides it once
              the last page came back short. The accumulated pages render plainly above (windowing off). */}
          {paged?.active.hasMore ? (
            <div className="mt-3 flex justify-center">
              <LoadMoreButton loading={paged.active.loading} onClick={paged.active.onLoadMore} />
            </div>
          ) : null}
        </section>

        {/* Closed strategies history (POO-460): the already-withdrawn closed strategies, hidden by
            default, revealed on demand and read-only (nothing left to withdraw). */}
        <section className="flex flex-col gap-3">
          <button
            type="button"
            onClick={toggleClosed}
            aria-expanded={showClosed}
            aria-controls="portfolio-closed-strategies"
            className="flex items-center gap-1 self-start font-medium text-muted-foreground text-sm hover:text-foreground"
          >
            {t("closedStrategies.title")}
            <ChevronDown
              className={cn("size-4 transition-transform", showClosed && "rotate-180")}
              aria-hidden="true"
            />
          </button>
          {showClosed && closedEntries === null && closedLoading ? (
            // The exited history is fetched on demand (a separate `closed=exited` read), so it never
            // taxes the initial page load; while the FIRST page is in flight, show a quiet spinner.
            // (A paged "Load more" keeps the list on screen and only disables its button, below.)
            <p
              id="portfolio-closed-strategies"
              role="status"
              aria-live="polite"
              className="inline-flex items-center gap-2 px-4 py-6 text-muted-foreground text-sm"
            >
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {tc("loading")}
            </p>
          ) : showClosed && closedEntries !== null ? (
            closedEntries.length > 0 ? (
              <div id="portfolio-closed-strategies" className="flex flex-col gap-2">
                {/* On-demand closed history in BACKEND ORDER (closed-with-balance-first, verbatim —
                    POO-668 R2, no client re-sort). Its OWN document-scroll virtualizer in mock mode
                    ([R1] falls back to the plain flow list below THRESHOLD / flag off); the paged path
                    disables the windowing (R5) and drives its own "Load more" below. Keyed by position.id. */}
                <WindowedCardList
                  items={closedEntries}
                  getItemKey={({ position }) => position.id}
                  estimateSize={84}
                  disabled={!!paged}
                  className="flex flex-col gap-2"
                  renderItem={({ position, strategy }) => (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
                      <div className="flex min-w-0 items-center gap-3">
                        {/* POO-724: strategy logo with an initials monogram fallback. */}
                        <StrategyLogo
                          url={strategy.logoUrl}
                          name={strategy.name}
                          className="size-8 shrink-0 text-xs"
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground text-sm">
                            {strategy.name}
                          </p>
                          <span className="mt-1 inline-flex items-center rounded-full bg-surface-raised px-2 py-0.5 text-muted-foreground text-xs">
                            {t("status.closed")}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-muted-foreground text-xs">{t("totalYield")}</p>
                        <p
                          className={cn(
                            "font-medium text-sm",
                            position.totalYield < 0 ? "text-destructive" : "text-success",
                          )}
                        >
                          {formatSignedUsd(position.totalYield)}
                        </p>
                      </div>
                    </div>
                  )}
                />
                {/* POO-668 R2: the closed list's OWN "Load more" (real mode). */}
                {paged?.closed.hasMore ? (
                  <div className="mt-1 flex justify-center">
                    <LoadMoreButton
                      loading={paged.closed.loading}
                      onClick={paged.closed.onLoadMore}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <p
                id="portfolio-closed-strategies"
                className="rounded-xl border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm"
              >
                {t("closedStrategies.empty")}
              </p>
            )
          ) : null}
        </section>
      </div>
    </PersistedMaskProvider>
  );
}
