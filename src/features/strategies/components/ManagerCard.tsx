/**
 * @id PP-STR-CMP-016
 * @name ManagerCard
 * @implements-rules-version v1 (POO-434) · v1 (POO-771: embedded avatar + verified source)
 *
 * The Strategy Detail "manager" card (Figma `4727:916`, right rail under the invest panel): the
 * manager's avatar, name + verified badge, a role sub-line ("Verified manager"), and a link to their
 * public profile (`/m/<handle>`). Surfaces who runs the strategy at a glance.
 *
 * POO-771/POO-758: the avatar (`avatarUrl`) and the `verified` flag now come from the backend-embedded
 * manager identity threaded through the strategy mapper — the card renders the real manager avatar
 * (monogram fallback via {@link ManagerAvatar}) and the verified badge with zero extra requests. In
 * real mode the name is `@handle` when saved (else the truncated wallet); "View profile" links by
 * handle, falling back to `/m/<address>` (POO-620) when no handle is set.
 */
"use client";

import { BadgeCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { ManagerAvatar } from "@/features/manager/components/ManagerAvatar";
import { ManagerLink } from "@/features/manager/components/ManagerLink";
import { formatUsd } from "@/lib/utils/format";

/** Public props for {@link ManagerCard}. */
export interface ManagerCardProps {
  /** Manager attribution text: `@handle` when saved, else the truncated address (real mode). */
  name: string;
  /** Whether to show the verified badge + "Verified manager" sub-line. */
  verified: boolean;
  /** The manager's public-profile handle; preferred link target for "View profile". */
  handle?: string;
  /** POO-620: the manager's wallet address — the fallback link target when no handle is set. */
  address?: string;
  /**
   * POO-771 R8: the manager's public avatar URL (embedded via POO-758). Renders the rounded image;
   * falls back to the initials monogram when absent or the image fails to load.
   */
  avatarUrl?: string;
  /**
   * The manager's own allocation in this strategy (initial seed + top-ups), in USD. Shown as a
   * skin-in-the-game signal; hidden when undefined (no analytics figure yet).
   */
  managerStakeUsd?: number;
}

/** The strategy's manager card. */
export function ManagerCard({
  name,
  verified,
  handle,
  address,
  avatarUrl,
  managerStakeUsd,
}: ManagerCardProps) {
  const t = useTranslations("strategies");
  // POO-620: "View profile" links by handle or wallet address; hidden only when neither is known.
  const profileSlug = handle || address;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center gap-3">
        {/* POO-771 R8: the manager's avatar image (embedded via POO-758), with an initials-monogram
            fallback that derives from the first alphanumeric char (never "@"). */}
        <ManagerAvatar avatarUrl={avatarUrl} name={name} className="size-10 text-sm" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 font-semibold text-foreground text-sm">
            {/* POO-434 R5: the name links to the manager's public profile (/m/<handle>) like every
                other manager mention; ManagerLink falls back to plain text when no handle (real mode). */}
            <ManagerLink handle={handle} address={address} className="truncate">
              {name}
            </ManagerLink>
            {verified ? (
              <BadgeCheck
                className="size-4 shrink-0 text-info"
                aria-label={t("detail.managerVerified")}
              />
            ) : null}
          </p>
          <p className="text-muted-foreground text-xs">
            {verified ? t("detail.managerVerified") : t("detail.managerRole")}
          </p>
        </div>
      </div>
      {managerStakeUsd != null ? (
        <div className="flex items-center justify-between gap-2 border-border border-t pt-3">
          <span className="text-muted-foreground text-sm">{t("detail.managerAllocation")}</span>
          <span className="font-semibold text-foreground text-sm">
            {formatUsd(managerStakeUsd)}
          </span>
        </div>
      ) : null}
      {profileSlug ? (
        <ManagerLink handle={handle} address={address} className="font-medium text-primary text-sm">
          {t("detail.viewProfile")}
        </ManagerLink>
      ) : null}
    </div>
  );
}
