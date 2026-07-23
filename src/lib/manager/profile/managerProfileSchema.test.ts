/**
 * Tests for the manager-profile registry contract (POO-579): response Zod, DTO->FE mapping, and the
 * deterministic write-body builder (field mapping, https-only images, socials full-replace).
 */
import { describe, expect, it } from "vitest";
import type { UpdateManagerProfileInput } from "@/lib/services";
import {
  type ApiManagerProfile,
  apiManagerProfileSchema,
  buildManagerProfileBody,
  deriveSinceLabel,
  MANAGER_UPDATE_ACTION,
  mapManagerProfile,
} from "./managerProfileSchema";

const apiFixture: ApiManagerProfile = {
  walletAddress: "0xabc0000000000000000000000000000000000001",
  handle: "carlos",
  handleLocked: true,
  displayName: "Carlos",
  bio: "DeFi builder",
  avatarUrl: "https://cdn.pool.party/a.png",
  bannerUrl: null,
  managerVerification: "valid",
  socials: {
    x: "https://x.com/carlos",
    telegram: null,
    discord: null,
    youtube: null,
    website: "https://carlos.xyz",
  },
  createdAt: "2024-03-01T00:00:00.000Z",
  updatedAt: "2024-06-01T00:00:00.000Z",
};

describe("apiManagerProfileSchema", () => {
  it("accepts the deployed response shape", () => {
    expect(apiManagerProfileSchema.parse(apiFixture)).toEqual(apiFixture);
  });

  it("rejects a response missing a required column", () => {
    const { walletAddress: _drop, ...partial } = apiFixture;
    expect(apiManagerProfileSchema.safeParse(partial).success).toBe(false);
  });

  // POO-809 [R3]: during BE rollout an old backend still sends `verified: true`. The schema is
  // non-strict, so the legacy key is stripped (never surfaced onto the FE ManagerProfile) rather than
  // failing the read — the tolerance that lets FE deploy before the BE column drop.
  it("[R3] strips a legacy `verified` key an old BE may still send (rollout tolerance)", () => {
    const withLegacy = { ...apiFixture, verified: true };
    const parsed = apiManagerProfileSchema.parse(withLegacy);
    expect("verified" in parsed).toBe(false);
    expect("verified" in mapManagerProfile(withLegacy)).toBe(false);
  });
});

describe("deriveSinceLabel", () => {
  it("composes the year from createdAt", () => {
    expect(deriveSinceLabel("2024-03-01T00:00:00.000Z")).toBe("Since 2024");
  });

  it("is empty for an empty or unparseable timestamp", () => {
    expect(deriveSinceLabel("")).toBe("");
    expect(deriveSinceLabel("not-a-date")).toBe("");
  });
});

describe("mapManagerProfile", () => {
  it("maps the registry response 1:1 onto the FE ManagerProfile with zeroed stats by default", () => {
    expect(mapManagerProfile(apiFixture)).toEqual({
      handle: "carlos",
      handleLocked: true,
      address: "0xabc0000000000000000000000000000000000001",
      name: "Carlos",
      avatarUrl: "https://cdn.pool.party/a.png",
      bio: "DeFi builder",
      managerVerification: "valid",
      sinceLabel: "Since 2024",
      bannerUrl: undefined,
      socials: {
        x: "https://x.com/carlos",
        telegram: undefined,
        discord: undefined,
        youtube: undefined,
        website: "https://carlos.xyz",
      },
      stats: { aum: 0, investors: 0, strategies: 0, avgApy: 0 },
    });
  });

  it("uses the composed stats when provided", () => {
    const stats = { aum: 1000, investors: 12, strategies: 3, avgApy: 8.5 };
    expect(mapManagerProfile(apiFixture, stats).stats).toEqual(stats);
  });

  it("never carries an instagram social (not a registry column)", () => {
    expect("instagram" in mapManagerProfile(apiFixture).socials).toBe(false);
  });

  // POO-745 [R1]: managerVerification drives the badge; map it through when present.
  it("maps managerVerification through from the projection", () => {
    expect(
      mapManagerProfile({ ...apiFixture, managerVerification: "pending" }).managerVerification,
    ).toBe("pending");
  });

  // POO-745 [R1]: the field is absent until POO-744 deploys — default to 'none', never blank the
  // profile (the portfolio-schema-drift failure class: a missing field must not fail the whole read).
  it("defaults managerVerification to 'none' when the API omits it", () => {
    const { managerVerification: _drop, ...withoutStatus } = apiFixture;
    expect(mapManagerProfile(withoutStatus).managerVerification).toBe("none");
  });
});

describe("buildManagerProfileBody", () => {
  it("maps name->displayName and full-replaces socials with empty-string clears", () => {
    const input: UpdateManagerProfileInput = {
      name: "Carlos",
      bio: "gm",
      socials: { x: "https://x.com/carlos", telegram: undefined },
    };
    expect(buildManagerProfileBody(input)).toEqual({
      displayName: "Carlos",
      bio: "gm",
      socials: { x: "https://x.com/carlos", telegram: "", discord: "", youtube: "", website: "" },
    });
  });

  it("sends the chosen handle on a first save but drops handleLocked (server-derived)", () => {
    const body = buildManagerProfileBody({ name: "C", handle: "carlos", handleLocked: true });
    expect(body.handle).toBe("carlos");
    expect("handleLocked" in body).toBe(false);
  });

  it("forwards an https avatar/banner but drops a data-url crop (registry is https-only)", () => {
    const withHosted = buildManagerProfileBody({ avatarUrl: "https://cdn/a.png" });
    expect(withHosted.avatarUrl).toBe("https://cdn/a.png");

    const withDataUrl = buildManagerProfileBody({ avatarUrl: "data:image/png;base64,AAAA" });
    expect("avatarUrl" in withDataUrl).toBe(false);
  });

  it("omits fields the caller did not set (partial update)", () => {
    expect(buildManagerProfileBody({})).toEqual({});
  });

  it("exposes the guard's action name", () => {
    expect(MANAGER_UPDATE_ACTION).toBe("manager.update");
  });
});
