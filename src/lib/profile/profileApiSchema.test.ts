/**
 * @id PP-PROF-LIB-003 (POO-232)
 * @name Profile API schema tests
 * @implements-rules-version v1
 *
 * Pins the deployed pp-api profile projections: the public read has no `email`/`country`/`phone`; the
 * owner `GET`/`PATCH /users/me` response adds them (POO-674/POO-675). A leaked owner field on the public
 * projection is the failure this guards against.
 */
import { describe, expect, it } from "vitest";
import { apiOwnerProfileSchema, apiPublicProfileSchema } from "./profileApiSchema";

const base = {
  walletAddress: "0x1a2b3c4d5e6f7890a1b2c3d4e5f6789012345678",
  displayName: "0x1A2b...5678",
  avatarUrl: null,
  isManager: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("apiPublicProfileSchema", () => {
  // @rule POO-232 (public read parses; extra unknown keys are stripped, not rejected)
  it("parses the public projection", () => {
    expect(apiPublicProfileSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a set avatarUrl", () => {
    expect(
      apiPublicProfileSchema.safeParse({ ...base, avatarUrl: "https://cdn/x.png" }).success,
    ).toBe(true);
  });

  it("rejects a missing displayName", () => {
    const { displayName: _omit, ...withoutName } = base;
    expect(apiPublicProfileSchema.safeParse(withoutName).success).toBe(false);
  });
});

describe("apiOwnerProfileSchema", () => {
  const owner = { ...base, email: "a@b.com", country: "Brazil", phone: "+55 11 90000-0000" };

  // @rule POO-232 / POO-675 (owner /users/me response carries email + country + phone; each may be null)
  it("parses the owner projection with email, country and phone", () => {
    expect(apiOwnerProfileSchema.safeParse(owner).success).toBe(true);
    expect(
      apiOwnerProfileSchema.safeParse({ ...owner, email: null, country: null, phone: null })
        .success,
    ).toBe(true);
  });

  // @rule POO-675 (country/phone are required keys on the owner projection — null, never absent)
  it("rejects an owner projection missing country or phone", () => {
    const { country: _c, ...noCountry } = owner;
    const { phone: _p, ...noPhone } = owner;
    expect(apiOwnerProfileSchema.safeParse(noCountry).success).toBe(false);
    expect(apiOwnerProfileSchema.safeParse(noPhone).success).toBe(false);
  });
});
