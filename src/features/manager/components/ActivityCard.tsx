/**
 * @id PP-MGR-CMP-018
 * @name ActivityCard
 * @implements-rules-version v1
 *
 * The manage-detail "Recent activity" card: the strategy's latest investor flows (deposit /
 * withdraw) and manager actions (collect / compound / move range), each with the per-token amount
 * plus its USD value at the moment of the event (price-at-time rule) and the event date.
 */
"use client";

import { ArrowDownLeft, ArrowUpRight, Coins, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { CollapsibleCard } from "@/components/ui/CollapsibleCard";
import type { ManagerActivityEvent } from "@/lib/schemas";
import { formatTokenAmount, formatUsd } from "@/lib/utils/format";

/** Icon per event type. */
const EVENT_ICONS: Record<ManagerActivityEvent["type"], typeof Coins> = {
  deposit: ArrowDownLeft,
  withdraw: ArrowUpRight,
  collect: Coins,
  compound: RefreshCw,
  move_range: SlidersHorizontal,
};

/** Public props for {@link ActivityCard}. */
export interface ActivityCardProps {
  /** Latest events, newest first. */
  activity: ManagerActivityEvent[];
  /**
   * When set, the body shows a "coming soon" placeholder instead of the list/empty state. The parent
   * passes this in real mode, where there is no activity feed yet (POO-380); mock mode keeps rendering
   * the fixture events. (POO-737 R2)
   */
  comingSoon?: boolean;
}

/** The recent-activity card. */
export function ActivityCard({ activity, comingSoon = false }: ActivityCardProps) {
  const t = useTranslations("manager");
  const locale = useLocale();
  const dateFormat = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  // Literal t() calls (the i18n usage scan is static — no dynamic keys).
  const typeLabels: Record<ManagerActivityEvent["type"], string> = {
    deposit: t("manage.activity.types.deposit"),
    withdraw: t("manage.activity.types.withdraw"),
    collect: t("manage.activity.types.collect"),
    compound: t("manage.activity.types.compound"),
    move_range: t("manage.activity.types.move_range"),
  };
  return (
    <CollapsibleCard title={t("manage.activity.title")}>
      {/* POO-737 R2: real mode has no activity feed yet (POO-380), so the parent flags comingSoon and
          the body shows a placeholder instead of the list or the "No activity yet." empty state. */}
      {comingSoon ? (
        <p className="text-muted-foreground text-sm">{t("manage.activity.comingSoon")}</p>
      ) : activity.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("manage.activity.empty")}</p>
      ) : (
        <ul className="flex flex-col">
          {activity.map((event) => {
            const Icon = EVENT_ICONS[event.type];
            return (
              <li
                key={event.id}
                className="flex items-center gap-3 border-border border-b py-3 last:border-b-0 last:pb-0 first:pt-0"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-raised text-muted-foreground">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium text-foreground text-sm">
                    {typeLabels[event.type]}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {dateFormat.format(new Date(event.timestamp))}
                  </span>
                </div>
                <div className="flex flex-col items-end">
                  {event.tokenAmount !== undefined && event.tokenSymbol ? (
                    <span className="font-medium text-foreground text-sm">
                      {formatTokenAmount(event.tokenAmount, event.tokenSymbol)}
                    </span>
                  ) : null}
                  {event.usdValueAtTime > 0 ? (
                    <span className="text-muted-foreground text-xs">
                      {formatUsd(event.usdValueAtTime)}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </CollapsibleCard>
  );
}
