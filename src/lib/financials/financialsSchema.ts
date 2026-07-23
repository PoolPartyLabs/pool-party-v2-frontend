/**
 * @id PP-CORE-LIB-045
 * @name analytics /financials wire schemas
 * @implements-rules-version v1
 *
 * Zod schemas + inferred types for the POO-932 C9 serving layer: the ledger/snapshot-sourced
 * financial payloads served at `GET /analytics/wallets/:addr/financials` (investor, Part I fields
 * 1-9) and `GET /analytics/manager/:addr/financials` (manager, Part I fields 10-16). PP-CORE-LIB-048
 * (POO-990): these are the SOLE money source for FE v2 in real mode — the legacy `/metrics` path they
 * once shadowed was fully removed.
 *
 * C9 wire discipline (the reason these fields are `z.number().nullable()`, never coerced strings):
 * every USD/% value is a JSON number OR null. NULL is HONEST ABSENCE (an unpriced aggregate, a
 * shadow source the backfill has not populated yet) - it is NEVER $0. The FE must render a null as
 * an unavailable/loading affordance, never as a fabricated zero (POO-936 [R5] / POO-698 posture).
 * A malformed field on the wire degrades the WHOLE read to honest-empty in the fetcher (never a
 * blanked surface), so the schema itself is deliberately strict-shaped but null-tolerant per field.
 *
 * The serving layer guarantees the never-negative floor by construction (D1/D5) and routes any
 * clamp firing to its own C7 telemetry (`_assertions.windowClampActivations`); the FE therefore does
 * NOT re-clamp these values (POO-936 [R2]) - it may log a dev assertion if a served value is < 0.
 *
 * PP-INTEGRATION-POINT: analytics /financials serving contract ← pp-analytics FinancialsService
 * (POO-932). Field map + authoritative shape: financials.service.ts in Data_Analytics_PoolParty.
 */
import { z } from "zod";

/** A served USD/percent value: a JSON number, or null for honest absence (NEVER coalesced to 0). */
const servedNumber = z.number().nullable();

/** The 24h/7d/30d fee windows, each served nullable (a shadow-empty source serves null, not $0). */
const feeWindowsSchema = z.object({
  "24h": servedNumber,
  "7d": servedNumber,
  "30d": servedNumber,
});

/** The collected-fees windows the per-strategy block carries (adds the lifetime `all` window). */
const collectedWindowsSchema = z.object({
  "24h": servedNumber,
  "7d": servedNumber,
  "30d": servedNumber,
  all: servedNumber,
});

/**
 * The per-source freshness envelope (`last_updated`): one ISO-8601 string per shadow source, or null
 * when that source has produced nothing yet (honest null, never a fabricated `now()`). Tolerant to
 * extra/unknown source names so the contract can grow without failing the read.
 */
const lastUpdatedSchema = z.record(z.string(), z.string().nullable());

/**
 * One strategy's financials inside the investor `byStrategy` map (Part I field 8), keyed by the
 * on-chain position id (the SAME key the portfolio position `id` uses, so the share card + "Your
 * position" card look it up by the held position's id). Every money field is served nullable;
 * `feesEarned` is the per-window OUTER-clamped fees earned.
 */
export const strategyFinancialsSchema = z.object({
  /** Field 2 (per strategy): invested cost basis. NULL until the ledger movements populate. */
  invested: servedNumber,
  /** Field 5/8: current value (V now). */
  currentValue: servedNumber,
  /** Field 6: available / claimable (CL now, gross). */
  available: servedNumber,
  /** Field 3/8: total yield (collected net + claimable gross). */
  totalYield: servedNumber,
  /** Collected fees per window incl. lifetime `all`. */
  collectedFees: collectedWindowsSchema,
  /** Fees earned per window (D5/A4 outer-clamped by the serving layer). */
  feesEarned: feeWindowsSchema,
  /** True when any window used a provisional (rule (c)) start anchor. */
  provisional: z.boolean(),
});

/** One strategy's ledger/snapshot financials. */
export type StrategyFinancials = z.infer<typeof strategyFinancialsSchema>;

