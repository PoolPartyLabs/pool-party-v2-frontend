import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the title", () => {
    render(<EmptyState title="No positions yet" />);

    expect(screen.getByText("No positions yet")).toBeInTheDocument();
  });

  it("renders the description when provided", () => {
    render(
      <EmptyState title="No positions yet" description="Deposit to open your first position." />,
    );

    expect(screen.getByText("Deposit to open your first position.")).toBeInTheDocument();
  });

  it("does not render a description paragraph when description is omitted", () => {
    const { container } = render(<EmptyState title="No positions yet" />);

    // Only the title paragraph should be present.
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("renders the action when provided", () => {
    render(<EmptyState title="No positions yet" action={<button type="button">Deposit</button>} />);

    expect(screen.getByRole("button", { name: "Deposit" })).toBeInTheDocument();
  });

  it("does not render the action when omitted", () => {
    render(<EmptyState title="No positions yet" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("applies title and description token classes", () => {
    render(<EmptyState title="Empty" description="Nothing here" />);

    expect(screen.getByText("Empty")).toHaveClass("text-foreground", "font-semibold");
    expect(screen.getByText("Nothing here")).toHaveClass("text-muted-foreground");
  });

  it("merges a consumer className onto the container defaults", () => {
    render(<EmptyState data-testid="empty" title="Empty" className="py-4" />);

    const root = screen.getByTestId("empty");
    expect(root).toHaveClass("flex", "flex-col", "items-center", "py-4");
    expect(root).not.toHaveClass("py-12");
  });

  it("forwards native div props such as aria-label", () => {
    render(<EmptyState data-testid="empty" title="Empty" aria-label="No data" />);

    expect(screen.getByTestId("empty")).toHaveAttribute("aria-label", "No data");
  });
});
