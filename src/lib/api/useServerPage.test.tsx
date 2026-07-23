/**
 * @id PP-CORE-HOK-021 (POO-666, POO-668)
 * @name useServerPage tests
 * @implements-rules-version v1
 *
 * The client "Load more" state machine over an injected page loader.
 * [R5] first page loads on mount; items/total/hasMore reflect it.
 * [R6] loadMore appends the NEXT page (accumulates, never replaces).
 * [R7] hasMore = (page+1)*limit < total; false once the last page is in.
 * [R8] reset() drops back to page 0 and re-runs the loader (new filter/sort/search set).
 * [R9] loading flips true during a fetch and false after.
 * [R10] a loader rejection surfaces as `error` without wiping the accumulated items.
 *
 * POO-668 additions:
 * - SHORT-PAGE termination (`pageMode: "short-page"`): hasMore derives from the LAST page length, not
 *   the (phantom) grand total. A full last page → more; a short/empty page → end.
 * - `refresh()`: re-reads pages 0..current in place and REPLACES them without dropping the cursor —
 *   the 45s / focus / post-write refresh path. Same ids after a refresh is NOT a reset (R4).
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useServerPage } from "./useServerPage";

/** A fake 3-page backend of `total` rows served in `pageSize` slices. */
function makeBackend(total: number, pageSize: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: `row-${i}` }));
  const loadPage = vi.fn(async (page: number) => ({
    items: rows.slice(page * pageSize, page * pageSize + pageSize),
    total,
  }));
  return { rows, loadPage };
}

