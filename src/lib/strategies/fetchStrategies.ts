/**
 * @id PP-STR (POO-298)
 * @name fetchStrategies
 * @implements-rules-version v1
 *
 * Server-side read of the strategy catalog from pool-party-api. `GET /api/v1/pools?network={n}`
 * is per-network, so the supported chains are fetched in parallel and merged. One network failing
 * yields a partial catalog; if ALL fail, the error propagates (page error boundary).
 *
 * The catalog is wallet-independent and slow-moving, and every authenticated page renders it under
 * `force-dynamic`. Without caching, each navigation re-fired one upstream call per network and
 * tripped the backend's per-IP rate limit (429 → error boundary). It is cached via the apiFetch
 * data-cache window so repeated navigations reuse one upstream hit per network per window.
 *
 * `GET /pools` paginates (`page` zero-based, `limit` default 100, response `{ totalItems, pools }`),
 * returning only ONE page per call. Passing no params silently truncated each network at 100 pools
 * (POO-646), so each network is DRAINED page-by-page ([R1] short-page termination, [R3] sequential
 * to respect the per-API-key throttle) via {@link drainPages}. Every page still goes through
 * `apiFetch` unchanged, so the revalidate window + `STRATEGIES_CACHE_TAG` cache tag keep working
 * per page.
 *
 * PP-INTEGRATION-POINT: strategy catalog ← pool-party-api pools (D1: pool = strategy),
 * paginated `?page&limit`, `{ totalItems, pools }` per page.
 */
import "server-only";

import { apiFetch } from "@/lib/api/client";
import { DEFAULT_PAGE_LIMIT, drainPages } from "@/lib/api/drainPages";
import { supportedChainMetas } from "@/lib/chains/config";
import type { Strategy } from "@/lib/schemas";
import { mapStrategy } from "./mapStrategy";
import { apiPoolsResponseSchema } from "./poolsSchema";

/** The API network slugs to query, derived from the shared chain config (single source). */
const API_NETWORKS = supportedChainMetas.map((meta) => meta.apiNetworkId);

/**
 * Data-cache window (seconds) for the catalog. TVL/APY drift slowly, so a short window collapses
 * a burst of navigations into one upstream read per network without showing stale figures.
 */
const CATALOG_REVALIDATE_SECONDS = 60;

/**
 * Cache tag for the catalog reads. A mutation that adds/changes a pool (create-pool) calls
 * `revalidateTag(STRATEGIES_CACHE_TAG)` so the new strategy appears immediately, instead of waiting
 * out the revalidate window.
 */
export const STRATEGIES_CACHE_TAG = "strategies";

/** The outcome of one network's fetch — never rejects, so partial failures are isolated. */
type NetworkResult = { ok: true; strategies: Strategy[] } | { ok: false; error: unknown };

/** Fetch and map one network's pools, draining every page and catching its own failure. */
async function fetchNetworkStrategies(network: string): Promise<NetworkResult> {
  try {
    // [R1][R3] Drain every page of this network's pools sequentially (short-page termination).
    const pools = await drainPages(
      async (page, limit) => {
        const response = await apiFetch(`pools?network=${network}&page=${page}&limit=${limit}`, {
          schema: apiPoolsResponseSchema,
          network,
          revalidate: CATALOG_REVALIDATE_SECONDS,
          tags: [STRATEGIES_CACHE_TAG],
        });
        // A 204/empty response is an empty (final) page.
        return { items: response?.pools ?? [], total: response?.totalItems };
      },
      { limit: DEFAULT_PAGE_LIMIT },
    );
    // Pass the queried slug so legacy rows (which omit `network`) still carry it (POO-316).
    return { ok: true, strategies: pools.map((p) => mapStrategy(p, network)) };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Fetch the full strategy catalog across every supported network.
 * Partial failures are tolerated; a total failure rethrows the first error.
 */
export async function fetchStrategies(): Promise<Strategy[]> {
  const results = await Promise.all(API_NETWORKS.map(fetchNetworkStrategies));

  const ok = results.filter((r): r is { ok: true; strategies: Strategy[] } => r.ok);

  // Every network failed → surface the error rather than show an empty catalog.
  if (ok.length === 0 && results.length > 0) {
    throw (results[0] as { ok: false; error: unknown }).error;
  }

  return ok.flatMap((r) => r.strategies);
}

/** Fetch a single strategy by id (positionId), or null when not found. */
export async function fetchStrategyById(id: string): Promise<Strategy | null> {
  // PP-PERF: scans the merged catalog; the API has no positionId lookup across networks.
  const strategies = await fetchStrategies();
  return strategies.find((strategy) => strategy.id === id) ?? null;
}
