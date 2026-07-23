/**
 * @id PP-STR-SCR-001 (POO-667)
 * @name Explore paged loader
 * @implements-rules-version v3
 *
 * POO-894 v1 [R1]/[R6]: the asset-category selection joined the loader tuple - a change re-keys
 * `loadPage` (page-0 reset, like search/risk) and rides the read as `categories`, so the backend
 * filters + counts across the whole catalog instead of the screen narrowing loaded pages only.
 *
 * POO-725 v1 [R3]: while a search query is active AND the user has not picked an explicit column sort,
 * the loader omits `sorting` so the backend RELEVANCE ranking (name-exact > prefix > substring) orders
 * the matches; the default `tvl:desc` would otherwise override relevance. A header click sets
 * `sortExplicit`, after which the chosen sort wins even during a search.
 *
 * Real-mode client boundary for the server-paged Explore discovery list (the "Load more" list, the
 * v1-interface parity that supersedes the drain-everything ExploreDataLoader for real mode). It owns
 * the filter/sort/search control state, builds the page loader keyed on that tuple (so any change
 * re-reads page 0 via useServerPage's reset), accumulates the pages, and resolves the connected
 * wallet's Owned/Invested badges over whatever rows are loaded. Used only when isMockMode is false.
 *
 * Server-side paging/sort/filter/search all run in `loadExplorePageAction` → `fetchStrategiesPage`
 * (`GET /api/v2/strategies?lifecycle=live`, closed excluded server-side so pages are dense and the
 * total is honest, POO-667); this component holds only the UI state + the accumulation.
 */
"use client";

import { useCallback, useState } from "react";
import type { PageResult } from "@/lib/api/pagination";
import { useServerPage } from "@/lib/api/useServerPage";
import { usePositions } from "@/lib/positions/usePositions";
import type { AssetTag, Strategy } from "@/lib/schemas";
import type { ExploreSortDir, ExploreSortKey } from "@/lib/strategies/fetchStrategiesPage";
import { loadExplorePageAction } from "./exploreActions";
import { StrategiesExploreScreen } from "./StrategiesExploreScreen";

/** The server "Load more" page size (POO-667 decision: 5, like the v1 interface). */
const PAGE_SIZE = 5;

/** Renders the server-paged discovery list and marks the connected wallet's owned strategies. */
export function ExplorePagedLoader() {
  const { positions } = usePositions();
  // The filter/sort/search tuple owns the loader identity: any change re-keys `loadPage`, which
  // resets useServerPage back to page 0 with the new params ([R25]). Default sort mirrors the screen.
  const [query, setQuery] = useState("");
  const [risk, setRisk] = useState<number | null>(null);
  // POO-894 [R1]: the category selection is part of the loader tuple, so a change re-reads page 0
  // with `categories` and the backend filters + counts across the WHOLE catalog (no more
  // loaded-pages-only narrowing). Empty selection = no filter (the param is omitted).
  const [categories, setCategories] = useState<AssetTag[]>([]);
  const [sort, setSort] = useState<{ key: ExploreSortKey; dir: ExploreSortDir }>({
    key: "tvl",
    dir: "desc",
  });
  // POO-725 R3: track whether the user picked an explicit column sort. Until they do, an active search
  // is ranked by the backend's relevance order (we omit `sorting`); after a header click the chosen
  // sort wins even while searching.
  const [sortExplicit, setSortExplicit] = useState(false);
  const onSortChange = useCallback((next: { key: ExploreSortKey; dir: ExploreSortDir }) => {
    setSortExplicit(true);
    setSort(next);
  }, []);

  const loadPage = useCallback(
    (page: number): Promise<PageResult<Strategy>> => {
      const searching = query.trim() !== "";
      return loadExplorePageAction({
        page,
        limit: PAGE_SIZE,
        // POO-725 R3: relevance order when searching without an explicit sort (omit `sorting`).
        sort: searching && !sortExplicit ? undefined : sort,
        risk: risk ?? undefined,
        // POO-894 [R1]: OR-filter across the selected categories, server-side; omitted when empty.
        categories: categories.length > 0 ? categories : undefined,
        search: searching ? query : undefined,
      });
    },
    [sort, sortExplicit, risk, categories, query],
  );

  const { items, total, hasMore, loadMore, loading } = useServerPage({
    loadPage,
    pageSize: PAGE_SIZE,
  });

  // Split the wallet's positions: the ones it manages (isPoolManager) drive "Owned", the rest
  // "Invested". A positions failure degrades to no badges (the catalog is independent of ownership).
  const ownedIds = positions?.filter((p) => p.isPoolManager).map((p) => p.strategyId) ?? [];
  const investedIds = positions?.filter((p) => !p.isPoolManager).map((p) => p.strategyId) ?? [];

  return (
    <StrategiesExploreScreen
      strategies={items}
      ownedIds={ownedIds}
      investedIds={investedIds}
      paged={{
        total,
        hasMore,
        loading,
        onLoadMore: loadMore,
        onQueryChange: setQuery,
        onRiskChange: setRisk,
        onSortChange,
        // POO-894 [R1]/[R6]: a category change re-keys `loadPage` → page-0 reset, like search/risk.
        onCategoriesChange: setCategories,
      }}
    />
  );
}
