/**
 * @id PP-CORE-LIB-031 (POO-666)
 * @name pagedFetch
 * @implements-rules-version v1
 *
 * The shared server-side paging seam over {@link apiFetch}. pool-party-api list endpoints paginate
 * with a zero-based `page` + `limit` and return a `{ totalItems, <itemsKey>[] }` envelope; this
 * helper reads exactly ONE page (unlike {@link drainPages}, which drains every page for a full read)
 * and returns `{ items, total }`. It is the read half of the "Load more" seam (POO-665): the client
 * {@link useServerPage} hook accumulates the pages this returns, page by page, on demand.
 *
 * It owns no fetch/caching logic of its own — every read rides `apiFetch` unchanged, so its
 * retry / data-cache / cache-tag seams keep working per page. Only the honored query params are
 * appended (no empty `sorting=`/`search=` noise), and unknown item keys are stripped by the schema.
 *
 * PP-INTEGRATION-POINT: server-paged list reads (Explore `/pools/all`, and future paged surfaces)
 * ride this seam so the cutover to real, server-side paging/sort/filter stays in one place.
 */
import "server-only";

import type { ZodType } from "zod";
import { z } from "zod";
import { apiFetch } from "./client";
import type { PageResult } from "./pagination";

// PageResult + the pure `computeHasMore` math live in the client-safe `./pagination` module so the
// client `useServerPage` hook shares them WITHOUT importing this `server-only` file (which `pnpm
// build` forbids in a client bundle). Re-exported here for server-side consumers that read one page.
export type { PageResult } from "./pagination";

/** Options for a single {@link fetchPage} read. */
export interface FetchPageOptions<T> {
  /** API path without the base or query (e.g. `"pools/all"`). */
  path: string;
  /** Zero-based page index. */
  page: number;
  /** Page size. */
  limit: number;
  /** The envelope key holding the row array (e.g. `"pools"`). */
  itemsKey: string;
  /** Zod schema for ONE row; unknown row keys are stripped. */
  itemSchema: ZodType<T>;
  /** Server sort spec as `field:asc|desc`. Omit for the backend default order. */
  sorting?: string;
  /** Backend risk filter (`steady|dynamic|wild`). Omit for no filter. */
  riskProfile?: string;
  /** Free-text search query. Omit for no search. */
  search?: string;
  /** API network slug (routes legacy networks in `apiFetch`). Omit for network-agnostic reads. */
  network?: string;
  /** GET data-cache window (seconds), forwarded to `apiFetch`. Omit to skip the cache. */
  revalidate?: number;
  /** Cache tags for the GET data-cache entry, forwarded to `apiFetch`. */
  tags?: string[];
}

/**
 * Read one page of a paginated `{ totalItems, <itemsKey>[] }` list endpoint and return
 * `{ items, total }`. A 204 / empty response yields an empty page with `total: 0`.
 *
 * @throws {ApiError} On HTTP / network failures (after `apiFetch`'s transient retries).
 * @throws {ApiParseError} When the envelope or a row fails validation.
 */
export async function fetchPage<T>(options: FetchPageOptions<T>): Promise<PageResult<T>> {
  const { path, page, limit, itemsKey, itemSchema, sorting, riskProfile, search, network } =
    options;

  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (sorting) query.set("sorting", sorting);
  if (riskProfile) query.set("riskProfile", riskProfile);
  if (search) query.set("search", search);
  if (network) query.set("network", network);

  // The envelope: only the total + the rows are declared; every other top-level key (e.g.
  // `networkCounts` on `/pools/all`) is stripped by the schema, and unknown row keys with it.
  const envelopeSchema = z.object({
    totalItems: z.number(),
    [itemsKey]: z.array(itemSchema),
  });

  const response = await apiFetch(`${path}?${query.toString()}`, {
    schema: envelopeSchema,
    network,
    revalidate: options.revalidate,
    tags: options.tags,
  });

  // A 204 (null) is an empty final page.
  if (!response) return { items: [], total: 0 };

  const envelope = response as { totalItems: number } & Record<string, T[]>;
  return { items: envelope[itemsKey] ?? [], total: envelope.totalItems };
}
