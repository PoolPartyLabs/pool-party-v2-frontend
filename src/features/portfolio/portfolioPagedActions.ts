/**
 * @id PP-PORT-SCR-001 (POO-668, POO-829)
 * @name Portfolio paged server actions
 * @implements-rules-version v3 (POO-829 rules v2)
 *
 * The Server Action the real-mode Portfolio (PortfolioPagedLoader) calls. It derives the wallet
 * server-side from the SIWE session (POO-270, never trusted from the client), forwards the Bearer,
 * joins each position to its strategy ({@link joinPositionsToStrategies}), and wraps the server-only
 * read so `apiFetch` never reaches a client bundle. Real-mode only (mock mode SSRs the Portfolio
 * unchanged).
 *
 * `loadPortfolioPageAction` reads ONE page of EITHER feed ({@link fetchPortfolioPage}):
 * - `closed=none` — the ACTIVE list's "Load more" (POO-829 [R1]), carrying the active `sorting`
 *   tuple ([R5]; POO-828 sorts the FULL holdings before slicing, so accumulated pages form one
 *   globally-sorted list).
 * - `closed=exited` — the on-demand closed history's own "Load more", backend order verbatim
 *   (POO-668 R2 — the exited feed is already closed-with-balance-first), never sorted.
 * Not signed in → empty + zeroed aggregates (no read).
 *
 * v3 (POO-829): the POO-668 v2 active drain (`getActivePortfolioAction` → fetchActivePortfolio) was
 * RETIRED by the server-paged cutover — POO-696's avgApy/allocation grand aggregates removed the
 * KPI header's need to see every active holding client-side.
 */
"use server";

import type { PageResult } from "@/lib/api/pagination";
import { getAuthHeader, getSessionWallet } from "@/lib/auth/session";
import {
  fetchPortfolioPage,
  type PortfolioPageClosedFilter,
  type PortfolioSort,
} from "@/lib/portfolio/fetchPortfolioPage";
import { mapPortfolioAggregates, type PortfolioAggregates } from "@/lib/portfolio/positionsSchema";
import { listStrategiesForHoldings } from "@/lib/strategies/strategyCatalog";
import { joinPositionsToStrategies } from "./joinPositionsToStrategies";
import type { PortfolioViewPosition } from "./PortfolioView";

/** Parameters for one Portfolio page read. */
export interface LoadPortfolioPageParams {
  /** Which feed: `none` = active, `exited` = closed history. */
  closed: PortfolioPageClosedFilter;
  /** Zero-based page index. */
  page: number;
  /** Page size (the Load-more stride). */
  limit: number;
  /**
   * Active server-side sort (POO-829 R5). Omit for the backend default order. Forwarded to
   * {@link fetchPortfolioPage}; no-op until POO-828 honors the `sorting` param.
   */
  sorting?: PortfolioSort;
}

/** One page of joined Portfolio positions plus the backend grand KPI aggregates. */
export interface PortfolioPageActionResult extends PageResult<PortfolioViewPosition> {
  /** The backend GRAND aggregates (page-independent) that drive the summary KPIs (POO-668 R3). */
  aggregates: PortfolioAggregates;
}

/** The empty result for a signed-out wallet — an empty page + zeroed KPIs. */
function emptyResult(): PortfolioPageActionResult {
  return { items: [], total: 0, aggregates: mapPortfolioAggregates(null) };
}

/**
 * Read one page of the signed-in wallet's portfolio (active or closed), joined to strategies, plus the
 * backend grand aggregates. Not signed in → an empty page + zeroed aggregates (no read).
 */
export async function loadPortfolioPageAction(
  params: LoadPortfolioPageParams,
): Promise<PortfolioPageActionResult> {
  const wallet = await getSessionWallet();
  if (!wallet) return emptyResult();

  // The holdings catalog (every status, incl. closed) resolves each position's strategy; a closed
  // holding whose pool `/pools` omits falls back to the position's own synthesized strategy (POO-526).
  const [page, strategies] = await Promise.all([
    fetchPortfolioPage({
      address: wallet,
      page: params.page,
      limit: params.limit,
      closed: params.closed,
      authHeader: await getAuthHeader(),
      // POO-829 R5: forward the active sort (no-op until POO-828). Omitted → verbatim backend order.
      sorting: params.sorting,
    }),
    listStrategiesForHoldings(),
  ]);

  return {
    // Backend order verbatim (POO-668 R2): the join preserves it, no client re-sort.
    items: joinPositionsToStrategies(page.items, strategies),
    total: page.total,
    aggregates: page.aggregates,
  };
}
