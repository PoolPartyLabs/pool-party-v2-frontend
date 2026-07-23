/**
 * @id PP-ADM-MCK-003
 * @name rbac service — tests
 * Behavior (POO-591): the mapping seeds from the defaults; grants/revokes change live enforcement;
 * master cannot be edited; master-only capabilities cannot be delegated to operator/admin; edits
 * persist across reads.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { adminCan } from "@/lib/admin/rbac";
import { rbacService, resetMockRbacState } from "./index";

beforeEach(() => {
  resetMockRbacState();
});

describe("rbacService (mock)", () => {
  it("returns the seeded mapping", async () => {
    const mapping = await rbacService.getRoleCapabilities();
    expect(mapping.operator).toContain("verification.approve");
    expect(mapping.admin).toContain("verification.reject");
    expect(mapping.operator).not.toContain("verification.reject");
    expect(mapping.master).toContain("roles.configure");
  });

  it("grants a capability, changing live enforcement", async () => {
    const before = await rbacService.getRoleCapabilities();
    expect(adminCan({ role: "operator" }, "verification.reject", before)).toBe(false);

    const mapping = await rbacService.setRoleCapability("operator", "verification.reject", true);
    expect(mapping.operator).toContain("verification.reject");
    expect(adminCan({ role: "operator" }, "verification.reject", mapping)).toBe(true);
  });

  it("revokes a capability", async () => {
    const mapping = await rbacService.setRoleCapability("admin", "image.remove", false);
    expect(mapping.admin).not.toContain("image.remove");
    expect(adminCan({ role: "admin" }, "image.remove", mapping)).toBe(false);
  });

  it("cannot edit master (always all-powerful)", async () => {
    await expect(rbacService.setRoleCapability("master", "image.remove", false)).rejects.toThrow();
  });

  it("cannot delegate a master-only capability to operator or admin", async () => {
    await expect(
      rbacService.setRoleCapability("operator", "roles.configure", true),
    ).rejects.toThrow();
    await expect(
      rbacService.setRoleCapability("admin", "adminUsers.manage", true),
    ).rejects.toThrow();
  });

  it("rejects an unknown capability", async () => {
    await expect(
      // @ts-expect-error — exercising the runtime guard against a non-catalog capability
      rbacService.setRoleCapability("operator", "totally.made-up", true),
    ).rejects.toThrow();
  });

  it("persists edits across reads", async () => {
    await rbacService.setRoleCapability("operator", "verification.reject", true);
    const mapping = await rbacService.getRoleCapabilities();
    expect(mapping.operator).toContain("verification.reject");
  });
});
