/**
 * @id PP-MGR-CMP-061
 * @name panelIds
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, pure functions over the mandate rows
 *
 * The ids a configuration panel body writes (review M3 of PR #54). Rides on PP-MGR-CMP-061
 * (BlockPanel) and has no id of its own; `panelBodies.ts` re-exports it, so a body imports the
 * registry and these from one place.
 *
 * A config a body writes, and the ids it keys its select options by, are the mandate rows'
 * CANONICAL keys, the ones the reducer stores (`setBlockConfig`, PA1): {@link panelPoolId}
 * (`poolRefKey`: the bare lowercase v4 PoolId of a real row, never its row id `<chainId>:<poolId>`;
 * a mock row's id) and {@link panelAssetKey} (`tokenKey`: "network:address", lowercase). The shell
 * passes every config a body hands to Use or to `onConfigChange` through
 * {@link canonicalPanelConfig}, so a row id or another casing still lands as the canonical key.
 */
import {
  type MandateDraft,
  type MandatePoolRef,
  type MandateTokenRef,
  type NetworkId,
  tokenKey,
} from "../../mandateDraft";
import { poolRefKey } from "../plan/blockConfig";
import type { AaveBlockConfig, PoolBlockConfig } from "../plan/buildPlan";

/** The `poolId` a body writes for a mandate pool row, and keys its option by. */
export function panelPoolId(pool: Pick<MandatePoolRef, "id" | "poolId">): string {
  return poolRefKey(pool);
}

/** The `assetKey` a body writes for a mandate token row, and keys its option by. */
export function panelAssetKey(token: Pick<MandateTokenRef, "network" | "address">): string {
  return tokenKey(token);
}

/**
 * The config with its id turned into the mandate row's canonical key. A pool named by its
 * canonical key in any case, or by its row id (`<chainId>:<poolId>` in real mode), becomes
 * {@link panelPoolId} of that row; an asset named in any case becomes {@link panelAssetKey}. Rows of
 * other networks never match. An id the mandate does not hold here is left as written, and the
 * reducer refuses it (`not_in_mandate`), which the panel says.
 */
export function canonicalPanelConfig<C extends PoolBlockConfig | AaveBlockConfig>(
  config: C,
  where: { draft: Pick<MandateDraft, "pools" | "tokens">; network: NetworkId },
): C {
  if ("poolId" in config && typeof config.poolId === "string") {
    const wanted = config.poolId.toLowerCase();
    const row = where.draft.pools.find(
      (pool) =>
        pool.network === where.network &&
        (panelPoolId(pool).toLowerCase() === wanted || pool.id.toLowerCase() === wanted),
    );
    return row ? { ...config, poolId: panelPoolId(row) } : config;
  }
  if ("assetKey" in config && typeof config.assetKey === "string") {
    const wanted = config.assetKey.toLowerCase();
    const token = where.draft.tokens.find(
      (candidate) => candidate.network === where.network && panelAssetKey(candidate) === wanted,
    );
    return token ? { ...config, assetKey: panelAssetKey(token) } : config;
  }
  return config;
}
