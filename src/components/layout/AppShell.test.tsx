/**
 * @id PP-CORE-LAY-001
 * @name AppShell.test
 * Behavior: the desktop sidebar and the mobile tab bar render their (intentionally different) nav
 * sets, deferred areas are absent, children mount in the content area, and the active item is
 * matched by path segment (mobile "Invest" also owns /portfolio).
 */
import { CreditCard } from "lucide-react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDevOverridesForTests } from "@/lib/features/devOverrides";
import {
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../tests/utils/renderWithProviders";
import { AppShell, isNavItemVisible, type NavItem } from "./AppShell";

// Mutable so a test can drive a different route (POO-760 regression). Defaults to "/portfolio".
const nav = vi.hoisted(() => ({ pathname: "/portfolio" }));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: vi.fn() }),
  // Consumed by useLocaleSwitch (LocaleSwitcher + MobileLocaleSheet); only called on a locale
  // switch, which these shell tests never perform.
  getPathname: ({ href, locale }: { href: string; locale: string }) => `/${locale}${href}`,
  Link: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/** The two `Primary` navs in document order: [desktop sidebar, mobile tab bar]. */
function getNavs() {
  const [sidebar, tabbar] = screen.getAllByRole("navigation", { name: "Primary" }) as [
    HTMLElement,
    HTMLElement,
  ];
  return { sidebar, tabbar };
}

describe("isNavItemVisible", () => {
  const item = (over: Partial<NavItem>): NavItem => ({
    labelKey: "cards",
    href: "/cards",
    icon: CreditCard,
    ...over,
  });
  const allOn = () => true;

  it("hides a mockOnly item (Cards) in real mode, shows it in mock mode", () => {
    const cards = item({ flag: "cards", mockOnly: true });
    expect(isNavItemVisible(cards, { isEnabled: allOn, isManager: false, isMockMode: true })).toBe(
      true,
    );
    expect(isNavItemVisible(cards, { isEnabled: allOn, isManager: false, isMockMode: false })).toBe(
      false,
    );
  });

  it("still applies the flag gate to a mockOnly item", () => {
    const cards = item({ flag: "cards", mockOnly: true });
    expect(
      isNavItemVisible(cards, { isEnabled: () => false, isManager: false, isMockMode: true }),
    ).toBe(false);
  });

  it("leaves a non-mockOnly item unaffected by mock mode", () => {
    const home = item({ labelKey: "home", flag: "home" });
    expect(isNavItemVisible(home, { isEnabled: allOn, isManager: false, isMockMode: false })).toBe(
      true,
    );
  });

  it("shows a manager-only item only to managers", () => {
    const mgr = item({ requiresManager: true });
    expect(isNavItemVisible(mgr, { isEnabled: allOn, isManager: false, isMockMode: true })).toBe(
      false,
    );
    expect(isNavItemVisible(mgr, { isEnabled: allOn, isManager: true, isMockMode: true })).toBe(
      true,
    );
  });
});

