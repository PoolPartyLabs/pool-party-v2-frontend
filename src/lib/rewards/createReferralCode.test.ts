/**
 * @id PP-REW-LIB-008 (POO-853)
 * @name createReferralCode tests
 * @implements-rules-version v1
 *
 * The server-only referral create-code WRITE seam ([R1]). Rules exercised:
 * - Mock mode: session-local mock create, no session read, no network; a mock throw → unavailable.
 * - Real mode: POST /referral { wallet, code } with the SIWE session wallet (never client-supplied),
 *   then bust referral:<wallet> and re-read the backend-confirmed program (survives reload).
 * - Real mode, no session wallet: unavailable, no POST.
 * - Real mode, non-2xx (code taken / rejected): unavailable, no revalidate, no re-read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  getSessionWallet: vi.fn(),
  revalidateTag: vi.fn(),
  fetchReferral: vi.fn(),
  mockCreate: vi.fn(),
  isMockMode: false,
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: (...args: unknown[]) => mocks.apiFetch(...args) };
});
vi.mock("@/lib/auth/session", () => ({ getSessionWallet: () => mocks.getSessionWallet() }));
vi.mock("next/cache", () => ({ revalidateTag: (...a: unknown[]) => mocks.revalidateTag(...a) }));
vi.mock("./fetchReferral", () => ({
  fetchReferral: (...a: unknown[]) => mocks.fetchReferral(...a),
  referralTag: (address: string) => `referral:${address.toLowerCase()}`,
}));
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mocks.isMockMode;
  },
  rewardsService: { createReferralCode: (...a: unknown[]) => mocks.mockCreate(...a) },
}));

import { createReferralCode } from "./createReferralCode";

/** Assert a create POST was (or was not) issued to `referral`, and with what body. */
function createPostCalls() {
  return mocks.apiFetch.mock.calls.filter(([path]) => path === "referral");
}

describe("createReferralCode", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.getSessionWallet.mockReset();
    mocks.revalidateTag.mockReset();
    mocks.fetchReferral.mockReset();
    mocks.mockCreate.mockReset();
    mocks.isMockMode = false;
    mocks.getSessionWallet.mockResolvedValue("0xReferrer");
  });

  // @rule R1 (mock mode: session-local mock create, no session read, no network)
  it("creates through the mock service in mock mode without any network or session read", async () => {
    mocks.isMockMode = true;
    mocks.mockCreate.mockResolvedValue({ code: "MYCODE1", invites: [] });

    expect(await createReferralCode("MYCODE1")).toEqual({
      status: "created",
      program: { code: "MYCODE1", invites: [] },
    });
    expect(mocks.mockCreate).toHaveBeenCalledWith("MYCODE1");
    expect(mocks.getSessionWallet).not.toHaveBeenCalled();
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  // @rule R1 (mock mode: a mock rejection — already set / invalid — surfaces as unavailable)
  it("returns unavailable in mock mode when the mock create rejects", async () => {
    mocks.isMockMode = true;
    mocks.mockCreate.mockRejectedValue(new Error("Referral code already set"));

    expect(await createReferralCode("MYCODE1")).toEqual({ status: "unavailable" });
  });

  // @rule R1 (real mode: POST /referral with the SESSION wallet + code, then bust the tag and re-read)
  it("posts /referral with the session wallet and re-reads the confirmed program in real mode", async () => {
    mocks.apiFetch.mockResolvedValueOnce({ ok: true }); // POST /referral
    const confirmed = {
      code: "MYCODE1",
      inviteLink: "app.pool-party.xyz?ref=MYCODE1",
      invites: [],
    };
    mocks.fetchReferral.mockResolvedValue(confirmed);

    expect(await createReferralCode("MYCODE1")).toEqual({ status: "created", program: confirmed });

    const post = createPostCalls();
    expect(post).toHaveLength(1);
    expect(post[0]?.[1]).toMatchObject({
      method: "POST",
      body: { wallet: "0xReferrer", code: "MYCODE1" },
    });
    expect(mocks.revalidateTag).toHaveBeenCalledWith("referral:0xreferrer");
    expect(mocks.fetchReferral).toHaveBeenCalledWith("0xReferrer");
  });

  // @rule R1 (real mode: no session wallet → unavailable, never POST)
  it("returns unavailable and never posts when there is no session wallet in real mode", async () => {
    mocks.getSessionWallet.mockResolvedValue(null);

    expect(await createReferralCode("MYCODE1")).toEqual({ status: "unavailable" });
    expect(createPostCalls()).toHaveLength(0);
  });

  // @rule R1 (real mode: a non-2xx create — code taken / rejected — is a soft failure, no re-read)
  it("returns unavailable when the create POST fails, without revalidating or re-reading", async () => {
    mocks.apiFetch.mockRejectedValueOnce(new ApiError(500, "SYSTEM_INTERNAL", "code taken"));

    expect(await createReferralCode("MYCODE1")).toEqual({ status: "unavailable" });
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
    expect(mocks.fetchReferral).not.toHaveBeenCalled();
  });
});
