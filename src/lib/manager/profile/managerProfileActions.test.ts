/**
 * Tests for the manager-profile `"use server"` bridge (POO-579): the handle-availability check returns
 * the boolean; the signed write forwards ONLY the whitelisted signed-write headers + exact body, busts
 * the per-key cache (wallet + handle), and returns the mapped identity.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { SIGNED_WRITE_HEADERS } from "@/lib/auth/signedWrite";
import type { ApiManagerProfile, ManagerProfileWriteBody } from "./managerProfileSchema";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), revalidateTag: vi.fn() }));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: mocks.apiFetch };
});
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));

import { managerProfileTag } from "./fetchManagerProfile";
import { checkManagerHandleAction, updateManagerProfileAction } from "./managerProfileActions";

const apiResponse: ApiManagerProfile = {
  walletAddress: "0xabc0000000000000000000000000000000000001",
  handle: "carlos",
  handleLocked: true,
  displayName: "Carlos",
  bio: "gm",
  avatarUrl: null,
  bannerUrl: null,
  socials: { x: null, telegram: null, discord: null, youtube: null, website: null },
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.revalidateTag.mockReset();
});

describe("checkManagerHandleAction", () => {
  it("returns the availability boolean and forwards handle + self as query params", async () => {
    mocks.apiFetch.mockResolvedValueOnce({ handle: "carlos", available: true });
    const available = await checkManagerHandleAction("carlos", "old-handle");
    expect(available).toBe(true);
    const path = mocks.apiFetch.mock.calls[0]?.[0] as string;
    expect(path).toContain("managers/handle/check?");
    expect(path).toContain("handle=carlos");
    expect(path).toContain("self=old-handle");
  });

  it("treats a taken handle as unavailable", async () => {
    mocks.apiFetch.mockResolvedValueOnce({ handle: "taken", available: false, reason: "taken" });
    expect(await checkManagerHandleAction("taken")).toBe(false);
  });
});

describe("updateManagerProfileAction", () => {
  const body: ManagerProfileWriteBody = { displayName: "Carlos", bio: "gm" };
  const headers = {
    [SIGNED_WRITE_HEADERS.WALLET]: "0xABC0000000000000000000000000000000000001",
    [SIGNED_WRITE_HEADERS.SIGNATURE]: "0xsig",
    [SIGNED_WRITE_HEADERS.NONCE]: "n1",
    [SIGNED_WRITE_HEADERS.TIMESTAMP]: "123",
    [SIGNED_WRITE_HEADERS.NETWORK]: "base",
    "x-evil": "should-be-stripped",
  };

  it("PATCHes /managers/me forwarding only the whitelisted signed-write headers + exact body", async () => {
    mocks.apiFetch.mockResolvedValueOnce(apiResponse);
    await updateManagerProfileAction({ body, headers });

    const call = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    const path = call[0];
    const options = call[1] as {
      method: string;
      body: unknown;
      headers: Record<string, string>;
    };
    expect(path).toBe("managers/me");
    expect(options.method).toBe("PATCH");
    expect(options.body).toBe(body);
    expect(options.headers).not.toHaveProperty("x-evil");
    expect(options.headers[SIGNED_WRITE_HEADERS.SIGNATURE]).toBe("0xsig");
  });

  it("busts the per-key cache by wallet and by returned handle, and returns the mapped identity", async () => {
    mocks.apiFetch.mockResolvedValueOnce(apiResponse);
    const profile = await updateManagerProfileAction({ body, headers });

    expect(profile).toMatchObject({ handle: "carlos", name: "Carlos" });
    expect(mocks.revalidateTag).toHaveBeenCalledWith(
      managerProfileTag("0xABC0000000000000000000000000000000000001"),
    );
    expect(mocks.revalidateTag).toHaveBeenCalledWith(managerProfileTag("carlos"));
  });

  it("throws on an empty response", async () => {
    mocks.apiFetch.mockResolvedValueOnce(null);
    await expect(updateManagerProfileAction({ body, headers })).rejects.toThrow(/empty response/);
  });

  // POO-702 Secondary #1 (observability): the manager persist PATCH is logged so the next save reveals
  // whether the uploaded https avatar/banner URLs reach the API, and a silent 4xx is diagnosable.
  // @rule R7: log the body SHAPE (keys + avatarUrl/bannerUrl classification) under PP-MEDIA-SAVE.
  it("logs the PATCH body shape under PP-MEDIA-SAVE with avatar + banner classification (R7)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.apiFetch.mockResolvedValueOnce(apiResponse);
    await updateManagerProfileAction({
      body: {
        displayName: "Carlos",
        avatarUrl: "https://cdn.pool-party.xyz/managers/0x/avatar.png",
        bannerUrl: "https://cdn.pool-party.xyz/managers/0x/banner.png",
      },
      headers,
    });
    expect(info).toHaveBeenCalledWith(
      "PP-MEDIA-SAVE request",
      expect.objectContaining({ surface: "manager", avatarUrl: "https", bannerUrl: "https" }),
    );
    info.mockRestore();
  });

  // @rule R7: a failed PATCH is logged (status/code) under PP-MEDIA-SAVE and the error rethrows.
  it("logs a failed PATCH under PP-MEDIA-SAVE and rethrows (R7)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.apiFetch.mockRejectedValueOnce(new ApiError(400, "VALIDATION_ERROR", "bad body"));
    await expect(updateManagerProfileAction({ body, headers })).rejects.toThrow("bad body");
    expect(errorSpy).toHaveBeenCalledWith(
      "PP-MEDIA-SAVE error",
      expect.objectContaining({ surface: "manager", status: 400, code: "VALIDATION_ERROR" }),
    );
    errorSpy.mockRestore();
  });
});
