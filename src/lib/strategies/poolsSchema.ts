/**
 * @id PP-STR (POO-298)
 * @name pools API schema
 * @implements-rules-version v1 · v1 (POO-798: verified badge gated on managerVerification enum)
 *
 * Zod schema for the subset of the pool-party-api `GET /api/v1/pools?network={n}`
 * response that the strategy ACL consumes. Extra API fields are ignored (zod strips
 * unknown keys); only what {@link mapStrategy} reads is declared.
 *
 * POO-771/POO-758: gains the flat embedded manager-identity fields (`managerHandle` etc.), all
 * optional/nullish so the v1 fallback path degrades gracefully when the backend has not yet embedded
 * them (the FE then keeps wallet-only attribution). POO-798: adds the flat `managerVerification` enum
 * (`none | pending | valid`) — the badge source {@link mapStrategy} gates on `=== "valid"`.
 */
import { z } from "zod";
import { managerVerificationStatusSchema } from "@/lib/schemas";

/** A pool currency. The symbol drives the risk classifier; decimals/name are read by the manage-detail. */
const apiCurrencySchema = z.object({
  symbol: z.string(),
  decimals: z.number().optional(),
  name: z.string().optional(),
});

/** One pool (an LP position) as returned by pool-party-api. */
export const apiPoolSchema = z.object({
  /** The position address — becomes Strategy.id (D1: pool = strategy). */
  positionId: z.string(),
  /** Display name set by the manager. */
  name: z.string(),
  /** Plain-language description set by the manager at creation (stored alongside the name). Nullable. */
  description: z.string().nullable().optional(),
  /** Manager wallet address (no display name in the API). */
  poolManager: z.string(),
  /**
   * POO-771/POO-758 (R6): the manager's PUBLIC registry identity, embedded FLAT on the v1 `/pools`
   * and `/pools/all` rows (the v2-list error fallback + legacy drain). All optional/nullish so an
   * older backend that omits them never fails the pools parse and blank the catalog (POO-316/POO-569
   * drift lesson); {@link mapStrategy} reads them into `managerHandle`/`managerAvatarUrl`/
   * `managerVerified` and the `@handle` attribution. `managerDisplayName` is carried for contract
   * parity but never rendered in attributions (POO-757 R1).
   */
  managerHandle: z.string().nullish(),
  managerDisplayName: z.string().nullish(),
  managerAvatarUrl: z.string().nullish(),
  /**
   * POO-798 R2: the flat account-verification enum (`none | pending | valid`) — the badge source
   * {@link mapStrategy} gates on `=== "valid"`. Supersedes the legacy `managerVerified` boolean below
   * as the gate (still accepted for contract parity / older backends).
   */
  managerVerification: managerVerificationStatusSchema.nullish(),
  // PP-TODO(POO-809): remove once the backend drops the legacy field from the embed
  managerVerified: z.boolean().nullish(),
  /** Total value locked in USD. */
  poolTvlUsd: z.number(),
  /**
   * The underlying Uniswap pool's total value locked in USD (CoinGecko `reserve_in_usd`) — the deep
   * pool liquidity investors read as "TVL" (POO-390 R1/R4), distinct from `poolTvlUsd` (the PP-managed
   * position value that feeds the manager's AUM). Live today on `GET /pools` rows (the underlying dex
   * pool's `reserve_in_usd`); `.optional()` only tolerates lean/mock rows that omit it (renders a dash).
   */
  dexPoolTvlUsd: z.number().min(0).optional(),
  /** Fees APR (percent) — becomes estReturn with rateType "APR". */
  feesApr: z.number(),
  /** Investor count — serialized as a string (e.g. "0"); occasionally a number. */
  totalInvestors: z.union([z.string(), z.number()]),
  /** Whether the manager ended the pool. */
  closed: z.boolean(),
  /** First token of the pair. */
  currency0: apiCurrencySchema,
  /** Second token of the pair. */
  currency1: apiCurrencySchema,
  /**
   * API network slug the pool lives on (e.g. "arbitrum"). The legacy (v0.8.0) backend OMITS this on
   * list rows, so it must stay optional — keeping it required made the whole `pools?network=arbitrum`
   * response fail validation, which dropped every Arbitrum/Base pool from the catalog and, in turn,
   * hid investors' legacy positions behind the "make your first deposit" empty state on Home/Portfolio
   * (POO-316). `mapStrategy` fills it from the network slug `fetchStrategies` queried (the ground
   * truth) when the row leaves it out.
   */
  network: z.string().optional(),
  /** Pool contract address (Permit2 spender + poolPartyPositionAddress for invest). */
  pool: z.string(),
  // --- Manage-detail fields (present on the single-pool detail; optional on lean list rows). ---
  /** Fee tier label, e.g. "0.05%". */
  poolFeeTier: z.string().optional(),
  /** Whether the position sits inside its price range (real in/out-of-range). */
  inRange: z.boolean().optional(),
  /** Lifetime trading fees in USD. */
  totalFeesInUsd: z.number().optional(),
  /** Price-range ticks (for the POO-282 tick→price conversion, deferred). */
  tickLower: z.number().optional(),
  tickUpper: z.number().optional(),
  tickCurrent: z.number().optional(),
  /** The underlying Uniswap DEX pool contract address (NOT `pool`, which is the PP position /
   *  Permit2 spender). Drives the "View on Uniswap" link (#8). Absent on lean list rows / mock. */
  dexPoolAddress: z.string().optional(),
});

/** One API pool. */
export type ApiPool = z.infer<typeof apiPoolSchema>;

/** The `GET /pools` payload (after the `{ data }` envelope is unwrapped). */
export const apiPoolsResponseSchema = z.object({
  totalItems: z.number(),
  pools: z.array(apiPoolSchema),
});

/** The pools list response. */
export type ApiPoolsResponse = z.infer<typeof apiPoolsResponseSchema>;
