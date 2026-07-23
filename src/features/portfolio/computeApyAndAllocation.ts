/**
 * @id PP-PORT-LIB-004 (POO-668)
 * @name computeApyAndAllocation
 * @implements-rules-version v2
 *
 * The shared pure helper for the two Portfolio KPI figures the backend has NO grand aggregate for yet
 * (POO-696): the value-weighted average APY and the allocation-by-risk split. Extracted verbatim from
 * the inline math that lived in {@link buildPortfolioViewModel}, so the mock SSR path and the real
 * active-drain path (POO-668) compute them IDENTICALLY — one source of truth, no divergence.
 *
 * Client-safe + pure (no `server-only` import), so both the server-mock viewModel and the client
 * PortfolioPagedLoader can call it. It operates over positions already joined to their strategies
 * (via {@link joinPositionsToStrategies}); the caller passes the holdings it wants the figures over
 * (the active drained holdings in real mode; every joined position in the mock path).
 */
import type { AllocationSegment } from "./components/AllocationByRisk";
import type { PortfolioViewPosition } from "./PortfolioView";

/** The two computed figures the backend does not (yet, POO-696) serve as grand aggregates. */
export interface ApyAndAllocation {
  /** Value-weighted average APY: Σ(estReturn × currentValue) / Σ(currentValue). 0 when no value. */
  avgApy: number;
  /** Allocation-by-risk: current value summed per risk band, in the positions' insertion order. */
  allocation: AllocationSegment[];
}

/**
 * Compute the value-weighted average APY and the allocation-by-risk split over the given holdings.
 *
 * @param positions - Positions already joined to their strategies (the holdings to measure).
 * @returns The weighted `avgApy` (0 when the total current value is 0) and the per-band `allocation`.
 */
export function computeApyAndAllocation(positions: PortfolioViewPosition[]): ApyAndAllocation {
  const currentValue = positions.reduce((sum, entry) => sum + entry.position.currentValue, 0);

  // Value-weighted average APY: each holding's estReturn weighted by its current value.
  const avgApy =
    currentValue > 0
      ? positions.reduce(
          (sum, entry) => sum + entry.strategy.estReturn * entry.position.currentValue,
          0,
        ) / currentValue
      : 0;

  // Allocation by risk band (weighted by current value); insertion order preserved.
  const byRisk = new Map<number, number>();
  for (const entry of positions) {
    byRisk.set(
      entry.strategy.riskLevel,
      (byRisk.get(entry.strategy.riskLevel) ?? 0) + entry.position.currentValue,
    );
  }
  const allocation = Array.from(byRisk.entries()).map(([level, value]) => ({ level, value }));

  return { avgApy, allocation };
}
