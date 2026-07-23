/**
 * @id PP-STR (POO-298) · PP-STR-LIB-008 (POO-579) · POO-721 (holdings → v2 catalog) · POO-778 (single-request detail)
 * @name strategy catalog resolver
 * @implements-rules-version v1
 *
 * Server-side seam for the strategy catalog: real pool-party-api reads in real mode, the existing mock
 * strategy service in mock mode. Server Components import these instead of `strategyService` so the
 * cutover stays in one place and `apiFetch` (server-only) never reaches a client bundle.
 *
 * POO-579 swaps the real DISCOVERY reads to the v2 catalog (`GET /api/v2/strategies(/:id)`, richer
 * owned metadata + derived onchain state), mapped by {@link mapStrategyV2}, each wrapped in a try/catch
 * that falls back to the v1 `/pools` reads ({@link fetchStrategies} / {@link fetchStrategyById}) on any
 * error (schema drift, upstream outage) so the catalog degrades instead of failing.
 *
 * {@link mapStrategyV2} keys a CHAIN-BOUND row by its on-chain `positionId` (mapping `pool` from
 * `poolAddress`), so a v2 discovery strategy lands in the SAME id space the rest of the app joins on —
 * the portfolio positions (`position.strategyId`=positionId), the analytics timeseries, and the invest
 * build all resolve, and the strategy is investable.
 *
 * POO-778: {@link getStrategyById} resolves the DETAIL of ANY id — UUID or positionId — in ONE v2
 * read. {@link fetchStrategyV2ById} shape-routes it (POO-776): a UUID hits the UUID-only
 * `GET /api/v2/strategies/:id`; a chain-bound positionId hits the case-insensitive
 * `GET /api/v2/strategies/by-position/:positionId`. Both carry every enrichment incl. the
 * manager-uploaded logoUrl, retiring the POO-741 drain-and-find from the detail path. LIST surfaces
 * keep their drains: POO-721 {@link listStrategiesForHoldings} reads the v2 catalog (go-forward
 * replacement for `/pools`), draining EVERY lifecycle state so held/managed closed strategies still
 * resolve (POO-455) and carry their `logoUrl`, falling back to v1 `/pools` on any v2 error.
 */
import "server-only";

import { DEFAULT_PAGE_LIMIT, drainPages } from "@/lib/api/drainPages";
import type { Strategy } from "@/lib/schemas";
import { isMockMode, strategyService as mockStrategyService } from "@/lib/services";
import { fetchStrategies, fetchStrategyById } from "./fetchStrategies";
import { fetchStrategiesV2, fetchStrategyV2ById } from "./v2/fetchStrategiesV2";
import { mapStrategyV2 } from "./v2/mapStrategyV2";

/**
 * Drain the full v2 catalog (every network in one endpoint, page by page) and map to FE Strategies,
 * falling back to the v1 `/pools` catalog on any error. Sequential page drain (throttle-safe) mirrors
 * {@link fetchStrategies}.
 */
async function fetchV2CatalogOrV1Fallback(): Promise<Strategy[]> {
  try {
    const rows = await drainPages(
      async (page, limit) => {
        // DISCOVERY: `lifecycle=live` so the backend excludes closed from BOTH the rows and the total
        // (POO-667). The `listStrategies` belt-and-braces `status !== "closed"` filter below stays —
        // harmless on the (now already-live) v2 rows and still needed for the v1 `/pools` fallback,
        // which has no lifecycle filter, and for mock mode.
        const result = await fetchStrategiesV2({ page, limit, lifecycle: "live" });
        return { items: result?.strategies ?? [], total: result?.totalItems };
      },
      { limit: DEFAULT_PAGE_LIMIT },
    );
    return rows.map(mapStrategyV2);
  } catch {
    return fetchStrategies();
  }
}

/**
 * List the Explore discovery catalog (real v2 pools in real mode, mock otherwise). Closed strategies
 * are never allocatable, so they never appear in discovery (POO-458); the v2 mapper already collapses
 * pending/missing/closed lifecycle states to `closed`, so only live strategies survive this filter.
 * Holdings resolution uses {@link listStrategiesForHoldings}, which keeps every status.
 */
export async function listStrategies(): Promise<Strategy[]> {
  const all = isMockMode ? await mockStrategyService.list() : await fetchV2CatalogOrV1Fallback();
  return all.filter((strategy) => strategy.status !== "closed");
}

/**
 * Drain the FULL v2 catalog for holdings — every lifecycle state (no `lifecycle` filter, so `closed`
 * held/managed strategies still resolve, POO-455) — and map to FE Strategies, falling back to the v1
 * `/pools` catalog on any error. Distinct from {@link fetchV2CatalogOrV1Fallback}, which narrows to
 * `lifecycle=live` for discovery. Chain-bound rows key by `positionId` (the id space `position.strategyId`
 * joins on), so the portfolio / manager-console / manage-detail joins resolve unchanged (POO-721).
 */
