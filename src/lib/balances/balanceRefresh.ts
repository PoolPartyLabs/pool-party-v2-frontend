/**
 * @id PP-BALANCES (POO-1128)
 * @name balanceRefresh
 * @implements-rules-version v1
 *
 * The wallet balance's invalidation channel ([R4], [R5]). Anything that moves the connected wallet
 * publishes here; the mounted {@link useTokenBalances} re-reads in place.
 *
 * Why a module-level subscriber set rather than `revalidateTag` or a context:
 * - The balance is read through a Server Action (the wallet identity comes from the SIWE cookie, not
 *   from the client), NOT a tagged `apiFetch` read, so there is no cache tag for a mutation to bust.
 * - The single consumer is `useTokenBalances`, whose state lives in the header's `WalletMenu`. The
 *   publishers are `usePostWriteRefresh` (called from operation modals rendered in portals, on
 *   several routes) and the deposit screen. A context would make every one of those depend on where
 *   a provider happens to be mounted, to relay one fire-and-forget signal.
 *
 * Mirrors the subscriber set in `lib/features/devOverrides.ts`, the existing precedent for this in
 * the codebase.
 */
const listeners = new Set<() => void>();

/**
 * Subscribe to balance-invalidation requests; returns an unsubscribe fn for the effect cleanup.
 * Every subscriber is expected to coalesce its own reads (see `useTokenBalances`).
 */
export function subscribeBalanceRefresh(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Ask every mounted balance reader to re-read. Fire-and-forget: callers are transaction success
 * paths, so a subscriber that throws (or unsubscribes mid-notification, which a modal unmounting on
 * success does) must never break the publisher or starve the subscribers after it. Hence the
 * snapshot and the per-listener catch.
 */
export function requestBalanceRefresh(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      // A broken reader must not turn a confirmed on-chain write into an error on screen.
      console.error("[balanceRefresh] subscriber failed", error);
    }
  }
}
