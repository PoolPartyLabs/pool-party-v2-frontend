/**
 * @id PP-PROF-HOOK-002 (POO-110, POO-581, POO-868)
 * @name useDisconnectLinkedAccount tests
 * @implements-rules-version v1 (POO-581) · session auth: POO-868 v2
 *
 * The real-mode disconnect hook forwards `{provider}` to `disconnectLinkedAccountAction` with NO
 * wallet interaction (POO-868 [R6]: the session Bearer is attached server-side; ownership was proven
 * at sign-in). An action failure propagates so the caller can surface it.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  disconnectLinkedAccountAction: vi.fn(),
}));

vi.mock("@/lib/profile/linkedAccountsActions", () => ({
  disconnectLinkedAccountAction: mocks.disconnectLinkedAccountAction,
}));

import { useDisconnectLinkedAccount } from "./useDisconnectLinkedAccount";

beforeEach(() => {
  mocks.disconnectLinkedAccountAction.mockReset();
});

describe("useDisconnectLinkedAccount", () => {
  it("forwards the {provider} body to the session-authenticated action with no signature", async () => {
    mocks.disconnectLinkedAccountAction.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useDisconnectLinkedAccount());
    await result.current("x");

    expect(mocks.disconnectLinkedAccountAction).toHaveBeenCalledTimes(1);
    expect(mocks.disconnectLinkedAccountAction).toHaveBeenCalledWith({ provider: "x" });
  });

  it("propagates an action failure (expired session / upstream error)", async () => {
    mocks.disconnectLinkedAccountAction.mockRejectedValueOnce(new Error("401 session expired"));

    const { result } = renderHook(() => useDisconnectLinkedAccount());
    await expect(result.current("x")).rejects.toThrow("401 session expired");
  });
});
