/**
 * @id PP-REW-SCR-003
 * @name Referral
 * @implements-rules-version v1
 *
 * The "invite & earn" referral screen (presentational; data fetched by the route). A gold hero that
 * pitches quacks (invite friends, earn quacks together) with the investor's code + invite link
 * (copyable) and a share action, a single friends-joined stat (the total-earned tile is hidden until
 * the give-get program pays out in USDC, POO-833), a 3-step "how it works", and the invited-friends
 * list with per-friend status badges. Responsive: one column on mobile, a 3-column grid on desktop.
 * The referral program is mocked end-to-end (PP-INTEGRATION-POINT).
 *
 * POO-579 (Feature A): a user who was themselves referred sees a subtle "Invited by <code>" line below
 * the subtitle (from `data.invitedByCode`); absent/null renders nothing.
 */
import { ChevronLeft, Gift } from "lucide-react";
import { useTranslations } from "next-intl";
import { TrackView } from "@/components/analytics/TrackView";
import { MetricTile } from "@/components/data-display/MetricTile";
import { Link } from "@/i18n/navigation";
import type { ReferralInvite, ReferralProgram } from "@/lib/schemas";
import { cn } from "@/lib/utils/cn";
import { ReferralHero } from "./components/ReferralHero";

/** Public props for {@link ReferralScreen}. */
export interface ReferralScreenProps {
  /** The referral program data. */
  data: ReferralProgram;
}

/** Avatar tints cycled across the invite list (green / blue / orange, per the design). */
const AVATAR_TINTS = [
  "bg-success/20 text-success",
  "bg-info/20 text-info",
  "bg-brand-mango/20 text-brand-mango",
] as const;

/** The referral / invite-and-earn screen. */
export function ReferralScreen({ data }: ReferralScreenProps) {
  const t = useTranslations("rewards");

  const steps = [
    { title: t("referral.steps.shareTitle"), body: t("referral.steps.shareBody") },
    {
      title: t("referral.steps.investTitle", { min: data.minInvestUsd }),
      body: t("referral.steps.investBody"),
    },
    {
      title: t("referral.steps.earnTitle", { amount: data.rewardUsd }),
      body: t("referral.steps.earnBody", { amount: data.rewardUsd }),
    },
  ];

  const statusBadge = (status: ReferralInvite["status"]): { label: string; className: string } => {
    switch (status) {
      case "earned":
        return {
          label: t("referral.status.earned", { amount: data.rewardUsd }),
          className: "bg-success/15 text-success",
        };
      case "invested":
        return { label: t("referral.status.invested"), className: "bg-info/15 text-info" };
      case "pending":
        return {
          label: t("referral.status.pending"),
          className: "bg-surface-raised text-muted-foreground",
        };
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <TrackView event="reward_program_viewed" params={{ reward_program: "referral" }} />
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/profile"
          aria-label={t("referral.back")}
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground lg:hidden"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </Link>
        <div>
          <h1 className="font-bold text-2xl text-foreground">{t("referral.title")}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t("referral.subtitle")}</p>
          {/* POO-579 (Feature A): a referred user sees who invited them — subtle, muted, below the
              subtitle. Rendered only when the user was themselves referred (invitedByCode truthy). */}
          {data.invitedByCode ? (
            <p className="mt-0.5 text-muted-foreground text-xs">
              {t("referral.invitedByLabel", { code: data.invitedByCode })}
            </p>
          ) : null}
        </div>
      </div>

      <section className="grid gap-4 lg:grid-cols-3">
        {/* Left: hero + how it works */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          {/* Give-get hero */}
          <div className="rounded-2xl border border-primary/40 bg-primary/5 p-5 lg:p-6">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Gift className="size-5" aria-hidden="true" />
            </span>
            <h2 className="mt-4 font-bold text-2xl text-foreground lg:text-3xl">
              {t("referral.heroTitle", { amount: data.rewardUsd })}
            </h2>
            <p className="mt-1 text-muted-foreground text-sm">
              {t("referral.heroBody", { amount: data.rewardUsd, min: data.minInvestUsd })}
            </p>
            {/* Creation form before the one-time code exists; code + link + share after (POO-290). */}
            <ReferralHero initial={data} />
          </div>

          {/* How it works */}
          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="font-semibold text-foreground">{t("referral.howItWorks")}</h2>
            <ol className="mt-4 grid gap-4 sm:grid-cols-3">
              {steps.map((step, index) => (
                <li key={step.title} className="flex flex-col gap-2">
                  <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary text-sm">
                    {index + 1}
                  </span>
                  <p className="font-medium text-foreground text-sm">{step.title}</p>
                  <p className="text-muted-foreground text-xs">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Right: stats + invites */}
        <div className="flex flex-col gap-4">
          {/* POO-833: "Total earned $" is hidden until the give-get program pays out in USDC; today the
              referral reward is quacks only, so only the friends-joined count is shown. */}
          <MetricTile label={t("referral.stats.friendsJoined")} value={data.friendsJoined} />

          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="font-semibold text-foreground">{t("referral.invites")}</h2>
            {data.invites.length === 0 ? (
              <p className="mt-4 text-muted-foreground text-sm">{t("referral.noInvites")}</p>
            ) : null}
            <ul className="mt-4 flex flex-col gap-3">
              {data.invites.map((invite, index) => {
                const badge = statusBadge(invite.status);
                return (
                  <li key={invite.name} className="flex items-center gap-3">
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-full font-semibold text-sm",
                        AVATAR_TINTS[index % AVATAR_TINTS.length],
                      )}
                      aria-hidden="true"
                    >
                      {invite.name.charAt(0)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground text-sm">{invite.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {invite.investedUsd != null
                          ? t("referral.investedAmount", { amount: invite.investedUsd })
                          : t("referral.signedUp")}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-0.5 font-medium text-xs",
                        badge.className,
                      )}
                    >
                      {badge.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
