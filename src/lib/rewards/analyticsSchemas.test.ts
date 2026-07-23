/**
 * @id PP-REW (POO-209)
 * @name Rubber Rush analytics response schemas tests
 * @implements-rules-version v1
 *
 * [R4] Validates the analytics indexer response shapes the Rubber Rush cutover
 * consumes: P1 /points/:a/summary, P2 /points/:a/tier, P3 /points/:a/duck-shoot/status.
 */
import { describe, expect, it } from "vitest";
import {
  duckShootPlayResponseSchema,
  duckShootStatusSchema,
  pointsSummarySchema,
  quackResponseSchema,
  referralsSummarySchema,
  tierInfoSchema,
} from "./analyticsSchemas";

describe("pointsSummarySchema (P1)", () => {
  it("parses a full summary payload", () => {
    const payload = {
      address: "0xabc",
      dailyPoints: 48,
      campaignPoints: 100,
      referralPoints: 12,
      quackPoints: 900,
      totalPoints: 15021,
    };
    expect(pointsSummarySchema.parse(payload)).toMatchObject({ totalPoints: 15021 });
  });

  it("rejects a payload missing totalPoints", () => {
    expect(pointsSummarySchema.safeParse({ dailyPoints: 1 }).success).toBe(false);
  });
});

describe("tierInfoSchema (P2)", () => {
  const base = {
    address: "0xabc",
    tierId: 2,
    tierName: "Swimmer",
    totalPoints: 15021,
    globalRank: 1234,
    percentile: 0.422,
    nextTierProgress: 68,
    roles: [{ roleName: "swimmer", multiplier: 1.1 }],
    hasSaidGM: false,
    totalBoost: 0,
    streak: { days: 3, multiplier: 1.2 },
  };

  it("parses a full tier payload", () => {
    expect(tierInfoSchema.parse(base)).toMatchObject({ tierId: 2, percentile: 0.422 });
  });

  it("allows totalBoost and hasSaidGM to be absent (the mapper applies defaults)", () => {
    const { totalBoost, hasSaidGM, ...rest } = base;
    const parsed = tierInfoSchema.parse(rest);
    expect(parsed.totalBoost).toBeUndefined();
    expect(parsed.hasSaidGM).toBeUndefined();
  });

  it("rejects a payload missing tierId", () => {
    const { tierId, ...rest } = base;
    expect(tierInfoSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a payload missing streak.days", () => {
    expect(tierInfoSchema.safeParse({ ...base, streak: { multiplier: 1 } }).success).toBe(false);
  });
});

describe("duckShootStatusSchema (P3)", () => {
  it("parses a full status payload", () => {
    const payload = {
      triesRemaining: 7,
      weeklyTriesLeft: 7,
      quacksEarnedToday: 48,
      weekResetAt: "2026-06-15T00:00:00Z",
    };
    expect(duckShootStatusSchema.parse(payload)).toMatchObject({
      triesRemaining: 7,
      quacksEarnedToday: 48,
    });
  });

  it("rejects a payload missing triesRemaining", () => {
    expect(duckShootStatusSchema.safeParse({ quacksEarnedToday: 1 }).success).toBe(false);
  });
});

describe("referralsSummarySchema (P6)", () => {
  it("parses a full referrals-summary payload and exposes totalReferrals", () => {
    // POO-854: the referral-rewards card depends on totalReferrals in real mode; lock the contract.
    const payload = {
      wallet: "0xabc",
      referralsQuacks24h: 12,
      referralsQuacksTotal: 340,
      totalReferrals: 4,
      lastUpdated: "2026-07-11T00:00:00Z",
    };
    expect(referralsSummarySchema.parse(payload)).toMatchObject({ totalReferrals: 4 });
  });

  it("rejects a payload missing totalReferrals", () => {
    expect(referralsSummarySchema.safeParse({ wallet: "0xabc" }).success).toBe(false);
  });
});

describe("quackResponseSchema (P4)", () => {
  it("parses the daily-quack success body", () => {
    const payload = { success: true, pointsAwarded: 10, wallet: "0xabc", date: "2026-06-10" };
    expect(quackResponseSchema.parse(payload)).toMatchObject({ pointsAwarded: 10 });
  });

  it("rejects a payload missing pointsAwarded", () => {
    expect(quackResponseSchema.safeParse({ success: true }).success).toBe(false);
  });
});

describe("duckShootPlayResponseSchema (P5)", () => {
  it("parses the play success body", () => {
    const payload = {
      ok: true,
      outcome: { value: 300, label: "300%" },
      quacksAwarded: 1500,
      triesRemaining: 2,
      weeklyTriesLeft: 5,
      quacksEarnedToday: 1500,
    };
    expect(duckShootPlayResponseSchema.parse(payload)).toMatchObject({
      outcome: { value: 300 },
      quacksAwarded: 1500,
    });
  });

  it("rejects a payload missing outcome.value", () => {
    expect(
      duckShootPlayResponseSchema.safeParse({
        outcome: { label: "x" },
        quacksAwarded: 1,
        triesRemaining: 1,
      }).success,
    ).toBe(false);
  });
});
