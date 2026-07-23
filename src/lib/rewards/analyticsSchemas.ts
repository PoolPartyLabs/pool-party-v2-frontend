/**
 * @id PP-REW (POO-209)
 * @name Rubber Rush analytics response schemas
 * @implements-rules-version v1
 *
 * Zod schemas for the analytics indexer responses the Rubber Rush cutover reads:
 * P1 GET /points/:address/summary, P2 GET /points/:address/tier,
 * P3 GET /points/:address/duck-shoot/status. Only the fields the FE maps are
 * required; the backend may send more (extra keys are ignored). A malformed 200
 * (missing a required field) surfaces as an AnalyticsParseError at the boundary.
 *
 * PP-INTEGRATION-POINT: response contract for the Data_Analytics points endpoints.
 */
import { z } from "zod";

/**
 * P1 — points summary buckets. FE `quacks` = `totalPoints` (lifetime balance);
 * FE `quacksToday` = `dailyPoints` (Quacks earned today — the "+N earned today" figure).
 */
export const pointsSummarySchema = z.object({
  totalPoints: z.number(),
  /** Quacks earned today (deposits + daily check-in + boosts). FE `quacksToday`. */
  dailyPoints: z.number(),
  /** Campaign/bonus bucket. Not surfaced yet; kept optional so a lean backend still parses. */
  campaignPoints: z.number().optional(),
});
export type PointsSummary = z.infer<typeof pointsSummarySchema>;

/** P2 — tier / streak / boost. Drives tierIndex, tierTopPercent, progress, boost, streak, GM. */
export const tierInfoSchema = z.object({
  /** 1-based tier (1..5). FE tierIndex = tierId - 1. */
  tierId: z.number(),
  /** Leaderboard percentile, 0..1 where 1 = top. FE tierTopPercent = (1 - percentile) * 100. */
  percentile: z.number(),
  /** Progress to the next tier, 0..100. */
  nextTierProgress: z.number(),
  /** Aggregate additive boost. FE dailyBoostX. Optional; mapRubberRush defaults it to 0. */
  totalBoost: z.number().optional(),
  /** Whether the daily GM/Say-Quack check-in is done today. Optional; mapper defaults to false. */
  hasSaidGM: z.boolean().optional(),
  /** Daily-streak state. */
  streak: z.object({ days: z.number() }),
});
export type TierInfo = z.infer<typeof tierInfoSchema>;

/** P3 — duck-shoot status. Drives duckShoot.triesLeft and duckShoot.weeklyTriesLeft. */
export const duckShootStatusSchema = z.object({
  /** Tries remaining to PLAY this week. FE duckShoot.triesLeft. */
  triesRemaining: z.number(),
  /** Tries still available to EARN this week. FE duckShoot.weeklyTriesLeft. */
  weeklyTriesLeft: z.number(),
  /** Quacks earned today via duck-shoot boosts (headline "earned today" comes from P1 dailyPoints). */
  quacksEarnedToday: z.number(),
  /** ISO timestamp the weekly try window resets at. Optional; not surfaced yet. */
  weekResetAt: z.string().optional(),
});
export type DuckShootStatus = z.infer<typeof duckShootStatusSchema>;

/** P4 — sayQuack success (POST /points/quacks/daily). FE quacksAwarded = pointsAwarded. */
export const quackResponseSchema = z.object({
  /** Quacks awarded by the daily check-in (backend QUACK_POINTS = 10). */
  pointsAwarded: z.number(),
  /** Updated streak after the check-in (drives the streak card without a full reload). Optional. */
  streak: z.object({ days: z.number(), multiplier: z.number() }).optional(),
});
export type QuackResponse = z.infer<typeof quackResponseSchema>;

/** P6 — referrals summary (GET /points/:address/referrals/summary). FE totalReferrals. */
export const referralsSummarySchema = z.object({
  /** People who used the investor's referral code. FE totalReferrals. */
  totalReferrals: z.number(),
});
export type ReferralsSummary = z.infer<typeof referralsSummarySchema>;

/** P5 — playDuckShoot success (POST /points/duck-shoot/play). */
export const duckShootPlayResponseSchema = z.object({
  /** The weighted outcome the server picked. `value` is the multiplier percent won. */
  outcome: z.object({ value: z.number(), label: z.string() }),
  /** Quacks awarded by the boost (base + boost). FE quacksWon. */
  quacksAwarded: z.number(),
  /** Tries remaining after this shot. FE triesLeft. */
  triesRemaining: z.number(),
});
export type DuckShootPlayResponse = z.infer<typeof duckShootPlayResponseSchema>;

/** P7 — grantDuckShootTry success (POST /points/duck-shoot/grant-try). */
export const grantDuckShootTryResponseSchema = z.object({
  /** Tries remaining to PLAY after this grant. */
  triesRemaining: z.number(),
  /** Tries still available to EARN this week after this grant. */
  weeklyTriesLeft: z.number(),
});
export type GrantDuckShootTryResponse = z.infer<typeof grantDuckShootTryResponseSchema>;
