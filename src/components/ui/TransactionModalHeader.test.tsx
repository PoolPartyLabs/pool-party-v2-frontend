/**
 * @id PP-CORE-CMP-047
 * @name TransactionModalHeader.test
 *
 * The shared transactional-modal header renders the title, an optional back (←) button, and an
 * optional settings (⚙) button positioned to clear the Dialog's absolute X close (POO-445 R1).
 * POO-807 (rules v1): the shared MockBadge renders next to the title in mock mode only.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mockMode: true }));

// PP-MOCK: drive the MockBadge's isMockMode gate (and dodge the heavy services barrel import).
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mocks.mockMode;
  },
}));

import { Dialog, DialogContent } from "./Dialog";
import { TransactionModalHeader } from "./TransactionModalHeader";

function renderHeader(props: ComponentProps<typeof TransactionModalHeader>) {
  return render(
    <Dialog open>
      <DialogContent aria-describedby={undefined}>
        <TransactionModalHeader {...props} />
      </DialogContent>
    </Dialog>,
  );
}

describe("TransactionModalHeader", () => {
  beforeEach(() => {
    mocks.mockMode = true;
  });

  // @rule POO-807 R1/R2: the mock indicator sits next to the title in mock mode, never in real mode.
  it("[POO-807] shows the MOCK badge next to the title in mock mode only", () => {
    const { unmount } = renderHeader({ title: "Review" });
    expect(screen.getByTestId("mock-badge")).toHaveTextContent("MOCK");
    unmount();
    mocks.mockMode = false;
    renderHeader({ title: "Review" });
    expect(screen.queryByTestId("mock-badge")).toBeNull();
  });

  // @rule R1 — shared trigger: title + gear in one consistent place
  it("renders the title and a settings button that fires onSettings", () => {
    const onSettings = vi.fn();
    renderHeader({ title: "Confirm & sign", onSettings, settingsLabel: "Transaction settings" });
    expect(screen.getByText("Confirm & sign")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    expect(onSettings).toHaveBeenCalledOnce();
  });

  // @rule R1 — optional back affordance (Review/Confirm steps)
  it("renders a back button only when onBack is provided", () => {
    const onBack = vi.fn();
    renderHeader({
      title: "Review",
      onBack,
      backLabel: "Back",
      onSettings: vi.fn(),
      settingsLabel: "Settings",
    });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  // @rule POO-840 R2 — back arrow + settings gear (16px icons) carry expanded (~44px) touch
  // targets via ::after hit-areas. The gear's right expansion is CAPPED (after:-right-2) so its
  // hit-area never overlaps the Dialog/Sheet X box: a missed gear tap must never close the whole
  // flow and discard the typed amount.
  it("[POO-840 R2] back and gear carry expanded touch targets; the gear stays clear of the X", () => {
    renderHeader({
      title: "Review",
      onBack: vi.fn(),
      backLabel: "Back",
      onSettings: vi.fn(),
      settingsLabel: "Transaction settings",
    });
    const back = screen.getByRole("button", { name: "Back" });
    expect(back).toHaveClass("after:absolute");
    expect(back).toHaveClass("after:-inset-3.5");
    const gear = screen.getByRole("button", { name: "Transaction settings" });
    expect(gear).toHaveClass("after:absolute");
    expect(gear).toHaveClass("after:-inset-3.5");
    expect(gear).toHaveClass("after:-right-2");
  });

  it("omits the settings and back buttons when their handlers are absent", () => {
    renderHeader({ title: "Withdraw" });
    expect(screen.queryByRole("button", { name: "Transaction settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(screen.getByText("Withdraw")).toBeInTheDocument();
  });
});
