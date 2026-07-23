import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("renders a pulsing placeholder element", () => {
    render(<Skeleton data-testid="skeleton" />);

    const skeleton = screen.getByTestId("skeleton");
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveClass("animate-pulse", "rounded-md", "bg-surface-raised");
  });

  it("is hidden from assistive technology", () => {
    render(<Skeleton data-testid="skeleton" />);

    const skeleton = screen.getByTestId("skeleton");
    expect(skeleton).toHaveAttribute("aria-hidden", "true");
    expect(skeleton).toHaveAttribute("role", "presentation");
  });

  it("applies width, height, and radius via inline style", () => {
    render(<Skeleton data-testid="skeleton" width={120} height="1rem" radius="9999px" />);

    const skeleton = screen.getByTestId("skeleton");
    expect(skeleton).toHaveStyle({ width: "120px", height: "1rem", borderRadius: "9999px" });
  });

  it("merges a consumer className onto the defaults", () => {
    render(<Skeleton data-testid="skeleton" className="rounded-full" />);

    const skeleton = screen.getByTestId("skeleton");
    expect(skeleton).toHaveClass("animate-pulse", "bg-surface-raised", "rounded-full");
    expect(skeleton).not.toHaveClass("rounded-md");
  });

  it("lets a consumer style override the dimension style", () => {
    render(<Skeleton data-testid="skeleton" width={50} style={{ width: "200px" }} />);

    expect(screen.getByTestId("skeleton")).toHaveStyle({ width: "200px" });
  });

  it("forwards native div props such as data attributes", () => {
    render(<Skeleton data-testid="skeleton" data-state="loading" />);

    expect(screen.getByTestId("skeleton")).toHaveAttribute("data-state", "loading");
  });
});
