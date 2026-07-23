import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { FeatureFlagBanner } from "@/components/feedback/FeatureFlagBanner";
import { CardsView } from "@/features/cards/CardsView";
import { requireFeature } from "@/lib/features/requireFeature";
import { cardsService, isMockMode } from "@/lib/services";

/**
 * PP-CARD-SCR-001, Cards area (Explore marketplace). Gated by the `cards` flag AND mock mode: off in
 * v1 (404), and real mode 404s regardless of the flag (real mode has no Cards data).
 */
export default async function CardsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Off in v1: deep-links to /cards 404 until the flag is flipped on, and real mode 404s regardless.
  requireFeature("cards");
  // Cards is mock-only: even with the flag on, real mode has no Cards data, so 404 it (matches the nav mockOnly gate, POO-834).
  if (!isMockMode) notFound();
  const [catalog, cards] = await Promise.all([
    cardsService.getCatalog(),
    cardsService.getMyCards(),
  ]);
  const primaryCard = cards[0];
  const transactions = primaryCard ? await cardsService.getTransactions(primaryCard.id) : [];
  return (
    <div className="flex flex-col gap-6">
      {/* TEMP preview banner — every dark-launched area shows one; removed before launch. */}
      <FeatureFlagBanner feature="cards" />
      <CardsView catalog={catalog} cards={cards} transactions={transactions} />
    </div>
  );
}
