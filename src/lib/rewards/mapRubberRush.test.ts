/**
 * @id PP-REW (POO-209, POO-763)
 * @name mapRubberRush tests
 * @implements-rules-version v1
 *
 * [R2][R3][R5] Pure mapping from the analytics slices (P1 summary, P2 tier, P3 duck-shoot status,
 * P6 referrals summary) to the FE RubberRush shape, with per-slice defaults. POO-763: "Quacks earned
 * today" is the summary's dailyPoints, weeklyTriesLeft + totalReferrals come from their real slices.
 */
import { describe, expect, it } from "vitest";
import { rubberRushSchema } from "@/lib/schemas";
import {
  mapRubberRush,
  REFERRAL_FRIENDS_TARGET,
  REFERRAL_TIER_MULTIPLIER_X,
  RUBBER_RUSH_PLACEHOLDERS,
} from "./mapRubberRush";

const summary = { totalPoints: 15021, dailyPoints: 286 };
const tier = {
  tierId: 2,
  percentile: 0.422,
  nextTierProgress: 68,
  totalBoost: 0,
  hasSaidGM: false,
  streak: { days: 3 },
};
const status = { triesRemaining: 7, weeklyTriesLeft: 5, quacksEarnedToday: 48 };
const referrals = { totalReferrals: 4 };

describe("mapRubberRush", () => {
  it("[R2] maps every sourced field from the four slices", () => {
    const result = mapRubberRush({ summary, tier, status, referrals });
    expect(result.quacks).toBe(15021); // P1 totalPoints
    expect(result.tierIndex).toBe(1); // tierId 2 - 1
    expect(result.tierTopPercent).toBe(57.8); // (1 - 0.422) * 100, 1dp
    expect(result.tierProgressPct).toBe(68); // nextTierProgress
    expect(result.dailyBoostX).toBe(0); // totalBoost
    expect(result.streakDays).toBe(3); // streak.days
    expect(result.quackedToday).toBe(false); // hasSaidGM
    expect(result.quacksToday).toBe(286); // POO-763 R1: P1 dailyPoints, NOT the duck-shoot slice
    expect(result.totalReferrals).toBe(4); // POO-763 R4: P6 referrals summary
    expect(result.referralFriends).toBe(4); // POO-854 R1: friends count = the real referrals slice
    expect(result.duckShoot.triesLeft).toBe(7); // P3 triesRemaining
    expect(result.duckShoot.weeklyTriesLeft).toBe(5); // POO-763 R2: P3 weeklyTriesLeft
    expect(result.duckShoot.triesPerWeek).toBe(7); // weekly cap
  });

  it("produces a value that satisfies rubberRushSchema", () => {
    const result = mapRubberRush({ summary, tier, status, referrals });
    expect(rubberRushSchema.safeParse(result).success).toBe(true);
  });

  it("[R3] fills unsourced fields from the placeholders", () => {
    const result = mapRubberRush({ summary, tier, status, referrals });
    expect(result.streakTarget).toBe(RUBBER_RUSH_PLACEHOLDERS.streakTarget);
    expect(result.referralCode).toBe(RUBBER_RUSH_PLACEHOLDERS.referralCode);
    expect(result.duckShoot.targets.length).toBeGreaterThan(0);
    expect(result.duckShoot.lastResult).toBeUndefined();
  });

  it("[POO-854 R2/R3] target and multiplier are fixed product constants (single tier 5 -> 1.5x)", () => {
    const result = mapRubberRush({ summary, tier, status, referrals });
    expect(REFERRAL_FRIENDS_TARGET).toBe(5);
    expect(REFERRAL_TIER_MULTIPLIER_X).toBe(1.5);
    expect(result.referralFriendsTarget).toBe(REFERRAL_FRIENDS_TARGET);
    expect(result.nextMultiplierX).toBe(REFERRAL_TIER_MULTIPLIER_X);
  });

  it("[POO-854 R1] referralFriends is sourced from the real referrals slice, not a placeholder", () => {
    expect(
      mapRubberRush({ summary, tier, status, referrals: { totalReferrals: 7 } }).referralFriends,
    ).toBe(7);
  });

  it("[R2] maps tierId 1 -> index 0 and tierId 5 -> index 4", () => {
    expect(
      mapRubberRush({ summary, tier: { ...tier, tierId: 1 }, status, referrals }).tierIndex,
    ).toBe(0);
    expect(
      mapRubberRush({ summary, tier: { ...tier, tierId: 5 }, status, referrals }).tierIndex,
    ).toBe(4);
  });

  it("[R2] clamps an out-of-range tierId into 0..4", () => {
    expect(
      mapRubberRush({ summary, tier: { ...tier, tierId: 9 }, status, referrals }).tierIndex,
    ).toBe(4);
    expect(
      mapRubberRush({ summary, tier: { ...tier, tierId: 0 }, status, referrals }).tierIndex,
    ).toBe(0);
  });

  it("[R2] percentile 1 (top) -> tierTopPercent 0", () => {
    expect(
      mapRubberRush({ summary, tier: { ...tier, percentile: 1 }, status, referrals })
        .tierTopPercent,
    ).toBe(0);
  });

  it("[R5] uses zero defaults for a null summary slice (quacks + quacksToday)", () => {
    const result = mapRubberRush({ summary: null, tier, status, referrals });
    expect(result.quacks).toBe(0);
    expect(result.quacksToday).toBe(0); // no summary → no dailyPoints
  });

  it("[R5] uses zero defaults for a null tier slice", () => {
    const result = mapRubberRush({ summary, tier: null, status, referrals });
    expect(result.tierIndex).toBe(0);
    expect(result.tierTopPercent).toBe(0);
    expect(result.tierProgressPct).toBe(0);
    expect(result.dailyBoostX).toBe(0);
    expect(result.streakDays).toBe(0);
    expect(result.quackedToday).toBe(false);
  });

  it("[R5] a null duck-shoot slice zeroes tries but keeps quacksToday from the summary", () => {
    const result = mapRubberRush({ summary, tier, status: null, referrals });
    expect(result.duckShoot.triesLeft).toBe(0);
    expect(result.duckShoot.weeklyTriesLeft).toBe(0);
    expect(result.quacksToday).toBe(286); // still from summary.dailyPoints, not the duck-shoot slice
  });

  it("[R5] a null referrals slice defaults totalReferrals and referralFriends to 0", () => {
    const result = mapRubberRush({ summary, tier, status, referrals: null });
    expect(result.totalReferrals).toBe(0);
    expect(result.referralFriends).toBe(0); // POO-854 R1/R4: empty state, never fabricated
  });

  it("[R5] all-null slices produce a schema-valid zero state", () => {
    const result = mapRubberRush({ summary: null, tier: null, status: null, referrals: null });
    expect(result.quacks).toBe(0);
    expect(result.tierIndex).toBe(0);
    expect(result.quacksToday).toBe(0);
    expect(result.totalReferrals).toBe(0);
    expect(rubberRushSchema.safeParse(result).success).toBe(true);
  });

  it("[R2] defaults totalBoost and hasSaidGM when the tier omits them", () => {
    const leanTier = { tierId: 2, percentile: 0.5, nextTierProgress: 10, streak: { days: 0 } };
    const result = mapRubberRush({ summary, tier: leanTier, status, referrals });
    expect(result.dailyBoostX).toBe(0);
    expect(result.quackedToday).toBe(false);
  });
});
