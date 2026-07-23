/**
 * @id PP-CORE-HOK-021 (POO-666, POO-668)
 * @name useServerPage
 * @implements-rules-version v1
 *
 * The client "Load more" state machine over an injected page loader (the shared paging seam,
 * POO-665). It owns the page cursor, accumulates the loaded rows, and exposes `loadMore` / `reset` /
 * `refresh`. It is data-source agnostic: the caller injects a `loadPage(page) => Promise<{ items,
 * total }>` (an Explore / Portfolio server action in real mode), so this hook has no knowledge of the
 * API or the domain.
 *
 * `hasMore` has two modes ({@link UseServerPageOptions.pageMode}):
 * - `"total"` (default, POO-666): `(page + 1) * pageSize < total` — trust the backend grand total.
 * - `"short-page"` (POO-668): derive the stop from the LAST page's length — a full page might have a
 *   successor, a short/empty page is the end. Used where the reported total is a phantom (portfolio
 *   `totalPositions` over-counts a `closed`-filtered read), so it is ignored for the per-list stop.
 *
 * `reset()` (and any change of the `loadPage` identity — a new filter/sort/search tuple) drops the
 * cursor to page 0 and re-runs the loader, replacing the accumulated set. `refresh()` (POO-668 R4) is
 * different: it RE-READS pages 0..current in place and replaces them WITHOUT dropping the cursor — the
 * 45s / focus / post-write refresh path, so a same-ids refetch never throws the user back to page 0
 * (the scroll survives). A `loadMore`/`refresh` failure surfaces via `error` WITHOUT wiping the
 * already-loaded rows, so a transient blip never blanks a populated list (mirrors `usePositions`).
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { computeHasMore, computeHasMoreShortPage, type PageResult } from "./pagination";

/** How `hasMore` is derived. See the file header. */
export type PageMode = "total" | "short-page";

/** Options for {@link useServerPage}. */
export interface UseServerPageOptions<T> {
  /**
   * Loads one zero-based page. Its IDENTITY is the reset trigger: pass a fresh function (e.g. via a
   * `useCallback` keyed on the filter/sort/search tuple) to re-fetch page 0 with the new params.
   */
  loadPage: (page: number) => Promise<PageResult<T>>;
  /** Page size; drives the `hasMore` math and must match the loader's own slice size. */
  pageSize: number;
  /**
   * The `hasMore` derivation. `"total"` (default) trusts the backend grand total; `"short-page"`
   * (POO-668) ignores the total and stops at the first short/empty page.
   */
  pageMode?: PageMode;
}

/** The "Load more" state exposed to a paged list surface. */
export interface UseServerPageResult<T> {
  /** Every row loaded so far, in order (page 0 … current page). */
  items: T[];
  /** The backend's grand total across all pages (drives the count + total-mode `hasMore`). */
  total: number;
  /** Whether another page exists after the current one. */
  hasMore: boolean;
  /** Load and append the next page. No-op while a load is in flight or there is nothing more. */
  loadMore: () => Promise<void>;
  /** True while any load (initial, more, reset, or refresh) is in flight. */
  loading: boolean;
  /** The last load error, or null. Set on failure without clearing `items`. */
  error: unknown;
  /** Reset the cursor to page 0 and re-run the loader (replacing the accumulated set). */
  reset: () => void;
  /**
   * Re-read pages 0..current IN PLACE and replace them, keeping the cursor (POO-668 R4). The
   * background-refresh path (45s / focus / post-write): a same-ids refetch is a refresh, not a reset.
   */
  refresh: () => Promise<void>;
}

/**
 * Drive a "Load more" paginated list from an injected page loader.
 *
 * @param options - The page loader, page size, and (optionally) the `hasMore` mode.
 * @returns The accumulated items, total, `hasMore`, and the `loadMore` / `reset` / `refresh` controls.
 */
