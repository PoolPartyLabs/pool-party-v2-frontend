/**
 * @id PP-PROF-SCR-005
 * @name Alerts & notifications — tests
 * Behavior: renders the grouped switches with their defaults and flips on toggle.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { NotificationsScreen } from "./NotificationsScreen";

vi.mock("@/i18n/navigation", () => ({
  // POO-751: SettingsLayout's back-link is now a GuardedLink, which reads useRouter().
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/profile/notifications",
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

describe("NotificationsScreen", () => {
  it("renders the switches at their defaults but locked (coming soon)", () => {
    renderWithProviders(<NotificationsScreen />);
    // Defaults are still reflected: "Strategy updates" off, "Push notifications" on.
    const strategyUpdates = screen.getByRole("switch", { name: "Strategy updates" });
    expect(strategyUpdates).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "Push notifications" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // ...but the controls are locked — disabled, and clicking does not flip them.
    expect(strategyUpdates).toBeDisabled();
    fireEvent.click(strategyUpdates);
    expect(strategyUpdates).toHaveAttribute("aria-checked", "false");
  });
});
