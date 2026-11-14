/**
 * @id PP-AUTH-SCR-007
 * @name PrivacyPolicy.test
 * Behavior: renders the key Privacy Policy sections, the legal entity, and the contact email link.
 */
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { PrivacyPolicy } from "./PrivacyPolicy";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/privacy",
}));

describe("PrivacyPolicy", () => {
  it("renders the title and key sections", () => {
    renderWithProviders(<PrivacyPolicy />);
    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeInTheDocument();
    for (const name of [
      "High Level Summary",
      "Data We Collect",
      "How We Share Data",
      "Your Data Protection Rights (GDPR)",
      "Contact Us",
    ]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
  });

  it("names Pool Party as the operator", () => {
    renderWithProviders(<PrivacyPolicy />);
    // @rule POO-2714 R4
    expect(screen.queryByText(/ARESTA|DIVINAL|517878240/i)).toBeNull();
    // @rule POO-2714 R6
    expect(
      screen.getByText(/Pool Party is the name used by the operators of the Services/),
    ).toBeInTheDocument();
  });

  it("exposes the contact email as a mailto link", () => {
    renderWithProviders(<PrivacyPolicy />);
    const links = screen.getAllByRole("link", { name: "legal@pool-party.xyz" });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute("href", "mailto:legal@pool-party.xyz");
  });
});
