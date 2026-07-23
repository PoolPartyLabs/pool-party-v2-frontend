/**
 * @id PP-MGR-SCR-005
 * @name ManagerProfileScreen
 * @implements-rules-version v3
 *
 * Public manager profile (`/m/<handle>`): a YouTube-style banner (uploaded image or gradient
 * fallback, never stretched) with the avatar overlapping it, the identity block (name, verified
 * badge, @handle, "since", bio), social logo chips (only the set links render), headline stats
 * (AUM / investors / strategies / avg APY), and the manager's public strategies (reusing the
 * investor {@link StrategyCard}). Responsive: mobile centers the header under the banner; desktop
 * left-aligns it. Figma: desktop `5843:468`, mobile `5845:581` (POO-227 v2).
 *
 * POO-618 v1: the same screen degrades gracefully for an UNFILLED manager (reached by wallet address,
 * `/m/<address>`). With no display name it shows the masked wallet address (R5); empty bio, the
 * `@handle · since` line and unset socials are hidden (R6/R7/R8); the avatar falls back to a neutral
 * placeholder icon instead of an address-derived letter (R9); the stats + strategies still render.
 *
 * POO-850: the social chips are extracted into the client {@link SocialChips} (its website chip warns
 * before leaving to an unverified external site); this Server Component now passes only the serializable
 * `profile.socials` record across the RSC boundary, never the chips' `Icon` component refs.
 *
 * POO-895 (@implements-rules-version v1): when the route resolves the viewer as the profile's owner
 * (server-side, see the page), an "Edit profile" pill renders beside the Share action [R1], linking
 * to the console's profile tab via the i18n `Link` [R2]. Non-owners never see it and Share is
 * unchanged [R3]; the flag also arrives on the owner's synthesized profile [R5].
 *
 * POO-901 (@implements-rules-version v1): the Share action appends the SHARER's referral code
 * (whoever is signed in and taps Share) [R3]. This Server Component now passes only the profile
 * slug; {@link ShareProfileButton} resolves the code client-side and builds the URL.
 */
import { BadgeCheck, User } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { AprTooltip } from "@/components/ui/AprTooltip";
import { StrategyCard } from "@/features/strategies/components/StrategyCard";
import { Link } from "@/i18n/navigation";
import type { ManagerProfile, Strategy } from "@/lib/schemas";
import { maskAddress } from "@/lib/utils/address";
import { formatPercent, formatUsdCompact } from "@/lib/utils/format";
import { ShareProfileButton } from "./components/ShareProfileButton";
import { SocialChips } from "./components/SocialChips";

/** Public props for {@link ManagerProfileScreen}. */
export interface ManagerProfileScreenProps {
  /** The manager's public profile. */
  profile: ManagerProfile;
  /** The manager's public strategies (looked up by handle). */
  strategies: Strategy[];
  /**
   * POO-895 [R1]: the signed-in viewer IS this manager (resolved server-side by the route from the
   * SIWE session wallet, or the mock dashboard address in mock mode). Shows the Edit-profile action.
   */
  isOwner?: boolean;
}

