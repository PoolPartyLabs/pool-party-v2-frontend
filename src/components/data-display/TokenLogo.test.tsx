/**
 * @id PP-CORE-CMP-057
 * @name TokenLogo tests
 * @implements-rules-version v1
 *
 * Renders a committed major-token logo (decorative: empty alt + aria-hidden), is case-insensitive on
 * the symbol, and falls back to a symbol-initial chip when the logo is unresolved.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TokenLogo } from "./TokenLogo";

describe("TokenLogo", () => {
  // @rule R3: the token logo is decorative (empty alt + aria-hidden), never announced.
  it("renders a committed major-token logo (network-free), decorative", () => {
    const { container } = render(<TokenLogo symbol="ETH" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "/tokens/eth.png");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("aria-hidden", "true");
  });

  // @rule R1: the symbol-keyed token logo resolves the per-asset row logos (used by R2 too).
  it("is case-insensitive on the symbol", () => {
    const { container } = render(<TokenLogo symbol="usdc" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/tokens/usdc.png");
  });

  // @rule R3: an unresolved token falls back to the symbol-initial chip, never a broken image.
  it("falls back to a symbol-initial chip when the logo is unresolved", () => {
    const { container, getByText } = render(<TokenLogo symbol="ZZZ" />);
    expect(container.querySelector("img")).toBeNull();
    expect(getByText("Z")).toBeInTheDocument();
  });
});
