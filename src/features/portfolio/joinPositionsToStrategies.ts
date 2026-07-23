/**
 * @id PP-PORT-LIB-002 (POO-668)
 * @name joinPositionsToStrategies
 * @implements-rules-version v1
 *
 * The shared position→strategy join for the Portfolio reads. Each position resolves to a strategy via
 * the holdings catalog (richest data), then falls back to the strategy synthesized from the position's
 * own pool descriptor (POO-526 — closed/wound-down pools are absent from `/pools`, so a closed holding
 * has no catalog match and would otherwise be dropped). A position with neither is DROPPED, never shown
 * with fabricated data (no-mock-in-real).
 *
 * It PRESERVES the incoming order (POO-668 R2): the backend already orders the closed feed
 * closed-with-balance-first ("closed with funds on top"), so the join must not re-sort. This extracts
 * the join that `buildPortfolioViewModel` and `getClosedStrategiesAction` each did inline, so the paged
 * active + closed reads share one implementation.
 */
import type { Position, Strategy } from "@/lib/schemas";
import type { PortfolioViewPosition } from "./PortfolioView";

/**
 * Join positions to their strategies, preserving order and dropping the unresolvable.
 *
 * @param positions - The positions to join, IN THE ORDER they should render (backend order).
 * @param strategies - The holdings catalog (every status, incl. closed).
 * @returns One `{ position, strategy }` per resolvable position, in the input order.
 */
export function joinPositionsToStrategies(
  positions: Position[],
  strategies: Strategy[],
): PortfolioViewPosition[] {
  const strategyById = new Map(strategies.map((strategy) => [strategy.id, strategy]));
  return positions
    .map((position) => {
      const strategy = strategyById.get(position.strategyId) ?? position.fallbackStrategy;
      return strategy ? { position, strategy } : null;
    })
    .filter((entry): entry is PortfolioViewPosition => entry !== null);
}
