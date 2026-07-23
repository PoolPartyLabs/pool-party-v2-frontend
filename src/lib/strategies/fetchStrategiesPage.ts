/**
 * @id PP-STR-LIB-007 (POO-667) · PP-STR-LIB-008 (POO-579)
 * @name fetchStrategiesPage
 * @implements-rules-version v1
 *
 * Real-mode server-paged read of the Explore strategy catalog, the server-paged counterpart to the
 * drain-everything {@link fetchStrategies}. POO-579 points the real path at the v2 catalog
 * (`GET /api/v2/strategies?page&limit&network&riskProfile&search&sorting`, query parity confirmed in
 * pp-api `strategies-v2-query.dto.ts`), envelope `{ strategies, totalItems }`, rows mapped by the v2
 * ACL {@link mapStrategyV2}. POO-667 always sends `lifecycle=live` for DISCOVERY: the backend excludes
 * closed from BOTH the count and the rows, so `totalItems` is the honest live count and every page is
 * dense — no client-side per-page filter shrinks a page below the total (the phantom-"Load more" bug).
 * On ANY error it falls back to the v1 `GET /pools/all` read (`{ totalItems, pools }`, mapped by
 * {@link mapStrategy}) so Explore degrades instead of erroring.
 *
 * Sort mapping (verified against pp_api `SORT_FIELD_MAP` / `strategies-v2-query.dto.ts`): the backend
 * honors `tvlInUSD` (→ dexPoolTvlUsd, the investor `tvl` column), `feesApr` (the `return` column) and,
 * since POO-726 shipped, `riskLevel` (band steady<dynamic<wild, so asc = lowest risk first → the `risk`
 * column) and `totalInvestors` (the `investors` column). Only `min` has NO server field — it is the
 * platform floor, identical for every strategy in v1 — so it sends no `sorting` param and falls to the
 * backend default order (documented gap, PP-NOTE; POO-726 R3 / POO-754 revisit once per-strategy minimums exist).
 *
 * Risk mapping: the 5-band UI maps to the API's 3-band `riskProfile` (1→steady, 3→dynamic, 5→wild).
 * Bands 2 & 4 have no profile and the API 400s on anything else, so they short-circuit to an empty
 * page — exactly the empty result the client-side filter already produced for those bands.
 *
 * Category filter (POO-894 rules-v1): the selected asset categories ride the v2 read as
 * `category=<tag>[,<tag>...]` ([R1], OR semantics, server-derived pair tags mirroring the FE
 * `deriveAssetTags`), so the filter + `totalItems` cover the WHOLE catalog, not just loaded pages.
 * The v1 fallback has NO category param, so it keeps the pre-POO-894 client-side narrowing over the
 * fetched page as the degraded path ([R8]) - loaded-rows-only semantics, unfiltered v1 total, never
 * an error.
 *
 * PP-INTEGRATION-POINT: Explore server-paged catalog ← pool-party-api `GET /api/v2/strategies?lifecycle=live`
 * (POO-636/POO-667) with the POO-894 `category` param, envelope `{ strategies, totalItems }` filtered
 * to computed-live; v1 `GET /pools/all` (`{ totalItems, pools }`) is the fallback until the v2 read is
 * the sole source (category narrows client-side there, [R8]).
 */
import "server-only";

import type { PageResult } from "@/lib/api/pagedFetch";
import { fetchPage } from "@/lib/api/pagedFetch";
import type { AssetTag, Strategy } from "@/lib/schemas";
import { mapStrategy } from "./mapStrategy";
import { apiPoolSchema } from "./poolsSchema";
import { RISK_PROFILE_LEVEL, type RiskProfile } from "./riskProfile";
import { filterStrategiesByAssetTags } from "./tags/filterByAssetTags";
import { fetchStrategiesV2 } from "./v2/fetchStrategiesV2";
import { mapStrategyV2 } from "./v2/mapStrategyV2";

/** The Explore sort columns (mirrors the screen's `SortKey`). */
export type ExploreSortKey = "risk" | "min" | "tvl" | "investors" | "return";

/** Sort direction. */
export type ExploreSortDir = "asc" | "desc";

/** Parameters for a single Explore page read. */
export interface FetchStrategiesPageParams {
  /** Zero-based page index. */
  page: number;
  /** Page size. */
  limit: number;
  /** Active sort column + direction. Omit for the backend default order. */
  sort?: { key: ExploreSortKey; dir: ExploreSortDir };
  /** Selected risk band (1–5), or undefined for no filter. */
  risk?: number;
  /**
   * Selected asset categories (POO-894 [R1]), OR semantics. Omit/empty for no filter. Sent to the
   * v2 read as the comma-joined `category` param; the v1 fallback narrows client-side ([R8]).
   */
  categories?: readonly AssetTag[];
  /** Free-text search query (trimmed; blank → no search). */
  search?: string;
}

