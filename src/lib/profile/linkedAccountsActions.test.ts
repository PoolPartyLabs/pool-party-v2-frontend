/**
 * @id PP-PROF-ACT-002 (POO-110, POO-581, POO-868)
 * @name linked-accounts actions tests
 * @implements-rules-version v1 (POO-581) · session auth: POO-868 v2
 *
 * The disconnect write bridge: forward the `{provider}` body to `DELETE /users/me/linked-accounts`
 * with the session Bearer read server-side (`getAuthHeader` — never a client-supplied header; POO-868
 * [R6]: no per-write signature), then bust the per-wallet linked-accounts cache tag. An upstream
 * error propagates (no cache bust) so the caller can retry.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  revalidateTag: vi.fn(),
  getSessionWallet: vi.fn(),
  getAuthHeader: vi.fn(),
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: mocks.apiFetch };
});
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock("@/lib/auth/session", () => ({
  getSessionWallet: (...args: unknown[]) => mocks.getSessionWallet(...args),
  getAuthHeader: (...args: unknown[]) => mocks.getAuthHeader(...args),
}));

import { disconnectLinkedAccountAction } from "./linkedAccountsActions";

const wallet = "0x1a2b3c4d5e6f7890a1b2c3d4e5f6789012345678";
const authHeader = { Authorization: "Bearer session-jwt" };

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.revalidateTag.mockReset();
  mocks.getSessionWallet.mockReset();
  mocks.getAuthHeader.mockReset();
  mocks.getAuthHeader.mockResolvedValue(authHeader);
});

describe("disconnectLinkedAccountAction", () => {
  it("DELETEs users/me/linked-accounts with the {provider} body and the session Bearer", async () => {
    mocks.apiFetch.mockResolvedValue(null);
    mocks.getSessionWallet.mockResolvedValue(wallet);

    await disconnectLinkedAccountAction({ provider: "x" });

    const [path, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("users/me/linked-accounts");
    expect(options).toMatchObject({ method: "DELETE", body: { provider: "x" } });
    // POO-868: the identity is the server-read session Bearer, never a client-supplied header.
    expect(options.headers).toEqual(authHeader);
  });

  it("busts the per-wallet linked-accounts cache tag on success", async () => {
    mocks.apiFetch.mockResolvedValue(null);
    mocks.getSessionWallet.mockResolvedValue(wallet);

    await disconnectLinkedAccountAction({ provider: "x" });

    expect(mocks.revalidateTag).toHaveBeenCalledWith(`linked-accounts:${wallet}`);
  });

  it("propagates an upstream error so the caller can retry (no cache bust)", async () => {
    mocks.apiFetch.mockRejectedValue(new Error("upstream"));
    await expect(disconnectLinkedAccountAction({ provider: "x" })).rejects.toThrow("upstream");
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });
});
