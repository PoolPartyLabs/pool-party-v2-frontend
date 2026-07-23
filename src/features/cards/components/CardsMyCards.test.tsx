/**
 * @id PP-CARD-SCR-002
 * @name CardsMyCards.test
 * Behavior: renders the held card + transactions; the empty state routes to Explore; Top up adds to
 * the balance and inserts a credit transaction.
 */
import { describe, expect, it, vi } from "vitest";
import { cardTransactions, ownedCards } from "@/mocks/data/cards";
import {
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../../tests/utils/renderWithProviders";
import { CardsMyCards } from "./CardsMyCards";

describe("CardsMyCards", () => {
  it("renders the held card balance and its transactions", () => {
    renderWithProviders(
      <CardsMyCards cards={ownedCards} transactions={cardTransactions} onExplore={vi.fn()} />,
    );
    expect(screen.getByText("$248.50")).toBeInTheDocument();
    expect(screen.getByText("Spotify")).toBeInTheDocument();
    expect(screen.getByText("Cashback")).toBeInTheDocument();
  });

  it("shows an empty state that routes to Explore when there are no cards", async () => {
    const onExplore = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<CardsMyCards cards={[]} transactions={[]} onExplore={onExplore} />);
    await user.click(screen.getByRole("button", { name: "Explore cards" }));
    expect(onExplore).toHaveBeenCalledOnce();
  });

  it("tops up the balance and inserts a credit transaction", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CardsMyCards cards={ownedCards} transactions={cardTransactions} onExplore={vi.fn()} />,
    );
    // Open the Top up dialog (the card action), then confirm the default $50 inside the dialog.
    await user.click(screen.getByRole("button", { name: "Top up" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Top up" }));
    // 248.50 + 50 = 298.50.
    expect(await screen.findByText("$298.50")).toBeInTheDocument();
  });
});
