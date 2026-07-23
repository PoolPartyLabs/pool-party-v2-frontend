/**
 * @id PP-CORE-CMP-029
 * @name EyeToggle tests
 * @implements-rules-version v1
 *
 * Uses the provided label as its accessible name, reflects the scope's mask state via aria-pressed,
 * and flips the scope on click.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EphemeralMaskProvider } from "@/lib/hooks/maskValue";
import { EyeToggle } from "./EyeToggle";

describe("EyeToggle", () => {
  it("uses the provided label and reflects the masked scope via aria-pressed", () => {
    // EphemeralMaskProvider starts masked.
    render(
      <EphemeralMaskProvider>
        <EyeToggle label="Hide values" />
      </EphemeralMaskProvider>,
    );
    expect(screen.getByRole("button", { name: "Hide values" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("toggles the masked state on click", () => {
    render(
      <EphemeralMaskProvider>
        <EyeToggle label="Hide values" />
      </EphemeralMaskProvider>,
    );
    const button = screen.getByRole("button", { name: "Hide values" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
  });
});
