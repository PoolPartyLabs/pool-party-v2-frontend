/**
 * @id PP-CARD-SCR-001
 * @name Cards · Explore
 * @implements-rules-version v1
 *
 * The partner card marketplace. Renders the catalog (from the route) as a single-column list on
 * mobile and a three-column grid on desktop. "Request card" is a referral handoff: it calls the
 * service for the partner onboarding URL, optimistically flips the offer to "requested", and opens
 * the partner's onboarding in a new tab. "Manage card" (owned) switches to the My cards tab.
 */
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { CardOffer as CardOfferData } from "@/lib/schemas";
import { cardsService } from "@/lib/services";
import { CardOffer } from "./CardOffer";

/** Public props for {@link CardsExplore}. */
export interface CardsExploreProps {
  /** Partner card catalog (fetched by the route). */
  catalog: CardOfferData[];
  /** Switch to the My cards tab (invoked by an owned offer's "Manage card"). */
  onManage: () => void;
}

/** The Explore marketplace grid. */
export function CardsExplore({ catalog, onManage }: CardsExploreProps) {
  const t = useTranslations("cards");
  // Local copy so "Request card" can optimistically flip an offer to "requested".
  const [offers, setOffers] = useState(catalog);

  async function handleRequest(partnerId: string) {
    // PP-INTEGRATION-POINT: referral handoff — the mock returns the partner onboarding URL; the
    // real flow applies/refers at the partner (KYC + issuance happen there).
    const { onboardingUrl } = await cardsService.requestCard(partnerId);
    setOffers((prev) =>
      prev.map((offer) =>
        offer.partnerId === partnerId
          ? { ...offer, badge: "requested", ctaState: "activating" }
          : offer,
      ),
    );
    if (typeof window !== "undefined") {
      window.open(onboardingUrl, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold text-foreground text-lg">{t("explore.title")}</h2>
        <p className="text-muted-foreground text-sm">
          {t("explore.partnerCount", { count: offers.length })}
        </p>
      </div>
      <ul className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {offers.map((offer) => (
          <li key={offer.partnerId}>
            <CardOffer offer={offer} onRequest={handleRequest} onManage={onManage} />
          </li>
        ))}
      </ul>
    </section>
  );
}
