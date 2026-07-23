/**
 * @id PP-STR-CMP-016
 * @name ManagerCard — tests
 * Behavior: shows the manager name + verified sub-line + view-profile link, and the manager's own
 * allocation (initial seed + top-ups) as a skin-in-the-game signal when known — hidden otherwise
 * (murilo 2026-06-29).
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../../tests/utils/renderWithProviders";
import { ManagerCard } from "./ManagerCard";

// ManagerLink renders an i18n <Link>; stub it so the test doesn't load next/navigation.
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

describe("ManagerCard", () => {
  it("shows the manager's allocation when known (skin in the game)", () => {
    renderWithProviders(
      <ManagerCard
        name="Pool Party Labs"
        verified
        handle="pool-party-labs"
        managerStakeUsd={18_500}
      />,
    );
    expect(screen.getByText("Manager allocation")).toBeInTheDocument();
    expect(screen.getByText("$18,500.00")).toBeInTheDocument();
  });

  it("hides the allocation row when not known", () => {
    renderWithProviders(<ManagerCard name="Pool Party Labs" verified handle="pool-party-labs" />);
    expect(screen.queryByText("Manager allocation")).toBeNull();
  });

  it("[POO-434] links the manager name to the public profile when a handle is known", () => {
    renderWithProviders(<ManagerCard name="Pool Party Labs" verified handle="pool-party-labs" />);
    const nameLink = screen.getByRole("link", { name: "Pool Party Labs" });
    expect(nameLink).toHaveAttribute("href", "/m/pool-party-labs");
  });

  it("[POO-434] renders the manager name as plain text when no handle (real mode)", () => {
    renderWithProviders(<ManagerCard name="0x1234…abcd" verified />);
    expect(screen.queryByRole("link", { name: "0x1234…abcd" })).toBeNull();
    expect(screen.getByText("0x1234…abcd")).toBeInTheDocument();
  });

  // @rule R8: renders the manager avatar image when an avatarUrl is passed.
  it("[R8] renders the manager avatar image when avatarUrl is set", () => {
    renderWithProviders(
      <ManagerCard
        name="@aave-labs"
        verified
        handle="aave-labs"
        avatarUrl="https://cdn.example/aave.png"
      />,
    );
    expect(screen.getByTestId("manager-avatar-image")).toHaveAttribute(
      "src",
      "https://cdn.example/aave.png",
    );
  });

  // @rule R8: falls back to the initials monogram (first alphanumeric char, never "@") without an avatar.
  it("[R8] falls back to the initials monogram (never '@') when no avatar", () => {
    renderWithProviders(<ManagerCard name="@aave-labs" verified handle="aave-labs" />);
    expect(screen.queryByTestId("manager-avatar-image")).toBeNull();
    expect(screen.getByText("A")).toBeInTheDocument();
  });
});
