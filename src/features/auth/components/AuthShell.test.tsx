/**
 * @id PP-AUTH-SCR-001
 * @name AuthShell.test
 * Behavior: renders its children over the pre-auth chrome and, by default, the top-right locale
 * switcher; the switcher can be suppressed via `showLocaleSwitcher={false}` for the English-only
 * legal document pages (POO-663 / POO-664), without affecting any other pre-auth screen.
 */
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../../tests/utils/renderWithProviders";
import { AuthShell } from "./AuthShell";

// AuthShell -> LocaleSwitcher reads the i18n navigation hooks; stub them so the real next-intl
// navigation (which imports next/navigation) is not loaded in the test environment.
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/sign-in",
}));

describe("AuthShell", () => {
  it("renders its children", () => {
    renderWithProviders(
      <AuthShell>
        <p>Shell content</p>
      </AuthShell>,
    );
    expect(screen.getByText("Shell content")).toBeInTheDocument();
  });

  it("shows the locale switcher by default", () => {
    renderWithProviders(
      <AuthShell>
        <p>Shell content</p>
      </AuthShell>,
    );
    expect(screen.getByRole("combobox", { name: "Language" })).toBeInTheDocument();
  });

  it("hides the locale switcher when showLocaleSwitcher is false", () => {
    renderWithProviders(
      <AuthShell showLocaleSwitcher={false}>
        <p>Shell content</p>
      </AuthShell>,
    );
    expect(screen.queryByRole("combobox", { name: "Language" })).toBeNull();
  });
});
