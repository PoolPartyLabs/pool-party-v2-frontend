/**
 * @id PP-MGR-CMP-010
 * @name ConsoleTabs
 * @implements-rules-version v1
 *
 * In-screen tab bar for the manager console (murilo's call: tabs on the screen, not a modified
 * sidebar; the console is client-side — switching tabs never changes the route). Underline style.
 * Overview and Strategies are live; Investors / Earnings / Activity are out of v1 and render as
 * disabled placeholders.
 */
"use client";

import { UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";

/** Which console tab is currently active. */
export type ConsoleTab =
  | "overview"
  | "strategies"
  | "investors"
  | "earnings"
  | "activity"
  | "profile";

/** The tabs a user can actually open in v1. */
export type SelectableConsoleTab = Extract<ConsoleTab, "overview" | "strategies" | "profile">;

/** The built tabs (the rest are disabled placeholders). */
const SELECTABLE: ReadonlySet<ConsoleTab> = new Set(["overview", "strategies", "profile"]);

/** Public props for {@link ConsoleTabs}. */
export interface ConsoleTabsProps {
  /** The active tab. */
  active: ConsoleTab;
  /** Called with the tab the user opened (only built tabs are clickable). */
  onSelect: (tab: SelectableConsoleTab) => void;
}

/** Borderless underline tab bar for the manager console. */
export function ConsoleTabs({ active, onSelect }: ConsoleTabsProps) {
  const t = useTranslations("manager");
  // Literal t() calls (the i18n usage scan is static — no dynamic keys).
  const tabs: { key: ConsoleTab; label: string }[] = [
    { key: "overview", label: t("tabs.overview") },
    { key: "strategies", label: t("tabs.strategies") },
    { key: "investors", label: t("tabs.investors") },
    { key: "earnings", label: t("tabs.earnings") },
    { key: "activity", label: t("tabs.activity") },
    { key: "profile", label: t("tabs.profile") },
  ];
  return (
    // overflow-x-auto lets the strip scroll on narrow screens; overflow-y-hidden + the hidden
    // scrollbar kill the stray vertical scrollbar overflow-x-auto otherwise computes (overflow-y
    // resolves to auto, and the content is ~1px taller than the box).
    <nav
      aria-label="Manager console"
      className="flex gap-1 overflow-x-auto overflow-y-hidden border-border border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map(({ key, label }) => {
        const isActive = key === active;
        // The manager's own public profile is set apart (pushed right) and styled as a bordered
        // button — prominent, but NOT a solid CTA (murilo 2026-06-29) — since it's a different
        // destination from the console's data tabs, which keep the underline style.
        const isFeatured = key === "profile";
        const classes = isFeatured
          ? cn(
              "ml-auto inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 font-medium text-sm transition-colors",
              isActive
                ? "border-primary/60 bg-primary/10 text-foreground"
                : "border-border text-foreground/90 hover:border-primary/40 hover:bg-surface-raised",
            )
          : cn(
              "-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 font-medium text-sm",
              isActive ? "border-primary text-foreground" : "border-transparent",
            );
        if (!SELECTABLE.has(key)) {
          // PP-TODO: the Investors / Earnings / Activity tabs are out of v1 (manager gap map).
          return (
            <span
              key={key}
              aria-disabled="true"
              className={cn(classes, "text-muted-foreground/50")}
            >
              {label}
            </span>
          );
        }
        return (
          <button
            key={key}
            type="button"
            aria-current={isActive ? "page" : undefined}
            onClick={() => onSelect(key as SelectableConsoleTab)}
            className={cn(
              classes,
              // The underline data tabs dim when inactive; the featured profile button carries its
              // own inactive treatment above.
              !isActive &&
                !isFeatured &&
                "text-muted-foreground transition-colors hover:text-foreground",
            )}
          >
            {isFeatured ? <UserRound className="size-3.5" aria-hidden="true" /> : null}
            {label}
          </button>
        );
      })}
    </nav>
  );
}
