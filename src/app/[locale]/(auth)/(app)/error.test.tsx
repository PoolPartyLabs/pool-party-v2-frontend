/**
 * @id PP-DASH-SCR-001 (POO-321)
 * @name AppSegmentError.test
 * @implements-rules-version v2
 * Unit tests for the (app) segment error boundary: renders the sober dashboard error within chrome,
 * retries, links to support, and reports app_error_shown once with the digest [R10/R11].
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../tests/utils/renderWithProviders";
import AppSegmentError from "./error";

// Render the i18n Link as a plain anchor so we can assert the exact href without locale prefixing.
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

describe("AppSegmentError", () => {
  beforeEach(() => {
    window.dataLayer = [];
  });

  it("renders the dashboard error fallback", () => {
    renderWithProviders(<AppSegmentError error={new Error("boom")} reset={() => {}} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Couldn't load your dashboard")).toBeInTheDocument();
  });

  it("links 'Contact support' to the help page", () => {
    renderWithProviders(<AppSegmentError error={new Error("boom")} reset={() => {}} />);
    expect(screen.getByRole("link", { name: "Contact support" })).toHaveAttribute(
      "href",
      "/profile/help",
    );
  });

  it("reports app_error_shown once with the digest", () => {
    const error = Object.assign(new Error("boom"), { digest: "DIG_456" });
    renderWithProviders(<AppSegmentError error={error} reset={() => {}} />);
    const fired = window.dataLayer?.filter((entry) => entry.event === "app_error_shown") ?? [];
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ error_code: "DIG_456" });
  });

  it("calls reset when retry is clicked", async () => {
    const reset = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<AppSegmentError error={new Error("boom")} reset={reset} />);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
