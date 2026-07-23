/**
 * @id PP-ADM-AUTH-001
 * @name admin RBAC — tests
 * Behavior: capability catalog is consistent; master is all-powerful; operator/admin follow the
 * v1 defaults; the mapping (not role strings) decides; assertAdminCan throws with the capability.
 */
import { describe, expect, it } from "vitest";
import {
  ADMIN_CAPABILITIES,
  ADMIN_CAPABILITY_KEYS,
  AdminForbiddenError,
  adminCan,
  assertAdminCan,
  DEFAULT_ROLE_CAPABILITIES,
  type RoleCapabilityMapping,
  roleHasCapability,
} from "./rbac";

describe("admin capability catalog", () => {
  it("every entry key is unique", () => {
    expect(new Set(ADMIN_CAPABILITY_KEYS).size).toBe(ADMIN_CAPABILITY_KEYS.length);
  });

  it("masterOnly capabilities are not granted to operator or admin by default", () => {
    const masterOnly = ADMIN_CAPABILITIES.filter((c) => c.masterOnly).map((c) => c.key);
    for (const cap of masterOnly) {
      expect(DEFAULT_ROLE_CAPABILITIES.operator).not.toContain(cap);
      expect(DEFAULT_ROLE_CAPABILITIES.admin).not.toContain(cap);
      expect(DEFAULT_ROLE_CAPABILITIES.master).toContain(cap);
    }
  });
});

describe("roleHasCapability / adminCan", () => {
  it("master holds every capability in the catalog", () => {
    for (const cap of ADMIN_CAPABILITY_KEYS) {
      expect(adminCan({ role: "master" }, cap)).toBe(true);
    }
  });

  it("master stays all-powerful even under an empty mapping", () => {
    const empty: RoleCapabilityMapping = { operator: [], admin: [], master: [] };
    for (const cap of ADMIN_CAPABILITY_KEYS) {
      expect(roleHasCapability(empty, "master", cap)).toBe(true);
    }
  });

  it("operator has the three feature capabilities but not the administration ones", () => {
    expect(adminCan({ role: "operator" }, "verification.approve")).toBe(true);
    expect(adminCan({ role: "operator" }, "image.approve")).toBe(true);
    expect(adminCan({ role: "operator" }, "image.remove")).toBe(true);
    expect(adminCan({ role: "operator" }, "adminUsers.manage")).toBe(false);
    expect(adminCan({ role: "operator" }, "roles.configure")).toBe(false);
  });

  it("admin matches operator's feature grants by default", () => {
    for (const cap of ["verification.approve", "image.approve", "image.remove"] as const) {
      expect(adminCan({ role: "admin" }, cap)).toBe(true);
    }
    expect(adminCan({ role: "admin" }, "roles.configure")).toBe(false);
  });

  it("only admin and master can reject verification (operator cannot)", () => {
    expect(adminCan({ role: "operator" }, "verification.reject")).toBe(false);
    expect(adminCan({ role: "admin" }, "verification.reject")).toBe(true);
    expect(adminCan({ role: "master" }, "verification.reject")).toBe(true);
  });

  it("a null session is never capable", () => {
    expect(adminCan(null, "image.approve")).toBe(false);
    expect(adminCan(undefined, "image.approve")).toBe(false);
  });

  it("respects a custom mapping for non-master roles", () => {
    const mapping: RoleCapabilityMapping = {
      operator: ["verification.approve"],
      admin: [],
      master: [...ADMIN_CAPABILITY_KEYS],
    };
    expect(adminCan({ role: "operator" }, "verification.approve", mapping)).toBe(true);
    expect(adminCan({ role: "operator" }, "image.remove", mapping)).toBe(false);
    expect(adminCan({ role: "admin" }, "verification.approve", mapping)).toBe(false);
  });
});

describe("assertAdminCan", () => {
  it("does not throw for a capable session", () => {
    expect(() => assertAdminCan({ role: "master" }, "roles.configure")).not.toThrow();
    expect(() => assertAdminCan({ role: "operator" }, "image.approve")).not.toThrow();
  });

  it("throws AdminForbiddenError carrying the capability when denied", () => {
    try {
      assertAdminCan({ role: "operator" }, "roles.configure");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AdminForbiddenError);
      expect((error as AdminForbiddenError).capability).toBe("roles.configure");
    }
  });

  it("throws for a null session", () => {
    expect(() => assertAdminCan(null, "image.approve")).toThrow(AdminForbiddenError);
  });
});
