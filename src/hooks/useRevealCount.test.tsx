/**
 * @id PP-CORE-HOK-022 (POO-669, POO-670; promoted from PP-MGR-HOK-003)
 * @name useRevealCount tests
 * @implements-rules-version v1
 *
 * The client-side reveal counter behind a "Load more" ([R1]): it starts at a page (5), grows a page
 * per reveal, and RESETS to the first page when its `resetKey` changes (a status-filter change, [R2]
 * — mirroring POO-626's reset-on-filter). It must NOT reset when only the data changes under a stable
 * key: a same-set 45s/focus/router.refresh refetch keeps the revealed count (the POO-628 DO-NOT-RESET
 * contract), which the tests below pin. Shared by the Manager Console (POO-669) and, after promotion
 * to a shared hook, the Admin queues (POO-670).
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PAGE_SIZE, useRevealCount } from "./useRevealCount";

describe("useRevealCount", () => {
  // @rule R1 — the first page is PAGE_SIZE (5) rows.
  it("starts at one page (PAGE_SIZE)", () => {
    const { result } = renderHook(() => useRevealCount());
    expect(result.current.count).toBe(PAGE_SIZE);
    expect(PAGE_SIZE).toBe(5);
  });

  // @rule R1 — each reveal grows the count by exactly one page (+5).
  it("reveals one more page per call (+PAGE_SIZE)", () => {
    const { result } = renderHook(() => useRevealCount());
    act(() => result.current.revealMore());
    expect(result.current.count).toBe(PAGE_SIZE * 2);
    act(() => result.current.revealMore());
    expect(result.current.count).toBe(PAGE_SIZE * 3);
  });

  // @rule R2 — a resetKey change (status-filter switch) resets the reveal back to the first page,
  // because the manager is now viewing a genuinely different subset (POO-626 reset-on-filter).
  it("resets to the first page when the resetKey changes", () => {
    const { result, rerender } = renderHook(({ key }) => useRevealCount(key), {
      initialProps: { key: "active" },
    });
    act(() => result.current.revealMore());
    act(() => result.current.revealMore());
    expect(result.current.count).toBe(PAGE_SIZE * 3);
    rerender({ key: "paused" });
    expect(result.current.count).toBe(PAGE_SIZE);
  });

  // @rule DO-NOT-RESET — a re-render under a STABLE resetKey preserves the revealed count. This is
  // the same-set 45s/focus/router.refresh refetch (POO-628): new data, same subset identity, the
  // manager keeps everything they had revealed.
  it("preserves the revealed count across a re-render with a stable resetKey (DO-NOT-RESET on refresh)", () => {
    const { result, rerender } = renderHook(({ key }) => useRevealCount(key), {
      initialProps: { key: "active" },
    });
    act(() => result.current.revealMore());
    act(() => result.current.revealMore());
    expect(result.current.count).toBe(PAGE_SIZE * 3);
    // A data refetch re-renders the view with the same filter identity: the count must not drop.
    rerender({ key: "active" });
    expect(result.current.count).toBe(PAGE_SIZE * 3);
    rerender({ key: "active" });
    expect(result.current.count).toBe(PAGE_SIZE * 3);
  });

  // @rule DO-NOT-RESET — with NO resetKey (the Overview, which has no status filter) the count is
  // pure component state: re-renders never reset it, so a 45s/focus refetch keeps the reveal.
  it("preserves the count across re-renders when there is no resetKey (Overview)", () => {
    const { result, rerender } = renderHook(() => useRevealCount());
    act(() => result.current.revealMore());
    expect(result.current.count).toBe(PAGE_SIZE * 2);
    rerender();
    rerender();
    expect(result.current.count).toBe(PAGE_SIZE * 2);
  });

  // The explicit reset handle exists for callers that want to force the first page without a key
  // change (not used by the current views, but part of the small hook's contract).
  it("resets to the first page on demand", () => {
    const { result } = renderHook(() => useRevealCount());
    act(() => result.current.revealMore());
    act(() => result.current.revealMore());
    expect(result.current.count).toBe(PAGE_SIZE * 3);
    act(() => result.current.reset());
    expect(result.current.count).toBe(PAGE_SIZE);
  });

  // POO-752 [R1]: an explicit pageSize overrides the default 5 for a single caller (the manager
  // "My strategies" list uses 6 to fill its 2-column grid). It threads through the first page AND the
  // per-reveal increment.
  it("uses a custom pageSize for the first page and the increment (POO-752 R1)", () => {
    const { result } = renderHook(() => useRevealCount(undefined, 6));
    expect(result.current.count).toBe(6);
    act(() => result.current.revealMore());
    expect(result.current.count).toBe(12);
    act(() => result.current.reset());
    expect(result.current.count).toBe(6);
  });

  // POO-752 [R1]: a resetKey change snaps back to the custom pageSize, not the default 5.
  it("resets to the custom pageSize when the resetKey changes (POO-752 R1)", () => {
    const { result, rerender } = renderHook(({ key }) => useRevealCount(key, 6), {
      initialProps: { key: "active" },
    });
    act(() => result.current.revealMore());
    expect(result.current.count).toBe(12);
    rerender({ key: "closed" });
    expect(result.current.count).toBe(6);
  });
});
