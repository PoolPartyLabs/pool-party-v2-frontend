/**
 * @id PP-CARD-SCR-001
 * @name CardsView
 * @implements-rules-version v1
 *
 * The Cards area shell: a segmented Explore / My cards toggle. Explore (PP-CARD-SCR-001) is the
 * partner card marketplace; My cards (PP-CARD-SCR-002) is the held-card view + Top up. Deep card
 * management (reveal PAN, freeze, settings, limit, cancel) is deferred to POO-142 (Card detail).
 * The whole area is gated by the `cards` flag at the route (off in v1 → /cards 404s, nav tab hidden).
 */
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import type { CardOffer, CardTransaction, OwnedCard } from "@/lib/schemas";
import { CardsExplore } from "./components/CardsExplore";
import { CardsMyCards } from "./components/CardsMyCards";

/** The two Cards sub-views. */
type CardsTab = "explore" | "myCards";

/** Public props for {@link CardsView}. */
export interface CardsViewProps {
  /** Partner card catalog (fetched by the route). */
  catalog: CardOffer[];
  /** The investor's held cards (fetched by the route). */
  cards: OwnedCard[];
  /** Transactions for the primary held card, newest-first. */
  transactions: CardTransaction[];
}

/** The Cards area (Explore marketplace + My cards). */
export function CardsView({ catalog, cards, transactions }: CardsViewProps) {
  const t = useTranslations("cards");
  const [tab, setTab] = useState<CardsTab>("explore");

  return (
    <div className="flex flex-col gap-6">
      {/* Desktop page header (the design's "Cards" + tagline). */}
      <header className="hidden lg:block">
        <h1 className="font-bold text-2xl text-foreground">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{t("explore.subtitle")}</p>
      </header>
      {/* Mobile keeps an accessible h1 without the visible page header (matches the design). */}
      <h1 className="sr-only lg:hidden">{t("title")}</h1>

      <Tabs value={tab} onValueChange={(value) => setTab(value as CardsTab)}>
        <TabsList>
          <TabsTrigger value="explore">{t("tabs.explore")}</TabsTrigger>
          <TabsTrigger value="myCards">{t("tabs.myCards")}</TabsTrigger>
        </TabsList>

        <TabsContent value="explore">
          <CardsExplore catalog={catalog} onManage={() => setTab("myCards")} />
        </TabsContent>

        <TabsContent value="myCards">
          <CardsMyCards
            cards={cards}
            transactions={transactions}
            onExplore={() => setTab("explore")}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
