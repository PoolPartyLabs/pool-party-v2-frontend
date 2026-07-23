/**
 * @id PP-CORE-MCK-005
 * @name rewards mock data
 * @implements-rules-version v1
 *
 * Static fixtures for the Rewards area: the Rubber Rush dashboard (PP-REW-SCR-001) and the
 * ManagerIncentiveProgram dashboard (PP-REW-SCR-002). Sample figures mirror the Figma reference frames. Typed
 * against the domain schemas (validated in the schema tests) so the UI has a stable shape to build
 * against. Replace with the rewards/points backend before production.
 */
import type { ManagerIncentiveProgram, ReferralProgram, RubberRush } from "@/lib/schemas";
import { referralUrl } from "@/lib/urls";

/**
 * One canonical referral identity shared by the Rubber Rush dashboard and the Referral screen, so a
 * user never sees two different codes/links (POO-172 A4). The link is the canonical `?ref=<code>`
 * invite URL (POO-853 [R3], code as-typed), never the dead `/r/` route.
 */
const REFERRAL_CODE = "MARIA2026";
const REFERRAL_LINK = referralUrl(REFERRAL_CODE);

/** PP-MOCK: Maria's Rubber Rush dashboard. */
export const rubberRush: RubberRush = {
  quacks: 15_021,
  tierIndex: 1, // Swimmer (2nd of 5)
  tierTopPercent: 57.8,
  tierProgressPct: 68,
  // Referral counts mirror the ReferralProgram mock below: one program shown twice (POO-172 A4).
  totalReferrals: 3,
  dailyBoostX: 0,
  quacksToday: 48,
  streakDays: 0,
  streakTarget: 7,
  referralCode: REFERRAL_CODE,
  referralLink: REFERRAL_LINK,
  invitedBy: null,
  referralFriends: 3,
  referralFriendsTarget: 5,
  nextMultiplierX: 1.5,
  quackedToday: false,
  duckShoot: {
    triesLeft: 7,
    weeklyTriesLeft: 7,
    triesPerWeek: 7,
    // The six Duck Shoot prize tiers (match the backend outcome set so the hit
    // animation always maps to the multiplier won). See DUCK_SHOOT_TARGETS.
    targets: [
      { multiplierPct: 10 },
      { multiplierPct: 50 },
      { multiplierPct: 100 },
      { multiplierPct: 150 },
      { multiplierPct: 300 },
      { multiplierPct: 1000 },
    ],
  },
};

/** PP-MOCK: Maria's ManagerIncentiveProgram dashboard. */
export const managerIncentiveProgram: ManagerIncentiveProgram = {
  name: "Maria",
  revenueThisMonth: 0,
  sinceLabel: "May 2026",
  strategiesCreated: 12,
  managedTvl: 391.83,
  referrals: 0,
  bonusFeesPct: 0,
  tokensToDistribute: 5_000_000,
  currentTier: 6,
  tierProgressPct: 26,
  // Top tier first. Tier 1 = highest threshold + highest bonus; Tier 6 = entry (no threshold).
  tiers: [
    { tier: 1, minTvl: 1_000_000, bonusFeesPct: 40 },
    { tier: 2, minTvl: 150_000, bonusFeesPct: 15 },
    { tier: 3, minTvl: 15_000, bonusFeesPct: 10 },
    { tier: 4, minTvl: 5_000, bonusFeesPct: 5 },
    { tier: 5, minTvl: 1_500, bonusFeesPct: 2.5 },
    { tier: 6, minTvl: 0, bonusFeesPct: 0 },
  ],
  revenue: {
    estimatedAccrued: 0,
    feesThisMonth: 44.55,
    totalFees: 1_626.46,
  },
  goals: [
    { key: "referrals", current: 0, target: 10, trackedExternally: false },
    { key: "posts", target: 5, trackedExternally: true },
    { key: "communityPool", trackedExternally: true },
  ],
};

/**
 * PP-MOCK: Maria's referral / invite-and-earn program. The code starts UNSET (`null`) so every
 * referral surface shows its empty state until the user creates the one-time, immutable code via
 * `rewardsService.createReferralCode` (POO-290 R1/R2) — with no code there are no invites or
 * earnings yet. (The legacy `rubberRush.referralCode/Link` fixture fields above are no longer read
 * by the UI — the referral surfaces all consume this program via `useReferral`.)
 */
export const referral: ReferralProgram = {
  rewardUsd: 10,
  minInvestUsd: 50,
  totalEarnedUsd: 0,
  friendsJoined: 0,
  code: null,
  inviteLink: null,
  // POO-579 (Feature A): Maria is a referrer, not a referee — she was not invited by anyone.
  invitedByCode: null,
  invites: [],
};
