/**
 * @id PP-STR-SCR-001
 * @name Strategies · Explore
 * @implements-rules-version v9
 *
 * POO-894 v1: the asset-category filter round-trips to the SERVER in paged (real) mode - selecting
 * categories forwards `paged.onCategoriesChange` (page-0 reset, like search/risk), the backend
 * filters + counts across the WHOLE catalog (`category` param on `GET /api/v2/strategies`), the
 * count line always reads `paged.total` ([R4]), and the loaded rows render verbatim (no client
 * narrowing - the pre-POO-894 loaded-pages-only narrowing dead-ended "Load more"). Mock mode keeps
 * the client-side `filterStrategiesByAssetTags` narrowing over the full catalog ([R7]).
 *
 * POO-843 v1 (R2): the mobile card list gains a "Sort by" control (metric {@link FilterDropdown} + a
 * direction toggle, lg:hidden, mirroring the manager POO-752 pattern) since the sortable table headers
 * are desktop-only (`hidden ... lg:block`). It writes the SAME `sort` state the headers drive via the
 * shared {@link applySort} (which forwards `paged.onSortChange`), so mobile and desktop never diverge
 * and the mobile metrics are narrowed to the backend-sortable set in paged mode, exactly like the
 * interactive desktop headers.
 *
 * POO-830 v1 (PR2, R6/R8): a MULTI-select asset-category filter (Bitcoin / Ethereum / Stablecoins /
 * Altcoins / Meme coins) sits beside the risk/type controls, gated behind the dark-launch
 * `strategyCategoryFilter` flag (R8) — invisible + inert when off, so the screen behaves exactly as
 * today. OR semantics (a strategy matches if its tag set includes ANY selected category; no selection
 * = no filter). MOCK mode filters client-side over the full catalog via the pure predicate
 * {@link filterStrategiesByAssetTags} (PP-STR-LIB-015); paged (real) mode is server-side since
 * POO-894 (see above).
 *
 * POO-734 v1: the desktop table headers sort SERVER-SIDE in real (paged) mode for every column the
 * backend exposes — `tvl`/`return` (POO-667) plus `risk`/`investors` (POO-726: `riskLevel` /
 * `totalInvestors`). Phase 1 [R1] disabled the dead headers (a column with no server field renders as
 * plain, non-interactive text, never a silent no-op); Phase 2 [R2] wired risk + investors now that
 * POO-726 shipped, so clicking them forwards `sorting=<field>:<dir>` and orders across all pages. Only
 * `min` stays plain (the identical platform floor). Mock mode still sorts every column client-side.
 *
 * v5 (POO-725): the real-mode search is DEBOUNCED (~300ms, [R1]) so a burst of keystrokes fires one
 * server round-trip (page-0 reset) instead of one per key; the input stays responsive via the local
 * state. The backend already matches name / token symbol / manager handle+name+wallet / any on-chain
 * address with relevance ranking (POO-733), so the placeholder is broadened to reflect that ([R2]);
 * relevance ordering while searching lives in the loader ({@link ExplorePagedLoader}, [R3]).
 *
 * v3 (POO-723): a real-mode (server-paged) search/filter that matches nothing no longer collapses the
 * screen to the terminal empty state — the search field + filter dropdowns stay mounted, a persistent
 * "Clear filters" action sits beside the dropdowns whenever a filter is active, and the terminal "No
 * strategies yet" shows ONLY for a genuinely empty catalog with no active filter (the initial page
 * load shows a loading affordance instead of flashing an empty state).
 *
 * v2 (POO-658): the Browse-by-risk / Browse-by-type filters are collapsed into floating dropdowns
 * ({@link FilterDropdown}, open on click) instead of always-visible chip rows. Supersedes the
 * `BrowseByRisk` component (PP-STR-CMP-002, removed).
 *
 * The managed-strategies discovery list (presentational; data fetched by the route). Responsive:
 * mobile stacks a search field, a browse-by-risk filter and risk-themed strategy cards; desktop adds
 * a sortable table (Risk / Min / TVL / Investors / Est. return) with a per-row gold Invest action
 * (the table-action exception to one-CTA-per-page). Owned strategies get an "Owned" badge; every
 * card/row routes to the strategy detail, which renders the Discovery or Owned state. The row/card
 * "Invest" stays gold per the explore-list exception.
 */
"use client";

import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Loader2,
  Search,
  TrendingUp,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { StrategyLogo } from "@/components/data-display/StrategyLogo";
import { AprTooltip } from "@/components/ui/AprTooltip";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterDropdown, type FilterOption } from "@/components/ui/FilterDropdown";
import { ManagerLink } from "@/features/manager/components/ManagerLink";
import { Link } from "@/i18n/navigation";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { useTrackView } from "@/lib/analytics/useTrackView";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { type AssetTag, STRATEGY_TYPES, type Strategy, type StrategyType } from "@/lib/schemas";
import { filterStrategiesByAssetTags } from "@/lib/strategies/tags/filterByAssetTags";
import { cn } from "@/lib/utils/cn";
import { formatPercent, formatPoolTvl, formatUsd } from "@/lib/utils/format";
// PP-PERF: windows the long Explore lists via the POO-625 shared virtualization primitive (mounts
// O(viewport) rows instead of O(n)); gated behind the `virtualize` flag + the >500 threshold.
import { techniqueASegments } from "@/lib/virtualization/rows";
import { useVirtualizedRows } from "@/lib/virtualization/useVirtualizedRows";
import { useVirtualizeGate } from "@/lib/virtualization/useVirtualizeGate";
import { CategoryFilter, type CategoryOption } from "./components/CategoryFilter";
import { RiskMeter } from "./components/RiskMeter";
import { StrategyCard } from "./components/StrategyCard";

