/**
 * @id PP-STR-SCR-001 (POO-667)
 * @name Explore paging server action
 * @implements-rules-version v1
 *
 * The Server Action the client "Load more" hook (useServerPage via ExplorePagedLoader) calls to read
 * one page of the real Explore catalog with server-side paging/sort/filter/search. It wraps the
 * server-only {@link fetchStrategiesPage} so `apiFetch` never reaches a client bundle.
 *
 * Discovery excludes closed strategies (never allocatable, POO-458), but that filter now lives in the
 * BACKEND: {@link fetchStrategiesPage} sends `lifecycle=live`, so the page is already dense and its
 * `total` is the honest live count. This action MUST NOT re-filter per page — doing so shrank a page
 * below the reported `total`, which made `computeHasMore` render an empty page 0 + a phantom "Load
 * more" (POO-667). It is a thin server boundary that passes the backend page through unchanged.
 *
 * Wallet-independent (the catalog is public), so no session is required — mirroring `fetchStrategies`.
 */
"use server";

import type { PageResult } from "@/lib/api/pagedFetch";
import type { Strategy } from "@/lib/schemas";
import type { FetchStrategiesPageParams } from "@/lib/strategies/fetchStrategiesPage";
import { fetchStrategiesPage } from "@/lib/strategies/fetchStrategiesPage";

/**
 * Read one page of the discovery catalog (real mode). The backend already filters to live
 * (`lifecycle=live`), so the page is returned unchanged: dense rows plus the honest grand total.
 * @returns the page's mapped strategies plus the backend grand total.
 */
export async function loadExplorePageAction(
  params: FetchStrategiesPageParams,
): Promise<PageResult<Strategy>> {
  return fetchStrategiesPage(params);
}
