/**
 * @id PP-PROF-SCR-003 (POO-110, POO-581, POO-637, POO-732)
 * @name Linked social accounts — tests
 * @implements-rules-version v2
 *
 * The screen renders the server-provided connected state, NOT the old fabricated local defaults: an
 * empty list means every provider disconnected (notifications-off pill shows, no persona handles); a
 * populated list renders each connected provider's stored handle. A connected row disconnects through
 * the injected signed-write action; the connect affordance is inert (disabled) for now.
 */
import type { AnchorHTMLAttributes, ComponentType, ReactNode, SVGProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { SOCIAL_NETWORKS } from "@/features/manager/components/socialNetworks";
import type { LinkedAccount } from "@/lib/profile/linkedAccountsSchema";
import {
  fireEvent,
  render,
  renderWithProviders,
  screen,
} from "../../../tests/utils/renderWithProviders";
import { DiscordMark, GoogleMark, TelegramMark } from "./components/socialBrandMarks";
import { SocialScreen } from "./SocialScreen";

/** The SVG inner markup (the `<path>`s) an icon component renders standalone — POO-732 R1 parity check. */
function iconMarkup(Icon: ComponentType<SVGProps<SVGSVGElement>>): string {
  const { container, unmount } = render(<Icon />);
  const markup = container.querySelector("svg")?.innerHTML ?? "";
  unmount();
  return markup;
}

/** The icon markup the manager profile renders for a shared social network. */
function managerIconMarkup(key: "x" | "telegram" | "discord"): string {
  const Icon = SOCIAL_NETWORKS.find((network) => network.key === key)?.Icon;
  if (!Icon) throw new Error(`manager has no icon for "${key}"`);
  return iconMarkup(Icon);
}

vi.mock("@/i18n/navigation", () => ({
  // POO-751: SettingsLayout's back-link is now a GuardedLink, which reads useRouter().
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/profile/social",
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

describe("SocialScreen", () => {
  it("renders every provider disconnected with no fabricated defaults when the list is empty", () => {
    renderWithProviders(<SocialScreen accounts={[]} />);

    // Telegram disconnected → the notifications-off pill shows.
    expect(screen.getByText("Notifications off")).toBeInTheDocument();
    // The persona handles from the old fabricated local state must be gone.
    expect(screen.queryByText("@maria_invests")).toBeNull();
    expect(screen.queryByText("maria@email.com")).toBeNull();
    expect(screen.queryByText("Connected")).toBeNull();
  });

  it("renders the real connected state + stored handle from the server", () => {
    const accounts: LinkedAccount[] = [
      { provider: "x", handle: "https://x.com/maria" },
      { provider: "google", handle: null }, // google handle omitted as PII on the open read
    ];
    renderWithProviders(<SocialScreen accounts={accounts} />);

    // X shows its stored handle; both X + Google show a "Connected" affordance.
    expect(screen.getByText("https://x.com/maria")).toBeInTheDocument();
    expect(screen.getAllByText("Connected")).toHaveLength(2);
    // Telegram is still disconnected here.
    expect(screen.getByText("Notifications off")).toBeInTheDocument();
  });

  it("disconnects a connected provider through the injected signed-write action", () => {
    const onDisconnect = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <SocialScreen
        accounts={[{ provider: "x", handle: "https://x.com/maria" }]}
        onDisconnect={onDisconnect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Connected/ }));
    expect(onDisconnect).toHaveBeenCalledWith("x");
  });

  it("renders the connect affordance disabled (connect stays inert)", () => {
    renderWithProviders(<SocialScreen accounts={[]} />);

    expect(screen.getByRole("button", { name: "Connect Telegram" })).toBeDisabled();
    const connectButtons = screen.getAllByRole("button", { name: "Connect" });
    expect(connectButtons).toHaveLength(3); // X, Google, Discord
    for (const button of connectButtons) {
      expect(button).toBeDisabled();
    }
  });

  // @rule POO-732 R2: the intro leads with the rewards value prop and drops "sign in faster".
  it("leads with the rewards value prop and drops 'sign in faster' (R2)", () => {
    renderWithProviders(<SocialScreen accounts={[]} />);

    expect(
      screen.getByText(
        "Connect your accounts to earn points, roles, multipliers and more, and to get notifications.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/sign in faster/i)).toBeNull();
  });

  // @rule POO-732 R1: each provider renders its REAL brand mark. X still reuses the manager's XMark
  // (the identity network never drifts between surfaces), while Telegram, Discord and Google render
  // their own canonical single-path brand glyphs — recognizable logos, not generic lucide glyphs.
  it("renders each provider's real brand mark (R1)", () => {
    renderWithProviders(<SocialScreen accounts={[]} />);

    // X mirrors the manager's real brand mark so the two surfaces never drift.
    expect(screen.getByTestId("social-icon-x").innerHTML).toBe(managerIconMarkup("x"));

    // Telegram + Discord render their OWN real brand marks, no longer the manager's generic lucide
    // glyphs — assert both parity with the local mark AND divergence from the manager's placeholder.
    const telegramMarkup = iconMarkup(TelegramMark);
    const discordMarkup = iconMarkup(DiscordMark);
    const googleMarkup = iconMarkup(GoogleMark);
    // Guard each mark is a non-empty path so a dropped/blanked glyph fails instead of matching "" to "".
    for (const markup of [telegramMarkup, discordMarkup, googleMarkup]) {
      expect(markup).toContain("path");
    }

    expect(screen.getByTestId("social-icon-telegram").innerHTML).toBe(telegramMarkup);
    expect(screen.getByTestId("social-icon-discord").innerHTML).toBe(discordMarkup);
    // Google is investor-only (no manager parity target); compare against its own mark.
    expect(screen.getByTestId("social-icon-google").innerHTML).toBe(googleMarkup);

    // The real Telegram / Discord marks must NOT be the manager's generic lucide placeholders.
    expect(telegramMarkup).not.toBe(managerIconMarkup("telegram"));
    expect(discordMarkup).not.toBe(managerIconMarkup("discord"));
  });
});
