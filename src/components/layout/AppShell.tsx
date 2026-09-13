/**
 * @id PP-CORE-LAY-001
 * @name AppShell
 * @implements-rules-version v1
 *
 * Authenticated app shell. Desktop (lg+): a persistent left sidebar (brand + nav) and a top bar
 * (Dev menu + rewards pill + locale switch + wallet menu). Mobile: a top brand bar (brand +
 * rewards + language sheet + wallet, POO-904) + a fixed bottom tab bar. An {@link AppFooter}
 * (brand + legal links + fine print) closes every screen.
 *
 * Desktop and mobile use SEPARATE nav sets ({@link DESKTOP_NAV_ITEMS} / {@link MOBILE_NAV_ITEMS}):
 * the mobile tab bar mirrors the 5-tab mobile design (Home · Invest · Cards · Deposit · Profile),
 * while the desktop sidebar has room for Home · Portfolio · Strategies · Deposit · Profile. The
 * active item is matched by the leading path segment via `usePathname` (a tab may also own extra
 * segments via {@link NavItem.activeFor}). A {@link ManagerEntry} row is always pinned to the top
 * of the sidebar (the manager area ships in v1, not feature-flagged, murilo 2026-06-11); its
 * Become-a-manager / Manager state comes from the signed-in owner's profile in real mode (POO-779),
 * and is only simulated by the TEMP Dev-menu toggle in mock mode.
 *
 * The chrome — sidebar, top bar (header), bottom tab bar, and footer — stays full-bleed across the
 * entire width. Only the page content is capped at {@link CONTENT_WIDTH} and centered, so it never
 * stretches edge-to-edge on large monitors. This is the single, app-wide content width cap — every
 * screen rendered through the shell inherits it. Tune it in one place by editing CONTENT_WIDTH.
 */
"use client";

