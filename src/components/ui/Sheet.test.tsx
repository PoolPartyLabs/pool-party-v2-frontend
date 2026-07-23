/**
 * @id PP-CORE-CMP-038
 * @name Sheet.test
 * @implements-rules-version v1
 * Behavior tests for the Sheet primitive: opening via trigger, closing via Esc / the X button, and
 * honoring showClose. Swipe-to-dismiss is gesture-driven and covered by on-device QA, not jsdom.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./Sheet";

function renderSheet(showClose = true) {
  return render(
    <Sheet>
      <SheetTrigger>Open sheet</SheetTrigger>
      <SheetContent showClose={showClose}>
        <SheetHeader>
          <SheetTitle>Not enough gas</SheetTitle>
          <SheetDescription>Top up below.</SheetDescription>
        </SheetHeader>
        <p>Body content</p>
        <SheetFooter>
          <SheetClose>Cancel</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>,
  );
}

describe("Sheet", () => {
  it("is closed by default", () => {
    renderSheet();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens when the trigger is clicked", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("button", { name: "Open sheet" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Not enough gas" })).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("button", { name: "Open sheet" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes via the built-in X button", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("button", { name: "Open sheet" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // @rule POO-840 R2 — the 16px X gets an expanded (~44px) touch target via an ::after hit-area
  // (icon position unchanged).
  it("[POO-840 R2] the built-in close (X) carries an expanded touch target", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("button", { name: "Open sheet" }));
    const close = screen.getByRole("button", { name: "Close" });
    expect(close).toHaveClass("after:absolute");
    expect(close).toHaveClass("after:-inset-3.5");
  });

  it("hides the X when showClose is false", async () => {
    const user = userEvent.setup();
    renderSheet(false);
    await user.click(screen.getByRole("button", { name: "Open sheet" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  // POO-839 R2 — the sheet caps its height and scrolls its body so clipped content stays
  // reachable. Restricting the swipe drag to the grab handle (so native scroll is not captured)
  // is gesture behavior verified by on-device QA, not jsdom.
  it("caps its height and scrolls its body", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(screen.getByRole("button", { name: "Open sheet" }));
    const surface = screen.getByRole("dialog");

    expect(surface).toHaveClass("overflow-y-auto");
    expect(surface.className).toContain("max-h-[calc(100dvh-1rem)]");
  });
});