/**
 * POO-830 R6: the asset categories the multi-select filter offers, in display order (matches the
 * `assetTagSchema` enum). Values are canonical `AssetTag`s; labels come from i18n (plain investor
 * voice — no "LST / concentrated / volatile"). A module constant so the option shape stays stable.
 */
const CATEGORY_VALUES: readonly AssetTag[] = [
  "bitcoin",
  "ethereum",
  "stablecoins",
  "altcoins",
  "meme",
];

/**
 * A stable empty-selection reference used when the category filter is flag-OFF, so the memoized
 * category filter never re-computes on an inline `[]` and the flag-off path is byte-for-byte today.
 */
const NO_CATEGORIES: AssetTag[] = [];

/** Desktop table row height estimate (px). Matches the plain-map row's `py-3` + content. */
const ROW_ESTIMATE = 57;
/** Mobile strategy-card height estimate (px), including the `gap-3` between cards. */
const CARD_ESTIMATE = 200;
/** POO-725 R1: debounce (ms) before a keystroke fires the server search round-trip (paged mode only). */
const SEARCH_DEBOUNCE_MS = 300;

/** Sortable desktop columns. */
type SortKey = "risk" | "min" | "tvl" | "investors" | "return";
type SortDir = "asc" | "desc";

/**
 * POO-734: the Explore columns the BACKEND can sort in real (paged) mode — the keys mapped in
 * `fetchStrategiesPage`'s SORT_FIELD_BY_KEY (`tvl` → tvlInUSD, `return` → feesApr, and — since POO-726
 * shipped the server fields — `risk` → riskLevel and `investors` → totalInvestors). In paged mode a
 * column outside this set has no server sort field, so its header renders as plain, non-interactive
 * text instead of a silent no-op button ([R1]). Mock mode sorts every column client-side, so all of
 * them stay interactive there. `min` stays OUT: it is the identical platform floor for every strategy,
 * so a server sort is a no-op (POO-726 R3 / POO-754). Kept as a literal (not imported) because
 * `fetchStrategiesPage` is a `server-only` module and this is a Client Component.
 */
const PAGED_SORTABLE_KEYS: ReadonlySet<SortKey> = new Set(["tvl", "return", "risk", "investors"]);

/**
 * POO-843 R2: the sort keys the mobile sort dropdown offers, in the desktop table's column order. In
 * paged (real) mode it is narrowed to `PAGED_SORTABLE_KEYS` (the columns the backend can sort; `min`
 * is excluded — the identical platform floor); mock mode sorts every column client-side, so all show.
 */
const SORT_KEY_ORDER: readonly SortKey[] = ["risk", "min", "tvl", "investors", "return"];

/** Numeric value for a strategy under a given sort column. */
function sortValue(strategy: Strategy, key: SortKey): number {
  switch (key) {
    case "risk":
      return strategy.riskLevel;
    case "min":
      return strategy.minInvestment;
    case "tvl":
      // Investor TVL sort is by the Uniswap pool TVL (POO-390 R2); missing/zero sorts to the bottom.
      return strategy.uniswapPoolTvlUsd ?? 0;
    case "investors":
      return strategy.investors;
    case "return":
      return strategy.estReturn;
  }
}

/**
 * The real-mode server-paging contract (POO-667). When supplied, the screen is a "Load more" list
 * driven by pool-party-api server-side paging/sort/filter/search: it renders the ALREADY-ordered,
 * already-filtered `strategies` accumulated so far (no client filter/sort), reads the count from the
 * backend `total`, hides the type filter (no backend `type` support), and forwards every
 * filter/sort/search change to the loader instead of re-deriving client-side. Absent = mock mode:
 * the screen keeps its original client-side filter/sort + the type filter (unchanged behavior).
 */
export interface StrategiesExplorePagedContract {
  /** Backend grand total across all pages — the count source (`explore.count`). */
  total: number;
  /** Whether another page exists (drives the "Load more" button). */
  hasMore: boolean;
  /** True while a page load is in flight (disables "Load more"). */
  loading: boolean;
  /** Load + append the next page. */
  onLoadMore: () => void;
  /** A search query change (server round-trip; resets to page 0). */
  onQueryChange: (query: string) => void;
  /** A risk-band change (null = all); forwarded verbatim, the loader maps 1/3/5 → steady/dynamic/wild. */
  onRiskChange: (risk: number | null) => void;
  /** A sort column/direction change (server round-trip; resets to page 0). */
  onSortChange: (sort: { key: SortKey; dir: SortDir }) => void;
  /**
   * An asset-category selection change (POO-894 [R1]; server round-trip, resets to page 0 like
   * search/risk). Empty array = no filter. The backend OR-filters the pair-derived tags across the
   * whole catalog, so the rows and `total` reflect the selection ([R4]).
   */
  onCategoriesChange: (categories: AssetTag[]) => void;
}

