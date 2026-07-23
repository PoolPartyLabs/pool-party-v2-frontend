/**
 * @id PP-STR-LIB-011 (POO-810)
 * @name receiptDecode
 * @implements-rules-version v1
 *
 * The shared executor-side glue that turns a mined receipt into the truthful executed amounts for
 * the invest/collect/withdraw success receipts (POO-810). It bundles the two per-call concerns the
 * three hooks would otherwise duplicate:
 *   - `positionCurrencies`: the client `Position`'s per-token `{ symbol, decimals }` pair (from
 *     `claimableFeeTokens` symbols + `decimals0/1`), which the token-meta resolver eliminates USDC
 *     against for the non-USDC leg (R7).
 *   - `decodeReceipt`: resolve the chain's USDC address, run `resolveReceivedAmounts`, and return
 *     the display rows + USDC USD total — or `null` on ANY failure (empty logs, decode/RPC error),
 *     so the modal falls back to the pre-broadcast figure (R9, never blank/$0).
 *
 * PP-INTEGRATION-POINT: reads the real receipt logs (real mode only) — the executors call this after
 * `executeBuiltTransactionWithLogs`.
 */
"use client";

import { getUsdcAddress } from "@/lib/chains/config";
import type { Position } from "@/lib/schemas";
import { readErc20Meta } from "@/lib/tokens/readErc20";
import type { ReceiptLog } from "@/lib/tx/decodeExecutedAmounts";
import type { ReceivedLegsResult } from "@/lib/tx/receivedAmounts";
import { resolveReceivedAmounts } from "@/lib/tx/resolveReceivedAmounts";
import type { ReadTokenMeta, TokenMeta } from "@/lib/tx/resolveTokenMeta";

/**
 * The position's two pool-token metas (`[currency0, currency1]`) for the non-USDC leg resolution
 * (R7), or undefined when the per-token symbols/decimals are absent (lean read → the resolver falls
 * through to the on-chain read). Both a symbol AND a decimals are required per leg.
 */
export function positionCurrencies(position: Position): TokenMeta[] | undefined {
  const [token0, token1] = position.claimableFeeTokens ?? [];
  const { decimals0, decimals1 } = position;
  if (!token0 || !token1 || decimals0 == null || decimals1 == null) return undefined;
  return [
    { symbol: token0.symbol, decimals: decimals0 },
    { symbol: token1.symbol, decimals: decimals1 },
  ];
}

/** Inputs for {@link decodeReceipt}. */
export interface DecodeReceiptInput {
  /** The mined receipt's logs (empty/absent → null → R9 fallback). */
  logs: ReceiptLog[] | undefined | null;
  /** The user's wallet — only Transfers whose `to` matches count. */
  wallet: `0x${string}`;
  /** The chain the tx settled on. */
  chainId: number;
  /**
   * The position whose currencies resolve the non-USDC leg without an on-chain read (collect/
   * withdraw). Omitted for invest — the only decoded leg there is the always-resolvable USDC refund
   * (the resolver uses its config fast-path; any stray non-USDC leg on-chain-reads).
   */
  position?: Position;
  /** The on-chain ERC-20 meta read (defaults to the real `readErc20Meta`; injected in tests). */
  readMeta?: ReadTokenMeta;
}

/**
 * Decode a mined receipt into `{ rows, usdcUsd }`, or `null` on any failure (POO-810 R9). Swallows
 * every error: a truthful-amounts decode must never turn a successful transaction's receipt into a
 * thrown error — the modal shows the pre-broadcast figure instead.
 */
export async function decodeReceipt({
  logs,
  wallet,
  chainId,
  position,
  readMeta = readErc20Meta,
}: DecodeReceiptInput): Promise<ReceivedLegsResult | null> {
  if (!logs || logs.length === 0) return null;
  try {
    const result = await resolveReceivedAmounts({
      logs,
      userWallet: wallet,
      chainId,
      usdcAddress: getUsdcAddress(chainId),
      currencies: position ? positionCurrencies(position) : undefined,
      readMeta,
    });
    return result.rows.length > 0 ? result : null;
  } catch {
    return null;
  }
}
