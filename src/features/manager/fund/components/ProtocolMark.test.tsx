/**
 * @id PP-MGR-CMP-036
 * @name ProtocolMark.test
 * @implements-rules-version v4 (POO-2167)
 * @analytics-events none, decorative logos
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ProtocolId } from "../mandateDraft";
import { ProtocolMark } from "./ProtocolMark";

describe("ProtocolMark", () => {
  // @rule R4 (POO-2167 v4)
  it.each([
    ["uniswap-v3-swap", "/protocols/uniswap.svg"],
    ["uniswap-v3", "/protocols/uniswap.svg"],
    ["uniswap-v4", "/protocols/uniswap.svg"],
    ["across", "/protocols/across.svg"],
    ["aave-v3", "/tokens/aave.png"],
    ["gmx", "/protocols/gmx.svg"],
    ["pendle", "/protocols/pendle.png"],
  ])("renders a committed decorative logo for %s at both row sizes (POO-2167)", (id, src) => {
    for (const size of [24, 28]) {
      const { container, unmount } = render(
        <ProtocolMark id={id as ProtocolId} name={id} size={size} />,
      );
      const logo = container.querySelector("img");
      expect(logo).toHaveAttribute("src", src);
      expect(logo).toHaveAttribute("alt", "");
      expect(logo).toHaveAttribute("aria-hidden", "true");
      expect(logo).toHaveAttribute("width", String(size));
      expect(container.textContent).toBe("");
      unmount();
    }
  });
});
