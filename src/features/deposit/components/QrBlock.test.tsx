/**
 * @id PP-DEP-CMP-004
 * @name QrBlock - tests
 * Behavior (POO-507): renders a REAL scannable QR of the value via the uqr encoder; the SVG module
 * grid matches the encoder's matrix exactly (same size, same on-module count), deterministically.
 */
import { encode } from "uqr";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../../../tests/utils/renderWithProviders";
import { QrBlock } from "./QrBlock";

const ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

describe("QrBlock", () => {
  // @rule POO-507 R1: the rendered modules ARE the encoder's matrix for the plain address -
  // matching size and on-module count means the graphic is the scannable code, not decoration.
  it("renders the real QR matrix for the value", () => {
    const { container } = renderWithProviders(<QrBlock value={ADDRESS} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    const expected = encode(ADDRESS, { border: 2 });
    expect(svg?.getAttribute("viewBox")).toBe(`0 0 ${expected.size} ${expected.size}`);
    const expectedOn = expected.data.flat().filter(Boolean).length;
    // Background rect + one rect per dark module.
    expect(svg?.querySelectorAll("rect").length).toBe(expectedOn + 1);
  });

  // @rule POO-507 R2: the quiet zone + white module background keep the code scannable on the
  // dark theme.
  it("keeps a white background under the modules", () => {
    const { container } = renderWithProviders(<QrBlock value={ADDRESS} />);
    const background = container.querySelector("svg rect");
    expect(background?.getAttribute("fill")).toBe("#ffffff");
  });

  it("is deterministic for the same value", () => {
    const a = renderWithProviders(<QrBlock value={ADDRESS} />);
    const first = a.container.querySelectorAll("rect").length;
    const b = renderWithProviders(<QrBlock value={ADDRESS} />);
    const second = b.container.querySelectorAll("rect").length;
    expect(first).toBe(second);
  });
});
