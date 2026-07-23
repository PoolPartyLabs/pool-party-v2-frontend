/**
 * @id PP-LAY-CMP-006
 * @name ManagerEntry
 *
 * Gold-tinted entry row always pinned to the top of the desktop sidebar (the manager area ships
 * in v1 — not feature-flagged, murilo 2026-06-11). Two states, driven by whether the current user
 * already manages strategies:
 *  - not a manager → "Become a manager" → /manager/become (onboarding)
 *  - a manager     → "Manager"          → /manager (console)
 *
 * Always visible — NOT gated by the Dev-menu toggle.
 *
 * `isManager` comes from the signed-in owner's profile in real mode (`profile.isManager` via the
 * owner profile session store and `useIsManager`, POO-779); the Dev-menu toggle only simulates it in
 * mock mode.
 */
"use client";

import { Briefcase } from "lucide-react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/Skeleton";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link ManagerEntry}. */
export interface ManagerEntryProps {
  /** Whether the current user already manages strategies (mocked today). */
  isManager: boolean;
  /**
   * Real-mode role still resolving (the owner profile session read that resolves `isManager` hasn't
   * landed). Shows a skeleton in place of the row so it doesn't flash "Become a manager" → "Manager".
   */
  loading?: boolean;
  /** Collapsed-sidebar mode: icon-only with the label as a tooltip (POO-283 R2). */
  collapsed?: boolean;
}

/** Sidebar row linking to the Become-a-manager onboarding or the Manager console. */
export function ManagerEntry({ isManager, loading = false, collapsed = false }: ManagerEntryProps) {
  const t = useTranslations("manager");
  // While the role resolves, hold the row's shape with a skeleton (avoids the become→manager flash).
  if (loading) {
    return (
      <div
        aria-hidden="true"
        className={cn(
          "flex items-center gap-3 rounded-md px-3 py-2",
          collapsed ? "justify-center px-2" : null,
        )}
      >
        <Skeleton width={16} height={16} radius="9999px" />
        {collapsed ? null : <Skeleton width={120} height={14} />}
      </div>
    );
  }
  const href = isManager ? "/manager" : "/manager/become";
  const label = isManager ? t("entry.manager") : t("entry.become");
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 font-medium text-sm transition-colors",
        "bg-primary/10 text-foreground ring-1 ring-primary/40 hover:bg-primary/15",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        collapsed && "justify-center px-2",
      )}
    >
      <Briefcase className="size-4 shrink-0 text-primary" aria-hidden="true" />
      {collapsed ? null : <span>{label}</span>}
    </Link>
  );
}
