/**
 * @id PP-MGR-SCR-003
 * @name ManageStrategiesView
 * @implements-rules-version v5
 *
 * The console's Strategies tab (Managed strategies): status filter pills over the manager's full
 * strategy list as cards, with a per-filter empty state. Lives client-side inside /manager — the
 * tabs switch views without a route change (murilo 2026-06-10). Opens on the Active filter when
 * the manager has at least one active strategy, falling back to All otherwise (POO-508).
 *
 * POO-669 (rules-v1): the card grid is a CLIENT-SIDE "Load more" reveal ([R1]) over the client-
 * filtered `visible` subset — the first page (5) cards, +5 per click via
 * {@link useRevealCount}. This list is NOT server-paged: the console derives it from the wallet's
 * positions drain (`isPoolManager` ⋈ catalog) and filters it client-side, and a closed/wound-down
 * managed pool that dropped out of `/pools` (POO-373) is still shown via the position-synth fallback
 * (POO-455/537), which `/pools/all?poolManager=` cannot serve. So paging stays a client reveal (see
 * the feature README's endpoint-gap note). The status filter is the reveal's `resetKey`: switching
 * pills is a genuinely different subset, so the reveal RESETS to the first 5 ([R2], mirroring
 * POO-626); a same-set 45s/focus/router.refresh refetch keeps the same filter key, so the revealed
 * count survives ([R2] DO-NOT-RESET, POO-628). This REPLACES the POO-627 windowing on this list
 * ([R3]); the shared VirtualCardList primitive and its own tests stay intact elsewhere.
 *
 * POO-752: this grid is 2-up, so the reveal uses a 6-card page (`useRevealCount(filter, 6)`) to fill
 * three even rows instead of the shared default 5 ([R1], other reveal surfaces unchanged). A "Sort by"
 * control (metric {@link FilterDropdown} + a direction toggle) beside the pills orders the filtered
 * subset via {@link sortManagerStrategies} — default AUM desc, resetting per visit — BEFORE the reveal
 * slice; sorting reorders the same subset so it PRESERVES the revealed count (not part of the reset
 * key), and `fees30d` "not measured" sinks to the bottom ([R2]).
 *
 * POO-816 v1: the tab title reads "Managed strategies" (was "Manage strategies"). Copy only, all
 * locales; no behavior change.
 */
"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { EyeToggle } from "@/components/ui/EyeToggle";
import { FilterDropdown, type FilterOption } from "@/components/ui/FilterDropdown";
import { useRevealCount } from "@/hooks/useRevealCount";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { EphemeralMaskProvider } from "@/lib/hooks/maskValue";
import type { ManagerStrategy } from "@/lib/schemas";
import { cn } from "@/lib/utils/cn";
import {
  type ManagerStrategySortKey,
  type SortDirection,
  sortManagerStrategies,
} from "../managerStrategySort";
import { ManagerStrategyCard } from "./ManagerStrategyCard";

/** The list filters: every lifecycle status plus "all". */
const FILTERS = ["all", "active", "paused", "closed", "drafts"] as const;

/** One of the list filters. */
export type StrategyFilter = (typeof FILTERS)[number];

/** Maps a filter to the strategy status it keeps ("all" keeps everything). */
const FILTER_STATUS: Record<Exclude<StrategyFilter, "all">, ManagerStrategy["status"]> = {
  active: "active",
  paused: "paused",
  closed: "closed",
  drafts: "draft",
};

/** POO-752 [R1]: this grid is 2-up, so a 6-card page fills three even rows (vs the shared default 5). */
const REVEAL_PAGE_SIZE = 6;

/** Public props for {@link ManageStrategiesView}. */
export interface ManageStrategiesViewProps {
  /** All the manager's strategies (the console handles the zero-strategies case upstream). */
  strategies: ManagerStrategy[];
  /** Opens the manage detail for a strategy. */
  onManage: (strategyId: string) => void;
}

