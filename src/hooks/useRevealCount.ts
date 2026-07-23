/**
 * @id PP-CORE-HOK-022 (POO-669, POO-670; promoted from PP-MGR-HOK-003)
 * @name useRevealCount
 * @implements-rules-version v1
 *
 * The client-side reveal counter behind a "Load more" over an already-loaded, non-server-paged list.
 * Born in the Manager Console (POO-669 [R1]) where the strategy lists are position-derived and
 * filtered client-side (see the view headers + the feature README), and promoted to a shared hook
 * (POO-670) for its SECOND consumer, the Admin queues, which are mock/thin-backed with NO backend
 * paging either. Both surfaces reveal over an already-loaded set, so paging is a pure client-side
 * reveal. This tiny hook holds the revealed row count: it starts at one page (5), grows a page per
 * {@link RevealCount.revealMore} call, and RESETS to the first page when `resetKey` changes (the
 * status-filter switch on the Manage tab, [R2] — mirroring POO-626's reset-on-filter identity
 * change). A queue with no filter omits `resetKey`, so its count only ever grows.
 *
 * DO-NOT-RESET (POO-628): the count is component state keyed only to `resetKey`, never to the data
 * array. A same-set 45s/focus/router.refresh refetch re-renders the view with a NEW strategies array
 * under the SAME filter identity, so the revealed count survives — the manager keeps everything they
 * had revealed instead of snapping back to 5. A `slice(0, count)` at the call site naturally clamps
 * when a refetch or filter yields fewer rows than are revealed, so no count clamping lives here.
 */
"use client";

import { useCallback, useRef, useState } from "react";

/** The default reveal page: the initial rows and the increment per "Load more" click ([R1]). A caller
 *  can override it per list (POO-752: the manager "My strategies" grid uses 6 to fill its 2 columns). */
export const PAGE_SIZE = 5;

/** The reveal-count handle returned by {@link useRevealCount}. */
export interface RevealCount {
  /** How many rows are currently revealed (a multiple of {@link PAGE_SIZE}). */
  count: number;
  /** Reveal one more page (+{@link PAGE_SIZE}). Wire to the "Load more" button. */
  revealMore: () => void;
  /** Force the reveal back to the first page (rarely needed; a `resetKey` change is the usual path). */
  reset: () => void;
}

/**
 * Client-side reveal counter for a "Load more" list.
 *
 * @param resetKey - When provided and it CHANGES between renders, the reveal resets to the first
 *   page (e.g. the active status filter on the Manage tab, [R2]). Omit it (the Overview has no
 *   filter) for a count that only ever grows via {@link RevealCount.revealMore}. A stable key across
 *   re-renders preserves the count (DO-NOT-RESET on a same-set refetch, POO-628).
 * @param pageSize - Rows per page: the first page AND the increment per reveal. Defaults to
 *   {@link PAGE_SIZE} (5); the manager "My strategies" grid passes 6 to fill its two columns evenly
 *   (POO-752 [R1]) without changing the other reveal surfaces.
 */
export function useRevealCount(resetKey?: string, pageSize: number = PAGE_SIZE): RevealCount {
  const [count, setCount] = useState(pageSize);
  const previousKey = useRef(resetKey);

  // Reset synchronously DURING render on a key change (the render-phase setState pattern) so the
  // first paint after a filter switch already shows the first page — no flash of the previous,
  // larger window. A stable key leaves this untouched, which is what preserves the count on refetch.
  if (resetKey !== previousKey.current) {
    previousKey.current = resetKey;
    setCount(pageSize);
  }

  const revealMore = useCallback(() => setCount((current) => current + pageSize), [pageSize]);
  const reset = useCallback(() => setCount(pageSize), [pageSize]);

  return { count, revealMore, reset };
}