export function useServerPage<T>({
  loadPage,
  pageSize,
  pageMode = "total",
}: UseServerPageOptions<T>): UseServerPageResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  // The last-served page length drives short-page `hasMore`. Seeded to `pageSize` so hasMore is not
  // prematurely false before the first page resolves (it is corrected on the first settle).
  const [lastPageLength, setLastPageLength] = useState(pageSize);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // Guards against races: `loadingRef` blocks overlapping loads; `runIdRef` invalidates the results
  // of a load that a reset / loadPage change / refresh superseded (so a slow page can't append late).
  const loadingRef = useRef(false);
  const runIdRef = useRef(0);

  /** hasMore for a given cursor + last-page length, per the active mode. */
  const deriveHasMore = useCallback(
    (atPage: number, lastLen: number, grandTotal: number): boolean =>
      pageMode === "short-page"
        ? computeHasMoreShortPage(lastLen, pageSize)
        : computeHasMore(atPage, pageSize, grandTotal),
    [pageMode, pageSize],
  );

  // The single page-0 load path, shared by the initial effect AND `reset()`. It bumps `runId` to
  // supersede any in-flight load, then replaces the accumulated set with the fresh page 0. A load a
  // later reset / loadPage change superseded (its `runId` no longer current) is discarded on settle,
  // so a slow read never overwrites a newer one.
  const loadFirstPage = useCallback(() => {
    const runId = ++runIdRef.current;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    loadPage(0)
      .then((result) => {
        if (runId !== runIdRef.current) return;
        setItems(result.items);
        setTotal(result.total);
        setLastPageLength(result.items.length);
        setPage(0);
      })
      .catch((err) => {
        if (runId !== runIdRef.current) return;
        setError(err);
      })
      .finally(() => {
        if (runId !== runIdRef.current) return;
        loadingRef.current = false;
        setLoading(false);
      });
  }, [loadPage]);

  // Initial load + re-load whenever the loader identity changes (a new filter/sort/search tuple).
  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    if (!deriveHasMore(page, lastPageLength, total)) return;
    const runId = runIdRef.current;
    const nextPage = page + 1;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await loadPage(nextPage);
      // A reset / loader change / refresh during the fetch bumps runId → discard this stale page.
      if (runId !== runIdRef.current) return;
      setItems((prev) => [...prev, ...result.items]);
      setTotal(result.total);
      setLastPageLength(result.items.length);
      setPage(nextPage);
    } catch (err) {
      if (runId !== runIdRef.current) return;
      setError(err);
    } finally {
      if (runId === runIdRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [loadPage, page, total, lastPageLength, deriveHasMore]);

  // Reset re-reads page 0 with the current loader. Shared with the initial effect via `loadFirstPage`,
  // so a filter clear that keeps the same `loadPage` identity still re-reads (the effect alone would
  // not re-fire without a `loadPage` change).
  const reset = useCallback(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  // [R4] Refresh in place: re-read pages 0..current SEQUENTIALLY and replace the accumulated set,
  // keeping the same cursor so a same-ids background refetch is a refresh (scroll survives), NOT a
  // reset to page 0. Sequential mirrors the per-API-key throttle discipline of the server drain. A
  // superseding reset / loadMore / refresh bumps runId and this settle is discarded.
  const refresh = useCallback(async () => {
    if (loadingRef.current) return;
    const runId = ++runIdRef.current;
    const upTo = page;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const fresh: T[] = [];
      let last = pageSize;
      let latestTotal = total;
      for (let p = 0; p <= upTo; p++) {
        const result = await loadPage(p);
        if (runId !== runIdRef.current) return; // superseded mid-refresh → drop this stale run
        fresh.push(...result.items);
        last = result.items.length;
        latestTotal = result.total;
        // A page that came back short means the feed shrank; there are no further pages to re-read.
        if (result.items.length < pageSize) {
          setPage(p);
          break;
        }
      }
      if (runId !== runIdRef.current) return;
      setItems(fresh);
      setTotal(latestTotal);
      setLastPageLength(last);
    } catch (err) {
      if (runId !== runIdRef.current) return;
      setError(err);
    } finally {
      if (runId === runIdRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [loadPage, page, pageSize, total]);

  return {
    items,
    total,
    hasMore: deriveHasMore(page, lastPageLength, total),
    loadMore,
    loading,
    error,
    reset,
    refresh,
  };
}
