/**
 * @id PP-AUTH-SCR-008
 * @name TermsOfService.test
 * Behavior: renders the key Terms sections/subsections, the legal entity, and the liability cap.
 */
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { TermsOfService } from "./TermsOfService";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/terms",
}));

describe("TermsOfService", () => {
  it("renders the title and key sections", () => {
    renderWithProviders(<TermsOfService />);
    expect(screen.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeInTheDocument();
    for (const name of [
      "1. Our Products and Third-Party Services",
      "5. Disclaimers",
      "7. Limitation of Liability",
      "8. Governing Law and Dispute Resolution",
    ]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
  });

  it("renders numbered subsections", () => {
    renderWithProviders(<TermsOfService />);
    expect(
      screen.getByRole("heading", { name: "4.2. Non-Custodial and No Fiduciary Duties" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "8.3. Class Action Waiver" })).toBeInTheDocument();
  });

  it("names the entity and the liability cap", () => {
    renderWithProviders(<TermsOfService />);
    expect(screen.getByText(/ARESTA DIVINAL, UNIPESSOAL, LDA/)).toBeInTheDocument();
    expect(screen.getByText(/ONE HUNDRED U\.S\. DOLLARS/)).toBeInTheDocument();
  });
});
