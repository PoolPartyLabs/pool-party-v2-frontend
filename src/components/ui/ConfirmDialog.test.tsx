/**
 * @id PP-CORE-MOD-003
 * @name ConfirmDialog — tests
 */
import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../tests/utils/renderWithProviders";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("confirms and cancels", async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    renderWithProviders(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Log out?"
        body="You'll need to sign in again."
        confirmLabel="Log out"
        cancelLabel="Cancel"
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText("Log out?")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Log out" });
    expect(confirm.className).toContain("destructive");
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("renders a non-destructive treatment with tone=info", () => {
    renderWithProviders(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        tone="info"
        title="Withdraw your funds first"
        body="Your account still holds funds."
        confirmLabel="Go to portfolio"
        cancelLabel="Cancel"
        onConfirm={vi.fn()}
      />,
    );
    const confirm = screen.getByRole("button", { name: "Go to portfolio" });
    expect(confirm.className).not.toContain("destructive");
  });
});
