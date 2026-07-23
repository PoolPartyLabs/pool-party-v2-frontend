/**
 * @id PP-PROF-MCK-001
 * @name profile mock data tests
 * @implements-rules-version v1
 *
 * POO-222 [R4]: the relocated `mockProfileUser` fixture is schema-valid against `profileUserSchema`
 * and preserves the PII-shaped identity (name/email/username/country/phone + referral + quacks +
 * isManager), so the service seam has a stable contract to clone from.
 */
import { describe, expect, it } from "vitest";
import { profileUserSchema } from "@/lib/schemas";
import { mockProfileUser } from "./profile";

describe("profile mock data", () => {
  // @rule R4: the fixture validates against the profile schema.
  it("passes the ProfileUser schema parse", () => {
    expect(() => profileUserSchema.parse(mockProfileUser)).not.toThrow();
  });

  // @rule R4: the PII-shaped identity fields are preserved.
  it("preserves the PII-shaped identity fields", () => {
    expect(mockProfileUser).toMatchObject({
      name: expect.any(String),
      email: expect.any(String),
      username: expect.any(String),
      country: expect.any(String),
      phone: expect.any(String),
      referralCode: expect.any(String),
      quacks: expect.any(Number),
      isManager: expect.any(Boolean),
    });
  });
});
