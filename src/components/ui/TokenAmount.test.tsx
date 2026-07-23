/**
 * @id PP-CORE-CMP-045
 * @name TokenAmount.test
 * @implements-rules-version v1
 * Unit tests for the TokenAmount render helper: subscript-zero for ultra-tiny values, plain for the
 * rest, and the exact value exposed for hover/copy.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TokenAmount } from "./TokenAmount";

describe("TokenAmount", () => {
  // @rule R5 + R7: ultra-tiny amount renders subscript-zero with the count in a <sub>.
  it("renders an ultra-tiny amount as subscript-zero", () => {
    const { container } = render(<TokenAmount value={1.234e-16} symbol="TKN" />);
    expect(container.querySelector("sub")?.textContent).toBe("15");
    expect(container.textContent).toContain("0.0");
    expect(container.textContent).toContain("1234");
    expect(container.textContent).toContain("TKN");
  });

  // @rule R1: the original tiny-amount bug — never renders a nonzero amount as "0".
  it("never renders a nonzero amount as 0", () => {
    const { container } = render(<TokenAmount value={1e-16} symbol="TKN" />);
    expect(container.textContent).not.toBe("0 TKN");
    expect(container.querySelector("sub")?.textContent).toBe("15");
  });

  // @rule R3: a normal amount renders plainly, no subscript.
  it("renders a normal amount without a subscript", () => {
    const { container } = render(<TokenAmount value={12.85} symbol="USDC" />);
    expect(container.querySelector("sub")).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe("12.85 USDC");
  });

  // @rule R7: the exact value is available for hover/copy (title) and to assistive tech (sr-only text).
  it("exposes the exact value via title and a screen-reader-only label", () => {
    render(<TokenAmount value={1.234e-16} symbol="TKN" />);
    expect(screen.getByTitle("0.0000000000000001234 TKN")).toBeInTheDocument();
    expect(screen.getByText("0.0000000000000001234 TKN")).toBeInTheDocument();
  });
});
