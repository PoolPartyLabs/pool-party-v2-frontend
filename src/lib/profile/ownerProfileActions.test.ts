/**
 * @id PP-PROF-ACT-003 (POO-779)
 * @name getOwnerProfileAction tests
 * @implements-rules-version v2
 *
 * The role source (POO-779 R1): the owner profile read exposes `isManager` from the session profile
 * (`GET /users/me` via `loadInvestorProfile`). No positions drain. A read failure or an absent
 * `isManager` field degrades to the investor role (false) rather than throwing — POO-788 reconciles the
 * flag upstream; the FE must never grant the manager surface on a malformed/absent read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileUser } from "@/lib/schemas";

const mocks = vi.hoisted(() => ({
  load: vi.fn<() => Promise<ProfileUser>>(),
}));

vi.mock("./loadInvestorProfile", () => ({
  loadInvestorProfile: mocks.load,
}));

import { getOwnerProfileAction } from "./ownerProfileActions";

/** A ProfileUser fixture carrying only the field the action reads (the rest is irrelevant here). */
function profile(isManager: boolean): ProfileUser {
  return { isManager } as unknown as ProfileUser;
}

describe("getOwnerProfileAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // @rule R1: the manager role is profile.isManager from the owner profile read (no positions drain).
  it("returns isManager true from the session profile", async () => {
    mocks.load.mockResolvedValue(profile(true));
    await expect(getOwnerProfileAction()).resolves.toEqual({ isManager: true });
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  // @rule R1: a non-manager profile resolves to the investor role.
  it("returns isManager false for a non-manager profile", async () => {
    mocks.load.mockResolvedValue(profile(false));
    await expect(getOwnerProfileAction()).resolves.toEqual({ isManager: false });
  });

  // @rule R1 (degrade-tolerant): an absent isManager field never grants the manager surface.
  it("degrades an absent isManager field to false", async () => {
    mocks.load.mockResolvedValue({} as unknown as ProfileUser);
    await expect(getOwnerProfileAction()).resolves.toEqual({ isManager: false });
  });

  // @rule R1 (degrade-tolerant): a read failure degrades to investor rather than throwing.
  it("degrades a read failure to false", async () => {
    mocks.load.mockRejectedValue(new Error("pp-api unreachable"));
    await expect(getOwnerProfileAction()).resolves.toEqual({ isManager: false });
  });
});
