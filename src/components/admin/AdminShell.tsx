/**
 * @id PP-ADM-CMP-010
 * @name AdminShell
 * @implements-rules-version v1
 *
 * Chrome for the internal Admin Console (POO-144 R4), distinct from the investor {@link AppShell}:
 * a persistent left sidebar (brand + gold ADMIN badge + grouped nav + signed-in user row) and a
 * capped content column. Desktop-first — the console is an internal, desktop-only surface. The
 * active nav item is matched against the locale-stripped pathname from `@/i18n/navigation`.
 *
 * Admin copy MAY use DeFi/crypto jargon (internal surface); it still flows through `useTranslations`
 * so the 11-locale parity gate stays green. Nav labels use LITERAL t() keys so the static i18n scan
 * resolves them.
 */
"use client";

import { BadgeCheck, ImageIcon, LayoutDashboard, type LucideIcon, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import type { AdminRole } from "@/lib/admin/rbac";
import { cn } from "@/lib/utils/cn";

/** One sidebar entry. `labelKey` indexes the precomputed literal labels (static i18n scan). */
interface AdminNavItem {
  labelKey: "overview" | "managers" | "images" | "roles";
  href: string;
  icon: LucideIcon;
  /** Only rendered for the master role (e.g. the Roles & Permissions page). */
  masterOnly?: boolean;
}

const NAV_ITEMS: readonly AdminNavItem[] = [
  { labelKey: "overview", href: "/admin/overview", icon: LayoutDashboard },
  { labelKey: "managers", href: "/admin/operations/managers", icon: BadgeCheck },
  { labelKey: "images", href: "/admin/moderation/images", icon: ImageIcon },
  { labelKey: "roles", href: "/admin/roles", icon: ShieldCheck, masterOnly: true },
] as const;

/** A nav item owns the current route when the pathname equals or nests under its href. */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export interface AdminShellProps {
  /** Signed-in admin email, shown in the sidebar user row. */
  email: string;
  /** Access level, shown as a chip. */
  role: AdminRole;
  children: ReactNode;
}

export function AdminShell({ email, role, children }: AdminShellProps) {
  const t = useTranslations("admin");
  const pathname = usePathname();

  // Literal t() calls so the static i18n usage scan can resolve every key.
  const labels: Record<AdminNavItem["labelKey"], string> = {
    overview: t("nav.overview"),
    managers: t("nav.managers"),
    images: t("nav.images"),
    roles: t("nav.roles"),
  };
  const roleLabel =
    role === "operator"
      ? t("roles.operator")
      : role === "admin"
        ? t("roles.admin")
        : t("roles.master");

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="font-semibold text-base">{t("brand")}</span>
          <span className="rounded bg-primary px-1.5 py-0.5 font-bold text-[10px] text-primary-foreground uppercase tracking-wide">
            {t("badge")}
          </span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2" aria-label={t("badge")}>
          {NAV_ITEMS.filter((item) => !item.masterOnly || role === "master").map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 font-medium text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-surface-raised text-foreground"
                    : "text-muted-foreground hover:bg-surface-raised hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                <span>{labels[item.labelKey]}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-border border-t px-5 py-4">
          <p className="text-muted-foreground text-xs">{t("userRow.signedInAs")}</p>
          <p className="truncate font-medium text-sm">{email}</p>
          <span className="mt-1 inline-block rounded bg-surface-raised px-1.5 py-0.5 font-semibold text-[10px] text-muted-foreground uppercase tracking-wide">
            {roleLabel}
          </span>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
