/**
 * @id PP-MGR-LIB-026
 * @name blockConfig
 * @implements-rules-version v1 (POO-2184 rules v1); POO-2237 rules v1
 * @implements-rules-version v1 (POO-2301 shared local runtime extension)
 * @analytics-events none, a pure domain module: it types and checks a block's configuration and
 *   emits nothing.
 *
 * The contract between the configuration panels (POO-2171) and the launch adapter (`launch/plan.ts`,
 * PP-MGR-LIB-037), confirmed by the launch owner on 2026-10-04. It EXTENDS S1's
 * `PoolBlockConfig { poolId }` and `AaveBlockConfig { assetKey }` (`buildPlan.ts`) and renames
 * nothing:
 *
 * - Pool: `poolId` is the BARE Uniswap v4 PoolId (bytes32), never the Mandate row id
 *   `<chainId>:<poolId>`; `tickLower` and `tickUpper` are integers, canonical (token1 per token0)
 *   and on the pool's own tick spacing, Full range being the finite aligned extremes
 *   ({@link fullRangeTicks}); `fullRange` and `displayInverted` are booleans; `slippagePct` runs
 *   from 0.1 to 5 (the launch signs `maxLossBps` = slippagePct x 100, 10 to 500).
 * - Aave Supply: `assetKey` (`network:address`), plus `slippagePct` only when a swap is needed.
 * - The launch side refuses ticks off the catalog `tickSpacing` (`validateTickAlignment`).
 *
 * Two levels of "not right", on purpose:
 * - MALFORMED: a field of the wrong type or out of range, or both `poolId` and `assetKey`.
 *   {@link isConfigFor} says no, so `normalizePlan` keeps today's behaviour (the plan is
 *   unreadable) and `setBlockConfig` refuses to write what the reader would refuse.
 * - INCOMPLETE: a field not written yet (a pool picked, no range). It reads, and readiness
 *   (`planReadiness.ts`, PP-MGR-LIB-028) asks for it before Review ({@link isPoolConfigComplete}).
 *
 * Fields this module does not know are kept, as S1 promised the panel batch.
 *
 * The WRITE adds two rules that need the mandate row, so they live in `setBlockConfig` (and through
 * it `applyBlockConfig`): on a row with its pool key, the range must sit on the pool's grid
 * ({@link isRangeOnGrid}); and the stored ids are the row's own (`poolRefKey`, `tokenKey`), since
 * the launch compares them strictly.
 *
 * Layering: this module reads the slippage bounds from `panel/fundSlippage.ts`, which must never
 * import from `plan/` (that would make a cycle).
 */
import { MAX_TICK, MIN_TICK } from "@/lib/uniswap/tick";
import type { MandatePoolRef, NetworkId } from "../../mandateDraft";
import {
  FUND_SLIPPAGE_DEFAULT_PCT,
  FUND_SLIPPAGE_MAX_PCT,
  FUND_SLIPPAGE_MIN_PCT,
} from "../panel/fundSlippage";
import type { ManualSwapConfig, PoolBlockConfig } from "./buildPlan";

export type { AaveBlockConfig, PoolBlockConfig } from "./buildPlan";

/** The lowest max slippage a block takes: the panels' floor (`fundSlippage`, PP-MGR-LIB-030). */
export const BLOCK_SLIPPAGE_MIN_PCT = FUND_SLIPPAGE_MIN_PCT;

/** The highest: the launch signs a loss bound of at most 500 bps (`launch/plan.ts`). */
export const BLOCK_SLIPPAGE_MAX_PCT = FUND_SLIPPAGE_MAX_PCT;

/** The slippage after Use (handoff P7, P12): the launch flow's default. */
export const BLOCK_DEFAULT_SLIPPAGE_PCT = FUND_SLIPPAGE_DEFAULT_PCT;

/** A pool config with every field the launch reads: what Apply writes for a pool. */
export type CompletePoolBlockConfig = Required<PoolBlockConfig>;

/** Which configuration a value or a kind is: a pool's or an Aave block's. */
export type BlockConfigShape = "pool" | "aave" | "solana-local";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTick(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= MIN_TICK && (value as number) <= MAX_TICK;
}

function isSlippage(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= BLOCK_SLIPPAGE_MIN_PCT &&
    value <= BLOCK_SLIPPAGE_MAX_PCT
  );
}