import {
  ArrowDownToLine,
  Award,
  CircleDollarSign,
  CreditCard,
  Gift,
  House,
  type LucideIcon,
  PanelLeftClose,
  PanelLeftOpen,
  PieChart,
  Smile,
  TrendingUp,
  User,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import { MobileLocaleSheet } from "@/components/ui/MobileLocaleSheet";
import { ManagerEntry } from "@/features/manager/components/ManagerEntry";
import { useQuacksBalance } from "@/features/rewards/hooks/useQuacksBalance";
import { FundingRecoveryBanner } from "@/features/strategies/components/provisioning/FundingRecoveryBanner";
import { WalletMenu } from "@/features/wallet";
import { usePathname } from "@/i18n/navigation";
import { useIsManager } from "@/lib/account/useIsManager";
import type { FeatureKey } from "@/lib/features";
import { isDevPanelEnabled } from "@/lib/features/devOverrides";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { usePersistentState } from "@/lib/hooks/usePersistentState";
import { isMockMode } from "@/lib/services";
import { cn } from "@/lib/utils/cn";
import { AppFooter } from "./AppFooter";
import { DevMenu } from "./DevMenu";
import { GuardedLink } from "./GuardedLink";
import { RewardsPill } from "./RewardsPill";

/**
 * App-wide max width for page content. The chrome (header, sidebar, footer tab bar) stays full-bleed
 * across the whole width; only the content is constrained to this and centered (`mx-auto`) so layouts
 * don't stretch on large screens. `max-w-7xl` ≈ 1280px: roomy on a laptop (the cap rarely engages
 * below ~1536px wide once the 256px sidebar is accounted for) yet keeps tiles/tables in proportion on
 * big monitors. Change this one value to retune the cap everywhere.
 */
const CONTENT_WIDTH = "mx-auto w-full max-w-7xl";

/** The shell.nav.* label keys — literal t() calls below (the i18n usage scan is static). */
type NavLabelKey =
  | "home"
  | "invest"
  | "portfolio"
  | "strategies"
  | "cashPlus"
  | "cards"
  | "deposit"
  | "profile"
  | "rubberRush"
  | "managerIncentive";

/** A single navigation entry. */
export interface NavItem {
  /** Key of the visible link text under `shell.nav` (POO-283 R1 — no hardcoded labels). */
  labelKey: NavLabelKey;
  /** Locale-agnostic destination (the locale-aware {@link Link} prefixes the active locale). */
  href: string;
  /** lucide-react icon. */
  icon: LucideIcon;
  /**
   * Extra leading path segments that also mark this item active. Lets one tab own several routes —
   * e.g. mobile "Invest" stays highlighted on `/portfolio` too, since Portfolio lives under the
   * Invest area (via an Explore/Portfolio toggle) rather than being its own mobile tab.
   */
  activeFor?: readonly string[];
  /**
   * Feature flag gating this item. When set, the item renders only while its flag is on (via
   * {@link useFeatureFlags}); unflagged items always render. This is how v1 hides not-yet-launched
   * areas (e.g. Savings) from the nav, flip the env flag on to reveal the tab with no code change.
   */
  flag?: FeatureKey;
  /** When set, the item renders only for managers (`isManager`). Desktop-only manager affordance. */
  requiresManager?: boolean;
  /**
   * When set, the item renders only in mock mode ({@link isMockMode}); real mode hides it regardless
   * of its flag. For areas we develop on the mock preview that must not surface to real users yet
   * (e.g. Cards). `flag` asks "is it launched?"; `mockOnly` asks "mock data only?".
   */
  mockOnly?: boolean;
}

/** The flag / role / mode context that decides whether a nav item is visible. */
export interface NavVisibilityContext {
  /** Whether a feature flag is on (from {@link useFeatureFlags}). */
  isEnabled: (flag: FeatureKey) => boolean;
  /** Whether the signed-in user is a manager. */
  isManager: boolean;
  /** Whether the app runs on mock data ({@link isMockMode}). */
  isMockMode: boolean;
}

/**
 * Whether a nav item shows: its flag must be on (or absent), a manager-only item needs a manager, and
 * a `mockOnly` item (e.g. Cards) hides in real mode, so it surfaces on the mock preview we develop
 * against but never to real users until it ships.
 */
export function isNavItemVisible(item: NavItem, ctx: NavVisibilityContext): boolean {
  return (
    (!item.flag || ctx.isEnabled(item.flag)) &&
    (!item.requiresManager || ctx.isManager) &&
    (!item.mockOnly || ctx.isMockMode)
  );
}

/**
 * Desktop sidebar navigation, in display order. The sidebar has room for Portfolio and Strategies
 * as separate top-level entries. Cards is flag-gated AND mock-only (off in v1, hidden in real mode)
 * like the mobile tab; other deferred areas (Savings, Predictions, …) are intentionally absent.
 */
const DESKTOP_NAV_ITEMS: readonly NavItem[] = [
  { labelKey: "home", href: "/", icon: House, flag: "home" },
  { labelKey: "portfolio", href: "/portfolio", icon: PieChart, flag: "portfolio" },
  { labelKey: "strategies", href: "/strategies", icon: TrendingUp, flag: "strategies" },
  { labelKey: "cashPlus", href: "/cash-plus", icon: CircleDollarSign, flag: "cashPlus" },
  { labelKey: "cards", href: "/cards", icon: CreditCard, flag: "cards", mockOnly: true },
  { labelKey: "deposit", href: "/deposit", icon: ArrowDownToLine, flag: "deposit" },
  { labelKey: "profile", href: "/profile", icon: User, flag: "profile" },
  // Manager-only incentive program, then Rubber Rush pinned LAST (both desktop-only, rewards-gated).
  {
    labelKey: "managerIncentive",
    href: "/rewards/manager-incentive-program",
    icon: Award,
    flag: "rewards",
    requiresManager: true,
  },
  { labelKey: "rubberRush", href: "/rewards/rubber-rush", icon: Gift, flag: "rewards" },
] as const;

/**
 * Mobile bottom tab bar, in display order — intentionally DIFFERENT from {@link DESKTOP_NAV_ITEMS},
 * mirroring the mobile design's 5-tab footer (Home · Invest · Cards · Deposit · Profile). Portfolio
 * and Strategies are not top-level tabs here: they live under "Invest" via an Explore/Portfolio
 * toggle inside that area (the toggle UI ships with the Strategies screen; until then "Invest" still
 * owns `/portfolio` via {@link NavItem.activeFor}). Cards is in the design's 5-tab footer but is
 * gated behind the `cards` flag (off in v1, the next area to build) AND is mock-only, so the v1 tab
 * bar shows four tabs until Cards launches. The fifth tab returns only when the flag is on AND the
 * app runs on mock data; real mode hides it regardless (mockOnly).
 */
const MOBILE_NAV_ITEMS: readonly NavItem[] = [
  { labelKey: "home", href: "/", icon: House, flag: "home" },
  {
    labelKey: "invest",
    href: "/strategies",
    icon: TrendingUp,
    activeFor: ["portfolio"],
    flag: "strategies",
  },
  { labelKey: "cashPlus", href: "/cash-plus", icon: CircleDollarSign, flag: "cashPlus" },
  { labelKey: "cards", href: "/cards", icon: CreditCard, flag: "cards", mockOnly: true },
  { labelKey: "deposit", href: "/deposit", icon: ArrowDownToLine, flag: "deposit" },
  { labelKey: "profile", href: "/profile", icon: Smile, flag: "profile" },
] as const;

/** Split a locale-stripped path/href into its non-empty segments. */
function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/**
 * Whether a nav item owns the current path (POO-760). An item is active when its href segments are a
 * segment-wise PREFIX of the current path's segments: a single-segment tab still owns its sub-routes
 * (Portfolio `/portfolio` owns `/portfolio/:id`), while two tabs that share a leading segment stay
 * distinct — `/rewards/rubber-rush` no longer also lights `/rewards/manager-incentive-program`.
 * Home (`/`, no segments) is active only at the root. `activeFor` stays a leading-segment fallback so
 * the mobile Invest tab still lights on `/portfolio`.
 */
function isActive(item: NavItem, pathname: string): boolean {
  const path = segments(pathname);
  const href = segments(item.href);
  if (href.length === 0) return path.length === 0;
  if (href.every((seg, index) => path[index] === seg)) return true;
  return item.activeFor?.includes(path[0] ?? "") ?? false;
}

/** Shared class for a desktop sidebar nav link, by active state. */
function navLinkClass(active: boolean): string {
  return cn(
    "flex items-center gap-3 rounded-md px-3 py-2 font-medium text-sm transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "bg-surface-raised text-foreground"
      : "text-muted-foreground hover:bg-surface-raised hover:text-foreground",
  );
}

/**
 * The brand lockup (duck + wordmark), linking Home. `large` bumps both the duck and the wordmark for
 * the desktop sidebar, where the lockup sits centered with room to breathe; the mobile header keeps
 * the default, smaller, left-aligned size so it fits a ~320px bar beside the rewards pill + connect.
 */
function Brand({ large = false, iconOnly = false }: { large?: boolean; iconOnly?: boolean }) {
  return (
    <GuardedLink
      href="/"
      className="flex items-center gap-2"
      aria-label={iconOnly ? "Pool Party" : undefined}
    >
      {/* Decorative: the wordmark beside it names the brand (the link label covers icon-only). */}
      <img
        src="/brand/duck-head.png"
        alt=""
        aria-hidden="true"
        className={cn("object-contain", large ? "size-10" : "size-8")}
      />
      {iconOnly ? null : (
        <span className={cn("font-semibold text-foreground", large ? "text-lg" : "text-base")}>
          Pool Party
        </span>
      )}
    </GuardedLink>
  );
}

/** Public props for {@link AppShell}. */
export interface AppShellProps {
  /** Page content rendered inside the main content area. */
  children: ReactNode;
  /** Extra classes merged onto the outermost shell element. */
  className?: string;
}

/** Wraps authenticated screens with the responsive navigation chrome. */
export function AppShell({ children, className }: AppShellProps) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const { isEnabled } = useFeatureFlags();
  // Manager role: in real mode it comes from the signed-in owner's profile (profile.isManager via the
  // owner profile session store, POO-779); in mock mode the Dev-menu toggle still simulates it for demos.
  const [managerMode, setManagerMode] = useState(false);
  const { isManager: realIsManager, isLoading: realIsManagerLoading } = useIsManager();
  const isManager = isMockMode ? managerMode : realIsManager;
  // Real Quacks balance for the header pill (replaces the old hardcoded value).
  const quacks = useQuacksBalance();
  // Skeleton the manager entry only in real mode while the owner profile read resolves (mock is instant).
  const managerLoading = !isMockMode && realIsManagerLoading;
  // Collapsed sidebar is a simple, non-sensitive UI preference — fine in localStorage (POO-283 R2).
  const [collapsed, setCollapsed] = usePersistentState<boolean>("pp.sidebar.collapsed", false);

  // Literal t() calls per key (the i18n usage scan is static — no dynamic keys).
  const navLabels: Record<NavLabelKey, string> = {
    home: t("nav.home"),
    invest: t("nav.invest"),
    portfolio: t("nav.portfolio"),
    strategies: t("nav.strategies"),
    cashPlus: t("nav.cashPlus"),
    cards: t("nav.cards"),
    deposit: t("nav.deposit"),
    profile: t("nav.profile"),
    rubberRush: t("nav.rubberRush"),
    managerIncentive: t("nav.managerIncentive"),
  };

  // Show only the nav items whose flag is on (unflagged items always show). One source of truth —
  // the registry — drives both nav sets, so launching an area is a flag flip, not a code edit.
  // `mockOnly` items (Cards) additionally hide in real mode, so they surface on the mock preview we
  // develop against but never to real users until they ship.
  const navContext: NavVisibilityContext = { isEnabled, isManager, isMockMode };
  const desktopNav = DESKTOP_NAV_ITEMS.filter((item) => isNavItemVisible(item, navContext));
  const mobileNav = MOBILE_NAV_ITEMS.filter(
    (item) =>
      isNavItemVisible(item, navContext) &&
      // CP-UI05: keep all live destinations and five comfortable mobile tabs in the demo.
      !(item.labelKey === "cards" && item.mockOnly && isEnabled("cashPlus")),
  );

  return (
    <div className={cn("min-h-screen bg-background text-foreground lg:flex", className)}>
      {/* Desktop sidebar. Borderless on purpose (no right divider, no line under the brand): the
          Figma chrome has the surface-shaded sidebar blend softly into the darker page canvas, not a
          boxed panel. Keep it borderless — don't re-add border-r/border-b. */}
      {/* Sticky on lg+ so the sidebar stays in view while only the page content scrolls
          (`self-start` + a viewport height keeps the sticky box from stretching the flex row). */}
      <aside
        className={cn(
          "hidden shrink-0 flex-col bg-surface lg:sticky lg:top-0 lg:flex lg:h-svh lg:self-start lg:overflow-y-auto",
          collapsed ? "w-[76px]" : "w-64",
        )}
      >
        <div className={cn("flex h-16 items-center justify-center", collapsed ? "px-2" : "px-5")}>
          <Brand large iconOnly={collapsed} />
        </div>
        <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 p-3">
          {/* Manager entry, always pinned to the top of the sidebar (v1, not feature-flagged).
              `isManager` comes from the signed-in owner's profile in real mode (POO-779); the Dev-menu
              toggle only simulates it in mock mode. It swaps Become a manager / Manager + the route. */}
          <ManagerEntry isManager={isManager} loading={managerLoading} collapsed={collapsed} />
          {/* Divider sets the pinned manager action apart from the primary nav. This is a
              deliberate in-content separator — the sidebar chrome itself stays borderless. */}
          <hr className="my-1 border-border border-t" />
          {desktopNav.map((item) => {
            const active = isActive(item, pathname);
            const Icon = item.icon;
            const label = navLabels[item.labelKey];
            return (
              <GuardedLink
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={collapsed ? label : undefined}
                aria-label={collapsed ? label : undefined}
                className={cn(navLinkClass(active), collapsed && "justify-center px-2")}
              >
                <Icon
                  className={cn("size-4 shrink-0", active && "text-primary")}
                  aria-hidden="true"
                />
                {collapsed ? null : <span>{label}</span>}
              </GuardedLink>
            );
          })}
          {/* Collapse / expand the sidebar to an icon rail (POO-283 R2). Pinned to the bottom. */}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            title={collapsed ? t("nav.expand") : t("nav.collapse")}
            aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
            className={cn(
              "mt-auto flex items-center gap-3 rounded-md px-3 py-2 font-medium text-muted-foreground text-sm transition-colors",
              "hover:bg-surface-raised hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              collapsed && "justify-center px-2",
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4 shrink-0" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="size-4 shrink-0" aria-hidden="true" />
            )}
            {collapsed ? null : <span>{t("nav.collapse")}</span>}
          </button>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header spans the full width; only the content below is capped. Borderless and no surface
            bar — it floats on the page canvas like the Figma (the top bar isn't a lighter divider-ed
            strip). Don't re-add border-b/bg-surface. */}
        <header className="flex h-16 items-center justify-between gap-3 px-4 lg:px-6">
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
            {/* TEMP dev tooling (removed before launch); drives the desktop Manager sidebar.
                Desktop-only — it has no place on a phone and would crowd the mobile header.
                Mock-mode only: in real mode the manager role + feature data come from the backend, so
                the Dev menu (manager toggle + flag overrides) is irrelevant and is hidden. */}
            {isDevPanelEnabled() && isMockMode ? (
              <div className="hidden lg:block">
                <DevMenu managerMode={managerMode} onManagerModeChange={setManagerMode} />
              </div>
            ) : null}
            {isEnabled("rewards") ? <RewardsPill quacks={quacks ?? 0} /> : null}
            {/* Language: below lg a Languages icon opens the bottom-sheet picker (POO-904 R1);
                lg+ keeps the select unchanged (R3). Both run the shared useLocaleSwitch seam. */}
            <div className="lg:hidden">
              <MobileLocaleSheet />
            </div>
            <div className="hidden lg:block">
              <LocaleSwitcher />
            </div>
            {/* Wallet entry: connected chip + modal (WalletMenu), or the connect/login fallback. */}
            <WalletMenu />
          </div>
        </header>

        {/* Content is capped + centered so it never stretches on large monitors. */}
        <main className="min-w-0 flex-1">
          <div className={cn(CONTENT_WIDTH, "p-4 lg:p-6")}>
            {/* POO-1055 (hackathon POO-1022): a funding route interrupted mid-flight. Mounted on the
                shell rather than on any one screen because a bridge takes minutes and the user comes
                back wherever they like, including to a screen that has nothing to do with the
                operation. Renders nothing unless the connected wallet actually has a route in
                flight, which is every load but a handful. */}
            <FundingRecoveryBanner />
            {children}
          </div>
        </main>

        {/* Footer is full-bleed (chrome is never width-capped) and carries the mobile tab-bar clearance. */}
        <AppFooter />
      </div>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-border border-t bg-surface lg:hidden"
      >
        {mobileNav.map((item) => {
          const active = isActive(item, pathname);
          const Icon = item.icon;
          return (
            <GuardedLink
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 py-2 font-medium text-[10px] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className={cn("size-5", active && "text-primary")} aria-hidden="true" />
              <span>{navLabels[item.labelKey]}</span>
            </GuardedLink>
          );
        })}
      </nav>
    </div>
  );
}