describe("useServerPage", () => {
  // @rule R5 @rule R7
  it("[R5][R7] loads the first page on mount and reports hasMore", async () => {
    const { loadPage } = makeBackend(250, 5);
    const { result } = renderHook(() => useServerPage({ loadPage, pageSize: 5 }));

    await waitFor(() => expect(result.current.items).toHaveLength(5));
    expect(result.current.total).toBe(250);
    expect(result.current.hasMore).toBe(true);
    expect(loadPage).toHaveBeenCalledWith(0);
  });

  // @rule R6 @rule R7
  it("[R6] loadMore appends the next page and advances through all 3 pages", async () => {
    const { loadPage } = makeBackend(12, 5);
    const { result } = renderHook(() => useServerPage({ loadPage, pageSize: 5 }));

    await waitFor(() => expect(result.current.items).toHaveLength(5));

    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.items).toHaveLength(10);
    expect(result.current.items.map((r) => r.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `row-${i}`),
    );
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.loadMore();
    });
    // @rule R7: last (short) page → 12 rows, no more.
    expect(result.current.items).toHaveLength(12);
    expect(result.current.hasMore).toBe(false);
    expect(loadPage).toHaveBeenLastCalledWith(2);
  });

  // @rule R8
  it("[R8] reset drops to page 0, replaces items, and re-runs the loader", async () => {
    const { loadPage } = makeBackend(12, 5);
    const { result } = renderHook(() => useServerPage({ loadPage, pageSize: 5 }));
    await waitFor(() => expect(result.current.items).toHaveLength(5));

    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.items).toHaveLength(10);

    await act(async () => {
      result.current.reset();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(5));
    // The last loader call after reset requests page 0 again.
    expect(loadPage).toHaveBeenLastCalledWith(0);
  });

  // @rule R8
  it("[R8] re-runs when the loader identity changes (a new filter/sort/search set)", async () => {
    const first = makeBackend(3, 5);
    const { result, rerender } = renderHook(
      ({ loadPage }) => useServerPage({ loadPage, pageSize: 5 }),
      {
        initialProps: { loadPage: first.loadPage },
      },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(3));

    const second = makeBackend(2, 5);
    // A new loader fn models a changed filter tuple; the hook must re-fetch page 0 with it.
    rerender({ loadPage: second.loadPage });
    await waitFor(() => expect(second.loadPage).toHaveBeenCalledWith(0));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
  });

  // @rule R10
  it("[R10] surfaces an initial-load error", async () => {
    const loadPage = vi.fn(async () => {
      throw new Error("initial-boom");
    });
    const { result } = renderHook(() => useServerPage({ loadPage, pageSize: 5 }));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  // @rule R8: a reset while an initial load is still pending discards the stale result (race guard).
  it("[R8] a reset supersedes an in-flight initial load", async () => {
    let resolveFirst: ((v: { items: { id: string }[]; total: number }) => void) | undefined;
    const loadPage = vi.fn((page: number) => {
      if (page === 0 && !resolveFirst) {
        return new Promise<{ items: { id: string }[]; total: number }>((r) => {
          resolveFirst = r;
        });
      }
      return Promise.resolve({ items: [{ id: "fresh" }], total: 1 });
    });
    const { result } = renderHook(() => useServerPage({ loadPage, pageSize: 5 }));

    await act(async () => {
      result.current.reset();
    });
    await waitFor(() => expect(result.current.items).toEqual([{ id: "fresh" }]));
    await act(async () => {
      resolveFirst?.({ items: [{ id: "stale" }], total: 99 });
    });
    expect(result.current.items).toEqual([{ id: "fresh" }]);
    expect(result.current.total).toBe(1);
  });

  // @rule R7
  it("[R7] loadMore is a no-op once there is nothing more to load", async () => {
    const { loadPage } = makeBackend(3, 5); // single short page → hasMore false.
    const { result } = renderHook(() => useServerPage({ loadPage, pageSize: 5 }));
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(result.current.hasMore).toBe(false);

    await act(async () => {
      await result.current.loadMore();
    });
    expect(loadPage).toHaveBeenCalledTimes(1);
  });

  // @rule R6
  it("[R6] loadMore is a no-op while a load is already in flight", async () => {
    let resolveFirst: ((v: { items: { id: string }[]; total: number }) => void) | undefined;
    let calls = 0;
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `row-${i}` }));
    const loadPage = vi.fn((page: number) => {
      calls += 1;
      if (calls === 1) {
        return new Promise<{ items: { id: string }[]; total: number }>((r) => {
          resolveFirst = r;
        });
      }
      return Promise.resolve({ items: rows.slice(page * 5, page * 5 + 5), total: 12 });
    });
    const { result } = renderHook(() => useServerPage({ loadPage, pageSize: 5 }));

    await act(async () => {
      await result.current.loadMore();
    });
    expect(loadPage).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFirst?.({ items: rows.slice(0, 5), total: 12 });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(5));
  });

  // @rule R8: a reset while a loadMore is in flight discards the stale next page (race guard).
  it("[R8] a reset supersedes an in-flight loadMore (the stale page is dropped)", async () => {
    let resolveMore: ((v: { items: { id: string }[]; total: number }) => void) | undefined;
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `row-${i}` }));
    const loadPage = vi.fn((page: number) => {
      if (page === 1 && !resolveMore) {
        return new Promise<{ items: { id: string }[]; total: number }>((r) => {
          resolveMore = r;
        });
      }
      return Promise.resolve({ items: rows.slice(page * 5, page * 5 + 5), total: 12 });
    });
    const { result } = renderHook(() => useServerPage({ loadPage, pageSize: 5 }));
    await waitFor(() => expect(result.current.items).toHaveLength(5));

    let morePromise: Promise<void> | undefined;
    await act(async () => {
      morePromise = result.current.loadMore();
    });
    await act(async () => {
      result.current.reset();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(5));

    await act(async () => {
      resolveMore?.({ items: rows.slice(5, 10), total: 12 });
      await morePromise;
    });
    expect(result.current.items).toHaveLength(5);
    expect(result.current.items.map((r) => r.id)).toEqual([
      "row-0",
      "row-1",
      "row-2",
      "row-3",
      "row-4",
    ]);
  });

  // @rule R9
  it("[R9] exposes loading during the initial fetch", async () => {
    let resolve: ((v: { items: { id: string }[]; total: number }) => void) | undefined;
    const loadPage = vi.fn(
      () => new Promise<{ items: { id: string }[]; total: number }>((r) => (resolve = r)),
    );
    const { result } = renderHook(() => useServerPage({ loadPage, pageSize: 5 }));

    await waitFor(() => expect(result.current.loading).toBe(true));
    await act(async () => {
      resolve?.({ items: [{ id: "a" }], total: 1 });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(1);
  });

  // @rule R10
  it("[R10] surfaces a loader error and keeps the accumulated items", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `row-${i}` }));
    const loadPage = vi.fn(async (page: number) => {
      if (page === 1) throw new Error("boom");
      return { items: rows.slice(0, 5), total: 12 };
    });
    const { result } = renderHook(() => useServerPage({ loadPage, pageSize: 5 }));
    await waitFor(() => expect(result.current.items).toHaveLength(5));

    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    // The already-loaded page is not lost by the failing loadMore.
    expect(result.current.items).toHaveLength(5);
    expect(result.current.loading).toBe(false);
  });
});

/** A short-page backend of `total` rows served in `pageSize` slices; the total is NOT used for hasMore. */
function makeShortPageBackend(total: number, pageSize: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: `row-${i}` }));
  const loadPage = vi.fn(async (page: number) => ({
    items: rows.slice(page * pageSize, page * pageSize + pageSize),
    // A deliberately WRONG (phantom) total — short-page mode must ignore it entirely.
    total: 9999,
  }));
  return { rows, loadPage };
}

