/**
 * @id PP-CORE-LIB-122
 * @name experimentAccess tests
 * @implements-rules-version v1 (POO-2281)
 */
import { describe, expect, it } from "vitest";
import {
  deniedExperimentAccess,
  experimentAccessSchema,
  hasExperimentCapability,
  resolveExperimentAccess,
} from "./access";

const now = Date.parse("2026-10-07T13:00:00Z");
const allowed = {
  schemaVersion: 1,
  experiment: "solana-preview",
  status: "allowed",
  capabilities: ["preview"],
  expiresAt: "2026-10-07T13:01:00Z",
};

describe("experiment access contract", () => {
  // @rule R2: the API grant is a minimal versioned DTO, independent of a personal wallet.
  it("accepts an explicit preview grant and an explicit denial", () => {
    expect(experimentAccessSchema.safeParse(allowed).success).toBe(true);
    expect(experimentAccessSchema.safeParse(deniedExperimentAccess()).success).toBe(true);
  });

  // @rule R3: malformed or unknown contracts never grant access.
  it.each([
    null,
    {},
    { ...allowed, schemaVersion: 2 },
    { ...allowed, experiment: "other-preview" },
    { ...allowed, status: "enabled" },
    { ...allowed, capabilities: [] },
    { ...allowed, capabilities: ["admin"] },
    { ...allowed, capabilities: ["execute"] },
    { ...allowed, capabilities: ["preview", "preview"] },
    { ...allowed, expiresAt: null },
    { ...allowed, expiresAt: "later" },
    { ...deniedExperimentAccess(), capabilities: ["preview"] },
    { ...deniedExperimentAccess(), expiresAt: allowed.expiresAt },
  ])("denies an invalid contract: %j", (value) => {
    expect(experimentAccessSchema.safeParse(value).success).toBe(false);
    expect(resolveExperimentAccess(value, now)).toEqual(deniedExperimentAccess());
  });

  // @rule R4: identity, credentials and cohort membership do not reach this client contract.
  it.each([
    "wallet",
    "token",
    "email",
    "cohort",
    "isManager",
  ])("rejects an unexpected %s field", (field) => {
    expect(experimentAccessSchema.safeParse({ ...allowed, [field]: "private" }).success).toBe(
      false,
    );
  });

  // @rule R3: expiry is checked when consuming the grant, including at the exact deadline.
  it("permits before expiry and denies at expiry or after it", () => {
    expect(resolveExperimentAccess(allowed, now).status).toBe("allowed");
    expect(resolveExperimentAccess(allowed, Date.parse(allowed.expiresAt))).toEqual(
      deniedExperimentAccess(),
    );
    expect(resolveExperimentAccess(allowed, Date.parse(allowed.expiresAt) + 1)).toEqual(
      deniedExperimentAccess(),
    );
  });

  // @rule R3: an invalid clock must not admit a lease.
  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])("denies access when the clock is %s", (time) =>
    expect(resolveExperimentAccess(allowed, time)).toEqual(deniedExperimentAccess()));

  // @rule R7: catalog and execution are separate explicit grants.
  it("does not infer catalog or execution from preview", () => {
    expect(hasExperimentCapability(allowed, "preview", now)).toBe(true);
    expect(hasExperimentCapability(allowed, "catalog", now)).toBe(false);
    expect(hasExperimentCapability(allowed, "execute", now)).toBe(false);
    expect(hasExperimentCapability(allowed, "preview", Date.parse(allowed.expiresAt))).toBe(false);
    expect(
      hasExperimentCapability(
        { ...allowed, capabilities: ["preview", "catalog", "execute"] },
        "execute",
        now,
      ),
    ).toBe(true);
  });
});
