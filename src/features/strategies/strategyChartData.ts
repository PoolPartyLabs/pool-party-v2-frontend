/**
 * @id PP-STR-SCR-002 (POO-300)
 * @name buildStrategyChartData
 * @implements-rules-version v2
 *
 * Pure builder for the strategy detail hero chart series — MOCK-MODE ONLY since POO-557 R3
 * (real mode plots the real pool AUM series or an explicit no-history state, never this).
 * Owned → series from invested→currentValue; discovery → a projection from the strategy's
 * estimated return. Points are intentionally date-less: the period tabs recognize that and
 * keep the legacy trailing-point slicing (POO-557 R4).
 *
 * PP-MOCK: synthetic series for the mock-mode design harness.
 * PP-INTEGRATION-POINT: real value series comes from the analytics timeseries endpoint (POO-366).
 */
import type { ChartPoint } from "@/components/data-display/PerformanceChart";
import type { Position, Strategy } from "@/lib/schemas";
import { toDailyChartPoints } from "@/mocks/data/portfolioSeries";

/** A smooth-ish value series from `start` → `end` for the hero chart (deterministic). */
function buildSeries(start: number, end: number, points = 9): number[] {
  return Array.from({ length: points }, (_, index) => {
    const t = index / (points - 1);
    const linear = start + (end - start) * t;
    const wiggle = Math.sin(t * Math.PI * 2) * (end - start) * 0.1;
    return Math.round((linear + wiggle) * 100) / 100;
  });
}

/** Build the labelled hero-chart series for a strategy, owned or discovery. */
export function buildStrategyChartData(
  position: Position | null,
  strategy: Strategy,
  locale: string,
): ChartPoint[] {
  const rawSeries = position
    ? buildSeries(position.invested, position.currentValue)
    : buildSeries(100, 100 * (1 + strategy.estReturn / 100));
  return toDailyChartPoints(rawSeries, locale);
}
