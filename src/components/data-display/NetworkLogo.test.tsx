/**
 * @id PP-CORE-CMP-041
 * @name NetworkLogo tests
 * @implements-rules-version v1
 *
 * Renders the official logo for a known network (decorative: aria-hidden, empty alt), honors the
 * size prop, and falls back to a brand-colored first-letter monogram for an unmapped network.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NetworkLogo } from "./NetworkLogo";

describe("NetworkLogo", () => {
  it("renders the committed logo for a known network", () => {
    const { container } = render(<NetworkLogo network="arbitrum" name="Arbitrum" />);
    const logo = container.querySelector("img");
    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute("src", "/networks/arbitrum.png");
  });

  it("is case-insensitive on the network slug", () => {
    const { container } = render(<NetworkLogo network="Base" name="Base" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/networks/base.png");
  });

  it("keeps the logo decorative (empty alt, aria-hidden)", () => {
    const { container } = render(<NetworkLogo network="polygon" name="Polygon" />);
    const logo = container.querySelector("img");
    expect(logo).toHaveAttribute("alt", "");
    expect(logo).toHaveAttribute("aria-hidden", "true");
  });

  it("defaults the logo to 16px and honors the size prop", () => {
    const { container, rerender } = render(<NetworkLogo network="base" name="Base" />);
    expect(container.querySelector("img")).toHaveAttribute("width", "16");
    rerender(<NetworkLogo network="base" name="Base" size={24} />);
    expect(container.querySelector("img")).toHaveAttribute("width", "24");
  });

  it("falls back to a first-letter monogram for an unmapped network", () => {
    const { container } = render(<NetworkLogo network="optimism" name="Optimism" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("O")).toBeInTheDocument();
  });

  it("applies extra classes", () => {
    const { container } = render(
      <NetworkLogo network="arbitrum" name="Arbitrum" className="custom-class" />,
    );
    expect(container.querySelector("img")).toHaveClass("custom-class");
  });
});
