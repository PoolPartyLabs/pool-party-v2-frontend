/**
 * @id PP-REW-SCR-001
 * @name Rubber Rush
 * @implements-rules-version v2
 *
 * The investor-side rewards dashboard (presentational; data fetched by the route). Leads with the
 * Quacks balance (brand grape) + loyalty tier, the two gamified actions (Say Quack / Play Duck
 * Shoot), tier progression, headline stats, the daily-streak boost, a Duck Shoot explainer, and the
 * referral program (code + link + rewards). Responsive: a single column on mobile, a 3-column grid
 * on desktop. Say Quack / Play Duck Shoot / Claim roles are presentational pending the rewards
 * backend (PP-INTEGRATION-POINT); the referral copy actions are live.
 *
 * Layout follows the desktop reference (a clean section stack that collapses to one column on
 * mobile); copy mirrors the mobile frame, the canonical source.
 */
import { ChevronLeft, Target } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { TrackView } from "@/components/analytics/TrackView";
import { MetricTile } from "@/components/data-display/MetricTile";
import { Link } from "@/i18n/navigation";
import type { RubberRush } from "@/lib/schemas";
import { RubberRushActions } from "./components/RubberRushActions";
import { RubberRushReferral } from "./components/RubberRushReferral";
import { StreakBoost } from "./components/StreakBoost";
import { TierProgressBar } from "./components/TierProgressBar";

/** Public props for {@link RubberRushScreen}. */
export interface RubberRushScreenProps {
  /** The Rubber Rush dashboard data. */
  data: RubberRush;
  /** POO-546 R1: refetch after a Say Quack check-in (real-mode loader). Omitted on the mock SSR path. */
  onRefresh?: () => void;
}

