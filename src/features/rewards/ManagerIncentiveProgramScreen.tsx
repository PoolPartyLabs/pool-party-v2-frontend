/**
 * @id PP-REW-SCR-002
 * @name ManagerIncentiveProgram
 * @implements-rules-version v1
 *
 * The managerIncentiveProgram rewards dashboard, hybrid by design: it rewards strategy creators AND advocates
 * (content creators / promoters), so "managed TVL" counts created + driven TVL (POO-172 A5).
 * Presentational; data fetched by the route. Leads with this
 * month's bonus revenue + headline stats (strategies created, managed TVL, referrals, bonus fees),
 * a token-distribution callout, the bonus-fee tier ladder with the current tier highlighted and
 * progress toward the next, a revenue breakdown, and first-month onboarding goals. Responsive: one
 * column on mobile, a 3-column grid on desktop. All figures are mocked (PP-INTEGRATION-POINT).
 */
import { ChevronLeft, Gift } from "lucide-react";
import { useTranslations } from "next-intl";
import { TrackView } from "@/components/analytics/TrackView";
import { MetricTile } from "@/components/data-display/MetricTile";
import { Link } from "@/i18n/navigation";
import type { ManagerIncentiveProgram, ManagerIncentiveProgramGoal } from "@/lib/schemas";
import { cn } from "@/lib/utils/cn";
import { formatCount, formatUsd, formatUsdCompact } from "@/lib/utils/format";
import { InfoTip } from "./components/InfoTip";
import { TierTable } from "./components/TierTable";

/** Public props for {@link ManagerIncentiveProgramScreen}. */
export interface ManagerIncentiveProgramScreenProps {
  /** The ManagerIncentiveProgram dashboard data. */
  data: ManagerIncentiveProgram;
}

