/**
 * @id PP-CARD-SCR-002
 * @name Cards · My cards
 * @implements-rules-version v1
 *
 * The investor's held cards (light slice): the card face with its rechargeable balance, a Top up
 * action, and the transactions feed. Deep management (reveal PAN/CVV, freeze, settings, limit,
 * cancel) is deferred to POO-142 (Card detail). Empty state routes to Explore. Responsive: stacked
 * on mobile, card + actions beside the transactions on desktop.
 */
"use client";

import { CreditCard, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import type { CardTransaction, OwnedCard } from "@/lib/schemas";
import { cardsService } from "@/lib/services";
import { CardTransactions } from "./CardTransactions";
import { TopUpDialog } from "./TopUpDialog";
import { VirtualCard } from "./VirtualCard";

/** Public props for {@link CardsMyCards}. */
export interface CardsMyCardsProps {
  /** The investor's held cards. */
  cards: OwnedCard[];
  /** Transactions for the primary card, newest-first. */
  transactions: CardTransaction[];
  /** Switch to the Explore tab (from "Add card" / the empty state). */
  onExplore: () => void;
}

/** The My cards screen (light slice + Top up). */
export function CardsMyCards({ cards, transactions, onExplore }: CardsMyCardsProps) {
  const t = useTranslations("cards");
  const primary = cards[0];
  // Local state so Top up updates the balance + prepends a credit transaction.
  const [balance, setBalance] = useState(primary?.balanceUsd ?? 0);
  const [txns, setTxns] = useState(transactions);
  const [topUpOpen, setTopUpOpen] = useState(false);

  if (!primary) {
    return (
      <EmptyState
        icon={<CreditCard className="size-7" aria-hidden="true" />}
        title={t("myCards.empty.title")}
        description={t("myCards.empty.body")}
        action={<Button onClick={onExplore}>{t("myCards.empty.cta")}</Button>}
      />
    );
  }

  // `primary` is defined past the early return; capture its id so the async closure keeps it typed.
  const cardId = primary.id;

  async function handleTopUp(amountUsd: number) {
    // PP-INTEGRATION-POINT: rechargeable funding — debits wallet/portfolio, credits the card balance.
    const result = await cardsService.topUp({ cardId, amountUsd, source: "wallet" });
    setBalance(result.newBalanceUsd);
    const credit: CardTransaction = {
      id: `ctx-topup-${result.newBalanceUsd}-${txns.length}`,
      cardId,
      merchant: t("topUp.title"),
      category: t("topUp.source.wallet"),
      tokenSymbol: "USDC",
      tokenAmount: amountUsd,
      usdValueAtTime: amountUsd,
      timestamp: Date.now(),
    };
    setTxns((prev) => [credit, ...prev]);
    setTopUpOpen(false);
  }

  return (
    <>
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-foreground text-lg">{t("myCards.title")}</h2>
          <button
            type="button"
            onClick={onExplore}
            className="inline-flex items-center gap-1 font-medium text-primary text-sm hover:underline"
          >
            <Plus className="size-4" aria-hidden="true" />
            {t("myCards.addCard")}
          </button>
        </div>

        <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,22rem)_1fr] lg:items-start lg:gap-8">
          <div className="flex flex-col gap-4">
            <VirtualCard
              brand={primary.brand}
              network={primary.network}
              brandColor={primary.brandColor}
              maskedPan={primary.maskedPan}
              balanceUsd={balance}
              balanceLabel={t("myCards.balance")}
              footerLabel={t("myCards.debit")}
            />
            <Button className="w-full" size="lg" onClick={() => setTopUpOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {t("myCards.actions.topUp")}
            </Button>
          </div>

          <CardTransactions transactions={txns} />
        </div>
      </div>

      <TopUpDialog open={topUpOpen} onOpenChange={setTopUpOpen} onConfirm={handleTopUp} />
    </>
  );
}
