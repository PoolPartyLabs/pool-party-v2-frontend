/**
 * Tests for the server-side manager-profile read (POO-579): maps the registry response, treats a 404
 * as "no profile yet" (null), and propagates every other upstream failure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { ApiManagerProfile } from "./managerProfileSchema";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: mocks.apiFetch };
});

import { fetchManagerProfile, managerProfileTag } from "./fetchManagerProfile";

const apiFixture: ApiManagerProfile = {
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

describe("fetchManagerProfile", () => {
  beforeEach(() => mocks.apiFetch.mockReset());

  it("maps a found registry profile onto the FE ManagerProfile", async () => {
    mocks.apiFetch.mockResolvedValueOnce(apiFixture);
    const profile = await fetchManagerProfile("carlos");
    expect(profile).toMatchObject({
      handle: "carlos",
      name: "Carlos",
      address: apiFixture.walletAddress,
    });
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "managers/carlos",
      expect.objectContaining({ tags: [managerProfileTag("carlos")] }),
    );
  });

  it("returns null when the registry has no record (404)", async () => {
    mocks.apiFetch.mockRejectedValueOnce(
      new ApiError(404, "NOT_FOUND", "Manager profile not found"),
    );
    expect(await fetchManagerProfile("0xdead")).toBeNull();
  });

  it("returns null on an empty (204) body", async () => {
    mocks.apiFetch.mockResolvedValueOnce(null);
    expect(await fetchManagerProfile("carlos")).toBeNull();
  });

  it("propagates a non-404 upstream failure", async () => {
    mocks.apiFetch.mockRejectedValueOnce(new ApiError(500, "SYSTEM_INTERNAL", "boom"));
    await expect(fetchManagerProfile("carlos")).rejects.toThrow("boom");
  });

  it("passes composed stats through to the mapped profile", async () => {
    mocks.apiFetch.mockResolvedValueOnce(apiFixture);
    const stats = { aum: 500, investors: 4, strategies: 2, avgApy: 9 };
    const profile = await fetchManagerProfile("carlos", stats);
    expect(profile?.stats).toEqual(stats);
  });
});
