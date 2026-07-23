/**
 * @id PP-CARD-CMP-003
 * @name Card Transactions
 * @implements-rules-version v1
 *
 * The held card's activity feed (My cards). Groups transactions by day (newest day = "Today", the
 * day before = "Yesterday", older = a formatted date — computed relative to the newest transaction
 * so it's deterministic and SSR-safe) and follows the transaction-display rule: each row shows the
 * per-token amount plus the USD value at the moment of the transaction. Credits render green.
 */
import { useTranslations } from "next-intl";
import type { CardTransaction } from "@/lib/schemas";
import { cn } from "@/lib/utils/cn";
import { formatTokenAmount, formatUsd } from "@/lib/utils/format";

const DAY_MS = 86_400_000;

/** Midnight (UTC) for a timestamp — UTC keeps grouping identical on server + client. */
function startOfUtcDay(timestamp: number): number {
  const d = new Date(timestamp);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** `HH:mm` in UTC (deterministic across timezones). */
function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

/** `Jun 1` in UTC. */
function formatDay(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

interface DayGroup {
  key: number;
  label: string;
  items: CardTransaction[];
}

/** Group a newest-first list by UTC day, labelling relative to the newest entry. */
function groupByDay(
  transactions: CardTransaction[],
  labels: { today: string; yesterday: string },
): DayGroup[] {
  const [newest] = transactions;
  if (!newest) return [];
  const referenceDay = startOfUtcDay(newest.timestamp);
  const groups: DayGroup[] = [];
  let current: DayGroup | null = null;
  for (const transaction of transactions) {
    const day = startOfUtcDay(transaction.timestamp);
    if (!current || current.key !== day) {
      const diff = Math.round((referenceDay - day) / DAY_MS);
      const label: string =
        diff <= 0 ? labels.today : diff === 1 ? labels.yesterday : formatDay(day);
      current = { key: day, label, items: [] };
      groups.push(current);
    }
    current.items.push(transaction);
  }
  return groups;
}

/** A single transaction row: avatar + merchant/meta + per-token amount and USD-at-time. */
function TransactionRow({ transaction }: { transaction: CardTransaction }) {
  const credit = transaction.tokenAmount > 0;
  const unitPrice = transaction.usdValueAtTime / Math.abs(transaction.tokenAmount);
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-raised font-semibold text-foreground text-sm"
        >
          {transaction.merchant.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground text-sm">{transaction.merchant}</p>
          <p className="truncate text-muted-foreground text-xs">
            {transaction.category} · {formatTime(transaction.timestamp)}
          </p>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p
          className={cn(
            "font-semibold text-sm tabular-nums",
            credit ? "text-success" : "text-foreground",
          )}
        >
          {credit ? "+" : ""}
          {formatTokenAmount(transaction.tokenAmount, transaction.tokenSymbol, 2)}
        </p>
        <p className="text-muted-foreground text-xs tabular-nums">
          {formatUsd(transaction.usdValueAtTime)} @ {formatUsd(unitPrice)}
        </p>
      </div>
    </li>
  );
}

/** Public props for {@link CardTransactions}. */
export interface CardTransactionsProps {
  /** The card's transactions, newest-first. */
  transactions: CardTransaction[];
}

/** The held card's grouped activity feed. */
export function CardTransactions({ transactions }: CardTransactionsProps) {
  const t = useTranslations("cards");
  const groups = groupByDay(transactions, {
    today: t("myCards.transactions.today"),
    yesterday: t("myCards.transactions.yesterday"),
  });

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-border border-b px-4 py-3">
        <h3 className="font-semibold text-foreground">{t("myCards.transactions.title")}</h3>
      </div>
      {groups.map((group) => (
        <div key={group.key}>
          <p className="bg-surface px-4 pt-3 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {group.label}
          </p>
          <ul className="divide-y divide-border">
            {group.items.map((transaction) => (
              <TransactionRow key={transaction.id} transaction={transaction} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
