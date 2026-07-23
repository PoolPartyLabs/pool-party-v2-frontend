/**
 * @id PP-CORE-CMP-062
 * @name MockBadge.test
 * @implements-rules-version v1 (POO-807 rules v1)
 *
 * The visible "MOCK" indicator: renders the chip in mock mode (R1) and renders NOTHING in real
 * mode (R2 — the gate lives inside the component, so no consumer can leak it into production).
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mockMode: true }));

// PP-MOCK: the badge reads the real `isMockMode` seam; the test drives it through this getter.
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mocks.mockMode;
  },
}));

import { MockBadge } from "./MockBadge";

describe("MockBadge", () => {
  beforeEach(() => {
    mocks.mockMode = true;
  });

  // @rule R1: in mock mode the indicator is visible and reads MOCK.
  it("renders the MOCK chip in mock mode", () => {
    render(<MockBadge />);
    const badge = screen.getByTestId("mock-badge");
    expect(badge).toHaveTextContent("MOCK");
  });

  // @rule R2: never renders in real mode — nothing, not even an empty wrapper.
  it("renders nothing in real mode", () => {
    mocks.mockMode = false;
    const { container } = render(<MockBadge />);
    expect(screen.queryByTestId("mock-badge")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});
