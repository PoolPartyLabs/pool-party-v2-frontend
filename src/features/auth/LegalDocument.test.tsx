/**
 * @id PP-AUTH-CMP-001
 * @name LegalDocument.test
 * Behavior: renders title, last-modified line and body; blocks copying; shows the Back action only
 * when there is in-app history to return to (POO-795 R3 — legal pages open in a new tab, where
 * router.back() is a dead no-op).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { LegalDocument } from "./LegalDocument";

const back = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ back, replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/privacy",
}));

/** Force the reported session-history length (read-only in the DOM, so redefined for the test). */
function setHistoryLength(length: number) {
  Object.defineProperty(window.history, "length", { configurable: true, value: length });
}

afterEach(() => {
  back.mockClear();
  setHistoryLength(1);
});

function renderDoc() {
  return renderWithProviders(
    <LegalDocument title="Test document" lastModified="Last modified: July 10, 2025">
      <p>Intro body text</p>
      <h2>A section heading</h2>
    </LegalDocument>,
  );
}

describe("LegalDocument", () => {
  it("renders the title, date and body", () => {
    renderDoc();
    expect(screen.getByRole("heading", { level: 1, name: "Test document" })).toBeInTheDocument();
    expect(screen.getByText("Last modified: July 10, 2025")).toBeInTheDocument();
    expect(screen.getByText("Intro body text")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A section heading" })).toBeInTheDocument();
  });

  it("blocks copying the body", () => {
    renderDoc();
    const region = screen.getByText("Intro body text").closest(".select-none");
    expect(region).not.toBeNull();
    // biome-ignore lint/style/noNonNullAssertion: guarded by the assertion above.
    expect(fireEvent.copy(region!)).toBe(false);
  });

  it("shows the Back action and goes back when there is in-app history", async () => {
    setHistoryLength(2);
    renderDoc();
    const button = await screen.findByRole("button", { name: "Back" });
    fireEvent.click(button);
    expect(back).toHaveBeenCalled();
  });

  it("hides the Back action when opened standalone (fresh tab, no in-app history)", () => {
    setHistoryLength(1);
    renderDoc();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("does not show the locale switcher (English-only legal page)", () => {
    renderDoc();
    expect(screen.queryByRole("combobox", { name: "Language" })).toBeNull();
  });
});
