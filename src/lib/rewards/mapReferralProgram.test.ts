/**
 * @id PP-REW-LIB-003 (POO-661)
 * @name mapReferralProgram tests
 * @implements-rules-version v1
 *
 * [R3][R4] ACL mapper: the pp-api `/referral/:wallet` shape (or null) into the FE `ReferralProgram`.
 * Pins the field-gap decisions so nothing is fabricated: code/link/friendsJoined/invites derive from
 * the referrer record; rewardUsd/minInvestUsd are program constants; totalEarnedUsd stays 0 (POO-652).
 */
import { describe, expect, it } from "vitest";
import { referralProgramSchema } from "@/lib/schemas";
import { maskAddress } from "@/lib/utils/address";
import {
  mapReferralProgram,
  REFERRAL_MIN_INVEST_USD,
  REFERRAL_REWARD_USD,
} from "./mapReferralProgram";
import type { ApiReferral } from "./referralApiSchema";

const wallet1 = "0x1111111111111111111111111111111111111111";
const wallet2 = "0x2222222222222222222222222222222222222222";

describe("mapReferralProgram", () => {
  // @rule R3: a null payload (wallet has no referral record) maps to the empty program
  it("maps a null payload to the empty program", () => {
    const program = mapReferralProgram(null);
    expect(program.code).toBeNull();
    expect(program.inviteLink).toBeNull();
    expect(program.invites).toHaveLength(0);
    expect(program.friendsJoined).toBe(0);
    expect(program.totalEarnedUsd).toBe(0);
    expect(program.rewardUsd).toBe(REFERRAL_REWARD_USD);
    expect(program.minInvestUsd).toBe(REFERRAL_MIN_INVEST_USD);
    expect(referralProgramSchema.safeParse(program).success).toBe(true);
  });

  // @rule R4 / POO-853 R3: a code present with no referees → code + canonical `?ref=` link (as typed,
  // never lowercased, never the dead `/r/` route), friendsJoined 0
  it("builds the canonical `?ref=` invite link from the code, as typed, with no referees", () => {
    const api: ApiReferral = { wallet: "0xabc", code: "MARIA2026", referees: [] };
    const program = mapReferralProgram(api);
    expect(program.code).toBe("MARIA2026");
    expect(program.inviteLink).toBe("app.pool-party.xyz?ref=MARIA2026");
    expect(program.friendsJoined).toBe(0);
    expect(program.invites).toHaveLength(0);
  });

  // @rule R4: friendsJoined = referees.length and each referee maps to a pending invite (masked name)
  it("maps referees to friendsJoined and pending invites with a masked name", () => {
    const api: ApiReferral = {
      wallet: "0xabc",
      code: "MARIA2026",
      referees: [
        { wallet: wallet1, createdAt: "2026-01-01T00:00:00.000Z" },
        { wallet: wallet2, createdAt: "2026-02-01T00:00:00.000Z" },
      ],
    };
    const program = mapReferralProgram(api);
    expect(program.friendsJoined).toBe(2);
    expect(program.invites).toHaveLength(2);
    expect(program.invites[0]).toEqual({ name: maskAddress(wallet1), status: "pending" });
    // No invest/earn signal from this endpoint → investedUsd is absent (never fabricated).
    expect(program.invites[0]?.investedUsd).toBeUndefined();
    expect(referralProgramSchema.safeParse(program).success).toBe(true);
  });

  // @rule R4: an empty-string code (referee-only wallet) maps to null code + null link
  it("treats an empty-string code as no code (null code + null link)", () => {
    const api: ApiReferral = { wallet: "0xabc", code: "", referees: [] };
    const program = mapReferralProgram(api);
    expect(program.code).toBeNull();
    expect(program.inviteLink).toBeNull();
  });

  // @rule R4: a missing/undefined referees array degrades to an empty invite list (never throws)
  it("degrades a missing referees array to an empty invite list", () => {
    const api: ApiReferral = { wallet: "0xabc", code: "X6chars" };
    const program = mapReferralProgram(api);
    expect(program.friendsJoined).toBe(0);
    expect(program.invites).toHaveLength(0);
  });

  // Feature A (POO-579): invitedByCode is surfaced from the referrer record's `referredBy.code` (who
  // referred this wallet), so the referee view can show "Invited by <code>".
  // @rule R9: invitedByCode comes from referredBy.code when the wallet is itself a referee
  it("maps invitedByCode from referredBy.code", () => {
    const api: ApiReferral = {
      wallet: "0xabc",
      code: "",
      referees: [],
      isReferee: true,
      referredBy: { wallet: wallet1, code: "MARIA2026", referredAt: "2026-01-01T00:00:00.000Z" },
    };
    const program = mapReferralProgram(api);
    expect(program.invitedByCode).toBe("MARIA2026");
    expect(referralProgramSchema.safeParse(program).success).toBe(true);
  });

  // @rule R9: invitedByCode is null when the API record carries no referredBy (not a referee)
  it("maps invitedByCode to null when there is no referredBy", () => {
    const api: ApiReferral = { wallet: "0xabc", code: "MARIA2026", referees: [] };
    const program = mapReferralProgram(api);
    expect(program.invitedByCode).toBeNull();
    expect(referralProgramSchema.safeParse(program).success).toBe(true);
  });

  // @rule R9: a null payload (no record at all) has no inviter → invitedByCode null
  it("maps invitedByCode to null for a null payload", () => {
    expect(mapReferralProgram(null).invitedByCode).toBeNull();
  });

  // @rule R9: a referredBy present but with no code (partial backend record) degrades to null
  it("maps invitedByCode to null when referredBy has no code", () => {
    const api: ApiReferral = {
      wallet: "0xabc",
      code: "",
      referees: [],
      referredBy: { wallet: wallet1, referredAt: null },
    };
    expect(mapReferralProgram(api).invitedByCode).toBeNull();
  });
});
