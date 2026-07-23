/**
 * @id PP-PROF-CMP-007
 * @name SettingsLayout
 * @implements-rules-version v1
 *
 * Shared chrome for the Profile settings sub-screens. Mobile = a "back to profile" link + the page
 * title + the screen content (drill-down). Desktop (lg+) = a persistent left nav rail (Account /
 * Preferences / Support groups, active row highlighted) beside the detail panel. The active row is
 * matched against the current path via `usePathname`.
 */
"use client";

import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { GuardedLink } from "@/components/layout/GuardedLink";
import { usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils/cn";

/** A nav item: route + the `rows.*` i18n key for its label. */
interface NavItem {
  href: string;
  key: string;
}

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "groups.account",
    items: [
      { href: "/profile/personal", key: "rows.personalInfo" },
      { href: "/profile/social", key: "rows.linkedSocial" },
      { href: "/profile/security", key: "rows.security" },
    ],
  },
  {
    label: "groups.preferences",
    items: [
      { href: "/profile/notifications", key: "rows.alerts" },
      { href: "/profile/settings", key: "rows.appSettings" },
    ],
  },
  {
    label: "groups.support",
    items: [{ href: "/profile/help", key: "rows.help" }],
  },
];

/** Public props for {@link SettingsLayout}. */
export interface SettingsLayoutProps {
  /** The page title (mobile heading). */
  title: string;
  /** The screen content. */
  children: ReactNode;
}

/** Responsive settings chrome (mobile drill-down / desktop nav rail). */
export function SettingsLayout({ title, children }: SettingsLayoutProps) {
  const t = useTranslations("profile");
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:gap-8">
      {/* Mobile: back link + title */}
      <div className="lg:hidden">
        <GuardedLink
          href="/profile"
          className="inline-flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          {t("backToProfile")}
        </GuardedLink>
        <h1 className="mt-3 font-bold text-2xl text-foreground">{title}</h1>
      </div>

      {/* Desktop: nav rail */}
      <aside className="hidden w-60 shrink-0 lg:block">
        <GuardedLink
          href="/profile"
          className="mb-4 inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          {t("backToProfile")}
        </GuardedLink>
        <nav className="flex flex-col gap-4" aria-label={t("settings")}>
          {GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-1 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                {t(group.label)}
              </p>
              {group.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <GuardedLink
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center rounded-md px-3 py-2 font-medium text-sm transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-surface-raised hover:text-foreground",
                    )}
                  >
                    {t(item.key)}
                  </GuardedLink>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      {/* Detail */}
      <div className="min-w-0 flex-1">
        <h1 className="mb-5 hidden font-bold text-2xl text-foreground lg:block">{title}</h1>
        <div className="flex flex-col gap-6">{children}</div>
      </div>
    </div>
  );
}
