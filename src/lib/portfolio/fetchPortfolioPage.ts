/**
 * @id PP-PORT-LIB-001 (POO-668, POO-829)
 * @name fetchPortfolioPage
 * @implements-rules-version v2 (POO-829 rules v2)
 *
 * The server-paged (ONE page) counterpart to the drain-everything {@link fetchPositions}. It backs the
 * Portfolio "Load more" for BOTH the active list (`closed=none`) and the on-demand closed list
 * (`closed=exited`): each reads exactly one `page` of `limit` rows and derives its own `hasMore` from
 * SHORT-PAGE termination in the client hook, NOT from `totalPositions` (a phantom grand total that
 * over-counts a filtered read, POO-646/POO-668).
 *
 * The read returns the mapped `Position[]` for the page IN BACKEND ORDER (verbatim, no client re-sort:
 * the exited feed already comes closed-with-balance-FIRST, the "closed with funds on top" requirement,
 * POO-457 R6) plus the backend GRAND {@link PortfolioAggregates} (page-independent) that drive the
 * summary KPIs. KPIs are read from these aggregates, never summed over the page (POO-668 R3).
 *
 * It rides `apiFetch` unchanged, so the per-wallet short data-cache window + `positionsTag` cache tag
 * keep working per page (a write busts them via {@link revalidatePositionsAction}). No wallet → an
 * empty page + zeroed aggregates; a per-wallet 404 → the same; other errors propagate.
 *
 * PP-INTEGRATION-POINT: investor positions + grand aggregates ← pool-party-api
 * `GET /portfolio/:wallet/all?closed=none|exited&page&limit` (D1: pool = strategy).
 */
import "server-only";

import { ApiError, apiFetch } from "@/lib/api/client";
import type { PageResult } from "@/lib/api/pagination";
import { POSITIONS_REVALIDATE_SECONDS, positionsTag } from "./fetchPositions";
import { mapPosition } from "./mapPosition";
import {
  apiPortfolioSchema,
  mapPortfolioAggregates,
  type PortfolioAggregates,
} from "./positionsSchema";

/**
 * The Portfolio-page `closed` filter values (POO-668). `none` = the active feed (positions with
 * balance); `exited` = the fully-withdrawn closed history (closed-with-balance-first from the backend).
 */
export type PortfolioPageClosedFilter = "none" | "exited";

/**
 * The Portfolio table's sortable columns (POO-829 R5) — mirrors the desktop `PortfolioView` headers.
 * `yield` is the position PnL in USD (the "Yield" column), the default sort. `strategy` is not sortable.
 */
export type PortfolioSortKey = "risk" | "invested" | "value" | "yield" | "rate";

/** Sort direction. */
export type PortfolioSortDir = "asc" | "desc";

/** An active sort selection (column + direction). */
export interface PortfolioSort {
  key: PortfolioSortKey;
  dir: PortfolioSortDir;
}

/**
 * The Portfolio sort column → backend `sorting` field id (POO-828). `yield` (the default) maps to
 * `totalYield`. Only mapped keys emit a `sorting` param.
 *
 * PP-INTEGRATION-POINT (POO-828, VERIFIED): field ids confirmed against pool-party-api
 * `portfolio-sort.ts` (`PORTFOLIO_SORT_FIELDS = totalYield | currentValue | invested | feesApr`).
 * `risk` is deliberately UNMAPPED: POO-828 defers `riskLevel` (not carried on the portfolio payload;
 * the backend silently ignores unknown fields), so emitting it would be a silent no-op round-trip —
 * the paged Risk header renders as a dead header instead (POO-829 R3, POO-734-style).
 */
const SORT_FIELD_BY_KEY: Partial<Record<PortfolioSortKey, string>> = {
  yield: "totalYield",
  invested: "invested",
  value: "currentValue",
  rate: "feesApr",
};

/**
 * The `&sorting=<field>:<dir>` query fragment for a sort selection, or `""` when there is no sort (or
 * the column has no backend field, e.g. `risk` — see {@link SORT_FIELD_BY_KEY}).
 */
export function sortingQueryParam(sorting?: PortfolioSort): string {
  if (!sorting) return "";
  const field = SORT_FIELD_BY_KEY[sorting.key];
  return field ? `&sorting=${field}:${sorting.dir}` : "";
}

/** Parameters for a single portfolio page read. */
export interface FetchPortfolioPageParams {
  /** The connected wallet. Absent → an empty page + zeroed aggregates (no call). */
  address?: string;
  /** Zero-based page index. */
  page: number;
  /** Page size (the Load-more stride, 5). */
  limit: number;
  /** Which feed to read. Defaults to the active feed (`none`). */
  closed?: PortfolioPageClosedFilter;
  /** Auth header (Bearer) so pool-party-api binds the read to the wallet. */
  authHeader?: Record<string, string>;
  /**
   * Active server-side sort (POO-829 R5). Omit for the backend default order (verbatim). When set,
   * the page is a slice of the globally-sorted set (POO-828 sorts the FULL holdings before slicing).
   */
  sorting?: PortfolioSort;
}

/** One page of the portfolio plus the backend grand KPI aggregates. */
export interface PortfolioPageResult extends PageResult<ReturnType<typeof mapPosition>> {
  /** The backend GRAND aggregates (page-independent) that drive the summary KPIs (POO-668 R3). */
  aggregates: PortfolioAggregates;
}

/** The empty result for a missing wallet / 404 — an empty page and zeroed KPIs. */
function emptyResult(): PortfolioPageResult {
  return { items: [], total: 0, aggregates: mapPortfolioAggregates(null) };
}

/**
 * Read exactly ONE page of the connected wallet's portfolio (active or exited), mapped to FE
 * positions in backend order, plus the grand KPI aggregates.
 *
 * @throws {ApiError} On non-404 HTTP / network failures (after `apiFetch`'s transient retries).
 */
export async function fetchPortfolioPage(
  params: FetchPortfolioPageParams,
): Promise<PortfolioPageResult> {
  const { address, page, limit, closed = "none", authHeader = {}, sorting } = params;
  if (!address) return emptyResult();

  try {
    const portfolio = await apiFetch(
      `portfolio/${address}/all?closed=${closed}&page=${page}&limit=${limit}${sortingQueryParam(sorting)}`,
      {
        schema: apiPortfolioSchema,
        headers: authHeader,
        // Same short per-wallet data cache + per-wallet tag as fetchPositions, so a write busts it and
        // rapid navigation collapses onto one upstream hit per page (POO-453).
        revalidate: POSITIONS_REVALIDATE_SECONDS,
        tags: [positionsTag(address)],
      },
    );
    // A 204/empty response is an empty page.
    if (!portfolio) return emptyResult();
    return {
      // Backend order VERBATIM — the exited feed is already closed-with-balance-first (POO-457 R6).
      items: portfolio.positions.map(mapPosition),
      // `totalPositions` is the phantom grand total (incl. closed); carried for parity but the client
      // hook derives hasMore from SHORT-PAGE termination, never from this.
      total: portfolio.totalPositions ?? 0,
      // KPIs from the GRAND aggregates, never summed over the page (POO-668 R3).
      aggregates: mapPortfolioAggregates(portfolio),
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return emptyResult();
    throw error;
  }
}
