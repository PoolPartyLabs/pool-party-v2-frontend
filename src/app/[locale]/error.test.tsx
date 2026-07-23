/**
 * @id PP-CORE (POO-163)
 * @name LocaleError.test
 * @implements-rules-version v1
 * Unit tests for the [locale] error boundary: renders the fallback, retries, reports app_error_shown.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, userEvent } from "../../../tests/utils/renderWithProviders";
import LocaleError from "./error";

describe("LocaleError", () => {
  beforeEach(() => {
    window.dataLayer = [];
  });

  it("renders the error fallback", () => {
    renderWithProviders(<LocaleError error={new Error("boom")} reset={() => {}} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("reports app_error_shown once with the digest", () => {
    const error = Object.assign(new Error("boom"), { digest: "DIG_123" });
    renderWithProviders(<LocaleError error={error} reset={() => {}} />);
    const fired = window.dataLayer?.filter((entry) => entry.event === "app_error_shown") ?? [];
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ error_code: "DIG_123" });
  });

  it("calls reset when retry is clicked", async () => {
    const reset = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<LocaleError error={new Error("boom")} reset={reset} />);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
