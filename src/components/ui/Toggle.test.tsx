/**
 * @id PP-CORE-CMP-008
 * @name Toggle — tests
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { Toggle } from "./Toggle";

describe("Toggle", () => {
  it("reports the next state on click", () => {
    const onChange = vi.fn();
    renderWithProviders(<Toggle checked={false} onCheckedChange={onChange} label="Push" />);
    const sw = screen.getByRole("switch", { name: "Push" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  // Soft-disabled (blocked): inert click, but stays keyboard-focusable so a wrapper hint (e.g. a
  // "coming soon" tooltip) is reachable by keyboard — unlike a native-`disabled` switch (POO-738).
  it("stays focusable and inert when blocked", () => {
    const onChange = vi.fn();
    renderWithProviders(<Toggle checked={false} onCheckedChange={onChange} label="Push" blocked />);
    const sw = screen.getByRole("switch", { name: "Push" });
    expect(sw).toHaveAttribute("aria-disabled", "true");
    expect(sw).not.toBeDisabled(); // still in the tab order
    sw.focus();
    expect(sw).toHaveFocus();
    fireEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
  });

  // A native `disabled` always wins over `blocked` (truly locked, out of the tab order).
  it("prefers native disabled over blocked", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <Toggle checked={false} onCheckedChange={onChange} label="Push" disabled blocked />,
    );
    const sw = screen.getByRole("switch", { name: "Push" });
    expect(sw).toBeDisabled();
    expect(sw).not.toHaveAttribute("aria-disabled");
    fireEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
  });
});