async function fetchV2HoldingsCatalogOrV1Fallback(): Promise<Strategy[]> {
  try {
    const rows = await drainPages(
      async (page, limit) => {
        // Holdings: NO lifecycle filter → every status incl. closed (POO-455). The FE consumers join
        // by positionId, so pending (UUID-keyed) rows simply don't match a position — harmless.
        const result = await fetchStrategiesV2({ page, limit });
        return { items: result?.strategies ?? [], total: result?.totalItems };
      },
      { limit: DEFAULT_PAGE_LIMIT },
    );
    return rows.map(mapStrategyV2);
  } catch {
    return fetchStrategies();
  }
}

/**
 * Resolve the strategies a wallet holds or manages: every status, including `closed` (POO-455).
 * Distinct from {@link listStrategies}. POO-721: reads the v2 `/strategies` catalog (the go-forward
 * replacement for v1 `/pools`), draining every lifecycle state so held/managed closed strategies still
 * resolve AND carry their manager-uploaded `logoUrl` (v1 `/pools` is on-chain-sourced and has no logo).
 * Chain-bound rows key by `positionId`, matching `position.strategyId`, so every holdings join is
 * unchanged; a v2 error degrades to the v1 `/pools` catalog. Mock uses the unfiltered list.
 */
export async function listStrategiesForHoldings(): Promise<Strategy[]> {
  return isMockMode ? mockStrategyService.listAll() : fetchV2HoldingsCatalogOrV1Fallback();
}

/**
 * POO-779 R4: the manager-console strategy LIST source, scoped to one manager's wallet. Replaces the
 * console's second full-catalog drain (`listStrategiesForHoldings`, POO-669) with the managerWallet
 * filter (POO-777): every lifecycle state (NO `lifecycle` filter, so a manager's closed strategy still
 * lists, POO-455) narrowed server-side to `managerWallet`.
 *
 * Returns the mapped `Strategy[]`, or `null` in real mode when the scoped read errors — the caller
 * ({@link getManagerConsoleAction}) then degrades to the legacy position-derived compose path (Q4), so
 * the console never blanks while POO-777 is being wired. Chain-bound rows key by `positionId`, the same
 * id space the console joins the positions on (yield/spark) and the vanished-pool recovery unions into.
 *
 * Mock mode returns the full mock catalog (the scoped-read stand-in); the caller joins it to the mock's
 * `isPoolManager` positions, preserving the current mock behavior (R5).
 */
export async function listManagedStrategies(managerWallet: string): Promise<Strategy[] | null> {
  if (isMockMode) return mockStrategyService.listAll();
  try {
    const rows = await drainPages(
      async (page, limit) => {
        // PP-INTEGRATION-POINT (POO-777): GET /api/v2/strategies?managerWallet=<wallet> — the indexed,
        // case-insensitive manager filter, NO lifecycle coupling (closed kept), server-paged. Assumed
        // contract per POO-777; built in parallel. On any error we return null (caller falls back).
        const result = await fetchStrategiesV2({ page, limit, managerWallet });
        return { items: result?.strategies ?? [], total: result?.totalItems };
      },
      { limit: DEFAULT_PAGE_LIMIT },
    );
    return rows.map(mapStrategyV2);
  } catch {
    // Q4: degrade to the legacy compose path rather than blanking the console or failing the render.
    return null;
  }
}

/**
 * Fetch a single strategy by id, or null when it does not exist. POO-778 R1: BOTH id shapes resolve
 * through a SINGLE v2 read that carries every enrichment (incl. the manager-uploaded logoUrl), retiring
 * the POO-741 drain-and-find workaround and taking the full-catalog drain off the detail path.
 * {@link fetchStrategyV2ById} shape-routes the request (POO-776): an owned UUID hits the UUID-only
 * `GET /api/v2/strategies/:id` (`ParseUUIDPipe`); a chain-bound `positionId` hits the dedicated,
 * case-insensitive `GET /api/v2/strategies/by-position/:positionId`. Both return the same
 * `{data: StrategyV2}` envelope, so the mapper and 404→null handling are identical.
 *
 * R3 (404 short-circuit): a clean v2 404 returns null WITHOUT the v1 3-network `/pools` drain — an
 * unknown id (bot / stale deep link) costs at most one upstream request. Only a genuine v2 ERROR (an
 * outage, not a 404) degrades to the v1 by-id read, preserving the POO-579 resilience.
 */
export async function getStrategyById(id: string): Promise<Strategy | null> {
  if (isMockMode) return mockStrategyService.getById(id);
  try {
    // PP-INTEGRATION-POINT (POO-776): `fetchStrategyV2ById` shape-routes the read — a UUID to the
    // UUID-only `GET /api/v2/strategies/:id`, a `0x`+64-hex positionId to the case-insensitive
    // `GET /api/v2/strategies/by-position/:positionId`. An unknown id 404s → it returns null.
    const row = await fetchStrategyV2ById(id);
    return row ? mapStrategyV2(row) : null;
  } catch {
    // A genuine v2 error (not a 404) degrades to the v1 `/pools` single read — an outage path, never
    // the unknown-id path (R3 keeps that a clean null above).
    return fetchStrategyById(id);
  }
}