/** Public props for {@link StrategiesExploreScreen}. */
export interface StrategiesExploreScreenProps {
  /** Every strategy that can be invested in. */
  strategies: Strategy[];
  /** Ids of strategies the investor manages as pool manager (drives the "Owned" badge). */
  ownedIds: string[];
  /** Ids of strategies the investor holds a (non-manager) position in (drives the "Invested" badge). */
  investedIds: string[];
  /**
   * Real-mode server-paging contract (POO-667). When present the screen is a server-paged "Load
   * more" list (see {@link StrategiesExplorePagedContract}); when absent it is the mock-mode
   * client-filtered list. Every existing (mock) test omits it, so mock behavior is untouched.
   */
  paged?: StrategiesExplorePagedContract;
}

/** The strategies discovery list. */
export function StrategiesExploreScreen({
  strategies,
  ownedIds,
  investedIds,
  paged,
}: StrategiesExploreScreenProps) {
  const t = useTranslations("strategies");
  const tCommon = useTranslations("common");
  const { track } = useAnalytics();
  useTrackView("strategy_list_viewed");
  const [query, setQuery] = useState("");
  // Filters are session-only: they reset on reload so the list always opens unfiltered (per UX call
  // 2026-06-26, an intentional reversal of the earlier persist-prefs default for this screen).
  const [risk, setRisk] = useState<number | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "tvl", dir: "desc" });
  const [type, setType] = useState<StrategyType | null>(null);
  // POO-830 R8: the asset-category filter is dark-launched. When the flag is off the control is hidden
  // AND its selection is forced empty (NO_CATEGORIES) so the screen behaves exactly as today.
  const { isEnabled } = useFeatureFlags();
  const categoryFilterEnabled = isEnabled("strategyCategoryFilter");
  const [selectedCategories, setSelectedCategories] = useState<AssetTag[]>([]);
  // The selection that actually filters: the live picks when the flag is on, else the stable empty set.
  const effectiveCategories = categoryFilterEnabled ? selectedCategories : NO_CATEGORIES;

  // Real mode (POO-667): the backend owns paging/sort/filter/search. The screen still tracks the
  // control state locally (so the inputs stay controlled) but forwards each change to the loader and
  // never re-filters/re-sorts the server-ordered rows.
  const isPaged = paged !== undefined;

  const owned = useMemo(() => new Set(ownedIds), [ownedIds]);
  const invested = useMemo(() => new Set(investedIds), [investedIds]);
  // A strategy the investor manages shows "Owned"; one they only hold a position in shows
  // "Invested"; Owned wins when both could apply (a manager who seeded also holds a position).
  const tagPill = (id: string, extra?: string) => {
    const tag = owned.has(id) ? "owned" : invested.has(id) ? "invested" : null;
    if (!tag) return null;
    return (
      <span
        className={cn(
          "rounded-full px-2 py-0.5 font-medium text-xs ring-1 ring-inset",
          tag === "owned" ? "text-primary ring-primary/60" : "text-info ring-info/60",
          extra,
        )}
      >
        {tag === "owned" ? t("explore.owned") : t("explore.invested")}
      </span>
    );
  };
  const riskLabels: Record<number, string> = {
    1: t("risk.level1"),
    2: t("risk.level2"),
    3: t("risk.level3"),
    4: t("risk.level4"),
    5: t("risk.level5"),
  };
  const typeLabels: Record<StrategyType, string> = {
    yield: t("explore.types.yield"),
    trading: t("explore.types.trading"),
    index: t("explore.types.index"),
    "market-neutral": t("explore.types.marketNeutral"),
  };
  // POO-658: the Browse-by-risk / Browse-by-type filters are collapsed into floating dropdowns. Risk
  // dots use literal classes so Tailwind statically generates them (mirrors BrowseByRisk).
  const riskDot: Record<number, string> = {
    1: "bg-risk-1",
    2: "bg-risk-2",
    3: "bg-risk-3",
    4: "bg-risk-4",
    5: "bg-risk-5",
  };
  const riskOptions: FilterOption<number | null>[] = [
    { value: null, label: t("explore.allRisks") },
    ...[1, 2, 3, 4, 5].map((level) => ({
      value: level as number | null,
      label: riskLabels[level] as string,
      adornment: (
        <span className={cn("size-2 shrink-0 rounded-full", riskDot[level])} aria-hidden="true" />
      ),
    })),
  ];
  const typeOptions: FilterOption<StrategyType | null>[] = [
    { value: null, label: t("explore.allTypes") },
    ...STRATEGY_TYPES.map((option) => ({
      value: option as StrategyType | null,
      label: typeLabels[option],
    })),
  ];
  // POO-830 R6: the asset-category options, plain investor labels over the canonical AssetTag values.
  // Static `t(...)` literals (not a dynamic key) so i18n:check sees each key and never flags an orphan.
  const categoryLabels: Record<AssetTag, string> = {
    bitcoin: t("explore.categories.bitcoin"),
    ethereum: t("explore.categories.ethereum"),
    stablecoins: t("explore.categories.stablecoins"),
    altcoins: t("explore.categories.altcoins"),
    meme: t("explore.categories.meme"),
  };
  const categoryOptions: CategoryOption[] = CATEGORY_VALUES.map((value) => ({
    value,
    label: categoryLabels[value],
  }));
  // POO-843 R2: the mobile sort options reuse the desktop COLUMN labels so a metric reads exactly like
  // the header it orders. Static `t(...)` literals so i18n:check sees each key. Narrowed to the
  // backend-sortable set in paged mode (see SORT_KEY_ORDER), same as the interactive desktop headers.
  const sortColumnLabels: Record<SortKey, string> = {
    risk: t("explore.columns.risk"),
    min: t("explore.columns.min"),
    tvl: t("explore.columns.tvl"),
    investors: t("explore.columns.investors"),
    return: t("explore.columns.return"),
  };
  const mobileSortOptions: FilterOption<SortKey>[] = SORT_KEY_ORDER.filter(
    (key) => !isPaged || PAGED_SORTABLE_KEYS.has(key),
  ).map((key) => ({ value: key, label: sortColumnLabels[key] }));

  const visible = useMemo(() => {
    // Real mode: the backend already filtered + sorted this page set — render it verbatim ([R19]).
    if (isPaged) return strategies;
    const q = query.trim().toLowerCase();
    const filtered = strategies.filter((strategy) => {
      const matchesQuery =
        q === "" ||
        strategy.name.toLowerCase().includes(q) ||
        strategy.manager.toLowerCase().includes(q);
      const matchesRisk = risk === null || strategy.riskLevel === risk;
      const matchesType = type === null || strategy.type === type;
      return matchesQuery && matchesRisk && matchesType;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => (sortValue(a, sort.key) - sortValue(b, sort.key)) * dir);
  }, [isPaged, strategies, query, risk, type, sort]);

  // POO-830 R6 / POO-894: the asset-category filter. OR semantics, no-selection = no filter.
  // - PAGED (real) mode ([R1]/[R4]/[R5]): the filter is SERVER-SIDE since POO-894 - the selection
  //   rides `paged.onCategoriesChange` → the loader's `categories` → the v2 `category` param, so the
  //   rows arriving here are ALREADY filtered across the whole catalog and render verbatim (`visible`
  //   unchanged). No client narrowing: the pre-POO-894 loaded-pages-only narrowing could empty the
  //   list while matches sat on unloaded pages, unmounting "Load more" (the reported dead end).
  // - MOCK mode ([R7]): the full catalog is client-held, so `filterStrategiesByAssetTags`
  //   (PP-STR-LIB-015) keeps narrowing it with identical semantics.
  // When no category is active it returns `visible` unchanged (same reference) so the flag-off path
  // is identical to today and the virtualization gate is untouched.
  // PP-INTEGRATION-POINT (POO-894): paged mode assumes the pp-api `category` param on
  // `GET /api/v2/strategies` (OR across comma-separated tags, filters count + rows). Degraded paths:
  // an OLDER v2 deploy strips the unknown param (whitelist) and serves unfiltered rows (trusted
  // as-is, [R2]); the v1 `/pools/all` FALLBACK has no param, so `fetchStrategiesPage` keeps the
  // client-side narrowing over each fetched page there ([R8]) - loaded-rows-only semantics with the
  // unfiltered v1 total, never an error.
  const categoryVisible = useMemo(
    () =>
      isPaged || effectiveCategories.length === 0
        ? visible
        : filterStrategiesByAssetTags(visible, effectiveCategories),
    [isPaged, visible, effectiveCategories],
  );

  // [R1] The virtualized RESET key: list IDENTITY, derived from the filter/sort/search tuple ONLY
  // (never the `visible` array reference). A filter/sort/search/clear change flips this string, which
  // scrolls the window origin back to row 0 in the same commit (ADR-0001 rule 5, the RESET half). A
  // background refetch that yields a same-tuple list keeps the key stable, so it does NOT reset.
  // POO-830: the category selection is part of the identity too (sorted so click order never resets).
  const resetKey = `${query}|${risk ?? ""}|${type ?? ""}|${sort.key}|${sort.dir}|${[...effectiveCategories].sort().join(",")}`;

  // [R3] The FLAT index of the row/card whose Invest link is focused, force-pinned into the window so
  // a keyboard user's focused element is never unmounted when it scrolls out. Null = pin off.
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const onRowFocus = useCallback((index: number) => setFocusedIndex(index), []);
  const onRowBlur = useCallback(() => setFocusedIndex(null), []);

  // POO-725 R1: the pending debounced server-search timer, so a burst of keystrokes fires ONE server
  // round-trip (page-0 reset) instead of one per key. Cleared on unmount and by Clear-filters.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

  // Search: track the input locally (controlled) and, in real mode, forward each change to the loader
  // (server-side search; resets to page 0). Mock mode filters `query` client-side via `visible`.
  function handleQuery(next: string) {
    setQuery(next);
    // Mock mode has no server round-trip (the client filter uses `query`), so nothing to debounce.
    if (!paged) return;
    // POO-725 R1: debounce the server search so typing does not spam the backend + reset to page 0 on
    // every keystroke. Pagination + the honest count stay correct (the backend owns them).
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const onQueryChange = paged.onQueryChange;
    searchTimer.current = setTimeout(() => onQueryChange(next), SEARCH_DEBOUNCE_MS);
  }

  // POO-843 R2: the SINGLE writer for the sort state, shared by the desktop table headers AND the
  // mobile sort control so both drive the SAME server sort. Real mode: the server sorts (columns the
  // backend cannot sort still update the header state, and the loader sends no `sorting` for them —
  // default order, see fetchStrategiesPage). Mock mode: `visible` re-sorts client-side.
  function applySort(next: { key: SortKey; dir: SortDir }) {
    track("strategy_sort_changed");
    setSort(next);
    paged?.onSortChange(next);
  }

  // Desktop header: click a column → sort by it desc; click the active column again → flip direction.
  function toggleSort(key: SortKey) {
    applySort(
      sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" },
    );
  }

  // POO-843 R2 (mobile control, mirrors the manager POO-752 pattern): the dropdown picks the metric (a
  // new metric starts descending; same metric = no-op), the toggle owns the direction — both write the
  // same `sort` via applySort, so the mobile control changes exactly what the desktop headers change.
  function selectSortKey(key: SortKey) {
    if (key === sort.key) return;
    applySort({ key, dir: "desc" });
  }

  function toggleSortDir() {
    applySort({ key: sort.key, dir: sort.dir === "asc" ? "desc" : "asc" });
  }

  function handleRisk(next: number | null) {
    setRisk(next);
    track(
      "strategy_filter_applied",
      next === null ? undefined : { risk_level: next as 1 | 2 | 3 | 4 | 5 },
    );
    paged?.onRiskChange(next);
  }

  function handleType(next: StrategyType | null) {
    setType(next);
    track("strategy_filter_applied");
  }

  // POO-894 [R1]: the category selection is forwarded to the loader in paged mode (server round-trip,
  // page-0 reset - the same shape as handleRisk). Mock mode keeps the local state re-narrowing
  // `categoryVisible` ([R7]).
  function handleCategories(next: AssetTag[]) {
    setSelectedCategories(next);
    track("strategy_filter_applied");
    paged?.onCategoriesChange(next);
  }

  // POO-723: any active search/filter — drives the persistent Clear-filters affordance and keeps the
  // screen recoverable when a real-mode (paged) search returns an empty page (the screen must never
  // collapse to the terminal empty state while a filter is active). `type` is mock-only (hidden and
  // always null in paged mode), so it never keeps the paged screen "active" on its own. POO-830: an
  // active category selection also counts (so Clear-filters shows and the screen stays recoverable).
  const hasActiveFilters =
    query.trim() !== "" || risk !== null || type !== null || effectiveCategories.length > 0;

  // Reset every filter/search back to the unfiltered list. In real mode this is a server round-trip
  // back to the unfiltered page 0 (the same callbacks the per-control handlers forward). Shared by the
  // persistent Clear-filters button and the no-results state.
  function clearAll() {
    setQuery("");
    setRisk(null);
    setType(null);
    setSelectedCategories([]);
    // POO-725 R1: cancel any pending debounced search so it does not re-fire after the reset.
    if (searchTimer.current) clearTimeout(searchTimer.current);
    paged?.onQueryChange("");
    paged?.onRiskChange(null);
    // POO-894: the category filter is server-side in paged mode, so clearing must round-trip too.
    paged?.onCategoriesChange([]);
  }

  // No strategies AND nothing to clear AND not mid-load → the genuine first-run / empty-catalog state.
  // POO-723 [R1][R4]: with an active search/filter (or while the first page is still loading) we keep
  // the controls mounted instead, so a real-mode search that matches nothing stays recoverable.
  if (strategies.length === 0 && !hasActiveFilters && !paged?.loading) {
    return (
      <EmptyState
        icon={<TrendingUp className="size-7" aria-hidden="true" />}
        title={t("explore.empty.title")}
        description={t("explore.empty.body")}
      />
    );
  }

  /**
   * A desktop column header. In real (paged) mode a column with no backend sort field (POO-734 [R1])
   * renders as plain, non-interactive text instead of a no-op sort button; mock mode sorts every
   * column client-side, so all headers stay interactive there.
   */
  const sortableHeader = (key: SortKey, label: string, align: "left" | "right") => {
    if (isPaged && !PAGED_SORTABLE_KEYS.has(key)) {
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-bold text-2xl text-foreground">{t("explore.title")}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{t("explore.subtitle")}</p>
      </div>

      {/* Search + risk filter */}
      <div className="flex flex-col gap-4">
        <div className="relative">
          <Search
            className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => handleQuery(event.target.value)}
            placeholder={t("explore.searchPlaceholder")}
            aria-label={t("explore.searchPlaceholder")}
            // POO-848 R3: 16px below sm (iOS zooms on focused inputs under 16px).
            className="w-full rounded-lg border border-border bg-surface py-2.5 pr-3 pl-9 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
          />
        </div>
        {/* POO-658: the risk + type filters are collapsed into floating dropdowns (open on click).
            POO-667: the TYPE filter is hidden in real (paged) mode — the backend has no `type`
            parameter, so it exists only in mock mode. The risk filter maps to the API `riskProfile`. */}
        <div className="flex flex-wrap items-center gap-2">
          <FilterDropdown
            label={t("explore.browseByRisk")}
            value={risk}
            onSelect={handleRisk}
            options={riskOptions}
          />
          {!isPaged && (
            <FilterDropdown
              label={t("explore.browseByType")}
              value={type}
              onSelect={handleType}
              options={typeOptions}
            />
          )}
          {/* POO-830 R8: the multi-select asset-category filter, dark-launched. Hidden entirely when the
              flag is off, so the control row is byte-for-byte today's. Filters client-side (R6). */}
          {categoryFilterEnabled && (
            <CategoryFilter
              label={t("explore.browseByCategory")}
              allLabel={t("explore.allCategories")}
              selectedCountLabel={(count) => t("explore.categorySelected", { count })}
              options={categoryOptions}
              selected={selectedCategories}
              onChange={handleCategories}
            />
          )}
          {/* POO-843 R2: the mobile sort control. Desktop sorts via the table headers (hidden below
              lg), so this is lg:hidden; it drives the SAME `sort` state the headers do (selectSortKey
              / toggleSortDir → applySort → paged.onSortChange), so the two never diverge. Mirrors the
              manager POO-752 "Sort by" pattern: FilterDropdown picks the metric, the toggle owns dir. */}
          <div className="flex items-center gap-2 lg:hidden">
            <span className="text-muted-foreground text-xs">{t("explore.sortLabel")}</span>
            <FilterDropdown
              label={t("explore.sortLabel")}
              options={mobileSortOptions}
              value={sort.key}
              onSelect={selectSortKey}
            />
            <button
              type="button"
              onClick={toggleSortDir}
              // Purpose-bearing accessible name (mirrors FilterDropdown's "label: value"): announced
              // as e.g. "Sort by: Descending", not a bare context-free adjective.
              aria-label={`${t("explore.sortLabel")}: ${
                sort.dir === "asc" ? t("explore.sortDir.asc") : t("explore.sortDir.desc")
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
          {/* POO-723: a persistent Clear-filters action, shown whenever any search/filter is active —
              the recovery affordance that used to live only inside the no-results state. */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-2 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" aria-hidden="true" />
              {t("explore.clearFilters")}
            </button>
          )}
        </div>
      </div>

      <p className="text-muted-foreground text-sm">
        {/* Real (paged) mode: ALWAYS the backend grand total across every page ([R15]; POO-894 [R4] -
            the category filter is server-side now, so `total` already reflects it and a
            loaded-pages-only count would lie). Mock: the client-filtered count (`categoryVisible`
            narrows it while a category is active, and equals `visible` otherwise). */}
        {t("explore.count", {
          count: paged ? paged.total : categoryVisible.length,
        })}
      </p>

      {paged?.loading && strategies.length === 0 ? (
        // POO-723 [R4]: the initial page load (real mode) shows a quiet loading affordance instead of
        // flashing the terminal empty / no-results state before the first page lands.
        <div
          className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {tCommon("loading")}
        </div>
      ) : categoryVisible.length === 0 ? (
        // POO-723 [R2]: the no-results state only explains the empty result now — the Clear-filters
        // action lives next to the dropdowns (always visible while a filter is active), so it stays
        // reachable even in paged mode, where an empty page would previously have collapsed the screen.
        // POO-830 (mock): a category that matches nothing narrows `categoryVisible` to empty and shows
        // this recoverable no-results state (never the terminal empty state). POO-894 [R5] (paged): the
        // category filter is server-side, so this state appears only when the SERVER-filtered total is
        // 0 - matches on unloaded pages can no longer dead-end the list (Load more stays mounted).
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-muted-foreground text-sm">{t("explore.noResults")}</p>
        </div>
      ) : (
        <>
          {/* Mobile: cards (window-scrolled, windowed past THRESHOLD). */}
          <ExploreCards
            strategies={categoryVisible}
            resetKey={resetKey}
            focusedIndex={focusedIndex}
            onRowFocus={onRowFocus}
            onRowBlur={onRowBlur}
            ariaLabel={t("explore.title")}
            renderCard={(strategy) => (
              <>
                {tagPill(strategy.id, "absolute top-3 right-3 z-10")}
                <StrategyCard strategy={strategy} />
              </>
            )}
          />

          {/* Desktop: sortable table (window-scrolled, Technique A spacer rows past THRESHOLD). */}
          <div className="hidden overflow-x-auto rounded-xl border border-border lg:block">
            {/*
              `table-fixed` + explicit column widths keep column sizes STABLE across filtering and
              sorting. With the default `auto` layout the browser re-measures the visible rows on
              every filter, so the Strategy column visibly jumps width. Strategy has no fixed `col`
              width: it absorbs the remaining space (constant — it tracks the container, not the row
              set). `min-w` makes the table scroll horizontally on the narrowest desktop rather than
              clip its columns.
            */}
            <table className="w-full min-w-[940px] table-fixed text-sm">
              <colgroup>
                <col />
                <col className="w-[140px]" />
                <col className="w-[96px]" />
                <col className="w-[100px]" />
                <col className="w-[110px]" />
                <col className="w-[130px]" />
                <col className="w-[116px]" />
              </colgroup>
              <thead className="bg-surface text-muted-foreground text-xs">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium">
                    {t("explore.columns.strategy")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    {sortableHeader("risk", t("explore.columns.risk"), "left")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    {sortableHeader("min", t("explore.columns.min"), "right")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    {sortableHeader("tvl", t("explore.columns.tvl"), "right")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    {sortableHeader("investors", t("explore.columns.investors"), "right")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    {sortableHeader("return", t("explore.columns.return"), "right")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    <span className="sr-only">{t("explore.columns.action")}</span>
                  </th>
                </tr>
              </thead>
              <ExploreTableBody
                strategies={categoryVisible}
                resetKey={resetKey}
                focusedIndex={focusedIndex}
                onRowFocus={onRowFocus}
                onRowBlur={onRowBlur}
                renderCells={(strategy) => (
                  <>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {/* POO-724: strategy logo with an initials monogram fallback (parity with Home
                            + the mobile StrategyCard); real data via mapStrategyV2 (POO-713). */}
                        <StrategyLogo
                          url={strategy.logoUrl}
                          name={strategy.name}
                          className="size-8 shrink-0 text-xs"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/strategies/${strategy.id}`}
                              className="font-medium text-foreground hover:underline"
                            >
                              {strategy.name}
                            </Link>
                            {tagPill(strategy.id)}
                          </div>
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
                                  aria-label={t("detail.managerVerified")}
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
                      {formatUsd(strategy.minInvestment)}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">
                      {formatPoolTvl(strategy.uniswapPoolTvlUsd)}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">
                      {strategy.investors.toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-3 text-right text-success">
                      {formatPercent(strategy.estReturn)}{" "}
                      <AprTooltip className="font-normal text-[10px] text-muted-foreground uppercase">
                        {strategy.rateType}
                      </AprTooltip>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/strategies/${strategy.id}`}
                        className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground text-sm transition-colors hover:bg-primary/90"
                      >
                        {t("card.invest")}
                        <ChevronRight className="size-4" aria-hidden="true" />
                      </Link>
                    </td>
                  </>
                )}
              />
            </table>
          </div>

          {/* Real mode (POO-667): the visible "Load more" pager. It appends the next server page to
              the accumulated set below the THRESHOLD, so the list renders plainly (the POO-623 window
              stays disengaged) while the count above shows the true backend total. */}
          {paged?.hasMore && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={paged.onLoadMore}
                disabled={paged.loading}
                className="rounded-lg border border-border bg-surface px-5 py-2.5 font-medium text-foreground text-sm transition-colors hover:bg-surface/70 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ring"
              >
                {paged.loading ? t("explore.loadingMore") : t("explore.loadMore")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Shared props for the two window-virtualized surfaces (desktop table body + mobile card list). */
interface ExploreListProps {
  /** The full, ordered filtered set (the same array a plain `.map()` renders). [R2] count uses this. */
  strategies: Strategy[];
  /** [R1] List-identity key; a change scrolls the window origin to row 0 in the same commit. */
  resetKey: string;
  /** [R3] Flat index of the focused row/card, force-pinned into the window. */
  focusedIndex: number | null;
  /** Record a row/card as focused (its flat index) so the pin keeps it mounted. */
  onRowFocus: (index: number) => void;
  /** Clear the focus pin when focus leaves the row/card. */
  onRowBlur: () => void;
}

/**
 * [R1] Scroll the window origin back to row 0 whenever the list identity (`resetKey`) changes — but
 * ONLY while windowing is actually engaged (`enabled`). A layout effect fires in the same commit as
 * the filter/sort/search state change that produced the new list, so the window can never linger in
 * the middle of the previous, differently-ordered list. `useLayoutEffect` (not `useEffect`) runs
 * before paint, so the reset is not visible as a jump.
 *
 * The `enabled` guard is load-bearing (ADR-0001 rule 4): with the `virtualize` flag off the surface
 * renders the plain-map baseline and `scrollToIndex(0)` would resolve to `window.scrollTo({ top: 0 })`
 * on the window virtualizer, hijacking the page to the document top on every mount and every
 * filter/sort/search/clear interaction and yanking reload/back-nav scroll restoration — the exact
 * "flag-off = today's baseline" contract this must not break. `enabled` also gates the reset ON the
 * transition false→true (the post-paint `hasLayout` resolve, and the remount after clearing a
 * no-results search), so a genuine windowed reset still fires when it should.
 */
function useResetOnIdentityChange(
  scrollToIndex: (index: number) => void,
  resetKey: string,
  enabled: boolean,
): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset is keyed on identity + gate, not the fn.
  useLayoutEffect(() => {
    if (!enabled) return;
    scrollToIndex(0);
  }, [resetKey, enabled]);
}

/**
 * Desktop `<tbody>` for the Explore table, window-scrolled (document scroll preserves Next 15
 * back/forward scroll restoration and lives under the AppShell sticky sidebar). Below THRESHOLD or
 * with the flag off it renders every row via `.map()` (identical DOM to today, [R1]); past THRESHOLD
 * with a real layout it windows via Technique A in-flow spacer `<tr>`s (ADR-0001 rule 1; absolute
 * rows are banned in tables, rule 2). `mode: "window"` is constant for this mount.
 */
function ExploreTableBody({
  strategies,
  resetKey,
  focusedIndex,
  onRowFocus,
  onRowBlur,
  renderCells,
}: ExploreListProps & { renderCells: (strategy: Strategy) => ReactNode }) {
  const gate = useVirtualizeGate(strategies.length);
  const rows = useVirtualizedRows<Strategy>({
    items: strategies,
    mode: "window",
    estimateSize: ROW_ESTIMATE,
    // [R3] Force-pin the focused row's flat index so its <tr> is never unmounted when the window
    // scrolls off it (keyboard focus is preserved); the pin makes the window non-contiguous, which
    // the per-gap `techniqueASegments` spacers below reserve for ([R4]).
    focusedIndex,
    enabled: gate.enabled,
  });
  useResetOnIdentityChange(rows.scrollToIndex, resetKey, gate.enabled);

  const row = (strategy: Strategy, index: number, measure: boolean) => (
    <tr
      key={strategy.id}
      data-index={index}
      ref={measure ? rows.virtualizer.measureElement : undefined}
      className="border-border border-t"
      onFocus={() => onRowFocus(index)}
      onBlur={onRowBlur}
    >
      {renderCells(strategy)}
    </tr>
  );

  // [R1] plain-map baseline: gate false → every row, no spacers, byte-for-byte today's DOM. The gate's
  // container is the table's own scroll wrapper (measured for hasLayout); the window virtualizer reads
  // the document scroll, so no scroll element is attached in window mode.
  if (!gate.enabled) {
    return <tbody ref={gate.containerRef}>{strategies.map((s, i) => row(s, i, false))}</tbody>;
  }

  // Technique A: one in-flow spacer per gap (top, bottom, AND every inter-segment gap the [R2] focus
  // pin opens by force-including a far row). A single top/bottom pad would drop the pinned-row gap and
  // collapse the table height under the user when a focused row scrolls out ([R4]).
  const segments = techniqueASegments(rows.getVirtualItems(), rows.getTotalSize());

  return (
    <tbody ref={gate.containerRef}>
      {segments.map((segment) =>
        segment.type === "spacer" ? (
          // PP-A11Y: pure-layout Technique-A spacer, no content/interactivity, correctly hidden.
          // biome-ignore lint/a11y/noAriaHiddenOnFocusable: empty spacer row, not focusable
          <tr key={`spacer-${segment.key}`} aria-hidden="true" data-virtual-spacer={segment.key}>
            <td colSpan={7} style={{ height: segment.height, padding: 0, border: 0 }} />
          </tr>
        ) : strategies[segment.index] === undefined ? null : (
          row(strategies[segment.index] as Strategy, segment.index, true)
        ),
      )}
    </tbody>
  );
}

/**
 * Mobile card `<ul>` for the Explore list, window-scrolled. Below THRESHOLD or with the flag off it
 * renders every card via `.map()` in normal flow (identical DOM to today, [R1]); past THRESHOLD with a
 * real layout it windows the single-column list with absolute `<li>` + `translateY` (allowed outside
 * tables, ADR-0001 rule 2), reserving the full height for back-nav scroll restoration ([R4]).
 */
function ExploreCards({
  strategies,
  resetKey,
  focusedIndex,
  onRowFocus,
  onRowBlur,
  ariaLabel,
  renderCard,
}: ExploreListProps & { ariaLabel: string; renderCard: (strategy: Strategy) => ReactNode }) {
  const gate = useVirtualizeGate(strategies.length);
  const rows = useVirtualizedRows<Strategy>({
    items: strategies,
    mode: "window",
    estimateSize: CARD_ESTIMATE,
    overscan: 6,
    focusedIndex,
    enabled: gate.enabled,
  });
  useResetOnIdentityChange(rows.scrollToIndex, resetKey, gate.enabled);

  const total = strategies.length;

  // [R1] plain-map baseline: gate false → every card, static flow, identical to today's DOM.
  if (!gate.enabled) {
    return (
      <ul ref={gate.containerRef} className="flex flex-col gap-3 lg:hidden" aria-label={ariaLabel}>
        {strategies.map((strategy, index) => (
          <li
            key={strategy.id}
            data-index={index}
            aria-setsize={total}
            aria-posinset={index + 1}
            className="relative"
            onFocus={() => onRowFocus(index)}
            onBlur={onRowBlur}
          >
            {renderCard(strategy)}
          </li>
        ))}
      </ul>
    );
  }

  const virtualItems = rows.getVirtualItems();

  return (
    // Inner container sized to the full list height reserves the scroll range ([R4]).
    <ul
      ref={gate.containerRef}
      className="relative lg:hidden"
      aria-label={ariaLabel}
      style={{ height: rows.getTotalSize(), margin: 0, padding: 0 }}
    >
      {virtualItems.map((virtualRow) => {
        const strategy = strategies[virtualRow.index];
        if (strategy === undefined) return null;
        const index = virtualRow.index;
        return (
          <li
            key={strategy.id}
            data-index={index}
            ref={rows.virtualizer.measureElement}
            aria-setsize={total}
            aria-posinset={index + 1}
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${Math.max(0, virtualRow.start)}px)` }}
            onFocus={() => onRowFocus(index)}
            onBlur={onRowBlur}
          >
            {renderCard(strategy)}
          </li>
        );
      })}
    </ul>
  );
}
