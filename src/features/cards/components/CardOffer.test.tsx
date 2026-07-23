/**
 * @id PP-CARD-CMP-001
 * @name CardOffer.test
 * Behavior: the badge + CTA follow the offer state, and request/manage fire the right callbacks.
 */
import { describe, expect, it, vi } from "vitest";
import type { CardOffer as CardOfferData } from "@/lib/schemas";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { CardOffer } from "./CardOffer";

const baseOffer: CardOfferData = {
  partnerId: "metamask",
  name: "MetaMask",
  subtitle: "Crypto Mastercard",
  network: "mastercard",
  brandColor: "#E8833A",
  perks: [
    "explore.perks.spendMetamask",
    "explore.perks.cryptoRewards",
    "explore.perks.globalMastercard",
  ],
  badge: "popular",
  ctaState: "request",
};

describe("CardOffer", () => {
  it("renders a requestable offer and fires onRequest with the partner id", async () => {
    const onRequest = vi.fn();
    const onManage = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<CardOffer offer={baseOffer} onRequest={onRequest} onManage={onManage} />);

    expect(screen.getByText("Popular")).toBeInTheDocument();
    // Perks are i18n keys resolved via t(): the en provider renders the translated copy.
    expect(screen.getByText("Spend from MetaMask balance")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Request card" }));
    expect(onRequest).toHaveBeenCalledWith("metamask");
    expect(onManage).not.toHaveBeenCalled();
  });

  it("renders an owned offer with Manage card that calls onManage", async () => {
    const onManage = vi.fn();
    const user = userEvent.setup();
    const owned: CardOfferData = { ...baseOffer, badge: "active", ctaState: "manage" };
    renderWithProviders(<CardOffer offer={owned} onRequest={vi.fn()} onManage={onManage} />);

    expect(screen.getByText("Active")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Manage card" }));
    expect(onManage).toHaveBeenCalledOnce();
  });

  it("disables the CTA for a requested (activating) offer", () => {
    const requested: CardOfferData = { ...baseOffer, badge: "requested", ctaState: "activating" };
    renderWithProviders(<CardOffer offer={requested} onRequest={vi.fn()} onManage={vi.fn()} />);

    expect(screen.getByText("Requested")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activating…" })).toBeDisabled();
  });
});
