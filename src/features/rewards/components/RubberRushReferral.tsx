/**
 * @id PP-REW-CMP-018
 * @name RubberRushReferral
 * @implements-rules-version v1
 *
 * The Rubber Rush "Your referral" aside card. Reads the shared referral program ({@link useReferral})
 * instead of the dashboard payload so it always matches the other surfaces: empty state + create CTA
 * before the one-time code exists (POO-290 R1), the code/link copy fields after. "Invited by" comes
 * from the dashboard (it is about who invited YOU, independent of your own code).
 */
"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { isMockMode } from "@/lib/services";
import { absoluteUrl, referralUrl } from "@/lib/urls";
import { useReferral } from "../useReferral";
import { ReferralField } from "./ReferralField";

/** Public props for {@link RubberRushReferral}. */
export interface RubberRushReferralProps {
  /** Who invited this investor, or `null` if nobody. */
  invitedBy: string | null;
}

/** The referral aside card on the Rubber Rush dashboard. */
export function RubberRushReferral({ invitedBy }: RubberRushReferralProps) {
  const t = useTranslations("rewards");
  const { program } = useReferral();

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h3 className="font-semibold text-foreground">{t("rubberRush.referral.title")}</h3>
      <div className="mt-4 flex flex-col gap-4">
        {program == null ? (
          <div className="h-12 animate-pulse rounded-lg bg-surface-raised" aria-hidden="true" />
        ) : program.code == null ? (
          <>
            <p className="text-muted-foreground text-sm">{t("rubberRush.referral.emptyBody")}</p>
            <Link
              href="/rewards/referral"
              className="flex items-center justify-center rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground text-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("rubberRush.referral.emptyCta")}
            </Link>
          </>
        ) : (
          <>
            <ReferralField
              label={t("rubberRush.referral.code")}
              value={program.code}
              copyLabel={t("rubberRush.referral.copyCode")}
              copiedLabel={t("rubberRush.referral.copied")}
            />
            <ReferralField
              label={t("rubberRush.referral.link")}
              // POO-765 R3: the canonical `?ref=` share link (never the legacy `/r/` form).
              value={program.code ? absoluteUrl(referralUrl(program.code)) : ""}
              copyLabel={t("rubberRush.referral.copyLink")}
              copiedLabel={t("rubberRush.referral.copied")}
            />
          </>
        )}
        {/* POO-765 R2: "Invited by" has no real backend source yet (hardcoded null in real mode), so
            show it only in mock mode rather than rendering a placeholder "-" as if it were real. */}
        {isMockMode && (
          <div>
            <p className="mb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
              {t("rubberRush.referral.invitedBy")}
            </p>
            <p className="text-foreground text-sm">{invitedBy ?? t("rubberRush.referral.none")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
