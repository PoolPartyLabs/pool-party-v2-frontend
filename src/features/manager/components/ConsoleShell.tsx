/**
 * @id PP-MGR-CMP-031
 * @name ConsoleShell
 * @implements-rules-version v1
 *
 * The shared chrome for the manager console's tabbed views: a persistent header (greeting +
 * "Create new strategy" CTA) above the in-screen {@link ConsoleTabs}, wrapping the active tab's
 * panel body. Hoisting this here (POO-451) makes the CTA visible on EVERY selectable tab
 * (Overview / My strategies / Profile), not only Overview where it used to live inside
 * ManagerDashboardView. The first-run empty state and the manage-detail overlay render their own
 * layouts and do not use this shell.
 */
"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { GreetingHeading } from "@/components/data-display/GreetingHeading";
import { Button } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";
import { useNavigationGuard } from "@/lib/hooks/unsavedChanges";
import { ConsoleTabs, type SelectableConsoleTab } from "./ConsoleTabs";

/** Public props for {@link ConsoleShell}. */
export interface ConsoleShellProps {
  /** The active console tab. */
  active: SelectableConsoleTab;
  /** Switches the console tab (URL-driven). */
  onSelectTab: (tab: SelectableConsoleTab) => void;
  /** The active tab's panel body. */
  children: ReactNode;
  /** POO-620: link target for the greeting — the manager's own public profile (`/m/<handle|address>`). */
  profileHref?: string;
  /** POO-704: the owner's PUBLIC `displayName` (`/users/me`), resolved server-side and forwarded to
   * the greeting; blank/absent falls back to the masked wallet. */
  displayName?: string;
}

/** Manager console chrome: persistent greeting + create CTA + tabs, above the panel body. */
export function ConsoleShell({
  active,
  onSelectTab,
  children,
  profileHref,
  displayName,
}: ConsoleShellProps) {
  const t = useTranslations("manager");
  const router = useRouter();
  // POO-751: leaving the Profile tab (tab switch or the Create CTA) with unsaved edits confirms first.
  const guard = useNavigationGuard();
  return (
    <div className="flex flex-col gap-6">
      {/* Persistent header: greeting + "Create new strategy" — visible on every tab (POO-451). */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <GreetingHeading profileHref={profileHref} displayName={displayName} />
          <p className="text-muted-foreground text-sm">{t("dashboard.subtitle")}</p>
        </div>
        <Button onClick={() => guard(() => router.push("/manager/new"))}>
          <Plus className="size-4 shrink-0" aria-hidden="true" />
          {t("dashboard.createNew")}
        </Button>
      </div>
      <ConsoleTabs active={active} onSelect={(tab) => guard(() => onSelectTab(tab))} />
      {children}
    </div>
  );
}