describe("AppShell", () => {
  // The feature-flag client snapshot is memoized at module scope (stability for useSyncExternalStore);
  // reset it around each test so per-test `vi.stubEnv` flag changes resolve fresh.
  beforeEach(() => {
    nav.pathname = "/portfolio";
    __resetDevOverridesForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    __resetDevOverridesForTests();
  });

  // @rule CP-UI01, CP-UI05: Cash+ is a separate destination in both responsive navs.
  it("shows Cash+ after Strategies, marks it active, and preserves five mobile tabs", () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_CASH_PLUS", "on");
    vi.stubEnv("NEXT_PUBLIC_FEATURE_CARDS", "on");
    nav.pathname = "/cash-plus";
    renderWithProviders(
      <AppShell>
        <div>cash</div>
      </AppShell>,
    );
    const { sidebar, tabbar } = getNavs();
    expect(within(sidebar).getByRole("link", { name: "Cash+" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const links = within(sidebar).getAllByRole("link");
    const strategyIndex = links.findIndex((link) => link.textContent === "Strategies");
    expect(links[strategyIndex + 1]).toHaveTextContent("Cash+");
    expect(within(tabbar).getByRole("link", { name: "Cash+" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(tabbar).getAllByRole("link")).toHaveLength(5);
    expect(within(tabbar).queryByRole("link", { name: "Cards" })).toBeNull();
  });

  // @rule CP-UI02: disabled Cash+ leaves existing navigation intact.
  it("hides Cash+ in both navs while the feature is off", () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_CASH_PLUS", "off");
    renderWithProviders(
      <AppShell>
        <div>cash</div>
      </AppShell>,
    );
    expect(screen.queryByRole("link", { name: "Cash+" })).toBeNull();
  });

  it("renders the desktop sidebar set (Home, Portfolio, Strategies, Deposit, Profile)", () => {
    renderWithProviders(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    const { sidebar } = getNavs();
    for (const label of ["Home", "Portfolio", "Strategies", "Deposit", "Profile"]) {
      expect(within(sidebar).getByRole("link", { name: label })).toBeInTheDocument();
    }
    // Invest is a mobile-only label; Cards is flag-gated (off in v1) → absent here.
    expect(within(sidebar).queryByRole("link", { name: "Invest" })).toBeNull();
    expect(within(sidebar).queryByRole("link", { name: "Cards" })).toBeNull();
  });

  it("renders the v1 mobile tab-bar set (Home, Invest, Deposit, Profile) — Cards gated off", () => {
    renderWithProviders(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    const { tabbar } = getNavs();
    for (const label of ["Home", "Invest", "Deposit", "Profile"]) {
      expect(within(tabbar).getByRole("link", { name: label })).toBeInTheDocument();
    }
    // Cards is behind the `cards` flag (off in v1); Portfolio + Strategies live under "Invest".
    expect(within(tabbar).queryByRole("link", { name: "Cards" })).toBeNull();
    expect(within(tabbar).queryByRole("link", { name: "Portfolio" })).toBeNull();
    expect(within(tabbar).queryByRole("link", { name: "Strategies" })).toBeNull();
  });

  it("reveals the Cards tab in both navs when the cards flag is on", () => {
    // Cash+ ships ON in this fork and CP-UI05 gives its tab the Cards slot on mobile; this case is
    // about the cards flag alone, so Cash+ is switched off explicitly.
    vi.stubEnv("NEXT_PUBLIC_FEATURE_CASH_PLUS", "off");
    vi.stubEnv("NEXT_PUBLIC_FEATURE_CARDS", "on");
    renderWithProviders(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    const { sidebar, tabbar } = getNavs();
    expect(within(tabbar).getByRole("link", { name: "Cards" })).toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "Cards" })).toBeInTheDocument();
  });

  it("does not render deferred (non-v1) areas in either nav", () => {
    renderWithProviders(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    for (const label of ["Savings", "Predictions", "Buy tokens"]) {
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }
  });

  it("renders children in the content area", () => {
    renderWithProviders(
      <AppShell>
        <p>dashboard body</p>
      </AppShell>,
    );
    expect(screen.getByRole("main")).toHaveTextContent("dashboard body");
  });

  it("marks the active section with aria-current — Portfolio on desktop, Invest on mobile", () => {
    renderWithProviders(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    // usePathname is mocked to "/portfolio".
    const { sidebar, tabbar } = getNavs();
    // Desktop: the Portfolio tab is active directly.
    expect(within(sidebar).getByRole("link", { name: "Portfolio" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Mobile: "Invest" owns /portfolio (activeFor), so it is the active tab.
    expect(within(tabbar).getByRole("link", { name: "Invest" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(sidebar).getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(within(tabbar).getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("renders the header chrome (Dev menu, rewards pill) and the footer", () => {
    renderWithProviders(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    expect(screen.getByRole("button", { name: "Dev mode" })).toBeInTheDocument();
    // Rewards pill links to the Rubber Rush area; named via its aria-label (the Quacks count).
    const pill = screen.getByRole("link", { name: /Quacks/ });
    expect(pill).toHaveAttribute("href", "/rewards/rubber-rush");
    // Footer: legal links + the "Developed by" credit. Legal links open in a new tab (POO-795),
    // so their accessible name carries the "opens in new tab" hint.
    expect(screen.getByRole("navigation", { name: "Legal" })).toBeInTheDocument();
    const termsLink = screen.getByRole("link", { name: /Terms of Service/ });
    expect(termsLink).toHaveAttribute("target", "_blank");
    expect(termsLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/Developed by Pool Party Labs/)).toBeInTheDocument();
  });

  it("always shows the manager entry, and flips Become-a-manager to Manager via the dev toggle", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    const { sidebar } = getNavs();
    // v1, no feature flag: not a manager (toggle off) → "Become a manager" → onboarding.
    expect(within(sidebar).getByRole("link", { name: "Become a manager" })).toHaveAttribute(
      "href",
      "/manager/become",
    );

    // The Dev-menu Manager toggle mocks the manager role → entry flips to "Manager" → console.
    await user.click(screen.getByRole("button", { name: "Dev mode" }));
    await user.click(screen.getByRole("switch", { name: "Manager mode" }));
    expect(within(sidebar).getByRole("link", { name: "Manager Console" })).toHaveAttribute(
      "href",
      "/manager",
    );
    expect(within(sidebar).queryByRole("link", { name: "Become a manager" })).toBeNull();
  });

  it("pins Rubber Rush to the desktop sidebar only (rewards-gated, not in the mobile tab bar) — POO-340", () => {
    renderWithProviders(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    const { sidebar, tabbar } = getNavs();
    expect(within(sidebar).getByRole("link", { name: "Rubber Rush" })).toHaveAttribute(
      "href",
      "/rewards/rubber-rush",
    );
    expect(within(tabbar).queryByRole("link", { name: "Rubber Rush" })).toBeNull();
  });

  it("shows Manager Incentive Program in the sidebar only for managers — POO-340", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    const { sidebar } = getNavs();
    // Not a manager by default → the manager-only entry is hidden.
    expect(within(sidebar).queryByRole("link", { name: "Manager Incentive Program" })).toBeNull();
    // Flip manager mode on via the Dev menu → it appears.
    await user.click(screen.getByRole("button", { name: "Dev mode" }));
    await user.click(screen.getByRole("switch", { name: "Manager mode" }));
    expect(
      within(sidebar).getByRole("link", { name: "Manager Incentive Program" }),
    ).toHaveAttribute("href", "/rewards/manager-incentive-program");
  });

  it("marks only the active rewards route active when both rewards rows render — POO-760", async () => {
    const user = userEvent.setup();
    nav.pathname = "/rewards/rubber-rush";
    renderWithProviders(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    // Manager mode renders both `/rewards/*` rows, which previously both lit up (shared "rewards" segment).
    await user.click(screen.getByRole("button", { name: "Dev mode" }));
    await user.click(screen.getByRole("switch", { name: "Manager mode" }));
    const { sidebar } = getNavs();
    expect(within(sidebar).getByRole("link", { name: "Rubber Rush" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      within(sidebar).getByRole("link", { name: "Manager Incentive Program" }),
    ).not.toHaveAttribute("aria-current");
  });

  // @rule POO-904 R1/R3 — the mobile header gains the language icon (below lg only) while the
  // desktop select stays exactly where it was (hidden below lg). Both mount; CSS decides.
  it("mounts the mobile locale sheet below lg and keeps the desktop select at lg+ — POO-904 R1/R3", () => {
    renderWithProviders(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    // Mobile picker: icon trigger wrapped in a lg:hidden container [R1].
    const trigger = screen.getByRole("button", { name: "Change language" });
    expect(trigger.parentElement).toHaveClass("lg:hidden");
    // Desktop select: unchanged, still wrapped in hidden lg:block [R3].
    const select = screen.getByRole("combobox", { name: "Language" });
    expect(select.parentElement?.parentElement).toHaveClass("hidden", "lg:block");
  });

  it("opens the shared status modal from a Dev-menu tester and closes it on Escape", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    await user.click(screen.getByRole("button", { name: "Dev mode" }));
    await user.click(screen.getByRole("button", { name: "Success" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("All done")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the Dev menu on outside click", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    await user.click(screen.getByRole("button", { name: "Dev mode" }));
    expect(screen.getByRole("switch", { name: "Manager mode" })).toBeInTheDocument();

    await user.click(screen.getByText("content"));
    expect(screen.queryByRole("switch", { name: "Manager mode" })).toBeNull();
  });
});
