/**
 * @id PP-MGR-CMP-107
 * @name raydiumPools
 * @description Pure logic for the Raydium CLMM pools that DEX Screener lists for one Solana token.
 * @linear https://linear.app/yeildbay/issue/POO-2343
 * @implements-rules-version v1 (POO-2343)
 * @analytics-events none, a data adapter. The Pools step emits its own events.
 *
 * This file has no network call. It checks the shape of a DEX Screener response (R5), keeps the
 * Raydium CLMM pairs (R2) and maps each pair to a `MandatePoolRef` (R3).
 *
 * DEX Screener gives no fee tier and no APR. Both stay null. This file never makes up a value.
 * Solana mints are case-sensitive, so no address is changed to lower case here.
 */
import { z } from "zod";
import type { MandatePoolRef } from "./mandateDraft";

const tokenSchema = z.object({
  address: z.string().min(1),
  symbol: z.string().min(1),
  name: z.string().optional(),
});

const pairSchema = z.object({
  dexId: z.string(),
  pairAddress: z.string().min(1),
  labels: z.array(z.string()).optional(),
  baseToken: tokenSchema,
  quoteToken: tokenSchema,
  liquidity: z.object({ usd: z.number().finite().nullish() }).nullish(),
});

/** The response of `token-pairs/v1/solana/{mint}`: a list of pairs. */
export const dexScreenerPairsSchema = z.array(pairSchema);

export type DexScreenerPair = z.infer<typeof pairSchema>;

/** Why a read failed. The Pools step shows its error state with Retry for each code. */
export type RaydiumPoolsErrorCode =
  | "invalid_input"
  | "unavailable"
  | "timeout"
  | "invalid_response";

/** R5: a typed result. A failure never throws and never looks like an empty list. */
export type RaydiumPoolsResult =
  | { ok: true; pools: MandatePoolRef[] }
  | { ok: false; error: { code: RaydiumPoolsErrorCode; status?: number } };

/** The label that DEX Screener puts on a Raydium concentrated liquidity pool. */
const CLMM_LABEL = "CLMM";
const RAYDIUM_DEX_ID = "raydium";

/** R5: returns the pairs when the shape is right, and null when it is not. */
export function parseDexScreenerPairs(body: unknown): DexScreenerPair[] | null {
  const parsed = dexScreenerPairsSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

function isRaydiumClmm(pair: DexScreenerPair): boolean {
  return pair.dexId === RAYDIUM_DEX_ID && (pair.labels ?? []).includes(CLMM_LABEL);
}

function holdsMint(pair: DexScreenerPair, mint: string): boolean {
  return pair.baseToken.address === mint || pair.quoteToken.address === mint;
}

function liquidityOf(pair: DexScreenerPair): number | null {
  return pair.liquidity?.usd ?? null;
}

/**
 * R2: the Raydium CLMM pairs for a search.
 *
 * With a second mint, a pair must hold both mints. A repeated pair address keeps its first row.
 * The result is sorted by liquidity in USD, high to low. A pair with no liquidity value goes last.
 */
export function selectRaydiumClmmPairs(
  pairs: readonly DexScreenerPair[],
  secondMint?: string,
): DexScreenerPair[] {
  const seen = new Set<string>();
  const kept: DexScreenerPair[] = [];
  for (const pair of pairs) {
    if (!isRaydiumClmm(pair)) continue;
    if (secondMint !== undefined && !holdsMint(pair, secondMint)) continue;
    if (seen.has(pair.pairAddress)) continue;
    seen.add(pair.pairAddress);
    kept.push(pair);
  }
  return kept.sort((a, b) => (liquidityOf(b) ?? -1) - (liquidityOf(a) ?? -1));
}

function side(token: DexScreenerPair["baseToken"]): MandatePoolRef["token0"] {
  return {
    address: token.address,
    symbol: token.symbol,
    name: token.name ?? token.symbol,
    logoUrl: null,
  };
}

/** R3: one DEX Screener pair to a mandate pool. Fee tier and APR stay null. */
export function mapRaydiumPair(pair: DexScreenerPair): MandatePoolRef {
  return {
    id: `solana:${pair.pairAddress}`,
    address: pair.pairAddress,
    network: "solana",
    protocol: "raydium",
    token0: side(pair.baseToken),
    token1: side(pair.quoteToken),
    feeBps: null,
    feeTier: null,
    tvlUsd: liquidityOf(pair),
    aprPct: null,
    tierSharePct: null,
    hasHook: false,
  };
}

/** R2 and R3: the pools of a search, ready for the Pools step. */
export function raydiumPoolsFromPairs(
  pairs: readonly DexScreenerPair[],
  secondMint?: string,
): MandatePoolRef[] {
  return selectRaydiumClmmPairs(pairs, secondMint).map(mapRaydiumPair);
}
