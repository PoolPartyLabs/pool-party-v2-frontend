/**
 * @id PP-STR (POO-216, POO-453, POO-476)
 * @name fetchPositions
 * @implements-rules-version v2
 *
 * Server-side read of the connected wallet's cross-network portfolio
 * (GET /api/v1/portfolio/:wallet/all) mapped to FE Position[]. No wallet → [];
 * a per-wallet 404 → []; other errors propagate.
 *
 * `/portfolio/:wallet/all` paginates (`page` zero-based, `limit` default 100, response
 * `{ totalPositions, positions }` where `positions` is filtered THEN sliced). Passing no params
 * silently truncated the portfolio at 100 positions (POO-646), so the read is DRAINED page-by-page
 * ([R1] short-page termination, [R3] sequential to respect the per-API-key throttle) via
 * {@link drainPages}. `totalPositions` is only a secondary short-circuit, never the stop condition:
 * the backend computes it BEFORE the `closed` filter, so it over-counts a filtered read. Every page
 * still goes through `apiFetch`, so the per-wallet cache window + tag keep working per page.
 *
 * v2 (POO-453): [R1] a short per-wallet data-cache window collapses a burst of navigations into ONE
 * upstream hit instead of one per render. The backend throttles per API key and all SSR shares one
 * key, so uncached per-wallet reads let rapid navigation trip 429s that took the dashboard down. The
 * window is short and [R2] a write invalidates it via `revalidatePositionsAction`, so holdings never
 * look stale after an action. The tag is per-wallet — the URL already keys the cache entry by
 * address, so entries never cross wallets and a write busts only that wallet's read.
 *
 * PP-INTEGRATION-POINT: investor positions ← pool-party-api portfolio (D1: pool = strategy).
 * PP-DEBT(SEV:MED) POO-316: this `/all` call assumes ONE backend returns every network's positions.
 * Under the legacy/current split (PP_API_URL_LEGACY set), legacy positions (Arbitrum / Base) live on
 * the legacy backend, so this would need a per-network fetch + merge (like fetchStrategies). It runs
 * against the current backend today; confirm whether `/all` aggregates across backends before launch.
 */
import "server-only";

import { ApiError, apiFetch } from "@/lib/api/client";
import { DEFAULT_PAGE_LIMIT, drainPages } from "@/lib/api/drainPages";
import type { Position } from "@/lib/schemas";
import { mapPosition } from "./mapPosition";
import { apiPortfolioSchema } from "./positionsSchema";

/**
 * How the portfolio read filters by position lifecycle (backend `closed` query param).
 * Omitted (default): only positions WITH balance — the investor's live holdings, incl. a
 * closed-but-not-yet-withdrawn position (pending Withdraw). `all`: every position regardless of
 * balance, incl. fully-exited (already-withdrawn) ones — the manager console/role read them so a
 * manager who wound a strategy down still counts as a manager and sees the strategies they closed
 * (POO-456). `exited`: only fully-withdrawn positions — the investor's "closed strategies" history.
 */
export type PortfolioClosedFilter = "all" | "exited" | "closed";

/**
 * [R1] Data-cache window (seconds) for the per-wallet positions read. Short on purpose: long enough
 * to collapse a back-and-forth navigation burst into one upstream hit, short enough that holdings
 * never look meaningfully stale — and a write invalidates it immediately anyway ([R2]). Shared with
 * the server-paged {@link fetchPortfolioPage} (POO-668) so both reads use the same window + tag.
 */
export const POSITIONS_REVALIDATE_SECONDS = 10;

/**
 * [R1][R2] Per-wallet cache tag for the positions read. Lowercased so the writer's session wallet
 * and the reader's address always resolve to the same tag. `revalidatePositionsAction` invalidates
 * exactly this tag after a write so the next read reflects the change without waiting out the window.
 */
export function positionsTag(address: string): string {
  return `positions:${address.toLowerCase()}`;
}

/**
 * Fetch and map the connected wallet's positions. No address → empty list. The session token
 * (when signed in) is forwarded as a Bearer so pool-party-api can bind the read to the wallet.
 * `closed` maps to the backend query param (omitted = live holdings with balance).
 */
export async function fetchPositions(
  address?: string,
  authHeader: Record<string, string> = {},
  closed?: PortfolioClosedFilter,
): Promise<Position[]> {
  if (!address) return [];

  // The `closed` filter (when set) is a stable query param carried on every page of the drain.
  const closedParam = closed ? `closed=${closed}&` : "";
  try {
    // [R1][R3] Drain every page of the wallet's positions sequentially (short-page termination).
    const positions = await drainPages(
      async (page, limit) => {
        const portfolio = await apiFetch(
          `portfolio/${address}/all?${closedParam}page=${page}&limit=${limit}`,
          {
            schema: apiPortfolioSchema,
            headers: authHeader,
            // [R1] Short per-wallet data cache; [R2] invalidated on write via positionsTag(address).
            revalidate: POSITIONS_REVALIDATE_SECONDS,
            tags: [positionsTag(address)],
          },
        );
        // A 204/empty response is an empty (final) page.
        return { items: portfolio?.positions ?? [], total: portfolio?.totalPositions };
      },
      { limit: DEFAULT_PAGE_LIMIT },
    );
    return positions.map(mapPosition);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return [];
    throw error;
  }
}
