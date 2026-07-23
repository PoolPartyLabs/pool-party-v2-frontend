/**
 * @id PP-REW-LIB-006 (POO-718)
 * @name applyReferralCode tests
 * @implements-rules-version v1
 *
 * The server-only apply resolver. Rules exercised:
 * - [R9] mock mode: simulated success, no network, still clears the pending cookie.
 * - [R3] real mode: POST /referral/apply-code with { wallet, code }, wallet from the SIWE session
 *   (never client-supplied — the function takes no wallet argument), code from the pp_ref cookie.
 * - [R4] no session wallet: keep the code pending (no clear, no apply).
 * - [R5] already-referred (referredBy / isReferee): do NOT apply, clear pending.
 * - [R6] self-referral (code === the wallet's own referrer code, case-insensitive): do NOT apply, clear.
 * - [R7] non-2xx apply: soft failure, clear pending, no throw, no retry.
 * - [R8] on a real attach, bust referral:<wallet> so the referred-by read refreshes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  getSessionWallet: vi.fn(),
  revalidateTag: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  isMockMode: false,
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: (...args: unknown[]) => mocks.apiFetch(...args) };
});
vi.mock("@/lib/auth/session", () => ({ getSessionWallet: () => mocks.getSessionWallet() }));
vi.mock("next/cache", () => ({ revalidateTag: (...a: unknown[]) => mocks.revalidateTag(...a) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (...a: unknown[]) => mocks.cookieGet(...a),
    set: (...a: unknown[]) => mocks.cookieSet(...a),
  }),
}));
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mocks.isMockMode;
  },
}));

import { applyReferralCode } from "./applyReferralCode";

/** Set the pp_ref cookie value the action reads server-side. */
function pendingCookie(value: string | undefined) {
  mocks.cookieGet.mockReturnValue(value === undefined ? undefined : { value });
}

/** Assert an apply-code POST was (or was not) issued, and with what body. */
function applyPostCalls() {
  return mocks.apiFetch.mock.calls.filter(([path]) => path === "referral/apply-code");
}

describe("applyReferralCode", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.getSessionWallet.mockReset();
    mocks.revalidateTag.mockReset();
    mocks.cookieGet.mockReset();
    mocks.cookieSet.mockReset();
    mocks.isMockMode = false;
    mocks.getSessionWallet.mockResolvedValue("0xreferee");
    pendingCookie("ABC123");
  });

  // @rule R2 (nothing pending → no-op, no network)
  it("returns not-applicable and does not call the API when no code is pending", async () => {
    pendingCookie(undefined);
    expect(await applyReferralCode()).toBe("not-applicable");
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  // @rule R9 (mock mode: simulated success, no network, clears the cookie)
  it("simulates success in mock mode without any network call and clears the pending code", async () => {
    mocks.isMockMode = true;
    expect(await applyReferralCode()).toBe("applied");
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "pp_ref",
      "",
      expect.objectContaining({ maxAge: 0, path: "/" }),
    );
  });

  // @rule R4 (no session wallet in real mode: keep the code pending, no apply)
  it("returns no-session and keeps the pending code when there is no session wallet", async () => {
    mocks.getSessionWallet.mockResolvedValue(null);
    expect(await applyReferralCode()).toBe("no-session");
    expect(applyPostCalls()).toHaveLength(0);
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  // @rule R3 (real apply uses the SESSION wallet + cookie code; never a client-supplied address)
  it("posts apply-code with the session wallet and the pending code, then clears + revalidates", async () => {
    // GET /referral/:wallet (guard read) → no record; POST apply-code → ok.
    mocks.apiFetch.mockResolvedValueOnce(null).mockResolvedValueOnce({ ok: true });

    expect(await applyReferralCode()).toBe("applied");

    const post = applyPostCalls();
    expect(post).toHaveLength(1);
    expect(post[0]?.[1]).toMatchObject({
      method: "POST",
      body: { wallet: "0xreferee", code: "ABC123" },
    });
    expect(mocks.revalidateTag).toHaveBeenCalledWith("referral:0xreferee");
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "pp_ref",
      "",
      expect.objectContaining({ maxAge: 0, path: "/" }),
    );
  });

  // @rule R5 (already-referred via referredBy: do NOT apply, clear pending)
  it("skips apply and clears when the wallet is already referred (referredBy set)", async () => {
    mocks.apiFetch.mockResolvedValueOnce({
      wallet: "0xreferee",
      referredBy: { wallet: "0xother", code: "OTHER1" },
    });
    expect(await applyReferralCode()).toBe("already-referred");
    expect(applyPostCalls()).toHaveLength(0);
    expect(mocks.cookieSet).toHaveBeenCalled();
  });

  // @rule R5 (already-referred via isReferee flag)
  it("skips apply when the wallet is flagged as a referee", async () => {
    mocks.apiFetch.mockResolvedValueOnce({ wallet: "0xreferee", isReferee: true });
    expect(await applyReferralCode()).toBe("already-referred");
    expect(applyPostCalls()).toHaveLength(0);
  });

  // @rule R6 (self-referral: pending code equals the wallet's own code, case-insensitive)
  it("skips apply and clears on self-referral", async () => {
    pendingCookie("MyCode1");
    mocks.apiFetch.mockResolvedValueOnce({ wallet: "0xreferee", code: "mycode1" });
    expect(await applyReferralCode()).toBe("self-referral");
    expect(applyPostCalls()).toHaveLength(0);
    expect(mocks.cookieSet).toHaveBeenCalled();
  });

  // @rule R7 (non-2xx apply is a soft failure: clear, no throw, no retry)
  it("clears the pending code and returns not-applicable when apply fails (no throw)", async () => {
    mocks.apiFetch
      .mockResolvedValueOnce(null) // guard read: no record
      .mockRejectedValueOnce(new ApiError(500, "SYSTEM_INTERNAL", "Referrer not found"));
    expect(await applyReferralCode()).toBe("not-applicable");
    expect(mocks.cookieSet).toHaveBeenCalled();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  // @rule R3/R6 (a failed guard read never crashes: fall through to apply, backend re-enforces)
  it("still attempts apply when the guard read fails", async () => {
    mocks.apiFetch
      .mockRejectedValueOnce(new ApiError(503, "SYSTEM", "read blip")) // guard read fails
      .mockResolvedValueOnce({ ok: true }); // apply succeeds
    expect(await applyReferralCode()).toBe("applied");
    expect(applyPostCalls()).toHaveLength(1);
  });
});
