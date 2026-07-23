/**
 * @id PP-DEP-CMP-001
 * @name AmountKeypad — tests
 * Behavior: digit keys and the delete key emit the right raw key.
 */
import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { AmountKeypad } from "./AmountKeypad";

describe("AmountKeypad", () => {
  it("emits digit and backspace keys", () => {
    const onKey = vi.fn();
    renderWithProviders(<AmountKeypad onKey={onKey} />);
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    expect(onKey).toHaveBeenCalledWith("5");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onKey).toHaveBeenCalledWith("backspace");
  });
});
