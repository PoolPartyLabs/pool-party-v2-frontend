/**
 * @id PP-PROF-LIB-004 (POO-233, POO-426, POO-661)
 * @name fetchInvestorProfile tests
 * @implements-rules-version v1
 *
 * The real identity read: signed in, the OWNER projection `GET /users/me` (POO-674) so email +
 * country/phone (POO-675) survive a reload; signed out (or on an owner-read failure during rollout), the
 * PUBLIC `GET /users/:address` (POO-232). Both map to ProfileUser with Quacks composed from the analytics
 * rewards read (POO-426) and referral code/joined from the pp-api referral read (POO-661). A rewards
 * outage degrades Quacks to zero; a referral outage degrades the referral fields to empty — neither takes
 * identity down.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReferralProgram, RubberRush } from "@/lib/schemas";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

const getAuthHeader = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getAuthHeader: () => getAuthHeader() }));

const fetchRubberRush = vi.fn();
vi.mock("@/lib/rewards/fetchRubberRush", () => ({
  fetchRubberRush: (...args: unknown[]) => fetchRubberRush(...args),
}));

const fetchReferral = vi.fn();
vi.mock("@/lib/rewards/fetchReferral", () => ({
  fetchReferral: (...args: unknown[]) => fetchReferral(...args),
}));

async function importModule() {
  vi.resetModules();
  return import("./fetchInvestorProfile");
}

const address = "0x1a2b3c4d5e6f7890a1b2c3d4e5f6789012345678";
const authHeader = { Authorization: "Bearer session-jwt" };
/** The OWNER projection returned by GET /users/me (carries the private name + email + country + phone). */
const ownerProfile = {
  walletAddress: address,
  // POO-693: the owner projection carries the PRIVATE `name`; the public read omits it.
  name: "Ana Private",
  displayName: "Ana Invests",
  avatarUrl: null,
  isManager: true,
  email: "ana@b.com",
  country: "Brazil",
  phone: "+55 11 90000-0000",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};
/** The PUBLIC projection returned by GET /users/:address (no email/country/phone). */
const apiProfile = {
  walletAddress: address,
  displayName: "Ana Invests",
  avatarUrl: null,
  isManager: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};
const rewards = {
  quacks: 15_021,
  totalReferrals: 99,
  referralCode: "FROM_ANALYTICS",
} as unknown as RubberRush;
const referral: ReferralProgram = {
  rewardUsd: 10,
  minInvestUsd: 50,
  totalEarnedUsd: 0,
  friendsJoined: 3,
  code: "ANA2026",
  inviteLink: "app.pool-party.xyz?ref=ana2026",
  invites: [],
};

