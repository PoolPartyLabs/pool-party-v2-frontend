/**
 * @id PP-MGR-HOK-024
 * @name Local shared builder draft regression tests
 * @implements-rules-version v1 (POO-2301)
 * @analytics-events none, hook regression assertions.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSolanaBuilderDraft } from "./useSolanaBuilderDraft";

afterEach(() => vi.restoreAllMocks());

// @rule R8/R9: edits and session acknowledgement never write browser storage or launch state.
it("tracks local Review edits as unsaved work and acknowledges them in memory only", async () => {
  const write = vi.spyOn(Storage.prototype, "setItem");
  const { result, unmount } = renderHook(useSolanaBuilderDraft);
  expect(result.current.isDirty).toBe(false);
  await act(async () => {
    expect(await result.current.save("Local intent")).toEqual({ ok: true });
  });
  expect(result.current.isDirty).toBe(false);
  act(() =>
    result.current.update((draft) => ({
      ...draft,
      review: {
        name: "Local intent",
        description: "Changed review",
        imageUrl: "",
        performanceFeeBps: 2000,
        managementFeeBps: 0,
        payoutFeeBps: 200,
        minimum: "100",
        seed: "100",
      },
    })),
  );
  expect(result.current.isDirty).toBe(true);
  await act(async () => {
    await result.current.save();
  });
  expect(result.current.isDirty).toBe(false);
  expect(write).not.toHaveBeenCalled();
  unmount();
  const next = renderHook(useSolanaBuilderDraft);
  expect(next.result.current.draft.review).toBeUndefined();
  expect(next.result.current.draft.name).toBeNull();
});
