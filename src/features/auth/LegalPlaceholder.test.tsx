/**
 * @id PP-AUTH-SCR-005
 * @name LegalPlaceholder.test
 * Behavior: renders the reserved page copy and goes back on the Back action.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { LegalPlaceholder } from "./LegalPlaceholder";

const back = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ back, replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/terms",
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

describe("LegalPlaceholder", () => {
  it("renders the wallets guide and goes back", () => {
    renderWithProviders(<LegalPlaceholder kind="learnWallets" />);
    expect(screen.getByRole("heading", { name: "New to wallets?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(back).toHaveBeenCalled();
  });
});