/** One headline stat cell. */
function Stat({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-surface p-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}

/** Public manager profile screen (responsive). */
export function ManagerProfileScreen({ profile, strategies, isOwner }: ManagerProfileScreenProps) {
  const t = useTranslations("manager");
  // POO-618: an unfilled manager (no display name) falls back to the masked wallet address, matching
  // the wallet pill / greeting format (R5). The initial-letter avatar only makes sense for a real
  // name; an address-only manager shows a neutral placeholder icon instead (R9).
  const hasName = profile.name.trim().length > 0;
  const displayName = hasName
    ? profile.name
    : profile.address
      ? maskAddress(profile.address)
      : profile.handle;
  // R7: the "@handle · since" line only shows the parts that exist; hidden entirely when neither does.
  const subtitleParts = [
    profile.handle ? `@${profile.handle}` : null,
    profile.sinceLabel || null,
  ].filter((part): part is string => Boolean(part));
  // R13: share the handle URL when a handle is set, else the address URL.
  const shareSlug = profile.handle || profile.address || "";

  return (
    <div className="flex flex-col gap-6">
      {/* Banner (image or gradient fallback) with the avatar overlapping its bottom edge. */}
      <header className="flex flex-col">
        <div
          data-testid="profile-banner"
          className="h-36 overflow-hidden rounded-2xl bg-gradient-to-br from-primary/50 via-surface to-brand-grape/40 sm:h-56"
        >
          {profile.bannerUrl ? (
            // PP-NOTE: center-crop, never stretch (object-cover) — the YouTube-banner rule (R2).
            <img src={profile.bannerUrl} alt="" className="size-full object-cover" />
          ) : null}
        </div>
        <div className="-mt-10 flex flex-col items-center gap-4 px-4 text-center sm:flex-row sm:items-end sm:px-7 sm:text-left">
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt=""
              className="size-20 shrink-0 rounded-full border-4 border-background object-cover sm:size-24"
            />
          ) : (
            <span
              data-testid="profile-avatar-fallback"
              aria-hidden="true"
              className="flex size-20 shrink-0 items-center justify-center rounded-full border-4 border-background bg-surface-raised font-bold text-2xl text-muted-foreground sm:size-24"
            >
              {hasName ? (
                displayName.charAt(0).toUpperCase()
              ) : (
                <User className="size-8 sm:size-10" aria-hidden="true" />
              )}
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:pb-1">
            <div className="flex items-center justify-center gap-1.5 sm:justify-start">
              <h1 className="font-bold text-2xl text-foreground">{displayName}</h1>
              {/* POO-745: the verified badge is driven by managerVerification === 'valid' (the code-DM
                  model), replacing the legacy `verified` boolean as the badge source. */}
              {profile.managerVerification === "valid" ? (
                <BadgeCheck
                  className="size-5 shrink-0 text-info"
                  aria-label={t("profile.verifiedManager")}
                />
              ) : null}
            </div>
            {subtitleParts.length > 0 ? (
              <p className="text-muted-foreground text-sm">{subtitleParts.join(" · ")}</p>
            ) : null}
          </div>
          {/* Right-aligned header actions: the owner's Edit-profile pill (POO-895 R1/R2, follows the
              investor-hub Edit-profile precedent restyled to the Share pill's header sizing) beside
              the Share action (POO-288 R1, unchanged for everyone [R3]). */}
          <div className="flex shrink-0 items-center gap-2 sm:mb-1 sm:ml-auto">
            {isOwner ? (
              <Link
                href="/manager?tab=profile"
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface px-4 font-semibold text-foreground text-sm transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("profile.edit")}
              </Link>
            ) : null}
            {/* POO-901 [R3]: the button receives only the slug; it resolves the SHARER's referral
                code client-side (this screen is a Server Component) and appends ?ref=<code>. */}
            <ShareProfileButton
              slug={shareSlug}
              label={t("profile.share")}
              copiedLabel={t("profile.shareCopied")}
            />
          </div>
        </div>
      </header>

      {/* R6: hide the bio entirely when the manager hasn't written one. */}
      {profile.bio.trim() ? <p className="px-1 text-foreground text-sm">{profile.bio}</p> : null}

      {/* Social logo chips — only the set links render (R4). POO-850: the interactive chips (the website
          chip warns before leaving to an unverified external site) live in the client {@link SocialChips};
          this Server Component passes only the serializable socials record across the RSC boundary. */}
      <SocialChips socials={profile.socials} />

      {/* Headline stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("profile.stats.aum")} value={formatUsdCompact(profile.stats.aum)} />
        <Stat
          label={t("profile.stats.investors")}
          value={profile.stats.investors.toLocaleString("en-US")}
        />
        <Stat label={t("profile.stats.strategies")} value={String(profile.stats.strategies)} />
        <Stat
          label={<AprTooltip average>{t("profile.stats.avgApy")}</AprTooltip>}
          value={formatPercent(profile.stats.avgApy)}
        />
      </div>

      {/* The manager's public strategies */}
      <section className="flex flex-col gap-4">
        <h2 className="font-semibold text-foreground text-lg">
          {t("profile.strategiesBy", { name: displayName })}
        </h2>
        {strategies.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("profile.empty")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {strategies.map((strategy) => (
              <StrategyCard key={strategy.id} strategy={strategy} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
