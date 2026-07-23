/**
 * @id PP-CORE-CMP-010
 * @name Button.test
 * @implements-rules-version v1
 * Unit tests for the Button primitive: rendering, variants/sizes, disabled, and loading.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("renders its children", () => {
    render(<Button>Deposit</Button>);
    expect(screen.getByRole("button", { name: "Deposit" })).toBeInTheDocument();
  });

  it("defaults to type=button", () => {
    render(<Button>Click</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("applies variant classes", () => {
    render(<Button variant="destructive">Remove</Button>);
    expect(screen.getByRole("button")).toHaveClass("bg-destructive");
  });

  it("applies size classes", () => {
    render(<Button size="lg">Large</Button>);
    expect(screen.getByRole("button")).toHaveClass("h-12");
  });

  it("merges a consumer className", () => {
    render(<Button className="w-full">Wide</Button>);
    expect(screen.getByRole("button")).toHaveClass("w-full");
  });

  it("fires onClick when enabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("blocks onClick when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows a spinner and disables the button when loading", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { container } = render(
      <Button loading onClick={onClick}>
        Submitting
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
