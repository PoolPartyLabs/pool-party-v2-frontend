/**
 * @id PP-STR-LIB-005 (POO-638)
 * @name fetchStrategiesV2
 * @implements-rules-version v1
 *
 * Server-side reads of the pool-party-api v2 strategy endpoints (POO-636, DB-only join, public):
 * `GET /api/v2/strategies` (list), the UUID-only `GET /api/v2/strategies/:id` (`ParseUUIDPipe`), and the
 * case-insensitive `GET /api/v2/strategies/by-position/:positionId` (POO-776/PR #79) that resolves a
 * chain-bound positionId — `fetchStrategyV2ById` shape-routes between the last two. Reused by POO-638
 * (deterministic convergence observes each touched strategy's `onchain.blockNumber`) and by POO-308
 * (the full v2 catalog wiring, stacked next).
 *
 * The per-id read is UNCACHED on purpose: the convergence poll must see the latest indexed block on
 * each observation, so a data-cache window would make it observe a stale block and never converge.
 * The list read is wallet-independent and slow-moving, so it takes a short revalidate window + tag
 * (the same throttle-avoidance rationale as {@link fetchStrategies}); POO-308 owns its consumers.
 *
 * PP-INTEGRATION-POINT: strategy catalog + per-strategy onchain sync state <- pool-party-api v2
 * (`/api/v2/strategies`, POO-636). The optional `lifecycle=live` filter (POO-667) narrows BOTH the
 * count and the rows to computed-live strategies server-side; omitted, the read is unchanged. A per-id
 * or per-positionId 404 -> null; other errors propagate.
 */
import "server-only";

import { ApiError, apiFetch } from "@/lib/api/client";
import {
  type StrategiesV2Page,
  type StrategyV2,
  strategiesV2PageSchema,
  strategyV2Schema,
} from "./strategiesV2Schema";

/**
 * Cache tag for the v2 catalog list reads. A write that changes a strategy (create/confirm) can
 * `revalidateTag(STRATEGIES_V2_CACHE_TAG)` so the change shows without waiting out the window.
 */
export const STRATEGIES_V2_CACHE_TAG = "strategies-v2";

/** Data-cache window (seconds) for the v2 list read. Short: collapses navigation bursts, stays fresh. */
const V2_LIST_REVALIDATE_SECONDS = 30;

/** A chain-bound positionId is `0x` + 64 hex (bytes32). Everything else routes as a UUID. */
const POSITION_ID_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Read a single v2 strategy by id, or null when it does not exist (404). UNCACHED so the convergence
 * poll always observes the latest indexed `onchain.blockNumber`.
 *
 * POO-776: `GET /api/v2/strategies/:id` is UUID-only (`ParseUUIDPipe` — a non-UUID 400s), so a
 * chain-bound positionId resolves via the dedicated, case-insensitive by-position route
 * (`GET /api/v2/strategies/by-position/:positionId`, PR #79). Both return the same `{data: StrategyV2}`
 * envelope, so the schema and the 404->null / error-propagate handling below are identical on either.
 */
export async function fetchStrategyV2ById(id: string): Promise<StrategyV2 | null> {
  const path = POSITION_ID_RE.test(id)
    ? `strategies/by-position/${id}`
    : `strategies/${encodeURIComponent(id)}`;
  try {
    return await apiFetch(path, { schema: strategyV2Schema, apiVersion: "v2" });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Query parameters for the v2 list read. All optional and narrowing — the endpoint returns every
 * network in one call (POO-636 R3); `network` narrows it, `riskProfile`/`search`/`sorting` mirror the
 * v1 `/pools/all` contract (verified in pp-api `strategies-v2-query.dto.ts`). Only provided params are
 * appended, so no empty `sorting=`/`search=` noise reaches the backend.
 */
export interface FetchStrategiesV2Params {
  /** Zero-based page index. */
  page?: number;
  /** Page size (backend default 100; the endpoint never silently caps a full-list drain). */
  limit?: number;
  /** Single-network filter (`arbitrum|base|polygon`). Omit for every network. */
  network?: string;
  /** Risk filter (`steady|dynamic|wild`). Omit for no filter. */
  riskProfile?: string;
  /**
   * Lifecycle filter (POO-667). `live` returns ONLY strategies whose computed `lifecycleState` is
   * `live` (backend `computeLifecycleState`: closed if `status==='closed'` OR `onchain.closed`, live
   * otherwise-with-onchain), applied to BOTH the count and the data query — so `totalItems` reflects
   * the filtered universe and pages are dense. Omit for every lifecycle state (unchanged default, so
   * other consumers are unaffected).
   */
  lifecycle?: string;
  /**
   * Pair-derived category filter (POO-894 [R1]), comma-separated tags out of
   * `bitcoin|ethereum|stablecoins|altcoins|meme` (e.g. `ethereum,bitcoin`), OR semantics across
   * values. The backend derives the pair's tags exactly like the FE `deriveAssetTags` (address-first
   * per POO-830 R1) and filters BOTH the count and the rows, so `totalItems` is honest across the
   * whole catalog. Omit for no filter. An unknown value is a backend 400 ([R3]); an OLDER deploy
   * without the param strips it (global `whitelist:true`) and returns the unfiltered page.
   */
  category?: string;
  /** Free-text search (name or token symbol). Omit for no search. */
  search?: string;
  /** Server sort spec `field:dir` (fields: `feesApr|inRange|tvlInUSD, plus riskLevel + totalInvestors (POO-726)`). Omit for the default order. */
  sorting?: string;
  /**
   * Manager-scope filter (POO-777/POO-779 R4): narrows the list to strategies whose `managerWallet`
   * matches (case-insensitive, indexed predicate on the backend). It carries NO implied lifecycle
   * (POO-777 R3), so it returns the manager's closed strategies too — this is what backs the manager
   * console list. Omit for every manager. A non-address value is a backend 400.
   */
  managerWallet?: string;
}

/** Read a page of the v2 strategy list with server-side paging/filter/sort (`page` zero-based). */
export async function fetchStrategiesV2(
  params?: FetchStrategiesV2Params,
): Promise<StrategiesV2Page | null> {
  const query = new URLSearchParams();
  if (params?.page !== undefined) query.set("page", String(params.page));
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  if (params?.network) query.set("network", params.network);
  if (params?.riskProfile) query.set("riskProfile", params.riskProfile);
  if (params?.lifecycle) query.set("lifecycle", params.lifecycle);
  // POO-894 [R1]: the server-side category filter (comma-separated, like `sorting`).
  if (params?.category) query.set("category", params.category);
  if (params?.search) query.set("search", params.search);
  if (params?.sorting) query.set("sorting", params.sorting);
  // PP-INTEGRATION-POINT (POO-777): the managerWallet filter on GET /api/v2/strategies. Assumed
  // contract: `?managerWallet=<addr>` returns only that manager's strategies (case-insensitive,
  // no implied lifecycle), composing with paging/sort/network. Public read (x-api-key), wallet as a
  // plain query filter (no per-user auth). Built in parallel under POO-777; until deployed the caller
  // (listManagedStrategies) degrades to the legacy compose path.
  if (params?.managerWallet) query.set("managerWallet", params.managerWallet);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";

  return apiFetch(`strategies${suffix}`, {
    schema: strategiesV2PageSchema,
    apiVersion: "v2",
    revalidate: V2_LIST_REVALIDATE_SECONDS,
    tags: [STRATEGIES_V2_CACHE_TAG],
  });
}
