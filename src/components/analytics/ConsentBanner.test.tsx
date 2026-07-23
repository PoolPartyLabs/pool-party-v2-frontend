/**
 * @id PP-CORE (SETUP-014) — ConsentBanner — tests
 */
import { beforeEach, describe, expect, it } from "vitest";
import { CONSENT_COOKIE } from "@/lib/analytics/consent";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../tests/utils/renderWithProviders";
import { ConsentBanner } from "./ConsentBanner";

beforeEach(() => {
  // Start each test with no stored choice so the banner renders.
  document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0`;
});

describe("ConsentBanner", () => {
  it("shows a labelled dialog when no choice is stored", async () => {
    renderWithProviders(<ConsentBanner />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-labelledby");
    expect(dialog).toHaveAttribute("aria-describedby");
    expect(screen.getByText("Your privacy")).toBeInTheDocument();
  });

  it("dismisses when the user accepts", async () => {
    renderWithProviders(<ConsentBanner />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("dismisses when the user declines", async () => {
    renderWithProviders(<ConsentBanner />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("declines and dismisses on Escape", async () => {
    renderWithProviders(<ConsentBanner />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
