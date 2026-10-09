/**
 * @id PP-MGR-HOK-006
 * @name Standard draft session checkpoint regression test
 * @implements-rules-version v1 (POO-2301)
 * @analytics-events none, session isolation regression assertions.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { type MandateDraftCheckpoint, useMandateDraft } from "./useMandateDraft";

// @rule R2/R9: switching runtimes restores EVM work without persisting it or mounting EVM hooks locally.
it("restores an unsaved standard draft and its dirty baseline from a route-owned memory checkpoint", async () => {
  const write = vi.spyOn(Storage.prototype, "setItem");
  const checkpoint: { current: MandateDraftCheckpoint | null } = { current: null };
  const first = renderHook(() => useMandateDraft(undefined, checkpoint));
  await waitFor(() => expect(first.result.current.hydrated).toBe(true));
  const id = first.result.current.draft.id;
  act(() =>
    first.result.current.update((draft) => ({
      ...draft,
      name: "Unsaved EVM work",
      lastStep: "protocols",
    })),
  );
  expect(first.result.current.isDirty).toBe(true);
  first.unmount();
  const second = renderHook(() => useMandateDraft(undefined, checkpoint));
  await waitFor(() => expect(second.result.current.hydrated).toBe(true));
  expect(second.result.current.draft.id).toBe(id);
  expect(second.result.current.draft.name).toBe("Unsaved EVM work");
  expect(second.result.current.draft.lastStep).toBe("protocols");
  expect(second.result.current.isDirty).toBe(true);
  expect(write).not.toHaveBeenCalled();
  second.unmount();
  write.mockRestore();
});
