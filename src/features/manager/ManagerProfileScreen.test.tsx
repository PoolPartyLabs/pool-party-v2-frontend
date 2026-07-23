/**
 * @id PP-MGR-SCR-005
 * @name ManagerProfileScreen.test
 * Behavior: renders the manager identity + stats + their strategies, and an empty state when the
 * manager has no public strategies.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManagerProfile } from "@/lib/schemas";
import { DEV_MANAGER_ADDRESS, managerProfiles } from "@/mocks/data/manager";
import { strategies } from "@/mocks/data/strategies";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../tests/utils/renderWithProviders";
import { ManagerProfileScreen } from "./ManagerProfileScreen";

vi.mock("@/i18n/navigation", () => ({
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

// POO-901 [R3]: the Share action appends the SHARER's referral code (whoever is signed in and taps
// Share) when one exists. Mock the shared referral state so each test pins its own code.
const referral = vi.hoisted(() => ({ code: null as string | null }));
vi.mock("@/features/rewards/useReferral", () => ({
  useReferral: () => ({ program: { code: referral.code }, createCode: vi.fn() }),
}));

afterEach(() => {
  referral.code = null;
});

// POO-659: the dev-login manager is now the UNFILLED, address-based identity (no handle "carlos").
// Find it by its stable id (the wallet address); its display falls back to the masked address.
const MASKED_DEV_MANAGER = "0x1A2b…5678"; // maskAddress(DEV_MANAGER_ADDRESS)

function devManager() {
  const profile = managerProfiles.find((candidate) => candidate.address === DEV_MANAGER_ADDRESS);
  if (!profile) throw new Error("expected the dev-manager mock profile");
  return profile;
}

describe("ManagerProfileScreen", () => {
  it("renders the manager identity, stats, and their strategies", () => {
    // POO-659: the dev manager owns strategies by address now (no claimed handle) → strat-delta-neutral.
    const owned = strategies.filter((strategy) => strategy.managerAddress === DEV_MANAGER_ADDRESS);
    renderWithProviders(<ManagerProfileScreen profile={devManager()} strategies={owned} />);

    // No display name → the masked address stands in as the heading (R5).
    expect(screen.getByRole("heading", { name: MASKED_DEV_MANAGER, level: 1 })).toBeInTheDocument();
    // No handle → the subtitle shows just the "since" label, no "@handle" (R7).
    expect(screen.getByText("Since 2023")).toBeInTheDocument();
    expect(screen.getByText("AUM")).toBeInTheDocument();
    expect(owned.length).toBeGreaterThan(0);
    for (const strategy of owned) {
      expect(screen.getByRole("heading", { name: strategy.name, level: 3 })).toBeInTheDocument();
    }
  });

  it("shows an empty state when there are no public strategies", () => {
    renderWithProviders(<ManagerProfileScreen profile={devManager()} strategies={[]} />);
    expect(screen.getByText("No public strategies yet.")).toBeInTheDocument();
  });

  // POO-745 / POO-809: the verified badge is driven solely by managerVerification === 'valid' (the
  // legacy `verified` boolean was removed). A `valid` manager shows the badge; `none` does not.
  it("[POO-745] shows the verified badge only when managerVerification is 'valid'", () => {
    const valid: ManagerProfile = { ...devManager(), managerVerification: "valid" };
    const { unmount } = renderWithProviders(
      <ManagerProfileScreen profile={valid} strategies={[]} />,
    );
    expect(screen.getByLabelText("Verified manager")).toBeInTheDocument();
    unmount();

    // managerVerification 'none' → no badge.
    const notValid: ManagerProfile = { ...devManager(), managerVerification: "none" };
    renderWithProviders(<ManagerProfileScreen profile={notValid} strategies={[]} />);
    expect(screen.queryByLabelText("Verified manager")).toBeNull();
  });

  it("renders the banner fallback and no social chips for the base (neutral) profile", () => {
    renderWithProviders(<ManagerProfileScreen profile={devManager()} strategies={[]} />);
    // No bannerUrl on the mock → gradient fallback strip renders.
    expect(screen.getByTestId("profile-banner")).toBeInTheDocument();
    // POO-659: the dev manager has no socials set → no chips render (R4/R8).
    expect(screen.queryByRole("link", { name: "X" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Telegram" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Discord" })).toBeNull();
    expect(screen.queryByRole("link", { name: "YouTube" })).toBeNull();
  });

  it("renders only the set social chips", () => {
    // A partially filled profile: only X + a website are set → only those two chips render.
    const profile = {
      ...devManager(),
      socials: { x: "https://x.com/devyield", website: "https://dev.xyz" },
    };
    renderWithProviders(<ManagerProfileScreen profile={profile} strategies={[]} />);
    expect(screen.getByRole("link", { name: "X" })).toHaveAttribute(
      "href",
      "https://x.com/devyield",
    );
    // The website chip shows the hostname, not "Website".
    expect(screen.getByRole("link", { name: /dev\.xyz/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Telegram" })).toBeNull();
    expect(screen.queryByRole("link", { name: "YouTube" })).toBeNull();
  });

  // POO-552: a stored unsafe URL (javascript:/data:/junk) must NEVER become a live href on the public
  // page — safeHttpUrl drops it. A valid link on another network still renders.
  it("[POO-552] drops an unsafe/invalid social link from the public chips (stored-XSS guard)", () => {
    const profile = {
      ...devManager(),
      socials: {
        x: "javascript:alert(document.cookie)",
        telegram: "not a url",
        discord: "https://discord.gg/real",
      },
    };
    renderWithProviders(<ManagerProfileScreen profile={profile} strategies={[]} />);
    expect(screen.queryByRole("link", { name: "X" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Telegram" })).toBeNull();
    expect(screen.getByRole("link", { name: "Discord" })).toHaveAttribute(
      "href",
      "https://discord.gg/real",
    );
  });

  it("renders the banner image when bannerUrl is set", () => {
    const profile = { ...devManager(), bannerUrl: "https://cdn.example/banner.png" };
    renderWithProviders(<ManagerProfileScreen profile={profile} strategies={[]} />);
    const banner = screen.getByTestId("profile-banner");
    expect(banner.querySelector("img")).toHaveAttribute("src", "https://cdn.example/banner.png");
  });

  // POO-618: the same screen degrades for an UNFILLED manager (reached by wallet address in real
  // mode). With no display name the masked address stands in (R5); the bio, the "@handle · since"
  // line and unset socials are hidden (R6/R7/R8); the avatar is a neutral placeholder with no letter
  // (R9); the stats (R12) and the manager's strategies still render. The unfilled profile is
  // crafted here as a prop — this is real-mode-only behavior with no mock manager standing in.
  function unfilled(): ManagerProfile {
    return {
      handle: "",
      address: "0x77d2e9a1b3c5d7f9a0b1c2d3e4f5a6b7c8d9e0f1",
      name: "",
      bio: "",
      managerVerification: "none",
      sinceLabel: "",
      socials: {},
      stats: { aum: 84_500, investors: 37, strategies: 1, avgApy: 6.4 },
    };
  }

  it("[POO-618] shows the masked address as the name and hides empty fields", () => {
    // The route pairs a profile with its strategies; here we pass a couple directly to prove the list
    // still renders under the degraded header.
    const owned = strategies.slice(0, 2);
    renderWithProviders(<ManagerProfileScreen profile={unfilled()} strategies={owned} />);

    // R5: masked address stands in for the name, in the header and the strategies heading.
    expect(screen.getByRole("heading", { name: "0x77d2…e0f1", level: 1 })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Strategies by 0x77d2…e0f1", level: 2 }),
    ).toBeInTheDocument();
    // R7: no "@handle · since" line (both empty).
    expect(screen.queryByText(/Since/)).toBeNull();
    expect(screen.queryByText(/@/)).toBeNull();
    // R8: no social chips.
    expect(screen.queryByRole("link", { name: "X" })).toBeNull();
    // R9: neutral avatar placeholder — no initial letter.
    expect(screen.getByTestId("profile-avatar-fallback").textContent).toBe("");
    // R12: stats still render, alongside the manager's strategies.
    expect(screen.getByText("AUM")).toBeInTheDocument();
    expect(owned.length).toBeGreaterThan(0);
    for (const strategy of owned) {
      expect(screen.getByRole("heading", { name: strategy.name, level: 3 })).toBeInTheDocument();
    }
  });

  it("[POO-618] keeps the name-initial avatar for a manager who has a name but no photo", () => {
    // A manager who has filled in a name but no photo → the fallback shows their initial (not the
    // neutral icon). Built off the neutral base so only the name drives the assertion.
    const named = { ...devManager(), name: "Carlos Mendes" };
    renderWithProviders(<ManagerProfileScreen profile={named} strategies={[]} />);
    expect(screen.getByTestId("profile-avatar-fallback").textContent).toBe("C");
  });

  // POO-895 rules v1: the owner's "Edit profile" action in the header. The OWNERSHIP decision is the
  // route's (server-side, page.test.tsx); the screen only honors the `isOwner` prop.
  it("[POO-895 R1/R2/R7] renders the Edit profile link beside Share when the viewer owns the profile", () => {
    renderWithProviders(<ManagerProfileScreen profile={devManager()} strategies={[]} isOwner />);
    // R2: links to the console's URL-driven profile tab via the i18n Link (locale-prefixing is the
    // real next-intl Link's job; the test stub renders the raw href).
    const edit = screen.getByRole("link", { name: "Edit profile" });
    expect(edit).toHaveAttribute("href", "/manager?tab=profile");
    // R1/R3: rendered NEXT TO the untouched Share action.
    expect(screen.getByRole("button", { name: "Share profile" })).toBeInTheDocument();
  });

  it("[POO-895 R3] never renders the Edit action for a non-owner (prop false or omitted)", () => {
    const { unmount } = renderWithProviders(
      <ManagerProfileScreen profile={devManager()} strategies={[]} isOwner={false} />,
    );
    expect(screen.queryByRole("link", { name: "Edit profile" })).toBeNull();
    // R3: the Share action is unchanged.
    expect(screen.getByRole("button", { name: "Share profile" })).toBeInTheDocument();
    unmount();

    // The prop is optional: existing call sites without it stay non-owner.
    renderWithProviders(<ManagerProfileScreen profile={devManager()} strategies={[]} />);
    expect(screen.queryByRole("link", { name: "Edit profile" })).toBeNull();
    expect(screen.getByRole("button", { name: "Share profile" })).toBeInTheDocument();
  });

  it("[POO-895 R5] renders the Edit action on the owner's synthesized (unfilled) profile", () => {
    renderWithProviders(<ManagerProfileScreen profile={unfilled()} strategies={[]} isOwner />);
    expect(screen.getByRole("link", { name: "Edit profile" })).toHaveAttribute(
      "href",
      "/manager?tab=profile",
    );
  });

  // POO-901 [R3]: whoever is signed in and taps Share (owner or visitor) shares the profile URL
  // with THEIR referral code appended (managerProfileReferralUrl; attribution is account-wide).
  it("[POO-901 R3] shares the profile URL with the sharer's ?ref=<code> appended", async () => {
    referral.code = "MARIA2026";
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    // Force the copy fallback by removing the native share API.
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    renderWithProviders(<ManagerProfileScreen profile={devManager()} strategies={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Share profile" }));
    // The dev manager has no handle, so the slug is the address (R13 precedence unchanged).
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `https://app.pool-party.xyz/m/${DEV_MANAGER_ADDRESS}?ref=MARIA2026`,
      ),
    );
  });

  // POO-901 [R3]: logged out or no code created → the plain profile URL, never a dangling ?ref=.
  it("[POO-901 R3] shares the plain profile URL when the sharer has no code", async () => {
    referral.code = null;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    renderWithProviders(<ManagerProfileScreen profile={devManager()} strategies={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Share profile" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`https://app.pool-party.xyz/m/${DEV_MANAGER_ADDRESS}`),
    );
  });
});
