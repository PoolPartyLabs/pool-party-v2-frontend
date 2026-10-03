/**
 * @id PP-MGR-CMP-041
 * @name MandateRow.test
 * @implements-rules-version v1
 * @analytics-events none, the row reports nothing; its caller decides what a click means
 *
 * POO-2123 [R12] / [R15] / [R17] / [R19] / [R21], epic POO-2119. The shared Mandate selection row.
 * The load-bearing assertion here is the DISABLED one: a disabled row must still deliver its click,
 * because a row that swallows it produces no event, and a demand nobody can see is a demand nobody
 * will build (CLAUDE.md premise 11, blocked intent).
 */
import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../tests/utils/renderWithProviders";
import { MandateRow } from "./MandateRow";

/** The row under test, with only the props a case cares about spelled out. */
function row(overrides: Partial<React.ComponentProps<typeof MandateRow>> = {}) {
  return (
    <MandateRow
      id="base"
      ariaLabel="Base"
      logo={<span data-testid="logo" />}
      title="Base"
      {...overrides}
    />
  );
}

describe("MandateRow", () => {
  // @rule R12
  it("renders an unselected row as a checkbox on the default surface", () => {
    renderWithProviders(row());

    const control = screen.getByRole("checkbox", { name: "Base" });
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(control).toHaveAttribute("data-mandate-row", "base");
    expect(control.className).toContain("bg-surface");
    expect(control.className).not.toContain("bg-surface-raised");
  });

  // @rule R12
  it("fills a selected row with the raised surface and ticks its checkbox", () => {
    renderWithProviders(row({ selected: true }));

    const control = screen.getByRole("checkbox", { name: "Base" });
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(control.className).toContain("bg-surface-raised");
    // R12: no yellow fill on the row itself; the primary colour lives on the checkbox.
    expect(control.className).not.toContain("bg-primary");
    expect(control.querySelector(".bg-primary")).not.toBeNull();
  });

  it("calls onToggle when the row is clicked", async () => {
    const onToggle = vi.fn();
    renderWithProviders(row({ onToggle }));

    await userEvent.click(screen.getByRole("checkbox", { name: "Base" }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // @rule R17
  // @rule R21
  it("keeps a disabled row clickable so the blocked intent reaches its caller", async () => {
    const onToggle = vi.fn();
    renderWithProviders(row({ disabled: true, statusLabel: "Coming soon", onToggle }));

    const control = screen.getByRole("checkbox", { name: "Base" });
    expect(control).toHaveAttribute("aria-disabled", "true");
    // The native `disabled` attribute would swallow the click, and with it the only signal that
    // someone wanted this network.
    expect(control).not.toBeDisabled();
    expect(control.className).toContain("opacity-60");
    expect(screen.getByText("Coming soon")).toBeInTheDocument();

    await userEvent.click(control);

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // @rule R15
  // @rule R19
  it("renders a locked row as plain content with the lock label and no checkbox", () => {
    const { container } = renderWithProviders(
      row({ locked: true, caption: "Deposits and withdrawals happen on this network." }),
    );

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Always included")).toBeInTheDocument();
    expect(
      screen.getByText("Deposits and withdrawals happen on this network."),
    ).toBeInTheDocument();
    // The block still answers to the row id, so a validation notice can scroll to it.
    expect(container.querySelector('[data-mandate-row="base"]')).not.toBeNull();
  });

  it("renders the trailing slot and the caption", () => {
    renderWithProviders(
      row({ caption: "Lending · supply tokens to earn interest", trailing: <span>On</span> }),
    );

    expect(screen.getByText("Lending · supply tokens to earn interest")).toBeInTheDocument();
    expect(screen.getByText("On")).toBeInTheDocument();
  });
});