describe("fetchInvestorProfile", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    getAuthHeader.mockReset();
    fetchRubberRush.mockReset();
    fetchReferral.mockReset();
    // Default to a signed-in session (Bearer present) — the common owner-read path.
    getAuthHeader.mockResolvedValue(authHeader);
  });

  // @rule POO-674 (signed in → reads the OWNER endpoint GET /users/me with the session Bearer, mapping
  // email + country + phone) · POO-426 (Quacks from rewards) · R6 (referral from pp-api)
  it("reads GET users/me with the Bearer and maps email/country/phone when signed in", async () => {
    apiFetch.mockResolvedValue(ownerProfile);
    fetchRubberRush.mockResolvedValue(rewards);
    fetchReferral.mockResolvedValue(referral);
    const { fetchInvestorProfile } = await importModule();

    const user = await fetchInvestorProfile(address);

    const call = apiFetch.mock.calls[0];
    if (!call) throw new Error("apiFetch was not called");
    const [path, opts] = call as [
      string,
      { revalidate?: number; tags?: string[]; headers?: Record<string, string> },
    ];
    expect(path).toBe("users/me");
    expect(opts.headers).toEqual(authHeader);
    expect(opts.revalidate).toBeGreaterThan(0);
    expect(opts.tags).toEqual([`profile:${address}`]);
    expect(fetchRubberRush).toHaveBeenCalledWith(address);
    expect(fetchReferral).toHaveBeenCalledWith(address);

    // POO-693: `displayName` is the PUBLIC field; the PRIVATE `name` round-trips from the owner projection.
    expect(user.displayName).toBe("Ana Invests");
    expect(user.name).toBe("Ana Private");
    expect(user.isManager).toBe(true);
    // Owner-only identity now round-trips (the whole point of POO-674/POO-675).
    expect(user.email).toBe("ana@b.com");
    expect(user.country).toBe("Brazil");
    expect(user.phone).toBe("+55 11 90000-0000");
    // Referral fields come from pp-api /referral, NOT from the analytics rewards read.
    expect(user.referralCode).toBe("ANA2026");
    expect(user.referralJoined).toBe(3);
    // Quacks still come from the analytics rewards read.
    expect(user.quacks).toBe(15_021);
  });

  // @rule POO-674 (signed out → falls back to the PUBLIC read GET /users/:address, no email/country/phone)
  it("reads GET users/:address (public) when signed out", async () => {
    getAuthHeader.mockResolvedValue({});
    apiFetch.mockResolvedValue(apiProfile);
    fetchRubberRush.mockResolvedValue(rewards);
    fetchReferral.mockResolvedValue(referral);
    const { fetchInvestorProfile } = await importModule();

    const user = await fetchInvestorProfile(address);

    const [path, opts] = apiFetch.mock.calls[0] as [string, { headers?: Record<string, string> }];
    expect(path).toBe(`users/${address}`);
    expect(opts.headers).toBeUndefined();
    // POO-693: the public read carries the display name but NEVER the private name (→ "").
    expect(user.displayName).toBe("Ana Invests");
    expect(user.name).toBe("");
    expect(user.email).toBe("");
  });

  // @rule POO-674 (graceful degradation: the owner read is unavailable during rollout / 401 → fall back
  // to the public read so identity still renders, minus the owner-only fields)
  it("falls back to the public read when the owner read fails", async () => {
    getAuthHeader.mockResolvedValue(authHeader);
    apiFetch.mockImplementation(async (path: string) => {
      if (path === "users/me") throw new Error("404 not deployed");
      return apiProfile;
    });
    fetchRubberRush.mockResolvedValue(rewards);
    fetchReferral.mockResolvedValue(referral);
    const { fetchInvestorProfile } = await importModule();

    const user = await fetchInvestorProfile(address);

    const paths = apiFetch.mock.calls.map((c) => c[0]);
    expect(paths).toContain("users/me");
    expect(paths).toContain(`users/${address}`);
    expect(user.displayName).toBe("Ana Invests"); // identity still loads from the public read
    expect(user.name).toBe(""); // the private name is owner-only, absent on the public projection
    expect(user.email).toBe(""); // owner-only field unavailable via the public projection
  });

  // @rule POO-426 (a rewards outage must not fail identity → Quacks degrade to 0)
  it("degrades Quacks to zero when the rewards read throws", async () => {
    apiFetch.mockResolvedValue(ownerProfile);
    fetchRubberRush.mockRejectedValue(new Error("analytics down"));
    fetchReferral.mockResolvedValue(referral);
    const { fetchInvestorProfile } = await importModule();

    const user = await fetchInvestorProfile(address);
    expect(user.displayName).toBe("Ana Invests");
    expect(user.quacks).toBe(0);
    expect(user.referralCode).toBe("ANA2026"); // referral read still succeeded
  });

  // @rule R7 (a referral outage must not fail identity → referral fields degrade to empty)
  it("degrades referral fields to empty when the referral read throws", async () => {
    apiFetch.mockResolvedValue(ownerProfile);
    fetchRubberRush.mockResolvedValue(rewards);
    fetchReferral.mockRejectedValue(new Error("pp-api down"));
    const { fetchInvestorProfile } = await importModule();

    const user = await fetchInvestorProfile(address);
    expect(user.displayName).toBe("Ana Invests");
    expect(user.referralCode).toBe("");
    expect(user.referralJoined).toBe(0);
    expect(user.quacks).toBe(15_021); // rewards read still succeeded
  });

  // @rule POO-232 (fetch-or-create; a null/empty read still yields a blank identity, never throws)
  it("degrades a null read to a blank identity", async () => {
    apiFetch.mockResolvedValue(null);
    fetchRubberRush.mockResolvedValue(null);
    fetchReferral.mockResolvedValue(null);
    const { fetchInvestorProfile } = await importModule();

    const user = await fetchInvestorProfile(address);
    expect(user.name).toBe("");
    expect(user.initial).toBe("");
  });

  it("exposes a lowercased per-wallet cache tag", async () => {
    const { profileTag } = await importModule();
    expect(profileTag("0xABC")).toBe("profile:0xabc");
  });
});
