import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorState } from "./ErrorState";

/**
 * @id PP-CORE-CMP-019
 * Behavioral specs for the ErrorState primitive. It is props-based (no i18n inside), so the
 * consumer supplies already-translated copy and the retry label.
 */
describe("ErrorState", () => {
  it("renders the provided title and description", () => {
    render(<ErrorState title="Failed to load positions" description="The network is down." />);

    expect(screen.getByText("Failed to load positions")).toBeInTheDocument();
    expect(screen.getByText("The network is down.")).toBeInTheDocument();
  });

  it("renders without a description when none is provided", () => {
    render(<ErrorState title="Failed to load" />);

    expect(screen.getByText("Failed to load")).toBeInTheDocument();
  });

  it("renders a retry button when both onRetry and retryLabel are provided", () => {
    render(<ErrorState title="Failed" onRetry={() => {}} retryLabel="Try again" />);

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("calls onRetry when the retry button is clicked", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState title="Failed" onRetry={onRetry} retryLabel="Try again" />);

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not render a retry button when onRetry is omitted", () => {
    render(<ErrorState title="Failed" retryLabel="Try again" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not render a retry button when retryLabel is omitted", () => {
    render(<ErrorState title="Failed" onRetry={() => {}} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("exposes an alert role for assistive technology", () => {
    render(<ErrorState title="Failed" />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("merges a consumer className onto the container defaults", () => {
    render(<ErrorState title="Failed" data-testid="error" className="py-4" />);

    const root = screen.getByTestId("error");
    expect(root).toHaveClass("flex", "flex-col", "items-center", "py-4");
    expect(root).not.toHaveClass("py-12");
  });

  it("forwards native div props such as aria-label", () => {
    render(<ErrorState title="Failed" data-testid="error" aria-label="Load failed" />);

    expect(screen.getByTestId("error")).toHaveAttribute("aria-label", "Load failed");
  });

  it("renders an optional secondary action beneath the retry button", () => {
    render(
      <ErrorState
        title="Failed"
        onRetry={() => {}}
        retryLabel="Try again"
        secondaryAction={<a href="/profile/help">Contact support</a>}
      />,
    );

    expect(screen.getByRole("link", { name: "Contact support" })).toHaveAttribute(
      "href",
      "/profile/help",
    );
  });

  it("omits the secondary action when none is provided", () => {
    render(<ErrorState title="Failed" />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
