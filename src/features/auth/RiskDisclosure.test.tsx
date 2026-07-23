/**
 * @id PP-AUTH-SCR-006
 * @name RiskDisclosure.test
 * Behavior: renders the title and all 14 risk sections and blocks copying the text.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { RiskDisclosure } from "./RiskDisclosure";

// AuthShell -> LocaleSwitcher reads the i18n navigation hooks; stub them so the real next-intl
// navigation (which imports next/navigation) is not loaded in the test environment.
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/risk",
}));

describe("RiskDisclosure", () => {
  it("renders the disclosure title", () => {
    renderWithProviders(<RiskDisclosure />);
    expect(screen.getByRole("heading", { level: 1, name: "Risk disclosure" })).toBeInTheDocument();
  });

  it("renders all 14 risk sections", () => {
    const { container } = renderWithProviders(<RiskDisclosure />);
    expect(container.querySelectorAll("ol > li")).toHaveLength(14);
    expect(screen.getByRole("heading", { name: "You can lose money" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your responsibility" })).toBeInTheDocument();
  });

  it("blocks copying the disclosure text", () => {
    renderWithProviders(<RiskDisclosure />);
    const region = screen.getByText(/Read this carefully/i).closest(".select-none");
    expect(region).not.toBeNull();
    // biome-ignore lint/style/noNonNullAssertion: guarded by the assertion above.
    expect(fireEvent.copy(region!)).toBe(false);
  });

  it("does not show the locale switcher (English-only legal page)", () => {
    renderWithProviders(<RiskDisclosure />);
    expect(screen.queryByRole("combobox", { name: "Language" })).toBeNull();
  });
});
