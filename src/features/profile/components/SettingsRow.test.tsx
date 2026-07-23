/**
 * @id PP-PROF-CMP-003
 * @name SettingsRow.test
 * Behavior (POO-795 R1/R2): an `external` link row opens in a NEW TAB with a safe rel, swaps the
 * in-app chevron for the external-link icon, and carries an "opens in new tab" hint. A plain link
 * row stays a same-tab navigation with the chevron.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../../tests/utils/renderWithProviders";
import { SettingsRow } from "./SettingsRow";

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

describe("SettingsRow", () => {
  it("opens an external row in a new tab with the external-link affordance (no chevron)", () => {
    const { container } = renderWithProviders(
      <SettingsRow title="Terms of Service" href="/terms" external />,
    );
    const link = screen.getByRole("link", { name: /terms of service/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("Opens in new tab")).toBeInTheDocument();
    expect(container.querySelector(".lucide-external-link")).not.toBeNull();
    expect(container.querySelector(".lucide-chevron-right")).toBeNull();
  });

  it("keeps a plain link row a same-tab navigation with the chevron", () => {
    const { container } = renderWithProviders(<SettingsRow title="Help" href="/profile/help" />);
    const link = screen.getByRole("link", { name: /help/i });
    expect(link).not.toHaveAttribute("target");
    expect(link).not.toHaveAttribute("rel");
    expect(screen.queryByText("Opens in new tab")).toBeNull();
    expect(container.querySelector(".lucide-chevron-right")).not.toBeNull();
    expect(container.querySelector(".lucide-external-link")).toBeNull();
  });
});
