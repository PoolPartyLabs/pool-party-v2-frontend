/**
 * @id PP-CORE-MOD-002
 * @name TransactionStatus — tests
 * Behavior: renders the title/body for each phase and any follow-up actions on success.
 * POO-807 (rules v1): the shared MockBadge renders above the headline in mock mode only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../../tests/utils/renderWithProviders";

const mocks = vi.hoisted(() => ({ mockMode: true }));

// PP-MOCK: drive the MockBadge's isMockMode gate (and dodge the heavy services barrel import).
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mocks.mockMode;
  },
}));

import { TransactionStatus } from "./TransactionStatus";

describe("TransactionStatus", () => {
  beforeEach(() => {
    mocks.mockMode = true;
  });

  // @rule POO-807 R1/R2: the mock indicator shows on every phase in mock mode, never in real mode.
  it("[POO-807] shows the MOCK badge in mock mode and hides it in real mode", () => {
    const { unmount } = renderWithProviders(
      <TransactionStatus phase="pending" title="Processing" />,
    );
    expect(screen.getByTestId("mock-badge")).toHaveTextContent("MOCK");
    unmount();
    mocks.mockMode = false;
    renderWithProviders(<TransactionStatus phase="success" title="Done" />);
    expect(screen.queryByTestId("mock-badge")).toBeNull();
  });

  it("renders the pending phase", () => {
    renderWithProviders(<TransactionStatus phase="pending" title="Processing" body="Hold on" />);
    expect(screen.getByText("Processing")).toBeInTheDocument();
    expect(screen.getByText("Hold on")).toBeInTheDocument();
  });

  it("renders the success phase with actions", () => {
    renderWithProviders(
      <TransactionStatus phase="success" title="Done">
        <button type="button">Continue</button>
      </TransactionStatus>,
    );
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  // POO-839 R6 — success bodies interpolate strategy names, so the body must wrap, not overflow.
  it("wraps a long success body", () => {
    renderWithProviders(
      <TransactionStatus
        phase="success"
        title="Done"
        body="Invested in SomeVeryLongUnbrokenStrategyNameThatWouldOverflowTheModal"
      />,
    );
    expect(
      screen.getByText("Invested in SomeVeryLongUnbrokenStrategyNameThatWouldOverflowTheModal"),
    ).toHaveClass("break-words");
  });
});
