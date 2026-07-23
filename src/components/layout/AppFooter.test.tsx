/**
 * @id PP-CORE-LAY-002
 * @name AppFooter.test
 * Behavior (POO-795 R1/R2): the legal links (Terms/Privacy/Risk) open in a NEW TAB with a safe rel
 * and an "opens in new tab" affordance; the in-app Help link stays a same-tab navigation.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, within } from "../../../tests/utils/renderWithProviders";
import { AppFooter } from "./AppFooter";

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

describe("AppFooter", () => {
  it("opens each legal link in a new tab with a safe rel", () => {
    renderWithProviders(<AppFooter />);
    for (const name of [/terms/i, /privacy/i, /risk/i]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("marks each legal link with an 'opens in new tab' hint for screen readers", () => {
    renderWithProviders(<AppFooter />);
    for (const name of [/terms/i, /privacy/i, /risk/i]) {
      const link = screen.getByRole("link", { name });
      expect(within(link).getByText("Opens in new tab")).toBeInTheDocument();
    }
  });

  it("keeps the in-app Help link a same-tab navigation", () => {
    renderWithProviders(<AppFooter />);
    const help = screen.getByRole("link", { name: /help/i });
    expect(help).not.toHaveAttribute("target");
    expect(help).not.toHaveAttribute("rel");
  });
});
