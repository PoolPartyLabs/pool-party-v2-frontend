/**
 * @name GreetingHeading.test
 * Behavior: greets by the user's profile name in mock mode; the time-of-day bucket follows the local
 * hour (covered exhaustively by timeOfDay.test). The masked-wallet fallback (no profile name) is
 * dormant in mock mode (the mock always has a name); it's covered in GreetingHeading.fallback.test
 * with isMockMode=false (a file-scoped vi.mock, hence the separate file).
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { GreetingHeading } from "./GreetingHeading";

// POO-620: GreetingHeading now imports @/i18n/navigation (Link); mock it like every other component
// test that renders a localized Link, so the suite doesn't load next-intl's navigation in the runner.
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

describe("GreetingHeading", () => {
  it("greets the user by their profile name (mock mode)", () => {
    renderWithProviders(<GreetingHeading />);
    // Mock mode → the mock profile name; any of the three time buckets is acceptable.
    expect(screen.getByRole("heading")).toHaveTextContent(
      /Good (morning|afternoon|evening), Maria Silva/,
    );
  });

  // POO-704 [R1]: the resolved owner displayName (threaded from /users/me) wins over the mock name.
  it("[POO-704] renders the provided owner displayName, overriding the mock profile name", () => {
    renderWithProviders(<GreetingHeading displayName="Ana Beatriz" />);
    expect(screen.getByRole("heading")).toHaveTextContent(
      /Good (morning|afternoon|evening), Ana Beatriz/,
    );
    expect(screen.getByRole("heading")).not.toHaveTextContent("Maria Silva");
  });

  // POO-620: with a profileHref (Manager Console), the greeting is a link to the manager's own
  // public profile; without one (investor Home) it stays plain text.
  it("[POO-620] links the greeting when profileHref is set", () => {
    renderWithProviders(<GreetingHeading profileHref="/m/carlos" />);
    const link = screen.getByRole("link");
    expect(link).toHaveTextContent(/Good (morning|afternoon|evening), Maria Silva/);
    expect(link.getAttribute("href")).toContain("/m/carlos");
  });

  it("[POO-620] stays plain text (no link) without profileHref", () => {
    renderWithProviders(<GreetingHeading />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
