/**
 * @id PP-STR-LIB-005 (POO-638) · PP-STR-LIB-008 (POO-579) · POO-771 · POO-819 · POO-897
 * @name strategiesV2 schema
 * @implements-rules-version v1 (POO-579/POO-638) · v1 (POO-771: embedded manager identity) · v1 (POO-819: top-level lockupDays) · v1 (POO-897: onchain reserves + ticks) · v1 (POO-905: protocolFeePct)
 *
 * Zod contract for the pool-party-api v2 strategy reads (`GET /api/v2/strategies(/:id)`, POO-636,
 * DB-only join, public). Modeled against the LIVE `StrategiesV2ResponseDto` (pp-api origin/main
 * `src/strategies/dto/strategies-v2-response.dto.ts`): the paginated envelope key is `strategies`
 * (NOT `items`), and every per-item `onchain.blockNumber` is a decimal STRING (e.g. `'215000000'`) —
 * the refresher persists it as a bigint column and serializes it as a string. POO-638 needs the block
 * to observe deterministic convergence; POO-579 hardens the fuller row so {@link StrategyV2} feeds the
 * `mapStrategyV2` ACL that powers the v2 catalog swap.
 *
 * Resilience: fields the mapper reads are modeled TOLERANTLY (nullable/optional, `.passthrough()` on
 * the row) so a lean/slightly-off backend row never fails the whole list parse (the POO-316 lesson).
 * The two enums stay strict unions (no `.catch` — that diverges the schema's input/output types and
 * breaks `apiFetch`'s `ZodType<T>` generic); a genuinely out-of-contract enum value is caught one
 * level up, where the catalog reads fall back to the v1 `/pools` source.
 *
 * PP-INTEGRATION-POINT (POO-638/POO-579): strategy catalog + per-strategy onchain sync state <-
 * pool-party-api v2 (`/api/v2/strategies`, POO-636). Envelope `{ strategies, page, limit, totalItems,
 * networks[] }`; the single-id read returns one {@link StrategyV2} (no envelope).
 */
import { z } from "zod";
import { embeddedManagerIdentitySchema } from "@/lib/manager/managerIdentitySchema";

/** Manager-declared risk profile the v2 read exposes (mirrors pp-api `RiskProfile`). */
export const strategyV2RiskLevelSchema = z.enum(["steady", "dynamic", "wild"]);
/** A manager-declared risk profile. */
export type StrategyV2RiskLevel = z.infer<typeof strategyV2RiskLevelSchema>;

/**
 * The computed badge state the FE renders (pp-api `computeLifecycleState`, R5):
 *   - `pending` : authored off-chain, chain identity not yet bound.
 *   - `live`    : bound, readable, open (the only allocatable state).
 *   - `closed`  : owned-closed OR on-chain closed.
 *   - `missing` : a live position the refresher can no longer read on-chain.
 */
export const strategyLifecycleStateSchema = z.enum(["pending", "live", "closed", "missing"]);
/** A computed strategy lifecycle/badge state. */
export type StrategyLifecycleState = z.infer<typeof strategyLifecycleStateSchema>;

/** A pool currency descriptor. Every field is tolerated-absent so a lean row never drops the strategy. */
export const strategyV2CurrencySchema = z
  .object({
    address: z.string().nullable().optional(),
    symbol: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    decimals: z.number().nullable().optional(),
    imageUrl: z.string().nullable().optional(),
  })
  .passthrough();

/**
 * [R1] The DERIVED on-chain projection the refresher writes: the per-item staleness checkpoint
 * (`refreshedAt` + `blockNumber`) plus the market snapshot the catalog reads. `blockNumber` is a
 * decimal STRING on the wire (bigint column) — the convergence poll Number()-parses it before the
 * numeric compare. Null/absent for a `pending` strategy that has no state row yet.
 */
export const onchainStateSchema = z
  .object({
    refreshedAt: z.string().nullable().optional(),
    blockNumber: z.string().nullable().optional(),
    poolTvlUsd: z.number().nullable().optional(),
    dexPoolTvlUsd: z.number().nullable().optional(),
    feesApr: z.number().nullable().optional(),
    totalFeesInUsd: z.number().nullable().optional(),
    inRange: z.boolean().nullable().optional(),
    /**
     * POO-897 [R2]: the pool position's raw reserves (base-unit strings) + tick bounds/current tick,
     * ALREADY served by the live DTO (`StrategyOnchainDto.totalSupply0/1`, `tick*`) and previously
     * dropped unread. Feed the Composition per-token split (`positionTokenSplit`, with the range-math
     * tick fallback). Modeled tolerantly so a lean/older row never fails the list parse.
     */
    totalSupply0: z.string().nullable().optional(),
    totalSupply1: z.string().nullable().optional(),
    tickLower: z.number().nullable().optional(),
    tickUpper: z.number().nullable().optional(),
    tickCurrent: z.number().nullable().optional(),
    closed: z.boolean().nullable().optional(),
    // Serialized as a string (e.g. '1234'); occasionally a number.
    totalInvestors: z.union([z.string(), z.number()]).nullable().optional(),
    missingOnchain: z.boolean().nullable().optional(),
  })
  .passthrough();

