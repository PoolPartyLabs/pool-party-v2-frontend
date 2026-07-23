/**
 * @id PP-DASH-CMP-004
 * @name ReferralCard
 * @implements-rules-version v1
 *
 * The Home aside "Invite & earn" card. Reads the shared referral program ({@link useReferral}):
 * before the one-time code exists it pitches + routes to the creation flow on the Referral screen
 * (POO-290 R1); after, it shows the code (copy) + share action and the live stats.
 *
 * POO-717: the share action and the code-pill copy both emit the FULL canonical `?ref=` referral URL
 * ({@link referralUrl}, code kept as typed), never the legacy `/r/` link nor the bare code, so a code
 * has one identity everywhere (POO-172). The primary share reuses {@link ShareInviteButton} (native
 * share sheet, copy fallback, `reward_referral_shared` analytics) rather than a second copy path.
 */
"use client";

import { Copy, Gift } from "lucide-react";
import { useTranslations } from "next-intl";
import { ShareInviteButton } from "@/features/rewards/components/ShareInviteButton";
import { useReferral } from "@/features/rewards/useReferral";
import { Link } from "@/i18n/navigation";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { absoluteUrl, referralUrl } from "@/lib/urls";

/** "Invite & earn" referral card. */
export function ReferralCard() {
  const t = useTranslations("home");
  const { program } = useReferral();
  const { track } = useAnalytics();

  // POO-717 R5: the pill "copy" affordance copies the SAME absolute `?ref=` URL as the share action
  // (not the bare code), so both give one identical, ready-to-send link. A link on the clipboard is a
  // share, so it emits `reward_referral_shared` like ShareInviteButton and ReferralField (POO-717).
  function copyReferralUrl(code: string | null) {
    if (code == null) return;
    navigator.clipboard?.writeText(absoluteUrl(referralUrl(code))).then(
      () => track("reward_referral_shared"),
      () => {},
    );
  }

  return (
    <section className="rounded-xl border border-primary/40 bg-primary/5 p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Gift className="size-5" aria-hidden="true" />
        </span>
        <div>
          <p className="font-semibold text-foreground">{t("referral.title")}</p>
          <p className="mt-0.5 text-muted-foreground text-sm">{t("referral.body")}</p>
        </div>
      </div>
      {program == null ? (
        <div className="mt-3 h-10 animate-pulse rounded-lg bg-surface" aria-hidden="true" />
      ) : program.code == null ? (
        // No code yet — route to the one-time creation flow on the Referral screen (POO-290 R1).
        <Link
          href="/rewards/referral"
          className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground text-sm hover:bg-primary/90"
        >
          {t("referral.createCta")}
        </Link>
      ) : (
        <>
          <p className="mt-3 text-muted-foreground text-xs">
            {t("referral.stat", { count: program.friendsJoined })}
          </p>
          <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
            <span className="truncate font-medium text-foreground text-sm">{program.code}</span>
            <button
              type="button"
              onClick={() => copyReferralUrl(program.code)}
              aria-label={t("referral.copyLink")}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <Copy className="size-4" aria-hidden="true" />
            </button>
          </div>
          {/* POO-717 R2: reuse the shared share button (native share + copy fallback + analytics). */}
          <ShareInviteButton
            url={referralUrl(program.code)}
            label={t("referral.share")}
            copiedLabel={t("referral.copied")}
            className="mt-3"
          />
        </>
      )}
    </section>
  );
}
