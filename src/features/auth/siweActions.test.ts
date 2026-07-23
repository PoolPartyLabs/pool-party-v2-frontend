/**
 * @id PP-AUTH (POO-270)
 * @name SIWE server actions tests
 * @implements-rules-version v1
 *
 * getNonce returns the API nonce; signIn sets the httpOnly cookie on success and not on failure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  cookieSet: vi.fn(),
  cookieDelete: vi.fn(),
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: mocks.apiFetch };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: mocks.cookieSet, delete: mocks.cookieDelete }),
}));

import { getNonceAction, signInAction, signOutAction } from "./siweActions";

const input = { wallet: "0xabc", signature: "0xsig", nonce: "n1", network: "arbitrum" };

describe("siweActions", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.cookieSet.mockReset();
    mocks.cookieDelete.mockReset();
  });

  it("getNonceAction returns the nonce from the API", async () => {
    mocks.apiFetch.mockResolvedValue({ nonce: "nonce-123" });
    expect(await getNonceAction("0xabc")).toBe("nonce-123");
    expect(mocks.apiFetch.mock.calls[0]?.[0]).toBe("auth/nonce");
  });

  it("signInAction sets the httpOnly cookie and returns true on success", async () => {
    mocks.apiFetch.mockResolvedValue({ accessToken: "jwt.token.sig" });
    const ok = await signInAction(input);
    expect(ok).toBe(true);
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "pp_access_token",
      "jwt.token.sig",
      expect.objectContaining({ httpOnly: true, path: "/" }),
    );
  });

  it("signInAction returns false and sets no cookie when the API has no token", async () => {
    mocks.apiFetch.mockResolvedValue(null);
    expect(await signInAction(input)).toBe(false);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("signOutAction clears the cookie", async () => {
    await signOutAction();
    expect(mocks.cookieDelete).toHaveBeenCalledWith("pp_access_token");
  });
});
