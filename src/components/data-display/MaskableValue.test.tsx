/**
 * @id PP-CORE-CMP-028
 * @name MaskableValue tests
 * @implements-rules-version v1
 *
 * Shows its children when the scope is visible and a dot placeholder when masked.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EphemeralMaskProvider } from "@/lib/hooks/maskValue";
import { MaskableValue } from "./MaskableValue";

describe("MaskableValue", () => {
  it("renders the value when no provider is present (defaults to visible)", () => {
    render(<MaskableValue>$1,250.00</MaskableValue>);
    expect(screen.getByText("$1,250.00")).toBeInTheDocument();
  });

  it("renders dots instead of the value when the scope is masked", () => {
    render(
      <EphemeralMaskProvider>
        <MaskableValue>$1,250.00</MaskableValue>
      </EphemeralMaskProvider>,
    );
    expect(screen.queryByText("$1,250.00")).not.toBeInTheDocument();
    expect(screen.getByText("••••")).toBeInTheDocument();
  });

  it("uses a custom dot glyph run when provided", () => {
    render(
      <EphemeralMaskProvider>
        <MaskableValue dots="***">$1,250.00</MaskableValue>
      </EphemeralMaskProvider>,
    );
    expect(screen.getByText("***")).toBeInTheDocument();
  });
});
