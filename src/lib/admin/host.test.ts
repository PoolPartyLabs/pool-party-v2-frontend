/**
 * @id PP-ADM-AUTH-001
 * @name admin host gate — tests
 * Behavior (POO-144 R2): adm. host serves only /admin; every other host serves none; local dev is
 * exempt; the four host×path combinations gate correctly.
 */
import { describe, expect, it } from "vitest";
import { adminHostGate, isAdminHost, isAdminPath, isLocalHost } from "./host";

describe("isAdminHost", () => {
  it("matches the adm. subdomain (case-insensitive, port-tolerant)", () => {
    expect(isAdminHost("adm.pool-party.xyz")).toBe(true);
    expect(isAdminHost("ADM.POOL-PARTY.XYZ")).toBe(true);
    expect(isAdminHost("adm.pool-party.xyz:3000")).toBe(true);
  });
  it("rejects the public host and anything else", () => {
    expect(isAdminHost("pool-party.xyz")).toBe(false);
    expect(isAdminHost("www.pool-party.xyz")).toBe(false);
    expect(isAdminHost("admin.pool-party.xyz")).toBe(false); // not the adm. prefix
    expect(isAdminHost(null)).toBe(false);
    expect(isAdminHost(undefined)).toBe(false);
  });
});

describe("isAdminPath", () => {
  it("matches the /admin segment, with or without a locale prefix", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/overview")).toBe(true);
    expect(isAdminPath("/en/admin")).toBe(true);
    expect(isAdminPath("/pt-BR/admin/operations/managers")).toBe(true);
  });
  it("does not match investor paths or a partial word", () => {
    expect(isAdminPath("/")).toBe(false);
    expect(isAdminPath("/en")).toBe(false);
    expect(isAdminPath("/en/portfolio")).toBe(false);
    expect(isAdminPath("/administrator")).toBe(false);
    expect(isAdminPath("/en/administrator")).toBe(false);
  });
});

describe("isLocalHost", () => {
  it("recognizes local dev hosts", () => {
    expect(isLocalHost("localhost:3000")).toBe(true);
    expect(isLocalHost("127.0.0.1")).toBe(true);
    expect(isLocalHost("mymac.local")).toBe(true);
  });
  it("rejects real hosts", () => {
    expect(isLocalHost("adm.pool-party.xyz")).toBe(false);
    expect(isLocalHost("pool-party.xyz")).toBe(false);
    expect(isLocalHost(null)).toBe(false);
  });
});

describe("adminHostGate", () => {
  it("allows the adm. host on /admin and the public host off /admin", () => {
    expect(adminHostGate("adm.pool-party.xyz", "/en/admin/overview")).toBe("allow");
    expect(adminHostGate("pool-party.xyz", "/en/portfolio")).toBe("allow");
  });
  it("blocks the cross combinations", () => {
    expect(adminHostGate("adm.pool-party.xyz", "/en/portfolio")).toBe("block");
    expect(adminHostGate("pool-party.xyz", "/en/admin/overview")).toBe("block");
  });
});
