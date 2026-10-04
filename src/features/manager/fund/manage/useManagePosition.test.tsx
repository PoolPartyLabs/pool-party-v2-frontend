/** @id PP-MGR-LIB-054 @implements-rules-version v1 (POO-2227) */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/api/v2/manageActions", () => ({ loadManagePositionAction: mocks.load }));

import { useManagePosition } from "./useManagePosition";

describe("Manage position read identity", () => {
  beforeEach(() => mocks.load.mockReset());
  it("[R7] does not read hidden panels and ignores an old identity response", async () => {
    let resolveOld: (value: unknown) => void = () => {};
    mocks.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      ({ key, active }) => useManagePosition("core", 42161, key, active),
      { initialProps: { key: "old", active: false } },
    );
    expect(mocks.load).not.toHaveBeenCalled();
    rerender({ key: "old", active: true });
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));
    mocks.load.mockResolvedValueOnce({ ok: true, data: { position: { positionKey: "new" } } });
    rerender({ key: "new", active: true });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => resolveOld({ ok: true, data: { position: { positionKey: "old" } } }));
    expect(result.current.position?.positionKey).toBe("new");
  });
  it("[R8] reports unavailable on a failed read and retry replaces the result", async () => {
    mocks.load.mockResolvedValueOnce({ ok: false, error: { status: 503, code: "V2_UNAVAILABLE" } });
    const { result } = renderHook(() => useManagePosition("core", 42161, "key", true));
    await waitFor(() => expect(result.current.status).toBe("error"));
    mocks.load.mockResolvedValueOnce({ ok: true, data: { position: { positionKey: "key" } } });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });
  it("[R7] keeps last same-position metadata during retry and failure", async () => {
    mocks.load.mockResolvedValueOnce({ ok: true, data: { position: { positionKey: "key" } } });
    const { result } = renderHook(() => useManagePosition("core", 42161, "key", true));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    let rejectRead: (error: Error) => void = () => {};
    mocks.load.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRead = reject;
        }),
    );
    act(() => result.current.retry());
    expect(result.current.position?.positionKey).toBe("key");
    await act(async () => rejectRead(new Error("offline")));
    expect(result.current.status).toBe("error");
    expect(result.current.position?.positionKey).toBe("key");
  });
});