/** The ManagerIncentiveProgram rewards dashboard. */
export function ManagerIncentiveProgramScreen({ data }: ManagerIncentiveProgramScreenProps) {
  const t = useTranslations("rewards");

  // Tiers count down in number as benefit rises (Tier 1 = top). The "next" tier is one step up.
  const currentTierRow = data.tiers.find((tier) => tier.tier === data.currentTier) ?? null;
  const nextTier = data.tiers.find((tier) => tier.tier === data.currentTier - 1) ?? null;
  const rangeFrom = formatUsdCompact(currentTierRow?.minTvl ?? 0);
  const rangeTo = formatUsdCompact(nextTier?.minTvl ?? currentTierRow?.minTvl ?? 0);

  const tierRows = data.tiers.map((tier) => ({
    name: t("managerIncentiveProgram.tierTable.rowName", { n: tier.tier }),
    minTvl: formatUsdCompact(tier.minTvl),
    bonusFees: `${tier.bonusFeesPct}%`,
    active: tier.tier === data.currentTier,
  }));

  const goalLabel = (goal: ManagerIncentiveProgramGoal): string => {
    switch (goal.key) {
      case "referrals":
        return t("managerIncentiveProgram.goals.referrals", { target: goal.target ?? 0 });
      case "posts":
        return t("managerIncentiveProgram.goals.posts", { count: goal.target ?? 0 });
      case "communityPool":
        return t("managerIncentiveProgram.goals.communityPool");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <TrackView
        event="reward_program_viewed"
        params={{ reward_program: "manager_incentive_program" }}
      />
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/profile"
          aria-label={t("managerIncentiveProgram.back")}
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground lg:hidden"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </Link>
        <div>
          <h1 className="font-bold text-2xl text-foreground">
            {t("managerIncentiveProgram.title")}
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            {t("managerIncentiveProgram.subtitle")}
          </p>
        </div>
      </div>

      {/* Hero: revenue this month */}
      <section className="rounded-xl border border-border bg-surface p-5 lg:p-6">
        <p className="font-semibold text-primary text-xs uppercase tracking-wide">
          {t("managerIncentiveProgram.label", { name: data.name })}
        </p>
        <p className="mt-2 font-bold text-4xl text-foreground lg:text-5xl">
          {formatUsd(data.revenueThisMonth)}
        </p>
        <p className="mt-1 text-muted-foreground text-sm">
          {t("managerIncentiveProgram.revenueThisMonth")}
        </p>
        <p className="mt-0.5 text-muted-foreground text-xs">
          {t("managerIncentiveProgram.since", { date: data.sinceLabel })}
        </p>
      </section>

      {/* Headline stats */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile
          label={t("managerIncentiveProgram.stats.strategiesCreated")}
          value={data.strategiesCreated}
          delta={t("managerIncentiveProgram.stats.strategiesCreatedSub")}
        />
        <MetricTile
          label={t("managerIncentiveProgram.stats.managedTvl")}
          value={formatUsd(data.managedTvl)}
          delta={t("managerIncentiveProgram.stats.managedTvlSub")}
        />
        <MetricTile
          label={t("managerIncentiveProgram.stats.referrals")}
          value={data.referrals}
          delta={t("managerIncentiveProgram.stats.referralsSub")}
        />
        <MetricTile
          label={t("managerIncentiveProgram.stats.bonusFees")}
          value={<span className="text-primary">{data.bonusFeesPct}%</span>}
          delta={t("managerIncentiveProgram.stats.bonusFeesSub")}
        />
      </section>

      {/* Token distribution callout */}
      <section className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/5 p-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Gift className="size-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-semibold text-primary text-sm">
            {t("managerIncentiveProgram.tokens.title", {
              count: formatCount(data.tokensToDistribute),
            })}
          </h2>
          <p className="mt-1 text-muted-foreground text-sm">
            {t("managerIncentiveProgram.tokens.body", {
              count: formatCount(data.tokensToDistribute),
            })}
          </p>
        </div>
      </section>

      {/* Tier ladder | Revenue + Goals */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-5 lg:col-span-2 lg:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-foreground">
              {t("managerIncentiveProgram.tierCard.title", { tier: data.currentTier })}
            </h2>
            <span className="shrink-0 text-muted-foreground text-sm">
              {t("managerIncentiveProgram.tierCard.range", { from: rangeFrom, to: rangeTo })}
            </span>
          </div>
          {nextTier ? (
            <p className="mt-1 text-muted-foreground text-sm">
              {t("managerIncentiveProgram.tierCard.body", {
                target: formatUsdCompact(nextTier.minTvl),
              })}
            </p>
          ) : null}

          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.min(100, Math.max(0, data.tierProgressPct))}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              {t("managerIncentiveProgram.tierCard.managed", {
                amount: formatUsd(data.managedTvl),
              })}
            </span>
            {nextTier ? (
              <span className="font-medium text-primary">
                {t("managerIncentiveProgram.tierCard.nextTier", {
                  delta: `+${formatUsdCompact(Math.max(0, nextTier.minTvl - data.managedTvl))}`,
                  tier: t("managerIncentiveProgram.tierTable.rowName", { n: nextTier.tier }),
                })}
              </span>
            ) : null}
          </div>

          <div className="mt-5">
            <TierTable
              rows={tierRows}
              headers={{
                tier: t("managerIncentiveProgram.tierTable.tier"),
                minTvl: t("managerIncentiveProgram.tierTable.minTvl"),
                bonusFees: t("managerIncentiveProgram.tierTable.bonusFees"),
              }}
            />
          </div>

          <p className="mt-3 text-muted-foreground text-xs">
            {t("managerIncentiveProgram.tierFootnote")}
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {/* Revenue */}
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-foreground">
                {t("managerIncentiveProgram.revenue.title")}
              </h2>
              <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                {t("managerIncentiveProgram.revenue.paidEndOfMonth")}
              </span>
            </div>
            <p className="mt-3 flex items-center gap-1 text-muted-foreground text-xs">
              {t("managerIncentiveProgram.revenue.estimatedAccrued")}
              <InfoTip text={t("managerIncentiveProgram.revenue.estimatedAccruedInfo")} />
            </p>
            <p className="font-bold text-2xl text-foreground">
              {formatUsd(data.revenue.estimatedAccrued)}
            </p>
            <div className="mt-4 flex flex-col gap-2 border-border border-t pt-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  {t("managerIncentiveProgram.revenue.feesThisMonth")}
                  <InfoTip text={t("managerIncentiveProgram.revenue.feesThisMonthInfo")} />
                </span>
                <span className="font-medium text-foreground">
                  {formatUsd(data.revenue.feesThisMonth)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  {t("managerIncentiveProgram.revenue.totalFees")}
                  <InfoTip text={t("managerIncentiveProgram.revenue.totalFeesInfo")} />
                </span>
                <span className="font-medium text-foreground">
                  {formatUsd(data.revenue.totalFees)}
                </span>
              </div>
            </div>
          </div>

          {/* First month goals */}
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-foreground">
                {t("managerIncentiveProgram.goals.title")}
              </h2>
              <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                {t("managerIncentiveProgram.goals.onboarding")}
              </span>
            </div>
            <ul className="mt-4 flex flex-col gap-3">
              {data.goals.map((goal) => (
                <li key={goal.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        goal.trackedExternally ? "bg-muted-foreground/40" : "bg-primary",
                      )}
                      aria-hidden="true"
                    />
                    <span className="text-foreground">{goalLabel(goal)}</span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0",
                      goal.trackedExternally
                        ? "text-muted-foreground text-xs"
                        : "font-medium text-primary",
                    )}
                  >
                    {goal.trackedExternally
                      ? t("managerIncentiveProgram.goals.trackedExternally")
                      : t("managerIncentiveProgram.goals.progress", {
                          current: goal.current ?? 0,
                          target: goal.target ?? 0,
                        })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
