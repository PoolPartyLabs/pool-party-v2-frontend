/**
 * @id PP-CORE-LIB-030 (POO-638)
 * @name blockConvergence
 * @implements-rules-version v1
 *
 * Deterministic post-write convergence primitives (POO-638, the POO-492 v2). A write's success flow
 * has the MINED receipt block from the wallet; the v2 read exposes each strategy's indexed
 * `onchain.blockNumber`. Convergence is therefore exact instead of a blind timeout:
 *
 *   [R1] converged(strategy) <=> onchain.blockNumber >= receipt.blockNumber.
 *
 * These are the pure, timer-free, React-free pieces the post-write poll is built from — the block
 * comparator, the per-strategy pending filter, the bounded backoff, and {@link nextConvergenceStep},
 * the single decision that folds the comparator together with the hard cap into one tick outcome.
 * The hook ({@link usePostWriteRefresh}) owns only the timers + cancellation around them.
 *
 * The confirm call (POO-307) fires first from the write flow ([R3]), so the backend has already been
 * asked to refresh the touched position by the time these observe; the poll never writes, it only
 * reads the v2 onchain block and decides whether to keep observing.
 */

/**
 * [R1] Base delay (ms) before the first convergence observation, and the growth base for the
 * exponential backoff. Short because the indexer usually catches up within a few seconds.
 */
export const CONVERGENCE_BASE_BACKOFF_MS = 1500;

/**
 * [R1] Ceiling (ms) for a single backoff step, so a long poll spaces its observations evenly instead
 * of growing without bound.
 */
export const CONVERGENCE_MAX_BACKOFF_MS = 12_000;

/**
 * [R1] Hard cap (ms) on the WHOLE convergence poll. If the indexed block never reaches the receipt
 * block within this window the poll gives up (rather than polling forever) and the last refetch stands.
 * Sits above the old blind ~45s fallback window so deterministic convergence has room to complete
 * first, replacing POO-492's blind POLL_DELAYS_MS that stopped at 13s.
 */
export const CONVERGENCE_CAP_MS = 45_000;

/**
 * [R1] Converged when the indexed on-chain block has caught up to (or passed) the mined receipt block.
 * A missing/null read (a strategy not yet on v2, or the indexer has not written it) is never converged.
 */
export function isBlockConverged(
  onchainBlock: number | null | undefined,
  receiptBlock: number,
): boolean {
  return onchainBlock != null && onchainBlock >= receiptBlock;
}

/**
 * [R1] The subset of `pending` strategy ids whose indexed block still lags the receipt block, given
 * the latest per-id reads. A converged id is dropped; a missing/null read stays pending.
 */
export function pendingStrategyIds(
  pending: string[],
  reads: Record<string, number | null | undefined>,
  targetBlock: number,
): string[] {
  return pending.filter((id) => !isBlockConverged(reads[id], targetBlock));
}

/**
 * [R1] Bounded exponential backoff (ms) before the next observation: `base * 2^attempt`, capped at
 * {@link CONVERGENCE_MAX_BACKOFF_MS}.
 */
export function convergenceBackoffMs(attempt: number): number {
  return Math.min(CONVERGENCE_BASE_BACKOFF_MS * 2 ** attempt, CONVERGENCE_MAX_BACKOFF_MS);
}

/** Inputs to {@link nextConvergenceStep} for one observation tick. */
export interface ConvergenceStepInput {
  /** The strategy ids still awaiting convergence coming into this tick. */
  pending: string[];
  /** The latest per-id indexed `onchain.blockNumber` read (null when unknown / not yet indexed). */
  reads: Record<string, number | null | undefined>;
  /** The mined receipt block the indexed blocks must reach. */
  targetBlock: number;
  /** Zero-based attempt index, drives the backoff for the NEXT tick. */
  attempt: number;
  /** Wall-clock elapsed (ms) since the poll started, checked against {@link CONVERGENCE_CAP_MS}. */
  elapsedMs: number;
}

/** The outcome of one convergence tick: either terminal (with a reason) or "poll again after N ms". */
export type ConvergenceStep =
  | { done: true; reason: "converged" | "capped" }
  | { done: false; pending: string[]; nextDelayMs: number };

/**
 * [R1] The single decision that drives the post-write poll. Given this tick's reads, it applies the
 * comparator (drop the converged strategies) and the hard cap:
 * - every strategy converged -> `{ done, reason: "converged" }` (convergence wins even at/after the cap);
 * - otherwise the cap reached -> `{ done, reason: "capped" }`;
 * - otherwise -> `{ done: false, pending, nextDelayMs }` to observe the still-lagging ids again.
 */
export function nextConvergenceStep(input: ConvergenceStepInput): ConvergenceStep {
  const remaining = pendingStrategyIds(input.pending, input.reads, input.targetBlock);
  if (remaining.length === 0) return { done: true, reason: "converged" };
  if (input.elapsedMs >= CONVERGENCE_CAP_MS) return { done: true, reason: "capped" };
  return { done: false, pending: remaining, nextDelayMs: convergenceBackoffMs(input.attempt) };
}
