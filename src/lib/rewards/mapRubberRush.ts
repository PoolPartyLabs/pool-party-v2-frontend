/**
 * @id PP-REW (POO-209, POO-763, POO-854)
 * @name mapRubberRush
 * @implements-rules-version v2
 *
 * Pure mapping from the analytics slices (P1 summary, P2 tier, P3 duck-shoot
 * status, P6 referrals) to the FE RubberRush shape. Each slice is nullable: a
 * null slice (the backend 404'd or returned empty for it) maps to that slice's
 * zero defaults ([R5]). The referred-friends count is real (POO-854 R1: from the
 * referrals slice); the referral-reward target/multiplier are product constants
 * (POO-854 R2/R3); referral identity has no analytics source and stays a
 * placeholder here (it is read separately from pp-api).
 */
import type { DuckShootTarget, RubberRush } from "@/lib/schemas";
import { referralUrl } from "@/lib/urls";

/** Weekly Duck Shoot try cap (backend DUCK_SHOOT_WEEKLY_CAP). */
const DUCK_SHOOT_WEEKLY_CAP = 7;

/**
 * PP-MOCK: presentational Duck Shoot prize board. The backend resolves outcomes
 * server-side and exposes no board, so the badges shown are a client-defined set.
 */
export const DUCK_SHOOT_TARGETS: DuckShootTarget[] = [
  { multiplierPct: 10 },
  { multiplierPct: 50 },
  { multiplierPct: 100 },
  { multiplierPct: 150 },
  { multiplierPct: 300 },
  { multiplierPct: 1000 },
];

/**
 * Referral-reward tier (POO-854 R2/R3): a single fixed tier. Reaching
 * REFERRAL_FRIENDS_TARGET referred friends unlocks REFERRAL_TIER_MULTIPLIER_X on
 * the investor's daily quacks. These are PRODUCT CONSTANTS (the program rule),
 * derived from the friend count, NOT backend fields: pool-party-api's referral
 * surface is pure tracking and exposes no multiplier (verified 2026-07-11), and
 * the quacks/tier engine exposes no per-friend multiplier. The friend COUNT
 * itself is real (referralFriends ← the referrals slice, below).
 */
export const REFERRAL_FRIENDS_TARGET = 5;
export const REFERRAL_TIER_MULTIPLIER_X = 1.5;

/**
 * PP-MOCK: RubberRush fields the analytics indexer does not provide. The referral
 * IDENTITY (code/link/invitedBy) is owned by the pp-api referral read on a
 * separate path (loadReferralProgram), so on the RubberRush payload it stays a
 * placeholder; streakTarget is a product constant.
 * PP-INTEGRATION-POINT: referral identity ← pp-api referral program (POO-661);
 * the RubberRush payload itself does not carry it.
 */
export const RUBBER_RUSH_PLACEHOLDERS = {
  streakTarget: 7,
  referralCode: "POOLPARTY",
  // POO-853 [R3]: canonical `?ref=` form (placeholder; the aside reads useReferral, not this field).
  referralLink: referralUrl("POOLPARTY"),
  invitedBy: null as string | null,
} as const;

/** The analytics slices consumed by the Rubber Rush read. Each may be null. */
export interface RubberRushSlices {
  summary: { totalPoints: number; dailyPoints: number } | null;
  tier: {
    tierId: number;
    percentile: number;
    nextTierProgress: number;
    totalBoost?: number;
    hasSaidGM?: boolean;
    streak: { days: number };
  } | null;
  status: { triesRemaining: number; weeklyTriesLeft: number; quacksEarnedToday: number } | null;
  /** P6 referrals summary (real referral count). Null when the wallet has no referral record. */
  referrals: { totalReferrals: number } | null;
}

/** Clamp `value` into the inclusive `[min, max]` range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Round to one decimal place. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Map the analytics slices to a RubberRush dashboard. Sourced fields ([R2]) come
 * from the slices (with zero defaults for null slices, [R5]); unsourced fields
 * ([R3]) come from RUBBER_RUSH_PLACEHOLDERS.
 */
export function mapRubberRush({ summary, tier, status, referrals }: RubberRushSlices): RubberRush {
  return {
    // [R2] sourced fields
    quacks: summary?.totalPoints ?? 0,
    tierIndex: tier ? clamp(tier.tierId - 1, 0, 4) : 0,
    tierTopPercent: tier ? clamp(round1((1 - tier.percentile) * 100), 0, 100) : 0,
    tierProgressPct: tier ? clamp(tier.nextTierProgress, 0, 100) : 0,
    dailyBoostX: tier?.totalBoost ?? 0,
    streakDays: tier?.streak.days ?? 0,
    quackedToday: tier?.hasSaidGM ?? false,
    // [POO-763 R1] "Quacks earned today" is the summary's dailyPoints, NOT the duck-shoot slice.
    quacksToday: summary?.dailyPoints ?? 0,
    // [POO-763 R4] Total referrals from the real referrals summary (0 when the wallet has none).
    totalReferrals: referrals?.totalReferrals ?? 0,
    duckShoot: {
      triesLeft: status?.triesRemaining ?? 0,
      // [POO-763 R2] Tries left to EARN this week — the real value, not the constant cap.
      weeklyTriesLeft: status?.weeklyTriesLeft ?? 0,
      triesPerWeek: DUCK_SHOOT_WEEKLY_CAP,
      targets: DUCK_SHOOT_TARGETS,
    },
    // [POO-854 R1] Referred-friends count is the real referrals slice (all referees, raw); 0 when
    // the wallet has no referrals — never fabricated.
    referralFriends: referrals?.totalReferrals ?? 0,
    // [POO-854 R2/R3] Single-tier referral reward: 5 friends -> 1.5x. Product constants, not backend.
    referralFriendsTarget: REFERRAL_FRIENDS_TARGET,
    nextMultiplierX: REFERRAL_TIER_MULTIPLIER_X,
    // [R3] unsourced placeholders (referral identity lives on a separate pp-api path)
    streakTarget: RUBBER_RUSH_PLACEHOLDERS.streakTarget,
    referralCode: RUBBER_RUSH_PLACEHOLDERS.referralCode,
    referralLink: RUBBER_RUSH_PLACEHOLDERS.referralLink,
    invitedBy: RUBBER_RUSH_PLACEHOLDERS.invitedBy,
  };
}
