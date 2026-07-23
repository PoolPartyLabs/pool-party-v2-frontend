/**
 * @id PP-CORE-CMP-052
 * @name BuildingStep tests
 * @implements-rules-version v2 (POO-807 rules v1)
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mockMode: true }));

// PP-MOCK: drive the MockBadge's isMockMode gate (and dodge the heavy services barrel import).
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mocks.mockMode;
  },
}));

import { BuildingStep } from "./BuildingStep";

describe("BuildingStep", () => {
  beforeEach(() => {
    mocks.mockMode = true;
  });

  it("renders the label under a status role", () => {
    render(<BuildingStep label="Processing…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Processing…");
  });

  // @rule POO-807 R1/R2: the building phase carries the mock indicator in mock mode only.
  it("[POO-807] shows the MOCK badge in mock mode and hides it in real mode", () => {
    const { unmount } = render(<BuildingStep label="Processing…" />);
    expect(screen.getByTestId("mock-badge")).toHaveTextContent("MOCK");
    unmount();
    mocks.mockMode = false;
    render(<BuildingStep label="Processing…" />);
    expect(screen.queryByTestId("mock-badge")).toBeNull();
  });

  it("renders the optional body line when provided, and omits it otherwise", () => {
    const { rerender } = render(<BuildingStep label="Processing…" body="Hang tight." />);
    expect(screen.getByText("Hang tight.")).toBeInTheDocument();
    rerender(<BuildingStep label="Processing…" />);
    expect(screen.queryByText("Hang tight.")).not.toBeInTheDocument();
  });
});
