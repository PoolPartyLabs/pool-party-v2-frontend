/**
 * @id PP-PROF-SCR-001
 * @name Profile (hub)
 * @implements-rules-version v1
 *
 * The Profile menu hub (presentational; mock user passed in). Mobile order: header (avatar / name /
 * email / gear → App settings) → featured Referral card → gold Manager card (conditional, right
 * after the referral per R4) → grouped menu sections (Rewards · Account · Preferences · Support).
 * Desktop (R7): 2-col, section cards on the left (Manager row folds into Rewards & Programs) and an
 * identity aside (avatar / name / email / Quacks chip / Edit profile) + the Referral instance on
 * the right. Log out opens a destructive ConfirmDialog that clears the (mock) session and routes
 * to Sign in.
 */
"use client";

import {
  Bell,
  Briefcase,
  Check,
  ChevronRight,
  Copy,
  Gift,
  HelpCircle,
  Link2,
  LogOut,
  Settings,
  Shield,
  Sparkles,
  Star,
  User,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { signOutAction } from "@/features/auth/siweActions";
import { useQuacksBalance } from "@/features/rewards/hooks/useQuacksBalance";
import { useReferral } from "@/features/rewards/useReferral";
import { Link, useRouter } from "@/i18n/navigation";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { useAuth } from "@/lib/auth/useAuth";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import type { ProfileUser } from "@/lib/schemas";
import { authService, isMockMode } from "@/lib/services";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";

/** Public props for {@link ProfileHubScreen}. */
export interface ProfileHubScreenProps {
  /** The signed-in user. */
  user: ProfileUser;
}

/** The Profile menu hub. */
export function ProfileHubScreen({ user }: ProfileHubScreenProps) {
  const t = useTranslations("profile");
  const router = useRouter();
  const { track } = useAnalytics();
  const auth = useAuth();
  const { isEnabled } = useFeatureFlags();
  // Real Quacks balance (same source as the header pill + Rewards tab); fall back to the mock value
  // while it loads so the chip never flashes empty (POO-343).
  const realQuacks = useQuacksBalance();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Rewards is gated by its flag; the Manager row needs only the manager role (the manager area
  // ships in v1, not feature-flagged). The Rewards section renders only if it has a visible row.
  const showRewards = isEnabled("rewards");
  const showManagerRow = user.isManager;
  const showRewardsSection = showRewards || showManagerRow;

  // Shared referral program — the same source every referral surface reads (POO-290 R1).
  const { program: referral } = useReferral();

  function copyReferral() {
    if (referral?.inviteLink == null) return;
    navigator.clipboard?.writeText(referral.inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleLogout() {
    track("auth_logout");
    if (!isMockMode) {
      // Real mode: Privy logout only disconnects the wallet (the useLogout onSuccess callback in
      // useAuth also calls wagmiDisconnect); it does NOT touch the httpOnly SIWE cookie. Clear the
      // server-side session too, awaited BEFORE navigation, so the Bearer token dies with the
      // logout instead of surviving its 7-day maxAge (POO-890 R1). A failed clear must never trap
      // the user in the app: log it and route out anyway.
      auth.logout();
      await signOutAction().catch((error) => console.error("Sign-out failed", error));
      router.push("/sign-in");
      return;
    }
    // Mock mode: use the mock authService.
    try {
      await authService.logout();
    } catch (error) {
      console.error("Logout failed", error);
    } finally {
      router.push("/sign-in");
    }
  }

  // Featured referral card. Links into the gated /rewards area, so gate it on the rewards flag.
  // Rendered twice: inline on mobile (after the header) and inside the desktop aside (R7).
  const referralCard = showRewards ? (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
      <Link
        href="/rewards/referral"
        className="-m-2 flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-primary/10"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Gift className="size-6" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">{t("referral.title")}</p>
          <p className="mt-0.5 text-muted-foreground text-sm">{t("referral.body")}</p>
          {referral?.code != null ? (
            <p className="mt-1 font-medium text-primary text-sm">
              {t("referral.stat", {
                count: referral.friendsJoined,
              })}
            </p>
          ) : null}
        </div>
        <ChevronRight
          className="size-5 shrink-0 self-center text-muted-foreground"
          aria-hidden="true"
        />
      </Link>
      {referral == null ? (
        <div className="mt-4 h-10 animate-pulse rounded-md bg-surface" aria-hidden="true" />
      ) : referral.code == null ? (
        // No code yet — route to the one-time creation flow on the Referral screen (POO-290 R1).
        <Link
          href="/rewards/referral"
          className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 font-semibold text-primary-foreground text-sm transition-colors hover:bg-primary/90"
        >
          {t("referral.createCta")}
        </Link>
      ) : (
        <div className="mt-4 flex items-center gap-2">
          <span className="flex-1 rounded-md border border-border bg-surface px-3 py-2 font-mono text-foreground text-sm">
            {referral.code}
          </span>
          <button
            type="button"
            onClick={copyReferral}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 font-semibold text-primary-foreground text-sm transition-colors hover:bg-primary/90"
          >
            {copied ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
            {t("referral.share")}
          </button>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="mx-auto w-full max-w-2xl lg:grid lg:max-w-5xl lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-8">
      <div className="flex w-full flex-col gap-6">
        {/* Header (mobile only; the desktop identity lives in the aside, R7) */}
        <div className="flex items-center gap-4 lg:hidden">
          {/* POO-849 R1: render the persisted avatar photo (POO-702 backend) with the initials
              monogram as the no-image fallback; overflow-hidden clips the photo to the circle. */}
          <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 font-semibold text-2xl text-primary">
            {user.avatar ? (
              <img src={user.avatar} alt="" className="size-full object-cover" />
            ) : (
              user.initial
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-bold text-foreground text-xl">{user.displayName}</h1>
            <p className="truncate text-muted-foreground text-sm">{user.email}</p>
          </div>
          <Link
            href="/profile/settings"
            aria-label={t("rows.appSettings")}
            className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            <Settings className="size-5" aria-hidden="true" />
          </Link>
        </div>

        {/* Featured referral (mobile placement; the desktop instance is in the aside) */}
        {referralCard ? <div className="lg:hidden">{referralCard}</div> : null}

        {/* Gold Manager card, right after the referral card (R4; mobile only — on desktop the
            row folds into Rewards & Programs to match the desktop frame) */}
        {showManagerRow ? (
          <section className="lg:hidden">
            <h2 className="mb-2 px-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
              {t("groups.manager")}
            </h2>
            <Link
              href="/manager"
              className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3.5 transition-colors hover:bg-primary/10"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                <Briefcase className="size-4 text-primary" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-foreground text-sm">
                  {t("rows.managerProfile")}
                </span>
                <span className="mt-0.5 block text-muted-foreground text-xs">
                  {t("rows.managerProfileSub")}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </section>
        ) : null}

        {/* Rewards — Rubber Rush / ManagerIncentiveProgram gated by the rewards flag. When only the manager row
            exists it is desktop-only content, so hide the whole section on mobile. */}
        {showRewardsSection ? (
          <SettingsSection
            label={t("groups.rewards")}
            className={showRewards ? undefined : "hidden lg:block"}
          >
            {showRewards ? (
              <>
                <SettingsRow
                  title={t("rows.rubberRush")}
                  sub={t("rows.rubberRushSub")}
                  href="/rewards/rubber-rush"
                  icon={<Star className="size-4 text-primary" aria-hidden="true" />}
                />
                {/* Manager Incentive Program is a manager-only surface (matches the sidebar's
                    requiresManager gate) — never show it to non-manager investors. POO-766 R2. */}
                {showManagerRow ? (
                  <SettingsRow
                    title={t("rows.managerIncentiveProgram")}
                    href="/rewards/manager-incentive-program"
                    icon={<Sparkles className="size-4 text-brand-grape" aria-hidden="true" />}
                  />
                ) : null}
              </>
            ) : null}
            {showManagerRow ? (
              <div className="hidden lg:block">
                <SettingsRow
                  title={t("rows.managerProfile")}
                  sub={t("rows.managerProfileSub")}
                  href="/manager"
                  icon={<Briefcase className="size-4 text-primary" aria-hidden="true" />}
                />
              </div>
            ) : null}
          </SettingsSection>
        ) : null}

        {/* Account */}
        <SettingsSection label={t("groups.account")}>
          <SettingsRow
            title={t("rows.personalInfo")}
            href="/profile/personal"
            icon={<User className="size-4 text-info" aria-hidden="true" />}
          />
          <SettingsRow
            title={t("rows.linkedSocial")}
            href="/profile/social"
            icon={<Link2 className="size-4 text-success" aria-hidden="true" />}
          />
          <SettingsRow
            title={t("rows.security")}
            href="/profile/security"
            icon={<Shield className="size-4 text-muted-foreground" aria-hidden="true" />}
          />
        </SettingsSection>

        {/* Preferences */}
        <SettingsSection label={t("groups.preferences")}>
          <SettingsRow
            title={t("rows.alerts")}
            href="/profile/notifications"
            icon={<Bell className="size-4 text-brand-mango" aria-hidden="true" />}
          />
          <SettingsRow
            title={t("rows.appSettings")}
            href="/profile/settings"
            icon={<Settings className="size-4 text-muted-foreground" aria-hidden="true" />}
          />
        </SettingsSection>

        {/* Support */}
        <SettingsSection label={t("groups.support")}>
          <SettingsRow
            title={t("rows.help")}
            href="/profile/help"
            icon={<HelpCircle className="size-4 text-success" aria-hidden="true" />}
          />
          <SettingsRow
            title={t("rows.logout")}
            onClick={() => setLogoutOpen(true)}
            danger
            icon={<LogOut className="size-4 text-destructive" aria-hidden="true" />}
          />
        </SettingsSection>
      </div>

      {/* Identity aside (desktop only, R7): avatar / name / email / Quacks chip / Edit profile,
          then the Referral instance. */}
      <aside className="hidden lg:flex lg:flex-col lg:gap-6">
        <div className="rounded-xl border border-border bg-surface p-6 text-center">
          {/* POO-849 R1: the persisted avatar photo with the initials monogram as the fallback. */}
          <span className="mx-auto flex size-16 items-center justify-center overflow-hidden rounded-full bg-primary font-bold text-2xl text-primary-foreground">
            {user.avatar ? (
              <img src={user.avatar} alt="" className="size-full object-cover" />
            ) : (
              user.initial
            )}
          </span>
          <p className="mt-3 font-semibold text-foreground text-lg">{user.displayName}</p>
          <p className="mt-0.5 truncate text-muted-foreground text-sm">{user.email}</p>
          <p className="mt-3">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 font-medium text-primary text-xs">
              <Sparkles className="size-3" aria-hidden="true" />
              {t("identity.quacks", { count: realQuacks ?? user.quacks })}
            </span>
          </p>
          <Link
            href="/profile/personal"
            className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-md border border-border bg-surface font-semibold text-foreground text-sm transition-colors hover:bg-surface-raised"
          >
            {t("identity.editProfile")}
          </Link>
        </div>
        {referralCard}
      </aside>

      <ConfirmDialog
        open={logoutOpen}
        onOpenChange={setLogoutOpen}
        title={t("logout.title")}
        body={t("logout.body")}
        confirmLabel={t("logout.confirm")}
        cancelLabel={t("cancel")}
        onConfirm={handleLogout}
      />
    </div>
  );
}