/** The Rubber Rush rewards dashboard. */
export function RubberRushScreen({ data, onRefresh }: RubberRushScreenProps) {
  const t = useTranslations("rewards");

  /** Highlight span for the referral-rewards rich copy (success/green accent). */
  const hl = (chunks: ReactNode) => <span className="font-medium text-success">{chunks}</span>;

  const tierLabels = [
    t("rubberRush.tiers.paddler"),
    t("rubberRush.tiers.swimmer"),
    t("rubberRush.tiers.diver"),
    t("rubberRush.tiers.waveRider"),
    t("rubberRush.tiers.partyCaptain"),
  ];
  const tierName = tierLabels[data.tierIndex] ?? tierLabels[0];
  const dayLabels = Array.from({ length: data.streakTarget }, (_, index) =>
    t("rubberRush.dayShort", { n: index + 1 }),
  );
  const quacksFmt = data.quacks.toLocaleString("en-US");
  // The visible streak never exceeds the target: "x / 7 days" caps at "7 / 7 days" even if the
  // backend streak runs past the max-boost threshold (POO-769).
  const cappedStreak = Math.min(data.streakDays, data.streakTarget);
  const streakLabel = t("rubberRush.streakProgress", {
    days: cappedStreak,
    target: data.streakTarget,
  });

  return (
    <div className="flex flex-col gap-6">
      <TrackView event="reward_program_viewed" params={{ reward_program: "rubber_rush" }} />
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/profile"
          aria-label={t("rubberRush.back")}
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground lg:hidden"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </Link>
        <div>
          <h1 className="font-bold text-2xl text-foreground">{t("rubberRush.title")}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t("rubberRush.subtitle")}</p>
        </div>
      </div>

      {/* Hero: balance + actions */}
      <section className="rounded-xl border border-border bg-surface p-5 lg:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="text-center lg:text-left">
            <p className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
              {t("rubberRush.yourQuacks")}
            </p>
            <p className="mt-1 font-bold text-4xl text-brand-grape lg:text-5xl">{quacksFmt}</p>
            <p className="mt-1 text-muted-foreground text-sm">
              <span className="font-semibold text-foreground">{tierName}</span> ·{" "}
              {t("rubberRush.topPercent", { percent: data.tierTopPercent })}
            </p>
            <Link
              href="/rewards/manager-incentive-program"
              className="mt-3 inline-flex items-center gap-1 rounded-full border border-primary/60 px-3.5 py-1.5 font-medium text-primary text-sm transition-colors hover:bg-primary/10"
            >
              {t("rubberRush.managerIncentiveProgramDashboard")}
              <span aria-hidden="true">→</span>
            </Link>
          </div>

          <RubberRushActions data={data} onRefresh={onRefresh} />
        </div>
      </section>

      {/* Tier progression */}
      <section className="rounded-xl border border-border bg-surface p-5 lg:p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="font-semibold text-foreground">{t("rubberRush.tierProgression")}</h2>
          <span className="font-medium text-brand-grape text-sm">
            {tierName} · {quacksFmt} {t("rubberRush.quacksUnit")}
          </span>
        </div>
        <TierProgressBar
          progressPct={data.tierProgressPct}
          activeIndex={data.tierIndex}
          tiers={tierLabels}
          youLabel={t("rubberRush.you")}
        />
      </section>

      {/* Headline stats */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile label={t("rubberRush.stats.totalReferrals")} value={data.totalReferrals} />
        <MetricTile
          label={t("rubberRush.stats.dailyBoost")}
          value={<span className="text-primary">{data.dailyBoostX}x</span>}
        />
        <MetricTile
          label={t("rubberRush.stats.quacksToday")}
          value={
            <span className="text-brand-grape">{data.quacksToday.toLocaleString("en-US")}</span>
          }
        />
        <MetricTile label={t("rubberRush.stats.streak")} value={streakLabel} />
      </section>

      {/* Streak + Duck Shoot | Referral + Referral rewards */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <StreakBoost
            title={t("rubberRush.dailyStreakBoost")}
            body={t("rubberRush.dailyStreakBody")}
            progressLabel={streakLabel}
            dayLabels={dayLabels}
            filledCount={cappedStreak}
          />
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="flex items-center gap-2">
              <Target className="size-4 text-primary" aria-hidden="true" />
              <h3 className="font-semibold text-foreground">{t("rubberRush.duckShootTitle")}</h3>
            </div>
            <p className="mt-2 text-muted-foreground text-sm">{t("rubberRush.duckShootBody")}</p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {/* One referral identity everywhere: the card reads the shared program, not the
              dashboard payload (POO-290 R1 / POO-172 A4). */}
          <RubberRushReferral invitedBy={data.invitedBy} />

          {/* Referral rewards: real friends count (POO-854 R1) + the fixed single-tier reward
              (5 friends -> 1.5x, POO-854 R2/R3). Renders in both mock and real mode. */}
          <div className="rounded-xl border border-border bg-surface p-5">
            <h3 className="font-semibold text-foreground">
              {t("rubberRush.referralRewards.title")}
            </h3>
            <div className="mt-2 flex flex-col gap-2 text-muted-foreground text-sm">
              <p>{t.rich("rubberRush.referralRewards.body1", { hl })}</p>
              <p>{t.rich("rubberRush.referralRewards.body2", { hl })}</p>
              <p>{t.rich("rubberRush.referralRewards.body3", { hl })}</p>
              <p>{t.rich("rubberRush.referralRewards.body4", { hl })}</p>
            </div>
            <div className="mt-4 flex items-end justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                  {t("rubberRush.referralRewards.progressLabel")}
                </span>
                <span className="text-foreground text-sm">
                  {t("rubberRush.referralRewards.progress", {
                    count: data.referralFriends,
                    target: data.referralFriendsTarget,
                  })}
                </span>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                  {t("rubberRush.referralRewards.nextTier")}
                </span>
                <span className="font-semibold text-primary text-sm">
                  {t("rubberRush.referralRewards.multiplier", { value: data.nextMultiplierX })}
                </span>
              </div>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
              <div
                className="h-full rounded-full bg-brand-grape"
                style={{
                  width: `${Math.min(100, (data.referralFriends / data.referralFriendsTarget) * 100)}%`,
                }}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
