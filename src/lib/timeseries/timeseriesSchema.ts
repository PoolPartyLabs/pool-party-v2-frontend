/**
 * @id PP-CORE (POO-366)
 * @name analytics timeseries schemas
 * @implements-rules-version v1
 *
 * Zod schemas for the analytics value-over-time endpoints consumed by the charts:
 *   - pool AUM series   GET /analytics/pools/:id/timeseries      → { series: [{ date, value_usd }] }
 *   - wallet series     GET /analytics/wallets/:addr/timeseries  → { manager_aum: [{ date, value_usd }] }
 * Only the fields the chart maps read are declared; extras (e.g. n_positions, investor_portfolio) are
 * ignored. Postgres numerics can serialize as strings, so `value_usd` is coerced to a number.
 *
 * PP-INTEGRATION-POINT: response contract for the analytics timeseries endpoints (Data_Analytics PR #12).
 */
import { z } from "zod";

/**
 * One point of a value-over-time series. On the wire (verified against the live endpoint, POO-555
 * R8): `date` is a FULL ISO timestamp (e.g. `2026-06-19T00:00:00.000Z`, not a bare `YYYY-MM-DD`)
 * and `value_usd` is a Postgres numeric serialized as a string; `z.coerce.number` and the
 * downstream `new Date()` absorb both.
 */
export const timeseriesPointSchema = z.object({
  date: z.string(),
  value_usd: z.coerce.number(),
});
export type TimeseriesPoint = z.infer<typeof timeseriesPointSchema>;

/** `GET /analytics/pools/:id/timeseries` — the PP pool's AUM over time. */
export const poolTimeseriesSchema = z.object({
  series: z.array(timeseriesPointSchema),
});

/**
 * `GET /analytics/wallets/:addr/timeseries` — `manager_aum` is the manager's AUM over time;
 * `investor_portfolio` is the investor's TOTAL value across all positions over time (POO-368).
 * LIVE WIRE CONTRACT (verified against the deployed endpoint, POO-645): `investor_portfolio` is a
 * BARE ARRAY of points, matching `manager_aum`'s convention, and the envelope carries extras
 * (`address`, `granularity`, per-point `n_positions`). The union below also tolerates the legacy
 * object shapes this field once had (`{ series: [...] }` and the `{ note: "pending" }` stub) so a
 * backend rollback can never blank the charts again — a parse failure here degrades BOTH series to
 * [] in the fetcher, which is exactly the incident POO-645 fixed.
 */
export const walletTimeseriesSchema = z.object({
  manager_aum: z.array(timeseriesPointSchema).optional(),
  investor_portfolio: z
    .union([
      z.array(timeseriesPointSchema),
      z.object({ series: z.array(timeseriesPointSchema).optional() }).passthrough(),
    ])
    .optional(),
});
