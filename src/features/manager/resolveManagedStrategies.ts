/**
 * @id PP-MGR-LIB-014 (POO-779)
 * @name resolveManagedStrategies
 * @implements-rules-version v3
 *
 * R4 (v3) core, pure: resolve the manager-console strategy LIST from the managerWallet-scoped v2 read
 * UNION any vanished-but-held managed pool recovered from the wallet's already-fetched positions.
 *
 * Before R4 the console list was `portfolio drain (isPoolManager) ⋈ FULL catalog drain
 * (listStrategiesForHoldings) + client filter` — two independent full compositions per load (POO-669).
 * R4 makes the list come from `GET /api/v2/strategies?managerWallet=<wallet>` (server-paged, POO-777),
 * killing the catalog drain. The positions read stays ONLY for the AUM/fees tiles (live amounts), so
 * recovering a vanished pool from those already-in-memory positions costs nothing.
 *
 * Why the union (Q2): a managed pool that wound down and dropped out of the indexer (POO-373 `missing`)
 * may be absent from the scoped read, but the manager's own console must still list it (POO-455/537).
 * The held position carries a `fallbackStrategy` synthesized from its own pool descriptor (POO-526), so
 * a managed (`isPoolManager`) position whose strategy is not in the scoped read is recovered and unioned
 * in. Deduped by strategy id, the scoped-read row wins on conflict — so if POO-777 DOES return `missing`
 * rows the union is a harmless no-op, and if it does not, parity is preserved regardless.
 */
import type { Position, Strategy } from "@/lib/schemas";

/**
 * The managed-strategy list for the manager console: the scoped-read strategies, plus any managed
 * (`isPoolManager`) position's `fallbackStrategy` whose id is not already present (a vanished-but-held
 * pool), deduped by id with the scoped-read row winning. Order: scoped-read rows first (their server
 * ordering preserved), then recovered rows in position order.
 */
export function resolveManagedStrategies(
  scopedStrategies: Strategy[],
  positions: Position[],
): Strategy[] {
  const byId = new Map<string, Strategy>();
  // Scoped-read rows are the authoritative base and win on any id conflict.
  for (const strategy of scopedStrategies) {
    if (!byId.has(strategy.id)) byId.set(strategy.id, strategy);
  }
  // Recover a vanished-but-held managed pool from the wallet's own held position (POO-526 fallback).
  // Only `isPoolManager` positions contribute, and only when the scoped read did not already cover the
  // strategy — so a plain investor holding is never promoted and a covered pool is never duplicated.
  for (const position of positions) {
    if (position.isPoolManager !== true) continue;
    const fallback = position.fallbackStrategy;
    if (!fallback || byId.has(fallback.id)) continue;
    byId.set(fallback.id, fallback);
  }
  return [...byId.values()];
}

/**
 * The LEGACY position-derived composition, preserved verbatim from the pre-R4 `buildManagerConsole`
 * row resolution. Used for two paths that must keep the old behavior exactly (R5 mock mode + the Q4
 * real-mode scoped-read-error fallback): the managed list is the wallet's `isPoolManager` positions
 * joined to the (mock holdings) catalog by id, falling back to the position's own `fallbackStrategy`
 * (POO-526) when the catalog omits it, deduped by id (catalog row wins), dropping a position that
 * resolves to neither (never fabricated). This is NOT the R4 scoped-read path — it is the baseline.
 */
export function composeManagedFromPositions(
  catalog: Strategy[],
  positions: Position[],
): Strategy[] {
  const catalogById = new Map(catalog.map((strategy) => [strategy.id, strategy]));
  const byId = new Map<string, Strategy>();
  for (const position of positions) {
    if (position.isPoolManager !== true) continue;
    const strategy = catalogById.get(position.strategyId) ?? position.fallbackStrategy;
    if (!strategy || byId.has(strategy.id)) continue;
    byId.set(strategy.id, strategy);
  }
  return [...byId.values()];
}