/** The Manage-strategies list with status filters. */
export function ManageStrategiesView({ strategies, onManage }: ManageStrategiesViewProps) {
  const t = useTranslations("manager");
  const { track } = useAnalytics();
  // POO-508: open on Active when there is anything active; otherwise All, so a wound-down manager
  // still sees their closed/paused strategies instead of an empty Active list.
  const [filter, setFilter] = useState<StrategyFilter>(() =>
    strategies.some((strategy) => strategy.status === "active") ? "active" : "all",
  );
  // POO-752 [R2]: metric sort over the filtered subset. Default AUM desc, reset each visit (no
  // persistence, murilo 2026-07-09). The dropdown picks the metric; the toggle owns direction.
  const [sort, setSort] = useState<{ key: ManagerStrategySortKey; dir: SortDirection }>({
    key: "aum",
    dir: "desc",
  });
  // Literal t() calls (the i18n usage scan is static — no dynamic keys).
  const filterLabels: Record<StrategyFilter, string> = {
    all: t("strategies.filters.all"),
    active: t("strategies.filters.active"),
    paused: t("strategies.filters.paused"),
    closed: t("strategies.filters.closed"),
    drafts: t("strategies.filters.drafts"),
  };
  const emptyLabels: Record<StrategyFilter, string> = {
    all: t("strategies.empty.all"),
    active: t("strategies.empty.active"),
    paused: t("strategies.empty.paused"),
    closed: t("strategies.empty.closed"),
    drafts: t("strategies.empty.drafts"),
  };
  // Reuse the card's KPI labels so the sort options read exactly like the columns they order.
  const sortOptions: FilterOption<ManagerStrategySortKey>[] = [
    { value: "aum", label: t("strategies.card.aum") },
    { value: "investors", label: t("strategies.card.investors") },
    { value: "apy", label: t("strategies.card.netApy") },
    { value: "fees30d", label: t("strategies.card.fees30d") },
  ];

  const visible = useMemo(
    () =>
      filter === "all"
        ? strategies
        : strategies.filter((strategy) => strategy.status === FILTER_STATUS[filter]),
    [strategies, filter],
  );
  // POO-752 [R2]: order a COPY of the filtered subset BEFORE the reveal slice.
  const ordered = useMemo(
    () => sortManagerStrategies(visible, sort.key, sort.dir),
    [visible, sort.key, sort.dir],
  );
  // POO-669 [R1/R2] + POO-752 [R1]: client-side reveal over the FILTERED subset, 6 per page. The
  // status filter is the resetKey, so switching pills snaps the reveal back to the first page
  // (POO-626); a same-set refetch OR a sort re-order keeps the filter key and preserves the revealed
  // count (POO-628 DO-NOT-RESET — a sort reorders the identical subset, so it must not reset).
  const { count, revealMore } = useRevealCount(filter, REVEAL_PAGE_SIZE);
  const revealed = ordered.slice(0, count);
  const hasMore = ordered.length > revealed.length;

  /** Pick the sort metric (a new metric starts descending; the toggle owns direction). */
  function selectSortKey(key: ManagerStrategySortKey) {
    track("strategy_sort_changed");
    setSort((prev) => (prev.key === key ? prev : { key, dir: "desc" }));
  }
  /** Flip the sort direction for the current metric. */
  function toggleSortDir() {
    track("strategy_sort_changed");
    setSort((prev) => ({ ...prev, dir: prev.dir === "asc" ? "desc" : "asc" }));
  }
  return (
    // Manager surface: values are REVEALED by default (eye open, like the Overview — murilo
    // 2026-06-30); the eye covers them on demand. Reuses the manager "hide values" label.
    <EphemeralMaskProvider defaultMasked={false}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-foreground text-lg">{t("strategies.title")}</h2>
            <EyeToggle label={t("dashboard.hideValues")} />
          </div>
          <p className="text-muted-foreground text-sm">{t("strategies.subtitle")}</p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">{t("strategies.filterLabel")}</legend>
            {FILTERS.map((key) => {
              const selected = key === filter;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setFilter(key)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 font-medium text-xs transition-colors",
                    selected
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {filterLabels[key]}
                </button>
              );
            })}
          </fieldset>

          {/* POO-752 [R2]: sort the filtered subset. The dropdown picks the metric (reusing the card's
              KPI labels); the toggle flips direction. */}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">{t("strategies.sortLabel")}</span>
            <FilterDropdown
              label={t("strategies.sortLabel")}
              options={sortOptions}
              value={sort.key}
              onSelect={selectSortKey}
            />
            <button
              type="button"
              onClick={toggleSortDir}
              // Purpose-bearing accessible name (mirrors FilterDropdown's "label: value"): the toggle
              // is announced as e.g. "Sort by: Descending", not a bare context-free adjective.
              aria-label={`${t("strategies.sortLabel")}: ${
                sort.dir === "asc" ? t("strategies.sortDir.asc") : t("strategies.sortDir.desc")
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
        </div>

        {visible.length === 0 ? (
          <p className="rounded-xl border border-border border-dashed px-4 py-10 text-center text-muted-foreground text-sm">
            {emptyLabels[filter]}
          </p>
        ) : (
          // POO-669 [R1]: the responsive 2-up grid renders only the revealed slice — one <li> per
          // revealed strategy — with a "Load more" that reveals the next 5 from the client-filtered
          // subset. The <ul> carries the accessible list name; the per-card content owns its own box.
          <>
            <ul aria-label={t("strategies.title")} className="grid gap-3 lg:grid-cols-2">
              {revealed.map((strategy) => (
                <li key={strategy.id}>
                  <ManagerStrategyCard strategy={strategy} onManage={onManage} />
                </li>
              ))}
            </ul>
            {hasMore ? (
              <button
                type="button"
                onClick={revealMore}
                className="self-center rounded-lg border border-border bg-surface px-5 py-2.5 font-medium text-foreground text-sm transition-colors hover:bg-surface/70 focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("loadMore")}
              </button>
            ) : null}
          </>
        )}
      </div>
    </EphemeralMaskProvider>
  );
}
