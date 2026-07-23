/**
 * @id PP-CORE-MCK-004
 * @name profile service — tests
 * @implements-rules-version v1
 *
 * POO-222 rules v1: the mock `profileService` seam. [R1] get()/update() exist on the factory export;
 * [R2] get() returns a structural clone seeded from the fixture (mutating the result never leaks into
 * later reads); [R3] update() shallow-merges the editable subset (name/email/country), persists for
 * the process lifetime, returns a clone, leaves unpatched fields untouched, and an empty patch is a
 * no-op; [R6] resetMockProfileState() reseeds from the fixture.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mockProfileUser } from "@/mocks/data/profile";
import { profileService, resetMockProfileState } from "./index";

beforeEach(() => {
  resetMockProfileState();
});

describe("profileService (mock)", () => {
  // @rule R1: the service exposes get() and update() on the factory.
  it("exposes get() and update()", () => {
    expect(typeof profileService.get).toBe("function");
    expect(typeof profileService.update).toBe("function");
  });

  // @rule R2: get() returns the current session profile seeded from the fixture.
  it("get() returns the fixture-seeded identity", async () => {
    const profile = await profileService.get();
    expect(profile.name).toBe(mockProfileUser.name);
    expect(profile.email).toBe(mockProfileUser.email);
    expect(profile.username).toBe(mockProfileUser.username);
    expect(profile.isManager).toBe(mockProfileUser.isManager);
  });

  // @rule R2: the returned object is a structural clone; mutating it never affects later reads.
  it("get() returns a clone: mutating it does not affect subsequent reads", async () => {
    const first = await profileService.get();
    first.name = "tampered";
    const second = await profileService.get();
    expect(second.name).toBe(mockProfileUser.name);
  });

  // @rule R3: update() shallow-merges the editable subset and persists for the session.
  it("update() merges name/email/country and persists across reads", async () => {
    const updated = await profileService.update({
      name: "Maria R.",
      email: "maria.r@example.com",
      country: "Portugal",
    });
    expect(updated).toMatchObject({
      name: "Maria R.",
      email: "maria.r@example.com",
      country: "Portugal",
    });
    const reread = await profileService.get();
    expect(reread.name).toBe("Maria R.");
    expect(reread.email).toBe("maria.r@example.com");
    expect(reread.country).toBe("Portugal");
  });

  // @rule R3: unpatched fields are left untouched.
  it("update() leaves unpatched fields unchanged", async () => {
    await profileService.update({ name: "Maria R." });
    const reread = await profileService.get();
    expect(reread.username).toBe(mockProfileUser.username);
    expect(reread.phone).toBe(mockProfileUser.phone);
    expect(reread.email).toBe(mockProfileUser.email);
  });

  // @rule R3: an empty patch returns the current profile unchanged.
  it("update({}) returns the current profile unchanged", async () => {
    const updated = await profileService.update({});
    expect(updated.name).toBe(mockProfileUser.name);
    expect(updated.email).toBe(mockProfileUser.email);
    expect(updated.country).toBe(mockProfileUser.country);
  });

  // @rule R3: the update result is a clone; mutating it never leaks into later reads.
  it("update() returns a clone isolated from the stored profile", async () => {
    const updated = await profileService.update({ name: "Maria R." });
    updated.name = "tampered";
    const reread = await profileService.get();
    expect(reread.name).toBe("Maria R.");
  });

  // @rule R6: resetMockProfileState() reseeds the session profile from the fixture.
  it("resetMockProfileState() reseeds from the fixture", async () => {
    await profileService.update({ name: "Maria R." });
    resetMockProfileState();
    const reread = await profileService.get();
    expect(reread.name).toBe(mockProfileUser.name);
  });
});
