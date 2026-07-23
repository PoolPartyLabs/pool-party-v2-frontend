import { describe, expect, it } from "vitest";
import { cardOfferSchema, cardTransactionSchema, ownedCardSchema } from "@/lib/schemas";
import { cardOffers, cardTransactions, ownedCards } from "./cards";

describe("cards mock data", () => {
  it("has every card offer pass the CardOffer schema parse", () => {
    for (const offer of cardOffers) {
      expect(() => cardOfferSchema.parse(offer)).not.toThrow();
    }
  });

  it("has every held card pass the OwnedCard schema parse", () => {
    for (const card of ownedCards) {
      expect(() => ownedCardSchema.parse(card)).not.toThrow();
    }
  });

  it("has every card transaction pass the CardTransaction schema parse", () => {
    for (const transaction of cardTransactions) {
      expect(() => cardTransactionSchema.parse(transaction)).not.toThrow();
    }
  });

  it("exposes the six-partner marketplace catalog including Ether.fi", () => {
    expect(cardOffers).toHaveLength(6);
    expect(cardOffers.map((offer) => offer.partnerId)).toContain("ether-fi");
  });

  it("orders card transactions most-recent-first", () => {
    const times = cardTransactions.map((transaction) => transaction.timestamp);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("links every transaction to a held card", () => {
    const cardIds = new Set(ownedCards.map((card) => card.id));
    for (const transaction of cardTransactions) {
      expect(cardIds.has(transaction.cardId)).toBe(true);
    }
  });

  it("has unique ids across offers and transactions", () => {
    const offerIds = cardOffers.map((offer) => offer.partnerId);
    expect(new Set(offerIds).size).toBe(offerIds.length);
    const txIds = cardTransactions.map((transaction) => transaction.id);
    expect(new Set(txIds).size).toBe(txIds.length);
  });
});
