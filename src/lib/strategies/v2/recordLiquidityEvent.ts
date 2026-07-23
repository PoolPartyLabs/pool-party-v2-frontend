/**
 * @id PP-STR-LIB-010 (POO-719 · POO-868)
 * @name recordLiquidityEvent
 * @implements-rules-version v2 (POO-719) · signature drop: POO-868 v2
 *
 * FIRE-AND-FORGET client callback that ledgers a confirmed liquidity operation (invest / withdraw /
 * remove / close) into pool-party-api's `strategy_liquidity_events` cost-basis ledger (POO-719
 * rules-v2). POO-868 [R1][R3]: NO wallet signature — the user already signed the operation on-chain,
 * and the API derives the event kind AND the wallet attribution from the receipt itself, so the
 * callback just posts `{txHash, network}` (public chain data; nothing here is trusted).
 *
 * EVERY failure is swallowed by design ([R12] phasing): a network hiccup or an API refusal (e.g.
 * price unavailable, 503) must never block or fail the user's already-confirmed on-chain operation.
 * Dropped writes are healed by the POO-822 reconciliation sweep. Collect-fees flows must NOT call
 * this ([R8] — the API would no-op it anyway).
 *
 * PP-INTEGRATION-POINT (POO-719): upstream write via {@link recordLiquidityEventAction}.
 */
import { recordLiquidityEventAction } from "./strategiesV2Actions";

export interface RecordLiquidityEventParams {
  /** Strategy identity: the strategies uuid OR the on-chain positionId (investor app default). */
  strategyRef: string;
  /** The CONFIRMED liquidity-operation tx hash (call only after the receipt succeeded). */
  txHash: string;
  /** The strategy's network slug (arbitrum / base / polygon). */
  network: string;
}

/**
 * Post the ledger callback. Resolves `true` when the write was accepted, `false` on ANY failure
 * (already logged) — callers never await-gate UX on this; invoke as `void recordLiquidityEvent(...)`
 * right after the receipt confirms.
 */
export async function recordLiquidityEvent(params: RecordLiquidityEventParams): Promise<boolean> {
  try {
    await recordLiquidityEventAction(params.strategyRef, {
      txHash: params.txHash,
      network: params.network,
    });
    return true;
  } catch (error) {
    // Swallowed by design: the on-chain operation already succeeded; POO-822 reconciles the ledger.
    console.warn("[PP] liquidity-event ledger callback failed (reconciliation will heal)", error);
    return false;
  }
}
