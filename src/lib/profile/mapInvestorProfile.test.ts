/**
 * @id PP-PROF-LIB-002 (POO-233, POO-426, POO-661)
 * @name mapInvestorProfile tests
 * @implements-rules-version v1
 *
 * The ACL mapper turns the deployed pp-api public profile (POO-232) plus the analytics rewards read
 * plus the pp-api referral read into the FE `ProfileUser`. It pins the field-gap decisions:
 * displayName->public displayName + profile.name->private name (POO-693), isManager passes through,
 * Quacks come from the analytics rewards read, referral
 * code + joined count come from pp-api `/referral` (POO-661 — authoritative source, NOT analytics),
 * email/country/phone come from the OWNER `/users/me` projection (POO-674/POO-675, `null`->`""`, absent
 * on the public shape->`""`), and the fields with NO backend source (username, emailVerified) stay
 * empty/false. A referral or rewards outage must not fail identity.
 */
import { describe, expect, it } from "vitest";
import { profileUserSchema, type ReferralProgram, type RubberRush } from "@/lib/schemas";
import { deriveInitial, mapInvestorProfile } from "./mapInvestorProfile";
import type { ApiPublicProfile } from "./profileApiSchema";

const apiProfile: ApiPublicProfile = {
  walletAddress: "0x1a2b3c4d5e6f7890a1b2c3d4e5f6789012345678",
  displayName: "Ana Invests",
  avatarUrl: null,
  isManager: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

/** Minimal RubberRush stub carrying only the field the mapper reads (Quacks). */
const rewards = {
  quacks: 15_021.4,
  // POO-661: the mapper no longer reads referralCode/totalReferrals from the rewards read — set them to
  // conflicting values to prove the referral fields come from the referral read, not from here.
  totalReferrals: 99,
  referralCode: "FROM_ANALYTICS",
} as unknown as RubberRush;

/** The authoritative pp-api referral program (POO-661). */
const referral: ReferralProgram = {
  rewardUsd: 10,
  minInvestUsd: 50,
  totalEarnedUsd: 0,
  friendsJoined: 3,
  code: "ANA2026",
  inviteLink: "app.pool-party.xyz?ref=ana2026",
  invites: [],
};

describe("mapInvestorProfile", () => {
  // @rule POO-426 (get resolves the real identity → a valid ProfileUser)
  it("produces a schema-valid ProfileUser", () => {
    const user = mapInvestorProfile(apiProfile, rewards, referral);
    expect(profileUserSchema.safeParse(user).success).toBe(true);
  });

  // @rule POO-693 (displayName -> the PUBLIC field, profile.name -> the PRIVATE field, isManager through)
  it("maps displayName to the public field, name to the private field, and isManager through", () => {
    const user = mapInvestorProfile({ ...apiProfile, name: "Ana Private" }, rewards, referral);
    expect(user.displayName).toBe("Ana Invests");
    expect(user.name).toBe("Ana Private");
    expect(user.isManager).toBe(false);
  });

  // @rule POO-233 R2 / POO-693 (the masked-address default flows through as the PUBLIC displayName)
  it("keeps the backend masked-address default as the public displayName", () => {
    const user = mapInvestorProfile(
      { ...apiProfile, displayName: "0x1A2b...5678" },
      rewards,
      referral,
    );
    expect(user.displayName).toBe("0x1A2b...5678");
  });

  // @rule POO-693 (the PRIVATE name is owner-only: absent on the public read / older responses → "")
  it("degrades an absent private name to an empty string", () => {
    const user = mapInvestorProfile(apiProfile, rewards, referral);
    expect(user.name).toBe("");
  });

  // @rule POO-693 (a null private name maps to "" — never null in ProfileUser)
  it("maps a null private name to an empty string", () => {
    const user = mapInvestorProfile({ ...apiProfile, name: null }, rewards, referral);
    expect(user.name).toBe("");
  });

  // @rule R6 (referral code + joined count come from pp-api /referral, NOT the analytics rewards read)
  it("sources referral code and joined count from the pp-api referral read", () => {
    const user = mapInvestorProfile(apiProfile, rewards, referral);
    expect(user.referralCode).toBe("ANA2026");
    expect(user.referralJoined).toBe(3);
  });

  // @rule R6 (Quacks still come from the analytics rewards read, rounded to an integer)
  it("sources Quacks from the analytics rewards read", () => {
    const user = mapInvestorProfile(apiProfile, rewards, referral);
    expect(user.quacks).toBe(15_021);
  });

  // @rule R6 (a null referral code maps to an empty string, never null in ProfileUser)
  it("maps a not-yet-created referral code (null) to an empty string", () => {
    const user = mapInvestorProfile(apiProfile, rewards, {
      ...referral,
      code: null,
      friendsJoined: 0,
    });
    expect(user.referralCode).toBe("");
    expect(user.referralJoined).toBe(0);
  });

  // @rule POO-426 (referralEarned has no backend source yet → 0, tracked as a follow-up POO-652)
  it("defaults referralEarned to 0 (no backend source)", () => {
    expect(mapInvestorProfile(apiProfile, rewards, referral).referralEarned).toBe(0);
  });

  // @rule POO-674/POO-675 (the PUBLIC shape has no owner fields → email/country/phone degrade to empty)
  it("leaves owner-only fields empty on the public projection (email/country/phone)", () => {
    const user = mapInvestorProfile(apiProfile, rewards, referral);
    expect(user.email).toBe("");
    expect(user.country).toBe("");
    expect(user.phone).toBe("");
  });

  // @rule POO-675 (username removed from the UI + no email-verification backend → stay empty/false)
  it("keeps username empty and emailVerified false (no backend source)", () => {
    const user = mapInvestorProfile(apiProfile, rewards, referral);
    expect(user.username).toBe("");
    expect(user.emailVerified).toBe(false);
  });

  // @rule POO-674/POO-675 (the OWNER /users/me projection carries email + country + phone → mapped)
  it("maps email, country and phone from the owner projection", () => {
    const user = mapInvestorProfile(
      { ...apiProfile, email: "ana@b.com", country: "Brazil", phone: "+55 11 90000-0000" },
      rewards,
      referral,
    );
    expect(user.email).toBe("ana@b.com");
    expect(user.country).toBe("Brazil");
    expect(user.phone).toBe("+55 11 90000-0000");
    expect(profileUserSchema.safeParse(user).success).toBe(true);
  });

  // @rule POO-674/POO-675 (a null owner email/country/phone maps to "" — never null in ProfileUser)
  it("maps null owner email/country/phone to empty strings", () => {
    const user = mapInvestorProfile(
      { ...apiProfile, email: null, country: null, phone: null },
      rewards,
      referral,
    );
    expect(user.email).toBe("");
    expect(user.country).toBe("");
    expect(user.phone).toBe("");
  });

  // @rule POO-580 (avatar <- backend avatarUrl → a persisted avatar renders after reload)
  it("maps a persisted avatarUrl to avatar", () => {
    const url = "https://cdn.pool-party.xyz/avatars/0xw.png?v=1";
    const user = mapInvestorProfile({ ...apiProfile, avatarUrl: url }, rewards, referral);
    expect(user.avatar).toBe(url);
  });

  // @rule POO-580 (a never-uploaded avatarUrl (null) → "" so the UI falls back to `initial`)
  it("maps a null avatarUrl to an empty avatar", () => {
    const user = mapInvestorProfile({ ...apiProfile, avatarUrl: null }, rewards, referral);
    expect(user.avatar).toBe("");
  });

  // @rule R7 (a referral outage → referral fields degrade to empty/zero, identity still loads)
  it("degrades referral fields to empty/zero when the referral read is null", () => {
    const user = mapInvestorProfile(apiProfile, rewards, null);
    expect(user.referralCode).toBe("");
    expect(user.referralJoined).toBe(0);
    expect(user.quacks).toBe(15_021); // Quacks still come from the rewards read
    expect(profileUserSchema.safeParse(user).success).toBe(true);
  });

  // @rule POO-426 (a rewards outage → Quacks degrade to zero, identity still loads)
  it("degrades Quacks to zero when the rewards read is null", () => {
    const user = mapInvestorProfile(apiProfile, null, referral);
    expect(user.quacks).toBe(0);
    expect(user.referralCode).toBe("ANA2026"); // referral still comes from the referral read
    expect(profileUserSchema.safeParse(user).success).toBe(true);
  });

  // @rule R7 (both reads absent → a fully blank-but-valid identity, never throws)
  it("degrades both referral and Quacks to empty/zero when both reads are null", () => {
    const user = mapInvestorProfile(apiProfile, null, null);
    expect(user.quacks).toBe(0);
    expect(user.referralJoined).toBe(0);
    expect(user.referralCode).toBe("");
    expect(profileUserSchema.safeParse(user).success).toBe(true);
  });
});

describe("deriveInitial", () => {
  // @rule POO-426 (initial is derived client-side)
  it("derives the uppercase first alphanumeric character of the display name", () => {
    expect(deriveInitial("ana invests")).toBe("A");
    expect(deriveInitial("  bob")).toBe("B");
  });

  // @rule POO-693 (skip a leading "0x" so a wallet-style name yields its first REAL letter/digit, not "0")
  it("skips a leading 0x prefix (case-insensitive)", () => {
    expect(deriveInitial("0xrzdev")).toBe("R");
    expect(deriveInitial("0X1A2b...5678")).toBe("1");
    expect(deriveInitial("0x1A2b...5678")).toBe("1");
  });

  // @rule POO-693 (a name with no usable letter/digit after skipping 0x → a neutral glyph, never "0")
  it("falls back to a neutral glyph when there is no alphanumeric character", () => {
    expect(deriveInitial("0x")).toBe("•");
    expect(deriveInitial("0x...")).toBe("•");
  });

  // @rule POO-426 (empty display name → empty initial, never throws)
  it("returns an empty string for an empty display name", () => {
    expect(deriveInitial("")).toBe("");
    expect(deriveInitial("   ")).toBe("");
  });
});