describe("useServerPage — SHORT-PAGE termination (POO-668, pageMode: 'short-page')", () => {
  // @rule R1 @rule R2: hasMore is true while the last page was full, ignoring the phantom total.
  it("[R1] reports hasMore from the last page length, NOT the (phantom) total", async () => {
    const { loadPage } = makeShortPageBackend(12, 5);
    const { result } = renderHook(() =>
      useServerPage({ loadPage, pageSize: 5, pageMode: "short-page" }),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(5));
    // Page 0 was full (5 === limit) → more, even though total is 9999 (phantom).
    expect(result.current.hasMore).toBe(true);
  });

  // @rule R1 @rule R2: advancing to a short page ends the feed.
  it("[R1] advances until a SHORT page, then stops (hasMore false)", async () => {
    const { loadPage } = makeShortPageBackend(12, 5);
    const { result } = renderHook(() =>
      useServerPage({ loadPage, pageSize: 5, pageMode: "short-page" }),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(5));

    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.items).toHaveLength(10);
    expect(result.current.hasMore).toBe(true); // page 1 was full (5)

    await act(async () => {
      await result.current.loadMore();
    });
    // Page 2 is short (2 rows) → the end.
    expect(result.current.items).toHaveLength(12);
    expect(result.current.hasMore).toBe(false);
    expect(loadPage).toHaveBeenLastCalledWith(2);
  });

  // @rule R1: an exactly-full final page needs ONE more (empty) read to confirm the end.
  it("[R1] an exactly-full last page keeps hasMore true until an empty page confirms the end", async () => {
    const { loadPage } = makeShortPageBackend(10, 5); // 2 full pages, then an empty page 2
    const { result } = renderHook(() =>
      useServerPage({ loadPage, pageSize: 5, pageMode: "short-page" }),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(5));

    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.items).toHaveLength(10);
    expect(result.current.hasMore).toBe(true); // page 1 was exactly full → could be more

    await act(async () => {
      await result.current.loadMore();
    });
    // The empty page 2 confirms the end without adding rows.
    expect(result.current.items).toHaveLength(10);
    expect(result.current.hasMore).toBe(false);
  });

  // @rule R1: a single short first page ends immediately (no phantom "Load more").
  it("[R1] a single short first page reports hasMore false", async () => {
    const { loadPage } = makeShortPageBackend(3, 5);
    const { result } = renderHook(() =>
      useServerPage({ loadPage, pageSize: 5, pageMode: "short-page" }),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(result.current.hasMore).toBe(false);
  });
});

describe("useServerPage — refresh() in place (POO-668 R4)", () => {
  /** A backend whose page values change per epoch, but ids are STABLE (a 45s refetch). */
  function makeRefreshableBackend(total: number, pageSize: number) {
    let epoch = 0;
    const loadPage = vi.fn(async (page: number) => ({
      items: Array.from({ length: total }, (_, i) => ({ id: `row-${i}`, v: i + epoch })).slice(
        page * pageSize,
        page * pageSize + pageSize,
      ),
      total: 9999,
    }));
    return { loadPage, bump: () => (epoch += 100) };
  }

  // @rule R4: refresh re-reads pages 0..current and REPLACES them, keeping the cursor + accumulated
  // length (no reset to page 0). Same ids after the refresh — the 45s/focus/post-write path.
  it("[R4] re-reads all loaded pages in place, preserving the cursor (no reset)", async () => {
    const { loadPage, bump } = makeRefreshableBackend(20, 5);
    const { result } = renderHook(() =>
      useServerPage({ loadPage, pageSize: 5, pageMode: "short-page" }),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(5));

    // Load 2 more pages → 15 rows across pages 0,1,2.
    await act(async () => {
      await result.current.loadMore();
    });
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.items).toHaveLength(15);
    const idsBefore = result.current.items.map((r) => r.id);

    // A 45s refetch: values change, ids identical. refresh() must keep all 15 rows + the cursor.
    bump();
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.items).toHaveLength(15); // still 3 pages, NOT reset to 5
    expect(result.current.items.map((r) => r.id)).toEqual(idsBefore); // same identities
    // The refreshed values landed (epoch bumped) — proves it re-read, not a no-op.
    expect((result.current.items[0] as { v: number }).v).toBe(100);
    // hasMore is still derived from the last (full) page.
    expect(result.current.hasMore).toBe(true);
  });

  // @rule R4: a refresh that comes back SHORTER (a position was closed) shrinks the loaded set but
  // still does not throw the user back to page 0.
  it("[R4] a refresh keeps the page cursor even if the feed shrank", async () => {
    let total = 15;
    const loadPage = vi.fn(async (page: number) => ({
      items: Array.from({ length: total }, (_, i) => ({ id: `row-${i}` })).slice(
        page * 5,
        page * 5 + 5,
      ),
      total: 9999,
    }));
    const { result } = renderHook(() =>
      useServerPage({ loadPage, pageSize: 5, pageMode: "short-page" }),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(5));
    await act(async () => {
      await result.current.loadMore();
    });
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.items).toHaveLength(15);

    // The feed shrank to 11 rows between refreshes.
    total = 11;
    await act(async () => {
      await result.current.refresh();
    });
    // pages 0,1,2 re-read → 5 + 5 + 1 = 11 rows; still 3 pages deep, not reset.
    expect(result.current.items).toHaveLength(11);
    expect(result.current.hasMore).toBe(false); // page 2 is now short
  });
});
