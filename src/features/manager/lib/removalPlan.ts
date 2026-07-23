/**
 * @id PP-MGR-MOD (POO-312)
 * @name removalPlan
 * @implements-rules-version v1
 *
 * Pure decision for the manager remove-liquidity action: given the chosen percentage and the
 * manager's stake (USD), decide whether it's a partial remove or a full close, and the resulting
 * "new position amount". Manager rule (ported from pool-party-interface):
 *   - percentage strictly > 50 → close (full exit, swap to stable);
 *   - dust guard: if the remaining value would be 0 < remaining < $5 → close (can't leave dust);
 *   - otherwise → partial remove of `percentage`.
 * Kept pure (no React) so the threshold + dust logic is unit-tested independently of the modal.
 */

/** Below this remaining USD value a partial removal is promoted to a full close. */
export const DUST_FLOOR_USD = 5;
/** Above this percentage a manager removal becomes a full close. */
export const CLOSE_THRESHOLD_PCT = 50;

/** The resolved removal action. */
export interface RemovalPlan {
  /** True when the action is a full close (close-pool) rather than a partial remove. */
  closing: boolean;
  /** Effective removal percentage (100 when closing). */
  percentage: number;
  /** The position value remaining after the removal, in USD (0 when closing). */
  newAmountUsd: number;
}

/** Decide partial-vs-close for a manager removal of `percentage` from a `stakeUsd` position. */
export function planRemoval(percentage: number, stakeUsd: number): RemovalPlan {
  const stake = Math.max(0, stakeUsd);
  const remaining = stake * (1 - percentage / 100);
  const dust = remaining > 0 && remaining < DUST_FLOOR_USD;
  const closing = percentage > CLOSE_THRESHOLD_PCT || dust;
  return {
    closing,
    percentage: closing ? 100 : percentage,
    newAmountUsd: closing ? 0 : remaining,
  };
}

/**
 * POO-847 R4: the owned mobile WithdrawModal + useWithdraw share ONE close-promotion predicate so
 * the UI signal and the tx routing can never diverge. Given a USD removal amount and the position's
 * current USD value, it reuses {@link planRemoval} (same {@link CLOSE_THRESHOLD_PCT} / dust rule as
 * the desktop RemoveLiquidityModal) to decide whether the removal must promote to a FULL pool close:
 * a full/near-full exit, a removal strictly over 50%, or a dust remainder. A non-positive position
 * value never closes. This is the mobile mirror of the desktop POO-312 threshold, no divergent 50%.
 */
export function ownedRemovalClosesPool(amountUsd: number, currentValueUsd: number): boolean {
  if (!(currentValueUsd > 0)) return false;
  const percentage = Math.min(100, (amountUsd / currentValueUsd) * 100);
  return planRemoval(percentage, currentValueUsd).closing;
}
