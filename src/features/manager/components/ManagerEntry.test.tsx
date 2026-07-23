/**
 * @id PP-LAY-CMP-006
 * @name ManagerEntry.test
 * Behavior: the entry shows "Become a manager" → /manager/become for a non-manager, and "Manager" →
 * /manager once the user manages strategies.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../../tests/utils/renderWithProviders";
import { ManagerEntry } from "./ManagerEntry";

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

describe("ManagerEntry", () => {
  it("shows 'Become a manager' → /manager/become for a non-manager", () => {
    renderWithProviders(<ManagerEntry isManager={false} />);
    const link = screen.getByRole("link", { name: "Become a manager" });
    expect(link).toHaveAttribute("href", "/manager/become");
    expect(screen.queryByRole("link", { name: "Manager Console" })).toBeNull();
  });

  it("shows 'Manager Console' → /manager for a manager", () => {
    renderWithProviders(<ManagerEntry isManager={true} />);
    const link = screen.getByRole("link", { name: "Manager Console" });
    expect(link).toHaveAttribute("href", "/manager");
    expect(screen.queryByRole("link", { name: "Become a manager" })).toBeNull();
  });
});