/** Structural read gate; the write gate additionally checks mandate membership and distinctness. */
export function isManualSwapConfig(value: unknown): value is ManualSwapConfig {
  return (
    isRecord(value) &&
    typeof value.tokenInKey === "string" &&
    typeof value.tokenOutKey === "string" &&
    isSlippage(value.slippagePct) &&
    !("poolId" in value) &&
    !("assetKey" in value)
  );
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** An optional field: absent, or present with a value the check accepts. */
function optional(value: unknown, check: (value: unknown) => boolean): boolean {
  return value === undefined || check(value);
}

/** The shape a kind takes. Pendle and GMX take none yet (`BlockConfigByKind` is `never`). */
export function configShapeOfKind(kind: string): BlockConfigShape | null {
  if (kind.startsWith("solana")) return "solana-local";
  if (kind === "uniswapV4Pool" || kind === "uniswapV3Pool") return "pool";
  if (kind === "aaveSupply" || kind === "aaveBorrow") return "aave";
  return null;
}

/** The shape a value is by its keys: `poolId` xor `assetKey` (D14), or neither. */
export function configShapeOf(config: unknown): BlockConfigShape | null {
  if (!isRecord(config)) return null;
  if (typeof config.catalogId === "string" && !("poolId" in config) && !("assetKey" in config))
    return "solana-local";
  const pool = typeof config.poolId === "string";
  const aave = typeof config.assetKey === "string";
  if (pool && !aave) return "pool";
  if (aave && !pool) return "aave";
  return null;
}

/** The pool fields: integer ticks on the Uniswap range and in order, booleans, a 0.1..5 slippage. */
function poolFieldsValid(config: Record<string, unknown>): boolean {
  const { tickLower, tickUpper } = config;
  if (!optional(tickLower, isTick) || !optional(tickUpper, isTick)) return false;
  if (typeof tickLower === "number" && typeof tickUpper === "number" && tickLower >= tickUpper) {
    return false;
  }
  return (
    optional(config.fullRange, isBoolean) &&
    optional(config.displayInverted, isBoolean) &&
    optional(config.slippagePct, isSlippage)
  );
}

/**
 * Whether a stored config is one its kind takes (null, the empty block, always is): the right
 * shape, and every field it carries of the right type and range. Fields not written yet are fine
 * (INCOMPLETE is readiness's business); unknown fields are kept.
 */
export function isConfigFor(kind: string, config: unknown): boolean {
  if (config === null) return true;
  const shape = configShapeOfKind(kind);
  if (shape === null || configShapeOf(config) !== shape || !isRecord(config)) return false;
  if (shape === "solana-local") {
    const ids: Record<string, string> = {
      solanaOrcaPool: "solana:mainnet-beta:orca-whirlpools",
      solanaRaydiumPool: "solana:mainnet-beta:raydium-clmm",
      solanaKaminoSupply: "solana:mainnet-beta:kamino-supply",
      solanaHolding: "solana:mainnet-beta:holding",
    };
    return (
      config.catalogId === ids[kind] &&
      (config.pair === "SOL / USDC" || config.pair === "USDC / SOL") &&
      Object.keys(config).every((key) => key === "catalogId" || key === "pair")
    );
  }
  return shape === "pool" ? poolFieldsValid(config) : optional(config.slippagePct, isSlippage);
}

/**
 * Whether a pool config holds every field Apply writes, each one valid. Stricter than the launch on
 * purpose: `getLaunchSteps` reads neither `fullRange` nor `displayInverted`, but the panels always
 * write both, so a pool without them was not configured by a panel.
 */
export function isPoolConfigComplete(
  config: PoolBlockConfig | null,
): config is CompletePoolBlockConfig {
  if (config === null || !isConfigFor("uniswapV4Pool", config)) return false;
  return (
    config.tickLower !== undefined &&
    config.tickUpper !== undefined &&
    config.fullRange !== undefined &&
    config.displayInverted !== undefined &&
    config.slippagePct !== undefined
  );
}

/**
 * Full range on a pool's own tick spacing: the lowest and highest ticks that are multiples of it
 * (the launch's "finite aligned extremes"). Null for a spacing that is not a positive integer.
 */
export function fullRangeTicks(
  tickSpacing: number,
): { tickLower: number; tickUpper: number } | null {
  if (!Number.isInteger(tickSpacing) || tickSpacing <= 0) return null;
  return {
    tickLower: Math.ceil(MIN_TICK / tickSpacing) * tickSpacing,
    tickUpper: Math.floor(MAX_TICK / tickSpacing) * tickSpacing,
  };
}

/**
 * Whether a pool config's range sits on the pool's own grid (review M2 of PR #51): each tick it
 * carries is a multiple of `tickSpacing`, and `fullRange: true` comes with exactly the finite
 * aligned extremes ({@link fullRangeTicks}), as the launch checks (`validateTickAlignment`, the
 * fallback execution). A config with no ticks yet passes, unless it claims Full; a spacing that is
 * not a positive integer passes nothing that carries a range.
 */
export function isRangeOnGrid(config: PoolBlockConfig, tickSpacing: number): boolean {
  const full = fullRangeTicks(tickSpacing);
  const { tickLower, tickUpper } = config;
  if (full === null) {
    return tickLower === undefined && tickUpper === undefined && config.fullRange !== true;
  }
  const onGrid = (tick: number | undefined) => tick === undefined || tick % tickSpacing === 0;
  if (!onGrid(tickLower) || !onGrid(tickUpper)) return false;
  if (config.fullRange !== true) return true;
  return tickLower === full.tickLower && tickUpper === full.tickUpper;
}

/** What a pool config's `poolId` names in a mandate row: its bare PoolId, else its id (a mock). */
export function poolRefKey(pool: Pick<MandatePoolRef, "id" | "poolId">): string {
  return pool.poolId ?? pool.id;
}

/**
 * Finding 2, option A: the mandate pool a block's `poolId` names, inside the block's network. A
 * real-mode row (`mapV2Pool`: id `<chainId>:<poolId>`) answers to its bare PoolId only; a mock
 * row, which has no PoolId, to its id. Hex is compared without case.
 */
export function findMandatePool(
  pools: readonly MandatePoolRef[],
  network: NetworkId,
  poolId: string,
): MandatePoolRef | undefined {
  const wanted = poolId.toLowerCase();
  return pools.find(
    (pool) => pool.network === network && poolRefKey(pool).toLowerCase() === wanted,
  );
}
