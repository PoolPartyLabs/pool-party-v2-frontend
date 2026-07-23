/**
 * @id PP-REW-CMP-016
 * @name InfoTip — tests
 * Behavior: the trigger carries the info text as its accessible name and reveals it on focus.
 */
import { describe, expect, it } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { InfoTip } from "./InfoTip";

describe("InfoTip", () => {
  it("names the trigger with the info text and shows the tooltip on focus", async () => {
    renderWithProviders(<InfoTip text="Paid out at the end of the month." />);
    const trigger = screen.getByRole("button", { name: "Paid out at the end of the month." });
    fireEvent.focus(trigger);
    const contents = await screen.findAllByText("Paid out at the end of the month.");
    expect(contents.length).toBeGreaterThan(0);
  });

  // @rule POO-840 R5 — same class as the receipt (i): a plain tap must reveal the explanation
  // (Radix tooltips ignore taps unless the open state is controlled).
  it("[POO-840 R5] shows the tooltip on tap", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InfoTip text="Paid out at the end of the month." />);
    await user.click(screen.getByRole("button", { name: "Paid out at the end of the month." }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Paid out at the end of the month.",
    );
  });

  // @rule POO-840 R2 — expanded (~44px) touch target on the 14px (i), visual size unchanged.
  it("[POO-840 R2] the trigger carries an expanded touch target", () => {
    renderWithProviders(<InfoTip text="Paid out at the end of the month." />);
    const trigger = screen.getByRole("button", { name: "Paid out at the end of the month." });
    expect(trigger).toHaveClass("relative");
    expect(trigger).toHaveClass("after:absolute");
    expect(trigger).toHaveClass("after:-inset-3.5");
  });
});
