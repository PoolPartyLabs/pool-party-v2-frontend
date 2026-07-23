/**
 * @id PP-CORE-CMP-030
 * @name ProtocolBadge tests
 * @implements-rules-version v1
 *
 * Renders the "Uniswap v3" label, keeps the logo decorative (aria-hidden, empty alt),
 * and honors the size prop on the logo.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProtocolBadge } from "./ProtocolBadge";

describe("ProtocolBadge", () => {
  it("renders the Uniswap v3 label", () => {
    render(<ProtocolBadge />);
    expect(screen.getByText("Uniswap v3")).toBeInTheDocument();
  });

  it("keeps the logo decorative (empty alt, aria-hidden)", () => {
    const { container } = render(<ProtocolBadge />);
    const logo = container.querySelector("img");
    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute("alt", "");
    expect(logo).toHaveAttribute("aria-hidden", "true");
  });

  it("defaults the logo to 16px", () => {
    const { container } = render(<ProtocolBadge />);
    const logo = container.querySelector("img");
    expect(logo).toHaveAttribute("width", "16");
    expect(logo).toHaveAttribute("height", "16");
  });

  it("honors the size prop on the logo", () => {
    const { container } = render(<ProtocolBadge size={24} />);
    const logo = container.querySelector("img");
    expect(logo).toHaveAttribute("width", "24");
    expect(logo).toHaveAttribute("height", "24");
  });

  it("applies extra classes to the wrapper", () => {
    render(<ProtocolBadge className="custom-class" />);
    expect(screen.getByText("Uniswap v3").parentElement).toHaveClass("custom-class");
  });
});