/**
 * The investor financials payload (Part I fields 1-9). Home + Portfolio + Strategy-detail read from
 * this ONE payload so Home and Portfolio necessarily share `totalYield` (identical values, [R1]).
 * Every money field is nullable; the FE renders null as unavailable, never $0 ([R5]).
 */
export const walletFinancialsSchema = z.object({
  /** The wallet the payload is scoped to (lowercased by the serving layer). */
  address: z.string(),
  /** Field 1 (Earned today) = the 24h fees-earned window, single OUTER clamp. */
  earnedToday: servedNumber,
  /** Fields 1/4/9 windows (Earned today / Last 30 days / Share windows). */
  feesEarned: feeWindowsSchema,
  /** Field 2 (Invested) - analytics is source of truth (D15); NULL until the ledger populates. */
  invested: servedNumber,
  /** Field 3/7 (Total Yield) - Home and Portfolio serve THIS SAME field ([R1]). */
  totalYield: servedNumber,
  /** Field 5 (Portfolio value) - Σ V incl. closed-unsettled. */
  portfolioValue: servedNumber,
  /** Field 6 (Available / claimable) aggregate - Σ CL(now) gross. */
  claimableGross: servedNumber,
  /** Snapshot coverage ratio (0..1), or null when unknown. */
  coverage: servedNumber,
  /** True when any per-strategy window used a provisional start anchor. */
  provisional: z.boolean(),
  /** Field 8: per-strategy financials keyed by on-chain position id. */
  byStrategy: z.record(z.string(), strategyFinancialsSchema),
  /** Per-source freshness stamps (honest null per empty source). */
  last_updated: lastUpdatedSchema,
  /**
   * C7 clamp telemetry: the cumulative count of OUTER-clamp firings the serving layer observed. On
   * clean data this stays 0; a non-zero value is a backend data bug (surfaced, never hidden). Tolerant
   * (optional) so a contract that drops it does not fail the read.
   */
  _assertions: z.object({ windowClampActivations: z.number() }).optional(),
});

/** The parsed investor financials payload. */
export type WalletFinancials = z.infer<typeof walletFinancialsSchema>;

/** One point of a manager server-provided series (field 16); the value is served nullable. */
const managerAumSeriesPointSchema = z.object({
  date: z.string(),
  valueUsd: servedNumber,
});
const managerFlowsPointSchema = z.object({
  date: z.string(),
  netFlowUsd: servedNumber,
});

/**
 * The manager financials payload (Part I fields 10-16). Each chart series is served from the SAME
 * table as its KPI (field 16), and the 30d change % is computed SERVER-SIDE (not FE-derived).
 */
export const managerFinancialsSchema = z.object({
  /** The manager wallet the payload is scoped to. */
  address: z.string(),
  /** Field 10 (Total AUM) - one source for the headline + chart (active only). */
  aum: servedNumber,
  /** Field 16: the AUM 30d change %, served server-side (null when no 30d-ago base). */
  aumChange30dPct: servedNumber,
  /** AUM snapshot coverage ratio (0..1), or null. */
  aumCoverage: servedNumber,
  /** Field 11 (Net inflows 30d, A3 override incl. the manager's own flows) - NULL until movements land. */
  netInflows30d: servedNumber,
  /** Field 12 (Yield generated) - G(all) + gross uncollected incl. closed-unsettled. */
  yieldGenerated: servedNumber,
  /** Field 15 (Performance fees, all-time) - Σ measured manager_receipt legs. */
  performanceFees: servedNumber,
  /** Field 15 (Performance fees, trailing 30d). */
  performanceFees30d: servedNumber,
  /** Field 13 (Active investors) - distinct, manager excluded. */
  activeInvestors: z.number(),
  /** Field 14 (Total investors, all-time) - distinct, manager excluded, monotonic. */
  totalInvestors: z.number(),
  /** Field 16 charts - each series from the SAME table as its KPI. */
  charts: z.object({
    aumSeries: z.array(managerAumSeriesPointSchema),
    flowsDaily: z.array(managerFlowsPointSchema),
  }),
  /** Per-source freshness stamps (honest null per empty source). */
  last_updated: lastUpdatedSchema,
});

/** The parsed manager financials payload. */
export type ManagerFinancials = z.infer<typeof managerFinancialsSchema>;
