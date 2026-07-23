/**
 * @id PP-MGR-CMP-016
 * @name RangeCard
 * @implements-rules-version v1
 *
 * The manage-detail price-range card for the strategy's single Uniswap v3 pool: min / current / max
 * with a band visualization and the in-range (earning) vs out-of-range (not earning) state. The
 * Move Range action lives in the Operations rail as a regular button (POO-286 R2) — this card is
 * read-only.
 */
"use client";

import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { MaskableValue } from "@/components/data-display/MaskableValue";
import { CollapsibleCard } from "@/components/ui/CollapsibleCard";
import type { ManagerStrategyDetail } from "@/lib/schemas";
import { cn } from "@/lib/utils/cn";

/** Formats a pool price for the range labels (4 significant digits, grouped). */
function formatPrice(value: number): string {
  return value.toLocaleString("en-US", { maximumSignificantDigits: 5 });
}

/** Public props for {@link RangeCard}. */
export interface RangeCardProps {
  /** The strategy detail (range + pool + inRange). */
  detail: ManagerStrategyDetail;
}

/** The price-range card. */
export function RangeCard({ detail }: RangeCardProps) {
  const t = useTranslations("manager");
  const { range, inRange } = detail;
  // Marker position inside a domain padded 10% beyond the band so out-of-range prices stay visible.
  const min = range.full ? range.currentPrice * 0.5 : (range.minPrice ?? 0);
  const max = range.full ? range.currentPrice * 1.5 : (range.maxPrice ?? min + 1);
  const pad = (max - min) * 0.1;
  const domainMin = min - pad;
  const domainMax = max + pad;
  const toPct = (value: number) =>
    Math.min(100, Math.max(0, ((value - domainMin) / (domainMax - domainMin)) * 100));
  const statusChip = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs",
        inRange ? "bg-success/10 text-success" : "bg-warning/10 text-warning",
      )}
    >
      {inRange ? t("operate.inRange") : t("operate.outOfRange")}
      {" · "}
      {inRange ? t("manage.range.earning") : t("manage.range.notEarning")}
    </span>
  );
  // The range band (track segment + current-price needle). POO-434 R4: it doubles as the collapsed
  // preview (`peek`), so a collapsed Range card still shows the bar — just without the min/current/max
  // numbers below.
  const band = (
    <div className="relative h-2 rounded-full bg-surface-raised" aria-hidden="true">
      <div
        className={cn("absolute h-2 rounded-full", inRange ? "bg-success/40" : "bg-warning/30")}
        style={{ left: `${toPct(min)}%`, width: `${toPct(max) - toPct(min)}%` }}
      />
      <div
        className="-translate-x-1/2 absolute top-[-3px] h-3.5 w-0.5 rounded-full bg-foreground"
        style={{ left: `${toPct(range.currentPrice)}%` }}
      />
    </div>
  );

  return (
    <CollapsibleCard title={t("operate.range")} aside={statusChip} peek={band}>
      {band}

      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div className="flex flex-col">
          <dt className="text-muted-foreground text-xs">{t("manage.range.min")}</dt>
          <dd className="font-medium text-foreground">
            <MaskableValue>{range.full ? t("manage.range.full") : formatPrice(min)}</MaskableValue>
          </dd>
        </div>
        <div className="flex flex-col items-center">
          <dt className="text-muted-foreground text-xs">{t("operate.currentPrice")}</dt>
          <dd className="font-medium text-foreground">{formatPrice(range.currentPrice)}</dd>
        </div>
        <div className="flex flex-col items-end">
          <dt className="text-muted-foreground text-xs">{t("manage.range.max")}</dt>
          <dd className="font-medium text-foreground">
            <MaskableValue>{range.full ? t("manage.range.full") : formatPrice(max)}</MaskableValue>
          </dd>
        </div>
      </dl>

      {!inRange ? (
        <p className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-warning text-xs">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {t("manage.range.outNote")}
        </p>
      ) : null}
    </CollapsibleCard>
  );
}