/**
 * The Explore sort column → backend `sorting` field id. Only the two the backend actually honors
 * are mapped; the rest are absent (no server field), so their reads fall to the default order.
 */
const SORT_FIELD_BY_KEY: Partial<Record<ExploreSortKey, string>> = {
  // `tvl` sorts by the investor-facing Uniswap pool TVL (dexPoolTvlUsd), whose honored key is `tvlInUSD`.
  tvl: "tvlInUSD",
  return: "feesApr",
  // POO-726 (Done): the backend now exposes a risk-band ordinal (`riskLevel`, steady<dynamic<wild, so
  // `risk:asc` = lowest risk first) and a `totalInvestors` sort field, so the Risk + Investors columns
  // sort server-side across all pages like TVL / Est. return.
  risk: "riskLevel",
  investors: "totalInvestors",
  // PP-NOTE: `min` is NOT server-sortable — it is the platform floor (identical for every strategy in
  // v1), so a server sort would be a no-op. It sends no `sorting` param and renders in the backend
  // default order (POO-726 R3 / POO-754 revisit once per-strategy minimums exist).
};

/** The 5-band UI level → the API's 3-band `riskProfile` slug. Bands 2 & 4 have no profile. */
const RISK_PROFILE_BY_LEVEL: Record<number, RiskProfile> = Object.fromEntries(
  (Object.entries(RISK_PROFILE_LEVEL) as [RiskProfile, 1 | 3 | 5][]).map(([profile, level]) => [
    level,
    profile,
  ]),
);

/**
 * Read one page of the Explore catalog with server-side paging/sort/filter/search.
 * @returns the mapped `Strategy[]` for this page plus the backend grand total.
 */
export async function fetchStrategiesPage(
  params: FetchStrategiesPageParams,
): Promise<PageResult<Strategy>> {
  const { page, limit, sort, risk, categories, search } = params;

  // Bands 2 & 4 have no API risk profile and the endpoint 400s on an unknown value, so short-circuit
  // to the empty page the client-side filter already produced for those bands (no wasted call).
  const riskProfile = risk === undefined ? undefined : RISK_PROFILE_BY_LEVEL[risk];
  if (risk !== undefined && riskProfile === undefined) {
    return { items: [], total: 0 };
  }

  const sortField = sort ? SORT_FIELD_BY_KEY[sort.key] : undefined;
  const sorting = sortField ? `${sortField}:${sort?.dir}` : undefined;
  const trimmedSearch = search?.trim() ? search.trim() : undefined;
  // POO-894 [R1]: comma-joined like the backend's `sorting`; omitted entirely when nothing selected.
  const category = categories && categories.length > 0 ? categories.join(",") : undefined;

  // Real path (POO-579): the v2 catalog, filtered to `lifecycle=live` (POO-667) so the backend excludes
  // closed from BOTH the rows and the total — the page is dense and its total is honest (no phantom
  // "Load more"). The v2 path TRUSTS the server for the category filter ([R2]): an older deploy
  // without the param strips it (whitelist) and serves the unfiltered page - accepted degradation, no
  // client re-narrowing here (a per-page re-filter shrinks pages below `total`, the phantom-Load-more
  // class of bug). Any error (schema drift, upstream outage) falls back to the v1 `/pools/all` read so
  // Explore degrades to the previous source instead of erroring.
  try {
    const v2 = await fetchStrategiesV2({
      page,
      limit,
      lifecycle: "live",
      riskProfile,
      category,
      search: trimmedSearch,
      sorting,
    });
    return { items: (v2?.strategies ?? []).map(mapStrategyV2), total: v2?.totalItems ?? 0 };
  } catch {
    const raw = await fetchPage({
      path: "pools/all",
      page,
      limit,
      itemsKey: "pools",
      itemSchema: apiPoolSchema,
      sorting,
      riskProfile,
      search: trimmedSearch,
    });
    // `/pools/all` rows carry `network` on the row, so no queried-network fallback is needed here.
    const mapped = raw.items.map((pool) => mapStrategy(pool));
    // POO-894 [R8] degraded path: v1 has NO category param, so keep the pre-POO-894 client-side
    // narrowing over THIS page (loaded-rows-only semantics; `assetTags` symbol-derived by
    // mapStrategy). The unfiltered v1 total passes through - v1 cannot count per-category - so the
    // count/hasMore may overshoot while degraded; the page never errors.
    const items =
      categories && categories.length > 0
        ? filterStrategiesByAssetTags(mapped, categories)
        : mapped;
    return { items, total: raw.total };
  }
}
