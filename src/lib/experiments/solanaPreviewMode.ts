/**
 * @id PP-CORE-LIB-124
 * @name solanaPreviewMode
 * @implements-rules-version v2 (POO-2281)
 * @analytics-events none, pure gesture model. The mounted toggle owns mode events.
 */

export const SOLANA_PREVIEW_GESTURE_WINDOW_MS = 1_000;

/** No identity, permission, persisted family or financial draft participates in this gesture. */
export interface SolanaPreviewGesture {
  count: number;
  firstAt: number | null;
}

export function createSolanaPreviewGesture(): SolanaPreviewGesture {
  return { count: 0, firstAt: null };
}

/** Request a guarded activation after three explicit presses, then clear the burst. */
export function advanceSolanaPreviewGesture(
  gesture: SolanaPreviewGesture,
  now: number,
): { gesture: SolanaPreviewGesture; ready: boolean } {
  if (!Number.isFinite(now)) return { gesture: createSolanaPreviewGesture(), ready: false };
  const continuing =
    gesture.firstAt !== null &&
    now >= gesture.firstAt &&
    now - gesture.firstAt <= SOLANA_PREVIEW_GESTURE_WINDOW_MS;
  const count = continuing ? gesture.count + 1 : 1;
  if (count === 3) return { gesture: createSolanaPreviewGesture(), ready: true };
  return { gesture: { count, firstAt: continuing ? gesture.firstAt : now }, ready: false };
}
