/**
 * @id PP-PROF-ACT-001 (POO-233 R4, POO-426, POO-637)
 * @name profile actions tests
 * @implements-rules-version v1
 *
 * The real-mode signed write forwards the client envelope to the guarded `PATCH /users/me`. It pins
 * the security whitelist (only the five `x-pp-*` headers are forwarded, so a client can never override
 * the injected `x-api-key`), the PATCH path/method, the per-wallet cache bust, and the identity round-trip
 * from the owner projection (email + country + phone, which the public read omits).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { SIGNED_WRITE_HEADERS } from "@/lib/auth/signedWrite";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

const getSessionWallet = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionWallet: () => getSessionWallet() }));

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag: (...a: unknown[]) => revalidateTag(...a) }));

const readRewardsOrNull = vi.fn();
vi.mock("@/lib/profile/fetchInvestorProfile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profile/fetchInvestorProfile")>();
  return { ...actual, readRewardsOrNull: (...a: unknown[]) => readRewardsOrNull(...a) };
});

async function importModule() {
  vi.resetModules();
  return import("./actions");
}

/** The first `apiFetch` call's `[path, options]`, asserted present (keeps types honest). */
function firstApiFetchCall(): [
  string,
  { method?: string; body?: unknown; headers?: Record<string, string> },
] {
  const call = apiFetch.mock.calls[0];
  if (!call) throw new Error("apiFetch was not called");
  return call as [string, { method?: string; body?: unknown; headers?: Record<string, string> }];
}

const owner = {
  walletAddress: "0xabc",
  // POO-693: the owner projection carries the PRIVATE `name` and the PUBLIC `displayName` as distinct fields.
  name: "Ana Private",
  displayName: "Ana Invests",
  avatarUrl: null,
  isManager: false,
  email: "ana@b.com",
  country: "Brazil",
  phone: "+55 11 90000-0000",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

describe("updateMyProfileAction", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    getSessionWallet.mockReset();
    revalidateTag.mockReset();
    readRewardsOrNull.mockReset();
    apiFetch.mockResolvedValue(owner);
    getSessionWallet.mockResolvedValue("0xabc");
    readRewardsOrNull.mockResolvedValue(null);
  });

  // @rule POO-233 R4 (edit calls the backend: PATCH /users/me)
  it("PATCHes /users/me with the write body", async () => {
    const { updateMyProfileAction } = await importModule();
    await updateMyProfileAction({ body: { displayName: "Ana Invests" }, headers: {} });

    const [path, opts] = firstApiFetchCall();
    expect(path).toBe("users/me");
    expect(opts.method).toBe("PATCH");
    expect(opts.body).toEqual({ displayName: "Ana Invests" });
  });

  // @rule POO-637 (security: only the five signed-write headers are forwarded — no x-api-key override)
  it("forwards only the whitelisted x-pp-* headers", async () => {
    const { updateMyProfileAction } = await importModule();
    await updateMyProfileAction({
      body: {},
      headers: {
        [SIGNED_WRITE_HEADERS.WALLET]: "0xabc",
        [SIGNED_WRITE_HEADERS.SIGNATURE]: "0xsig",
        [SIGNED_WRITE_HEADERS.NONCE]: "n",
        [SIGNED_WRITE_HEADERS.TIMESTAMP]: "1",
        [SIGNED_WRITE_HEADERS.NETWORK]: "polygon",
        "x-api-key": "attacker-key",
        cookie: "steal-me",
      },
    });

    const forwarded = firstApiFetchCall()[1].headers;
    expect(forwarded).toEqual({
      [SIGNED_WRITE_HEADERS.WALLET]: "0xabc",
      [SIGNED_WRITE_HEADERS.SIGNATURE]: "0xsig",
      [SIGNED_WRITE_HEADERS.NONCE]: "n",
      [SIGNED_WRITE_HEADERS.TIMESTAMP]: "1",
      [SIGNED_WRITE_HEADERS.NETWORK]: "polygon",
    });
    expect(forwarded).not.toHaveProperty("x-api-key");
    expect(forwarded).not.toHaveProperty("cookie");
  });

  // @rule POO-426 (busts the per-wallet cache so the next read reflects the edit)
  it("revalidates the per-wallet profile tag", async () => {
    const { updateMyProfileAction } = await importModule();
    await updateMyProfileAction({ body: {}, headers: {} });
    expect(revalidateTag).toHaveBeenCalledWith("profile:0xabc");
  });

  // @rule POO-674/POO-675/POO-693 (the owner projection carries the saved email + country + phone + the
  // PRIVATE name; the public read omits them — so the write result round-trips the just-saved identity)
  it("returns the identity with email + country + phone + private name from the owner projection", async () => {
    const { updateMyProfileAction } = await importModule();
    const user = await updateMyProfileAction({ body: {}, headers: {} });
    expect(user.email).toBe("ana@b.com");
    expect(user.country).toBe("Brazil");
    expect(user.phone).toBe("+55 11 90000-0000");
    // POO-693: `displayName` is the PUBLIC field; `name` is the PRIVATE comms-only one.
    expect(user.displayName).toBe("Ana Invests");
    expect(user.name).toBe("Ana Private");
  });

  it("throws on an empty PATCH response", async () => {
    apiFetch.mockResolvedValue(null);
    const { updateMyProfileAction } = await importModule();
    await expect(updateMyProfileAction({ body: {}, headers: {} })).rejects.toThrow();
  });

  // POO-702 Secondary #1 (observability): the real-mode persist PATCH is logged so the next save reveals
  // whether the uploaded https URL reaches the API, and a silent 4xx is diagnosable in the container.
  // @rule R6: log the PATCH body SHAPE (keys + avatarUrl classification) under PP-MEDIA-SAVE, no values.
  it("logs the PATCH body shape under PP-MEDIA-SAVE with the avatarUrl classification (R6)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { updateMyProfileAction } = await importModule();
    await updateMyProfileAction({
      body: { displayName: "Ana", avatarUrl: "https://cdn.pool-party.xyz/a.png" },
      headers: {},
    });
    expect(info).toHaveBeenCalledWith(
      "PP-MEDIA-SAVE request",
      expect.objectContaining({
        surface: "investor",
        bodyKeys: ["avatarUrl", "displayName"],
        avatarUrl: "https",
      }),
    );
    info.mockRestore();
  });

  // @rule R6: a failed PATCH is logged (status/code/message) under PP-MEDIA-SAVE and the error rethrows.
  it("logs a failed PATCH under PP-MEDIA-SAVE and rethrows (R6)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    apiFetch.mockRejectedValueOnce(new ApiError(400, "VALIDATION_ERROR", "phone too long"));
    const { updateMyProfileAction } = await importModule();
    await expect(updateMyProfileAction({ body: {}, headers: {} })).rejects.toThrow(
      "phone too long",
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "PP-MEDIA-SAVE error",
      expect.objectContaining({ surface: "investor", status: 400, code: "VALIDATION_ERROR" }),
    );
    errorSpy.mockRestore();
  });
});
