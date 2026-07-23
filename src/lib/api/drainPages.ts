/**
 * @id PP-CORE-LIB-027 (POO-646)
 * @name drainPages
 * @implements-rules-version v1
 *
 * Sequential page-drain for pool-party-api list endpoints. pp_api paginates by default
 * (`page` zero-based, `limit` default 100) and returns only ONE page per call, so a caller
 * that passes no params silently gets at most 100 rows — both the Explore catalog (`GET /pools`)
 * and the portfolio (`GET /portfolio/:wallet/all`) were truncated at 100 (POO-646).
 *
 * DTO contract (verified against pool-party-api):
 *   GET /pools?network={n}           → { totalItems: number; pools: [...] },  skip(page*limit).take(limit)
 *   GET /portfolio/:wallet/all       → { totalPositions: number; positions: [...] }, slice(page*limit, +limit)
 * Both are zero-based (`page`) with `limit` default 100.
 *
 * [R1] Termination is the SHORT-PAGE signal (a page with fewer than `limit` rows is the last page),
 * NOT a length-vs-total comparison. This is deliberate and correct: on the portfolio endpoint
 * `totalPositions` is the count BEFORE the `closed` filter narrows the returned set, so it OVER-counts
 * a filtered read and cannot be trusted as the stop condition. The reported total is used only as a
 * secondary "we've reached everything" short-circuit (skips a wasteful trailing empty page when the
 * last page happens to be exactly full) and never to keep looping past a short page.
 *
 * [R3] Pages are drained SEQUENTIALLY (awaited one at a time), never in parallel: pool-party-api
 * throttles per API key and all SSR shares one key, so parallel page reads would trip 429s. Each page
 * request goes through `apiFetch` unchanged, so its retry/caching/cache-tag seams keep working; this
 * helper only orchestrates the loop and owns no fetch/caching logic of its own.
 *
 * A `maxPages` cap bounds the loop so a misbehaving backend (always-full page, unbounded total)
 * cannot hang the SSR render — hitting the cap throws rather than looping forever.
 */
import "server-only";

/** The pool-party-api default page size (`limit`). Draining in this stride matches the backend. */
export const DEFAULT_PAGE_LIMIT = 100;

/**
 * Safety cap on the number of pages a single drain will fetch. At the default limit of 100 this is
 * 100 * 100 = 10k rows, far beyond any realistic catalog/portfolio; it exists only to fail fast on a
 * backend that never returns a short page instead of looping forever.
 */
const DEFAULT_MAX_PAGES = 100;

/** One page of a paginated list read: the rows plus (optionally) the backend's reported grand total. */
export interface Page<T> {
  items: T[];
  /** The backend's total-count field (`totalItems` / `totalPositions`), when present. */
  total?: number;
}

interface DrainOptions {
  /** Page size to request; defaults to the pp_api default of 100. */
  limit?: number;
  /** Safety cap on pages fetched before the drain gives up (defaults to 100). */
  maxPages?: number;
}

/**
 * Drain every page of a paginated list, calling `fetchPage(page, limit)` sequentially from page 0
 * until a short page (or the reported total) is reached, and return the concatenated rows in order.
 *
 * @param fetchPage - Fetches one zero-based page; MUST honor the `(page, limit)` it is given.
 * @param options - `limit` (page size, default 100) and `maxPages` (safety cap, default 100).
 * @throws When the drain exceeds `maxPages` without seeing a short page (misbehaving backend).
 */
export async function drainPages<T>(
  fetchPage: (page: number, limit: number) => Promise<Page<T>>,
  options: DrainOptions = {},
): Promise<T[]> {
  const limit = options.limit ?? DEFAULT_PAGE_LIMIT;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  const all: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    // [R3] Sequential: await this page before deciding whether to request the next one.
    const { items, total } = await fetchPage(page, limit);
    all.push(...items);

    // [R1] A page shorter than the limit is the last page — stop.
    if (items.length < limit) return all;
    // [R1] Reached the reported total on an exactly-full page — stop before a wasteful empty page.
    if (total !== undefined && all.length >= total) return all;
  }

  throw new Error(
    `drainPages exceeded ${maxPages} pages (limit ${limit}) without a short page — the backend never signalled the end of the list`,
  );
}