/** A single v2 strategy row: owned identity + its optional derived `onchain` state. */
export const strategyV2Schema = z
  .object({
    /** Owned strategy UUID (stable identity; the v2 catalog id space). */
    id: z.string(),
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    logoUrl: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    riskLevel: strategyV2RiskLevelSchema.nullable().optional(),
    /** Manager fee in basis points. */
    managerFee: z.number().nullable().optional(),
    managerWallet: z.string().nullable().optional(),
    /** Access model; the live contract enumerates `public|private` but is modeled loosely. */
    access: z.string().nullable().optional(),
    /** Owned lifecycle status (`pending_onchain|live|closed|archived`); modeled loosely. */
    status: z.string().nullable().optional(),
    lifecycleState: strategyLifecycleStateSchema.nullable().optional(),
    chainId: z.number().nullable().optional(),
    network: z.string().nullable().optional(),
    positionId: z.string().nullable().optional(),
    tokenId: z.string().nullable().optional(),
    /**
     * The PP-managed position (pool) contract address — the invest `poolPartyPositionAddress`. Same DB
     * source (`cache.pool`) as the v1 `/pools` `pool` field, so `mapStrategyV2` maps it straight onto
     * `Strategy.pool`. Null on a pending row that has no chain identity yet.
     */
    poolAddress: z.string().nullable().optional(),
    /** Raw Uniswap fee tier (hundredths of a bip, e.g. 3000 = 0.30%). */
    feeTier: z.number().nullable().optional(),
    /**
     * POO-819 [R1]: the manager-declared lock-up in days before the principal can be withdrawn (`0` =
     * none), ALREADY exposed top-level on the live v2 DTO (`StrategiesV2ResponseDto.lockupDays`).
     * Modeled TOLERANTLY (nullable/optional) so an older payload that predates the field never fails
     * the whole list parse; {@link mapStrategyV2} reads it onto the FE `Strategy.lockupDays`.
     */
    lockupDays: z.number().nullable().optional(),
    /**
     * POO-905 [R2]: the protocol fee RATE in percent (0.25 today, the pp-api `PROTOCOL_FEE`
     * constant), served on v2 rows so the Invest Review can estimate the protocol fee BEFORE the
     * server build produces the authoritative `swapInfo.protocolFee`. Modeled TOLERANTLY
     * (nullable/optional): an older backend that predates the field never fails the parse and the
     * Review simply shows no line (R4). {@link mapStrategyV2} reads it onto `Strategy.protocolFeePct`.
     */
    protocolFeePct: z.number().nullable().optional(),
    creationTime: z.string().nullable().optional(),
    currency0: strategyV2CurrencySchema.nullable().optional(),
    currency1: strategyV2CurrencySchema.nullable().optional(),
    onchain: onchainStateSchema.nullable().optional(),
    /**
     * POO-771/POO-758: the PUBLIC manager identity the backend now embeds per row (`handle`,
     * `displayName`, `avatarUrl`, and the `managerVerification` enum `none|pending|valid`, the single
     * verified-badge source (POO-798) the mapper gates on `=== "valid"`), joined from the manager
     * registry. `null` when no profile matches the wallet. `.nullish()` so an older backend that omits it never fails the
     * whole list parse (POO-569/POO-698 drift lesson). {@link mapStrategyV2} reads it into the FE
     * `manager`/`managerHandle`/`managerAvatarUrl`/`managerVerified` fields.
     */
    manager: embeddedManagerIdentitySchema.nullish(),
  })
  .passthrough();

/**
 * The paginated v2 list envelope. `strategies` is required (a list endpoint returns a list; a
 * 204/empty upstream is handled as `null` by the fetcher). No Zod `.default()` here on purpose: a
 * default diverges the schema's input/output types and breaks `apiFetch`'s `ZodType<T>` generic.
 */
export const strategiesV2PageSchema = z.object({
  strategies: z.array(strategyV2Schema),
  page: z.number().optional(),
  limit: z.number().optional(),
  totalItems: z.number().optional(),
  networks: z.array(z.unknown()).optional(),
});

/** A single v2 strategy read result. */
export type StrategyV2 = z.infer<typeof strategyV2Schema>;
/** A page of the v2 strategy list. */
export type StrategiesV2Page = z.infer<typeof strategiesV2PageSchema>;
