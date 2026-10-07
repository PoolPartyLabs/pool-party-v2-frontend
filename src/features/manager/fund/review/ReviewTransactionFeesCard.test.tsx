/**
 * @id PP-MGR-CMP-090 (POO-2289)
 * @name ReviewTransactionFeesCard.test
 * @implements-rules-version v1
 * @analytics-events none: read-only card contracts; parent assembly tests preserve emissions.
 */
import { describe, expect, it } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import { ReviewTransactionFeesCard } from "./ReviewTransactionFeesCard";

describe("ReviewTransactionFeesCard", () => {
  // @rule R2/R3/R6: unavailable amounts are plain text, not editable or inferred fees.
  it("renders two read-only unavailable values and no fee controls", () => {
    renderWithProviders(<ReviewTransactionFeesCard />);
    const card = screen.getByRole("region", { name: "Transaction fees" });
    expect(within(card).getByText("Entry fee")).toBeVisible();
    expect(within(card).getByText("Exit fee")).toBeVisible();
    expect(card.querySelectorAll("dd")).toHaveLength(2);
    expect(within(card).getAllByText("Not available")).toHaveLength(2);
    expect(card.querySelector("input,select,textarea")).toBeNull();
    expect(within(card).queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(
      within(card)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["More about Entry fee", "More about Exit fee"]);
    expect(
      within(card).queryByText(/0%|25%|Instant withdrawal|Protocol fee/),
    ).not.toBeInTheDocument();
  });
  // @rule R3/R6: keyboard help uses the same unavailable helper and leaves values intact.
  it("offers keyboard-accessible help without an operation or editable value", async () => {
    renderWithProviders(<ReviewTransactionFeesCard />);
    const entry = screen.getByRole("button", { name: "More about Entry fee" });
    const exit = screen.getByRole("button", { name: "More about Exit fee" });
    expect(entry).toHaveAccessibleDescription("Fee details are unavailable.");
    expect(exit).toHaveAccessibleDescription("Fee details are unavailable.");
    await userEvent.tab();
    expect(entry).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Fee details are unavailable.");
    await userEvent.keyboard("{Escape}");
    await userEvent.tab();
    expect(exit).toHaveFocus();
    expect(screen.getAllByText("Not available")).toHaveLength(2);
  });
  // @rule R4: no fixed height or clipping; header and rows permit wrap with 24px row minimum.
  it("keeps natural height and reflow contracts for narrow or translated content", () => {
    renderWithProviders(<ReviewTransactionFeesCard />);
    const card = screen.getByRole("region", { name: "Transaction fees" });
    expect(card.className).not.toMatch(/overflow-(hidden|clip)|\bh-\[152px\]/);
    expect(card.querySelector("h3")?.parentElement).toHaveClass("flex-wrap", "min-w-0");
    for (const value of card.querySelectorAll("dd")) {
      expect(value.parentElement).toHaveClass("min-h-6", "flex-wrap", "min-w-0");
      expect(value).toHaveClass("max-w-full", "break-words");
    }
  });
});
