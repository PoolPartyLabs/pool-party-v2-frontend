/**
 * @id PP-CORE-LIB-032 (POO-666, POO-668)
 * @name pagination (client-safe paging primitives)
 * @implements-rules-version v1
 *
 * The client-safe half of the "Load more" seam (POO-665/POO-666): the {@link PageResult} shape and
 * the two pure hasMore derivations. It carries NO `server-only` import, so the client hook
 * {@link useServerPage} can share the exact same contract + hasMore logic as the server-only
 * {@link fetchPage} without dragging `apiFetch`/`server-only` into the client bundle (which `pnpm
 * build` rejects). {@link pagedFetch} (server-only) imports {@link PageResult} from here.
 *
 * Two hasMore modes:
 * - {@link computeHasMore} (TOTAL-based, POO-666): trust the backend's grand total. The default for
 *   list reads whose total is honest (Explore `/pools/all` filtered server-side).
 * - {@link computeHasMoreShortPage} (SHORT-PAGE, POO-668): derive the stop from the LAST page length,
 *   ignoring the total. Used where the reported total is a PHANTOM: portfolio `totalPositions` is the
 *   grand total INCLUDING closed positions (computed before the `closed` filter), so it over-counts
 *   an active-only or exited-only read and cannot drive a per-list "Load more".
 */

/** One page of a server-paged list read: the rows plus the backend's reported grand total. */
export interface PageResult<T> {
  /** The rows on this page (already schema-validated + mapped by the item schema). */
  items: T[];
  /** The backend's `totalItems` grand total across every page (drives {@link computeHasMore}). */
  total: number;
}

/**
 * Whether another page exists after the one just served. The single source of the "Load more"
 * math: the next page's first row index is `(page + 1) * limit`; there is more only while that is
 * still below `total`. An exact multiple (served === total) and an empty set both yield `false`.
 */
export function computeHasMore(page: number, limit: number, total: number): boolean {
  return (page + 1) * limit < total;
}

/**
 * SHORT-PAGE termination (POO-668): whether another page MAY exist, judged ONLY by the last page's
 * length. A page that came back exactly full (`length === pageSize`) might have a successor, so there
 * is more; a short or empty page is the definitive end of the feed. This never consults a grand total,
 * so it is correct where that total is a phantom (portfolio `totalPositions` over-counts a filtered
 * read). A zero page size yields `false` (a degenerate guard so a mis-sized loader cannot loop).
 */
export function computeHasMoreShortPage(lastPageLength: number, pageSize: number): boolean {
  return pageSize > 0 && lastPageLength === pageSize;
}
