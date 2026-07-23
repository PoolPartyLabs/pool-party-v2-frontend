/**
 * @id PP-CORE-CMP-013
 * @name Dialog.test
 * @implements-rules-version v1
 * Behavior tests for the Dialog primitive: opening via trigger, closing via Esc, and closing via
 * the built-in close (X) button.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./Dialog";

function renderDialog() {
  return render(
    <Dialog>
      <DialogTrigger>Open dialog</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm withdrawal</DialogTitle>
          <DialogDescription>Review the details before continuing.</DialogDescription>
        </DialogHeader>
        <p>Body content</p>
        <DialogFooter>
          <DialogClose>Cancel</DialogClose>
          <button type="button">Confirm</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>,
  );
}

describe("Dialog", () => {
  it("is closed by default (no dialog rendered)", () => {
    renderDialog();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens when the trigger is clicked", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Open dialog" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Confirm withdrawal" })).toBeInTheDocument();
  });

  it("closes when Escape is pressed", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when the built-in close (X) button is clicked", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // @rule POO-840 R2 — the 16px X is the ONLY dismissal of the success receipts (POO-801), so it
  // carries an expanded (~44px) touch target via an ::after hit-area (icon position unchanged).
  it("[POO-840 R2] the built-in close (X) carries an expanded touch target", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    const close = screen.getByRole("button", { name: "Close" });
    expect(close).toHaveClass("after:absolute");
    expect(close).toHaveClass("after:-inset-3.5");
  });

  it("closes when a DialogClose action button is clicked", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not render the built-in close button when showClose is false", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent showClose={false}>
          <DialogTitle>No close X</DialogTitle>
          <DialogDescription>This dialog hides the corner close button.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  // POO-839 R1/R3 — the surface caps its height + scrolls (CTA reachable on short viewports)
  // and keeps a horizontal gutter below max-w-lg (never flush to the physical screen edge).
  it("caps its height, scrolls, and keeps a viewport gutter", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    const surface = screen.getByRole("dialog");

    expect(surface).toHaveClass("overflow-y-auto");
    expect(surface.className).toContain("max-h-[calc(100dvh-2rem)]");
    expect(surface.className).toContain("w-[calc(100%-2rem)]");
    expect(surface).not.toHaveClass("w-full");
  });
});
