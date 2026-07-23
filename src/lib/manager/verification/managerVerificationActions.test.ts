/**
 * Tests for the manager verification-request `"use server"` bridge (POO-745). Forwards ONLY the
 * whitelisted signed-write headers + an empty body to POST /managers/me/verification/request, busts the
 * per-key profile cache by wallet, and returns the parsed { status, code, message }.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SIGNED_WRITE_HEADERS } from "@/lib/auth/signedWrite";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), revalidateTag: vi.fn() }));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: mocks.apiFetch };
});
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));

import { managerProfileTag } from "@/lib/manager/profile/fetchManagerProfile";
import { requestManagerVerificationAction } from "./managerVerificationActions";

const apiResponse = { status: "pending", code: "K7QF2M9X", message: "DM this code: K7QF2M9X" };

const headers = {
  [SIGNED_WRITE_HEADERS.WALLET]: "0xABC0000000000000000000000000000000000001",
  [SIGNED_WRITE_HEADERS.SIGNATURE]: "0xsig",
  [SIGNED_WRITE_HEADERS.NONCE]: "n1",
  [SIGNED_WRITE_HEADERS.TIMESTAMP]: "123",
  [SIGNED_WRITE_HEADERS.NETWORK]: "base",
  "x-evil": "should-be-stripped",
};

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.revalidateTag.mockReset();
});

describe("requestManagerVerificationAction", () => {
  it("POSTs the endpoint with an empty body + only the whitelisted signed-write headers", async () => {
    mocks.apiFetch.mockResolvedValueOnce(apiResponse);
    await requestManagerVerificationAction({ headers });

    const call = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(call[0]).toBe("managers/me/verification/request");
    const options = call[1] as { method: string; body: unknown; headers: Record<string, string> };
    expect(options.method).toBe("POST");
    expect(options.body).toEqual({});
    expect(options.headers).not.toHaveProperty("x-evil");
    expect(options.headers[SIGNED_WRITE_HEADERS.SIGNATURE]).toBe("0xsig");
  });

  it("returns the parsed status + code + message and busts the profile cache by wallet", async () => {
    mocks.apiFetch.mockResolvedValueOnce(apiResponse);
    const result = await requestManagerVerificationAction({ headers });

    expect(result).toEqual(apiResponse);
    expect(mocks.revalidateTag).toHaveBeenCalledWith(
      managerProfileTag("0xABC0000000000000000000000000000000000001"),
    );
  });

  it("throws on an empty response", async () => {
    mocks.apiFetch.mockResolvedValueOnce(null);
    await expect(requestManagerVerificationAction({ headers })).rejects.toThrow(/empty response/);
  });
});
