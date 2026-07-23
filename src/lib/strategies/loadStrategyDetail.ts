/**
 * @id PP-STR-LIB-009 (POO-778)
 * @name loadStrategyDetail
 * @implements-rules-version v1
 *
 * Server-side data load for the strategy-detail route (`/strategies/[id]`). POO-778 R2: the analytics
 * AUM series and the strategy resolution have NO data dependency — the route param IS the series key
 * for chain-bound rows — so they are fired CONCURRENTLY here (one `Promise.all`) instead of the old
 * waterfall where the series fetch waited for the whole resolution chain to settle. This is the top
 * deep link in the app; collapsing the serial RTTs is the biggest latency win.
 *
 * Resolution ({@link resolveDetailStrategy}) does the single-request v2 read (R1) plus the signed-in
 * closed/held positions fallback (R4). The series read ({@link fetchPoolTimeseries}) never throws (it
 * degrades to []), so a null/short series simply yields no chart — the page maps it locale-aware. A
 * resolution error still propagates (real error boundary); an unknown id resolves to a null strategy
 * so the page can `notFound()` (R3).
 */
import "server-only";

import type { Strategy } from "@/lib/schemas";
import { fetchPoolTimeseries } from "@/lib/timeseries/fetchPoolTimeseries";
import type { TimeseriesPoint } from "@/lib/timeseries/timeseriesSchema";
import { resolveDetailStrategy } from "./resolveDetailStrategy";

/** The concurrently-resolved page data: the strategy (null → 404) and its raw AUM series. */
export interface StrategyDetailPageData {
  /** The resolved strategy, or null when the id is unknown and not held (the page 404s). */
  strategy: Strategy | null;
  /** The raw pool AUM series (wallet-independent); [] on empty/missing/error. Mapped in the page. */
  series: TimeseriesPoint[];
}

/**
 * Resolve the strategy and its AUM series concurrently for the detail page. [R2] both reads start
 * together (the series is keyed on the raw route `id`), so the analytics fetch is in flight before
 * resolution completes rather than stacked behind it.
 */
export async function loadStrategyDetail(id: string): Promise<StrategyDetailPageData> {
  const [strategy, series] = await Promise.all([
    resolveDetailStrategy(id),
    fetchPoolTimeseries(id),
  ]);
  return { strategy, series };
}
