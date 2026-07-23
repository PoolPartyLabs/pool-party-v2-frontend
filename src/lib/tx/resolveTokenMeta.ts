/**
 * @id PP-CORE-LIB-042 (POO-810)
 * @name resolveTokenMeta
 * @implements-rules-version v1
 *
 * Resolve a decoded receipt leg's `{ decimals, symbol }` so the truthful-amounts receipt can scale
 * + label the non-USDC token amount (POO-810 R7). The resolution ladder, cheapest first:
 *   1. USDC leg → config: 6 decimals, "USDC" (the USD 1:1 case, always resolvable).
 *   2. Non-USDC leg → the position's non-USDC `currency` (by USDC-symbol elimination on the
 *      2-token pool), which already carries `{ symbol, decimals }` (positionsSchema `currency0/1`).
 *   3. Still unresolved → an on-chain ERC-20 `decimals()`/`symbol()` read (injected `readMeta`).
 *   4. Read fails → `undefined`; the caller drops that leg and R9-falls-back to the pre-broadcast
 *      figure rather than showing a wrong-scale amount.
 *
 * The on-chain read is injected (not imported) so this is a pure orchestrator that unit-tests with a
 * mocked read and no live chain. USDC identity comes from the decoder's `isUsdc` flag (already
 * matched against the chain's configured USDC address), so this needs no address list.
 */
import type { DecodedTransfer } from "./decodeExecutedAmounts";

/** A token's display metadata: how to scale (`decimals`) and label (`symbol`) its raw amount. */
export interface TokenMeta {
  symbol: string;
  decimals: number;
}

/** USDC is native 6-decimal on every supported chain (POO-810 R7 fast-path). */
const USDC_META: TokenMeta = { symbol: "USDC", decimals: 6 };

/** An on-chain ERC-20 metadata read for a token address (injected for testability). */
export type ReadTokenMeta = (token: `0x${string}`, chainId: number) => Promise<TokenMeta>;

/** Inputs for {@link resolveTokenMeta}. */
export interface ResolveTokenMetaOptions {
  /** The chain the token lives on (for the on-chain read). */
  chainId: number;
  /**
   * The position's pool currencies (`[currency0, currency1]`, each `{ symbol, decimals }`) when
   * available — the non-USDC leg is resolved from the one whose symbol is not "USDC". Absent on lean
   * reads → falls through to the on-chain read.
   */
  currencies: TokenMeta[] | undefined;
  /** The on-chain ERC-20 `{ symbol, decimals }` read (throws on RPC failure → undefined result). */
  readMeta: ReadTokenMeta;
}

/** Whether a currency symbol denotes USDC (case-insensitive). */
function isUsdcSymbol(symbol: string): boolean {
  return symbol.toUpperCase() === "USDC";
}

/** Resolve a decoded leg's `{ decimals, symbol }` (POO-810 R7); undefined when unresolvable (R9). */
export async function resolveTokenMeta(
  leg: DecodedTransfer,
  { chainId, currencies, readMeta }: ResolveTokenMetaOptions,
): Promise<TokenMeta | undefined> {
  // 1. USDC leg — always resolvable from config (the USD 1:1 case).
  if (leg.isUsdc) return USDC_META;

  // 2. The position's non-USDC currency, identified by USDC-symbol elimination on the 2-token pool.
  const nonUsdc = currencies?.filter((c) => !isUsdcSymbol(c.symbol)) ?? [];
  if (nonUsdc.length === 1 && nonUsdc[0]) return nonUsdc[0];

  // 3. On-chain read (decimals()/symbol()). 4. Failure → undefined (caller drops the leg, R9).
  try {
    return await readMeta(leg.address, chainId);
  } catch {
    return undefined;
  }
}
