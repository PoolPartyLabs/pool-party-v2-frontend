/**
 * @id PP-MGR-CMP-107
 * @name raydiumBlockPool
 * @description The pool of a Raydium block, taken from the Raydium pools of the mandate.
 * @linear https://linear.app/yeildbay/issue/POO-2343
 * @implements-rules-version v1 (POO-2343)
 * @analytics-events none, pure helpers.
 *
 * R7. A Raydium block keeps `poolAddress` and the pair label in its config. The pool comes from the
 * Raydium pools of the mandate. With no Raydium pool in the mandate, the block uses the SOL/USDC
 * pool {@link DEFAULT_RAYDIUM_POOL_ADDRESS}. Solana addresses are case-sensitive, so no address is
 * changed to lower case here.
 *
 * The pair label is one of the two labels that the Solana block config allows. A mandate pool with
 * any other pair is not a choice for the block.
 */
import type { SolanaLocalBlockConfig } from "../build/plan/buildPlan";
import type { MandateDraft } from "../mandateDraft";
import { USDC_MINT, WSOL_MINT } from "./solanaSchemas";

/** The SOL/USDC Raydium CLMM pool that a block uses when the mandate has no Raydium pool. */
export const DEFAULT_RAYDIUM_POOL_ADDRESS = "3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv";

/** The catalog id of the Raydium block. `SOLANA_LOCAL_CONFIGS` holds the same value. */
const RAYDIUM_CATALOG_ID = "solana:mainnet-beta:raydium-clmm";

export interface RaydiumBlockPool {
  poolAddress: string;
  pair: SolanaLocalBlockConfig["pair"];
}

function pairOf(token0: string, token1: string): SolanaLocalBlockConfig["pair"] | null {
  if (token0 === WSOL_MINT && token1 === USDC_MINT) return "SOL / USDC";
  if (token0 === USDC_MINT && token1 === WSOL_MINT) return "USDC / SOL";
  return null;
}

/** The Raydium pools of the mandate that the block can use, in mandate order, with no repeat. */
export function mandateRaydiumPools(draft: Pick<MandateDraft, "pools">): RaydiumBlockPool[] {
  const found = new Map<string, RaydiumBlockPool>();
  for (const pool of draft.pools) {
    if (pool.network !== "solana" || pool.protocol !== "raydium") continue;
    const pair = pairOf(pool.token0.address, pool.token1.address);
    if (pair && !found.has(pool.address))
      found.set(pool.address, { poolAddress: pool.address, pair });
  }
  return [...found.values()];
}

/** What the block can choose: the Raydium pools of the mandate, or the default pool without any. */
export function raydiumBlockPools(draft: Pick<MandateDraft, "pools">): RaydiumBlockPool[] {
  const pools = mandateRaydiumPools(draft);
  return pools.length > 0
    ? pools
    : [{ poolAddress: DEFAULT_RAYDIUM_POOL_ADDRESS, pair: "SOL / USDC" }];
}

/** The block config for one pool. */
export function raydiumBlockConfig(pool: RaydiumBlockPool): SolanaLocalBlockConfig {
  return { catalogId: RAYDIUM_CATALOG_ID, pair: pool.pair, poolAddress: pool.poolAddress };
}

/** The first choice of the block: the first Raydium pool of the mandate, or the default pool. */
export function defaultRaydiumBlockConfig(
  draft: Pick<MandateDraft, "pools">,
): SolanaLocalBlockConfig {
  const [first] = raydiumBlockPools(draft);
  if (!first) throw new Error("the Raydium block has no pool");
  return raydiumBlockConfig(first);
}

/** Whether a stored `poolAddress` is one the block may keep: a pool of the mandate, or the default. */
export function raydiumPoolInMandate(
  draft: Pick<MandateDraft, "pools">,
  poolAddress: string,
): boolean {
  return (
    poolAddress === DEFAULT_RAYDIUM_POOL_ADDRESS ||
    mandateRaydiumPools(draft).some((pool) => pool.poolAddress === poolAddress)
  );
}
