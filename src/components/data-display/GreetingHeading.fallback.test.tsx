/**
 * @name GreetingHeading.fallback.test
 * Behavior (POO-704): in real mode the greeting shows the owner `displayName` threaded from
 * `/users/me` [R1]; when that name is blank (a cleared name, POO-700) or absent it falls back to the
 * connected wallet masked in the SERVER-DEFAULT format `0x1A2b...5678` (checksummed, three dots) [R2]
 * [R5], NOT the `0x1234…cdef` ellipsis form. Pinned here with isMockMode=false + a connected address;
 * file-scoped vi.mock of @/lib/services, so it lives apart from GreetingHeading.test.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { GreetingHeading } from "./GreetingHeading";

// POO-620: GreetingHeading imports @/i18n/navigation (Link); mock it so the suite doesn't load
// next-intl's navigation in the runner (this fallback path renders no link, but the import loads).
// POO-751: the own-profile link is a GuardedLink, which also reads useRouter().
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
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
// isMockMode=false makes the mock name path dormant, so the `displayName` prop is the only name source.
vi.mock("@/lib/services", () => ({ isMockMode: false }));
// A connected, EIP-55-checksummed address for maskWalletName to truncate to `0xf39F...2266`.
vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({ address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" }),
}));
// Pin the time-of-day bucket so the assertion is deterministic in CI.
vi.mock("@/lib/utils/timeOfDay", () => ({ timeOfDay: () => "morning" }));

describe("GreetingHeading (real mode)", () => {
  // POO-704 [R1]: the owner displayName is shown verbatim when set.
  it("shows the owner displayName when one is set", async () => {
    renderWithProviders(<GreetingHeading displayName="Alice" />);
    expect(await screen.findByText("Good morning, Alice")).toBeInTheDocument();
  });

  // POO-704 [R2][R5]: a blank/whitespace name (cleared) → masked wallet in the server-default format.
  it("falls back to the masked wallet (server-default format) when the displayName is blank", async () => {
    renderWithProviders(<GreetingHeading displayName="   " />);
    expect(await screen.findByText("Good morning, 0xf39F...2266")).toBeInTheDocument();
  });

  // POO-704 [R2]: no displayName provided at all also falls back to the masked wallet.
  it("falls back to the masked wallet when no displayName is provided", async () => {
    renderWithProviders(<GreetingHeading />);
    expect(await screen.findByText("Good morning, 0xf39F...2266")).toBeInTheDocument();
  });
});
