import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Input } from "./Input";

/**
 * @id PP-CORE-CMP-011
 * Behavioral specs for the Input primitive: one it() per business rule.
 */
describe("Input", () => {
  it("reflects a controlled value", () => {
    render(<Input value="hello world" onChange={() => {}} />);

    expect(screen.getByRole("textbox")).toHaveValue("hello world");
  });

  it("updates the displayed value when the controlling state changes", async () => {
    const user = userEvent.setup();

    function Controlled() {
      const [value, setValue] = useState("");
      return <Input value={value} onChange={(e) => setValue(e.target.value)} />;
    }

    render(<Controlled />);
    const input = screen.getByRole("textbox");
    await user.type(input, "abc");

    expect(input).toHaveValue("abc");
  });

  it("works uncontrolled via defaultValue", async () => {
    const user = userEvent.setup();
    render(<Input defaultValue="seed" />);
    const input = screen.getByRole("textbox");

    await user.type(input, "!");

    expect(input).toHaveValue("seed!");
  });

  it("sets aria-invalid when variant is error", () => {
    render(<Input variant="error" />);

    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("does not set aria-invalid for the default variant", () => {
    render(<Input variant="default" />);

    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-invalid");
  });

  it("blocks typing when disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Input disabled onChange={onChange} />);
    const input = screen.getByRole("textbox");

    await user.type(input, "nope");

    expect(input).toHaveValue("");
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toBeDisabled();
  });

  it("merges a consumer className with the variant defaults", () => {
    render(<Input className="custom-class" />);

    expect(screen.getByRole("textbox")).toHaveClass("custom-class");
  });

  it("renders 16px mobile fonts that shrink from the sm breakpoint per size", () => {
    // @rule R2
    const { rerender } = render(<Input size="sm" />);
    expect(screen.getByRole("textbox")).toHaveClass("text-base", "sm:text-xs");

    rerender(<Input size="md" />);
    expect(screen.getByRole("textbox")).toHaveClass("text-base", "sm:text-sm");
  });

  it("associates a visible label with the input", () => {
    render(<Input label="Amount" />);

    expect(screen.getByLabelText("Amount")).toBe(screen.getByRole("textbox"));
  });

  it("links a description to the input via aria-describedby", () => {
    render(<Input label="Amount" description="In USDC" />);
    const input = screen.getByRole("textbox");

    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(screen.getByText("In USDC")).toHaveAttribute("id", describedBy as string);
  });

  it("announces an error message via aria-describedby and sets aria-invalid", () => {
    render(<Input label="Amount" error="Amount is required" />);
    const input = screen.getByRole("textbox");

    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const errorEl = screen.getByText("Amount is required");
    expect(describedBy).toContain(errorEl.getAttribute("id") as string);
  });
});
