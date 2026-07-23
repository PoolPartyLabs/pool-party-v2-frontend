/**
 * @id PP-ADM-AUTH-001
 * @name admin session — tests
 * Behavior (POO-144 R5): parse validates shape/role/expiry; getAdminSession reads only the admin
 * cookie and ignores the investor `pp_access_token`; the mock-mode fallback yields a master session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value === undefined ? undefined : { value };
    },
  }),
}));

import {
  ADMIN_SESSION_COOKIE,
  getAdminSession,
  parseAdminSession,
  resolveAdminSession,
} from "./session";

const encode = (obj: unknown) => `h.${Buffer.from(JSON.stringify(obj)).toString("base64url")}.s`;
const validSession = {
  userId: "u1",
  email: "ana@pool-party.xyz",
  role: "admin" as const,
  twoFactorVerified: true,
};

beforeEach(() => cookieStore.clear());

describe("parseAdminSession", () => {
  it("returns null for missing or garbage input", () => {
    expect(parseAdminSession(null)).toBeNull();
    expect(parseAdminSession("")).toBeNull();
    expect(parseAdminSession("not-base64-json")).toBeNull();
  });

  it("rejects a bare base64(JSON) blob that is not a three-part JWT", () => {
    const bareBlob = Buffer.from(JSON.stringify(validSession)).toString("base64url");
    expect(parseAdminSession(bareBlob)).toBeNull();
  });

  it("decodes a well-formed session", () => {
    expect(parseAdminSession(encode(validSession))).toEqual(validSession);
  });

  it("rejects an unknown role", () => {
    expect(parseAdminSession(encode({ ...validSession, role: "superuser" }))).toBeNull();
  });

  it("rejects a missing email or non-boolean 2FA flag", () => {
    expect(parseAdminSession(encode({ ...validSession, email: undefined }))).toBeNull();
    expect(parseAdminSession(encode({ ...validSession, twoFactorVerified: "yes" }))).toBeNull();
  });

  it("honors an expiry claim", () => {
    expect(parseAdminSession(encode({ ...validSession, exp: 1 }))).toBeNull();
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect(parseAdminSession(encode({ ...validSession, exp: future }))).toEqual(validSession);
  });
});

describe("getAdminSession", () => {
  it("reads the admin cookie", async () => {
    cookieStore.set(ADMIN_SESSION_COOKIE, encode(validSession));
    expect(await getAdminSession()).toEqual(validSession);
  });

  it("ignores the investor pp_access_token cookie", async () => {
    cookieStore.set("pp_access_token", encode({ address: "0xabc" }));
    expect(await getAdminSession()).toBeNull();
  });
});

describe("resolveAdminSession", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null by default — no cookie and no explicit dev opt-in (POO-591 security)", async () => {
    vi.stubEnv("ADMIN_DEV_MASTER", "");
    expect(await resolveAdminSession()).toBeNull();
  });

  it("falls back to a dev master session only with the explicit non-prod opt-in", async () => {
    vi.stubEnv("ADMIN_DEV_MASTER", "1");
    const session = await resolveAdminSession();
    expect(session?.role).toBe("master");
    expect(session?.twoFactorVerified).toBe(true);
  });

  it("never falls back in production, even with the opt-in set", async () => {
    vi.stubEnv("ADMIN_DEV_MASTER", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(await resolveAdminSession()).toBeNull();
  });

  it("prefers a real cookie over the fallback", async () => {
    vi.stubEnv("ADMIN_DEV_MASTER", "1");
    cookieStore.set(ADMIN_SESSION_COOKIE, encode(validSession));
    expect(await resolveAdminSession()).toEqual(validSession);
  });
});
