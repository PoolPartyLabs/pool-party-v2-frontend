/**
 * @id PP-STR (POO-298)
 * @name revalidateStrategiesAction
 * @implements-rules-version v1
 *
 * Server Action that invalidates the cached strategy catalog. Call it after a mutation that changes
 * the catalog (a successful create-pool, invest, withdraw, collect) so the change shows immediately,
 * instead of waiting out the `revalidate` window. The browser invokes it; `revalidateTag` must run
 * server-side.
 *
 * Busts BOTH catalog data-caches: the v2 tag ({@link STRATEGIES_V2_CACHE_TAG}) that now backs the
 * Explore/discovery list + `getStrategyById` (POO-579), and the v1 tag ({@link STRATEGIES_CACHE_TAG})
 * that still backs the portfolio holdings resolver and the v1 fallback path. Dropping only the v1 tag
 * would leave the rendered discovery catalog stale under its 30s window after every write.
 */
"use server";

import { revalidateTag } from "next/cache";
import { STRATEGIES_CACHE_TAG } from "./fetchStrategies";
import { STRATEGIES_V2_CACHE_TAG } from "./v2/fetchStrategiesV2";

/** Drop both cached strategy catalogs (v2 discovery + v1 holdings/fallback) so the next read re-fetches. */
export async function revalidateStrategiesAction(): Promise<void> {
  revalidateTag(STRATEGIES_V2_CACHE_TAG);
  revalidateTag(STRATEGIES_CACHE_TAG);
}
