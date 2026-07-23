/**
 * @id PP-CORE-CMP-037 (POO-410)
 * @name GreetingHeading
 * @implements-rules-version v1 (POO-620 rules v1)
 *
 * Time-of-day greeting shared by the investor Home and the Manager Console Overview:
 * "Good morning/afternoon/evening, {name}". The bucket tracks the viewer's LOCAL time (defaults to
 * morning until mounted to avoid a hydration mismatch; the real bucket appears on mount). The name is
 * the user's PUBLIC display name, falling back to their masked wallet address when no name is set.
 *
 * POO-704: the real-mode display name is now sourced. The owner's `displayName` (`GET /users/me`,
 * POO-693) is resolved server-side by the Home / Console pages and threaded in via `displayName`.
 * When it is blank (a cleared name, POO-700) or absent, the greeting falls back to the masked wallet
 * in the SAME format as the server default (POO-232 [R2]: `0x1A2b...5678`), via `maskWalletName`, so a
 * cleared name reads identically to a server-defaulted one. Mock mode (no prop) shows the mock name.
 *
 * POO-620: an optional `profileHref` turns the greeting into a link to the viewer's own public
 * profile (the Manager Console passes it; the investor Home leaves it unset, staying plain text).
 *
 * POO-751: that own-profile link is a {@link GuardedLink}, so navigating away from a DIRTY Profile
 * screen via the greeting routes through the same unsaved-changes guard the settings nav uses ([R3]).
 */
"use client";

import { useTranslations } from "next-intl";
import { GuardedLink } from "@/components/layout/GuardedLink";
import { useAuth } from "@/lib/auth/useAuth";
import { useHasMounted } from "@/lib/hooks/useHasMounted";
import { isMockMode } from "@/lib/services";
import { maskWalletName } from "@/lib/utils/address";
import { cn } from "@/lib/utils/cn";
import { type TimeOfDay, timeOfDay } from "@/lib/utils/timeOfDay";
import { mockProfileUser } from "@/mocks/data/profile";

/** Public props for {@link GreetingHeading}. */
export interface GreetingHeadingProps {
  /** Extra classes merged onto the heading. */
  className?: string;
  /**
   * POO-620: when set, the greeting links to the viewer's own public profile (`/m/<handle|address>`).
   * Passed by the Manager Console; omitted on the investor Home so it stays plain text.
   */
  profileHref?: string;
  /**
   * POO-704: the authenticated owner's PUBLIC display name (`GET /users/me` `displayName`, POO-693),
   * resolved server-side and threaded in by the Home / Console pages. Blank/whitespace (a cleared
   * name, POO-700) or absent → the greeting falls back to the masked wallet. Mock mode omits it and
   * the mock profile name is used instead.
   */
  displayName?: string;
}

/** "Good {time}, {name|wallet}" heading. */
export function GreetingHeading({ className, profileHref, displayName }: GreetingHeadingProps) {
  const t = useTranslations("common");
  const { address } = useAuth();
  const mounted = useHasMounted();
  const bucket: TimeOfDay = mounted ? timeOfDay(new Date().getHours()) : "morning";
  // POO-704: prefer the real owner `displayName` (threaded from /users/me); mock mode (no prop) keeps
  // the mock profile name. POO-693: the greeting uses the PUBLIC `displayName`, not the private `name`.
  const profileName = (displayName ?? (isMockMode ? mockProfileUser.displayName : "")).trim();
  // Blank name (cleared, POO-700) or none → the masked wallet in the SAME format as the server default
  // (POO-704 [R5]), so a cleared name reads identically to a server-defaulted one.
  const name = profileName || (mounted && address ? maskWalletName(address) : profileName);
  // Resolve all three with literal keys so the i18n usage scan sees them, then index by bucket.
  const greetings: Record<TimeOfDay, string> = {
    morning: t("greeting.morning", { name }),
    afternoon: t("greeting.afternoon", { name }),
    evening: t("greeting.evening", { name }),
  };
  const content = greetings[bucket];
  return (
    <h1 className={cn("font-semibold text-2xl text-foreground", className)}>
      {profileHref ? (
        <GuardedLink
          href={profileHref}
          className="transition-colors hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {content}
        </GuardedLink>
      ) : (
        content
      )}
    </h1>
  );
}
