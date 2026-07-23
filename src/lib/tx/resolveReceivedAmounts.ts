/**
 * @id PP-CORE-LIB-044 (POO-810)
 * @name resolveReceivedAmounts
 * @implements-rules-version v1
 *
 * The one call the invest/collect/withdraw executors make after a mined receipt to get the truthful
 * executed amounts (POO-810): it composes the three pure/injected primitives —
 *   {@link decodeExecutedAmounts} (sum ERC-20 `Transfer`-to-user per token, flag USDC),
 *   {@link resolveTokenMeta} (per leg: USDC config → position currency → on-chain read → drop),
 *   {@link buildReceivedLegs} (map to display rows + the USDC USD total).
 *
 * Returns `{ rows, usdcUsd }`: `rows` are the per-token receipt rows (USDC as USD, others as token
 * amounts, R3/R5/R6); `usdcUsd` is the summed USDC in USD (invest `deployed = requested − usdcUsd`,
 * R4; also the collect/withdraw USD body when the payout is all USDC). Empty/absent logs → the empty
 * result, so the caller falls back to the pre-broadcast figure (R9, never blank/$0).
 *
 * The on-chain read is injected (`readMeta`) so this unit-tests with fixture logs + a mock, and so it
 * stays client-safe (the executor injects a real `readErc20`-backed read at the call site).
 */
import { decodeExecutedAmounts, type ReceiptLog } from "./decodeExecutedAmounts";
import { buildReceivedLegs, type ReceivedLegsResult } from "./receivedAmounts";
import { type ReadTokenMeta, resolveTokenMeta, type TokenMeta } from "./resolveTokenMeta";

/** Inputs for {@link resolveReceivedAmounts}. */
export interface ResolveReceivedAmountsInput {
  /** The mined receipt's logs (absent/empty → empty result → R9 fallback at the call site). */
  logs: ReceiptLog[] | undefined | null;
  /** The user's wallet — only Transfers whose `to` matches count (R2). */
  userWallet: `0x${string}`;
  /** The chain the tx settled on (for on-chain meta reads). */
  chainId: number;
  /** The chain's native USDC address (undefined → no leg flagged USDC). */
  usdcAddress: `0x${string}` | undefined;
  /** The position's pool currencies for non-USDC leg resolution (R7); absent → on-chain read. */
  currencies: TokenMeta[] | undefined;
  /** The on-chain ERC-20 `{ symbol, decimals }` read (throws → that leg is dropped, R9). */
  readMeta: ReadTokenMeta;
}

/** Decode + resolve + present a mined receipt's executed amounts in one call (POO-810). */
export async function resolveReceivedAmounts({
  logs,
  userWallet,
  chainId,
  usdcAddress,
  currencies,
  readMeta,
}: ResolveReceivedAmountsInput): Promise<ReceivedLegsResult> {
  const { perToken } = decodeExecutedAmounts({ logs, userWallet, usdcAddress });
  if (perToken.length === 0) return { rows: [], usdcUsd: 0, hasUnpricedLeg: false };

  const resolved = await Promise.all(
    perToken.map(async (leg) => ({
      leg,
      meta: await resolveTokenMeta(leg, { chainId, currencies, readMeta }),
    })),
  );
  return buildReceivedLegs(resolved);
}
