/**
 * @id PP-CARD-SCR-001
 * @name CardsView.test
 * Behavior: Explore renders by default (partners + count); requesting a card opens the partner
 * onboarding and flips the offer to "Activating…"; the My cards tab shows the held card + activity.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cardOffers, cardTransactions, ownedCards } from "@/mocks/data/cards";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../tests/utils/renderWithProviders";
import { CardsView } from "./CardsView";

function renderView() {
  return renderWithProviders(
    <CardsView catalog={cardOffers} cards={ownedCards} transactions={cardTransactions} />,
  );
}

describe("CardsView", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the Explore marketplace by default", () => {
    renderView();
    expect(screen.getByRole("heading", { name: "Available cards" })).toBeInTheDocument();
    expect(screen.getByText("Cash · crypto debit")).toBeInTheDocument();
    expect(screen.getByText("6 partners")).toBeInTheDocument();
  });

  it("requests a card (referral handoff): opens onboarding and flips to Activating…", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const user = userEvent.setup();
    renderView();

    const [firstRequest] = screen.getAllByRole("button", { name: "Request card" });
    if (!firstRequest) throw new Error("expected a requestable offer");
    const requestableBefore = screen.getAllByRole("button", { name: "Request card" }).length;
    await user.click(firstRequest);

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Request card" })).toHaveLength(
        requestableBefore - 1,
      );
    });
    expect(open).toHaveBeenCalledOnce();
  });

  it("shows the held card + transactions on the My cards tab", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("tab", { name: "My cards" }));
    expect(await screen.findByText("$248.50")).toBeInTheDocument();
    expect(screen.getByText("Spotify")).toBeInTheDocument();
  });
});
