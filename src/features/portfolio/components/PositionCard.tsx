/**
 * @id PP-PORT-CMP-002
 * @name PositionCard
 * @implements-rules-version v3
 *
 * The canonical portfolio position card. Risk-themed accent, manager + verified badge and a status
 * pill (Active / Paused / Closed), then a metric grid (Invested / Total yield / Current value /
 * Rate). The whole card is tappable → the owned strategy detail (via PositionLink, which records
 * `position_detail_viewed`); it has no gold CTA (growth-first; withdrawal is never promoted here —
 * the closed detail screen owns the Withdraw action).
 *
 * POO-647 (rules v1): dropped the redundant green "Available to withdraw" pill from closed cards —
 * the card taps through to the owned detail, which owns the Withdraw action [R1][R4].
 * POO-653 (rules v1): a closed card shows no rate — the Rate/Final-APY metric is dropped (the rate
 * is stale/uninformative), leaving Invested / Total yield / Current value [R1].
 */
import { BadgeCheck, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { MaskableValue } from "@/components/data-display/MaskableValue";
import { StrategyLogo } from "@/components/data-display/StrategyLogo";
import { AprTooltip } from "@/components/ui/AprTooltip";
import { ManagerLink } from "@/features/manager/components/ManagerLink";
import { RiskMeter } from "@/features/strategies/components/RiskMeter";
import type { Position, Strategy } from "@/lib/schemas";
import { cn } from "@/lib/utils/cn";
import { formatPercent, formatSignedUsd, formatUsd } from "@/lib/utils/format";
import { PositionLink } from "./PositionLink";

/** Risk-level → top accent-bar color. Literal classes so Tailwind generates them. */
const RISK_ACCENT: Record<number, string> = {
  1: "bg-risk-1",
  2: "bg-risk-2",
  3: "bg-risk-3",
  4: "bg-risk-4",
  5: "bg-risk-5",
};

/** One label/value cell in the metric grid. */
function Metric({
  label,
  value,
  valueClass,
}: {
  label: ReactNode;
  value: ReactNode;
  valueClass?: string;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={cn("mt-0.5 font-medium text-foreground text-sm", valueClass)}>{value}</p>
    </div>
  );
}

/** Public props for {@link PositionCard}. */
export interface PositionCardProps {
  /** The investor's position. */
  position: Position;
  /** The strategy the position belongs to (for name / manager / risk / rate). */
  strategy: Strategy;
  /** Extra classes on the card. */
  className?: string;
}

/** A single owned-position card. */
export function PositionCard({ position, strategy, className }: PositionCardProps) {
  const t = useTranslations("portfolio");
  const ts = useTranslations("strategies");
  const accent = RISK_ACCENT[strategy.riskLevel] ?? RISK_ACCENT[3];
  const yieldTone = position.totalYield < 0 ? "text-destructive" : "text-success";
  const isPaused = position.status === "paused";
  const isClosed = position.status === "closed";
  const statusLabel = isClosed
    ? t("status.closed")
    : isPaused
      ? t("status.paused")
      : t("status.active");

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:bg-surface-raised",
        className,
      )}
    >
      <span className={cn("block h-1 w-full", accent)} aria-hidden="true" />
      {/* Content sits beneath the stretched position link; only the manager name re-enables pointer
          events (below) so it links to the manager profile instead of opening the position. */}
      <div className="pointer-events-none p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {/* POO-724: strategy logo with an initials monogram fallback (parity with Home + the
                desktop Portfolio table); real data via the v2 holdings catalog (POO-721). */}
            <StrategyLogo
              url={strategy.logoUrl}
              name={strategy.name}
              className="size-10 shrink-0 text-sm"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate font-semibold text-foreground">{strategy.name}</p>
                {/* "Owned" when the investor manages this strategy (PP-INTEGRATION-POINT:
                    position.isPoolManager) — consistent with Home and the Strategies list. */}
                {position.isPoolManager ? (
                  <span className="shrink-0 rounded-full px-2 py-0.5 font-medium text-primary text-xs ring-1 ring-primary/60 ring-inset">
                    {ts("explore.owned")}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 flex items-center gap-1 text-muted-foreground text-sm">
                <ManagerLink
                  handle={strategy.managerHandle}
                  address={strategy.managerAddress}
                  className="pointer-events-auto relative z-10 truncate"
                >
                  {strategy.manager}
                </ManagerLink>
                {/* POO-771 R6: gate the badge on the backend-derived `managerVerified` (the single
                    badge source, embedded via POO-758), matching the sibling StrategyCard — so a
                    verified manager's badge renders in real mode, not only in mock. */}
                {strategy.managerVerified === true ? (
                  <BadgeCheck
                    className="size-4 shrink-0 text-info"
                    aria-label={ts("detail.managerVerified")}
                  />
                ) : null}
              </p>
            </div>
          </div>
          <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <RiskMeter level={strategy.riskLevel} />
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
              isPaused || isClosed
                ? "bg-surface-raised text-muted-foreground"
                : "bg-success/10 text-success",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                isPaused || isClosed ? "bg-muted-foreground" : "bg-success",
              )}
              aria-hidden="true"
            />
            {statusLabel}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          <Metric
            label={t("invested")}
            value={<MaskableValue>{formatUsd(position.invested)}</MaskableValue>}
          />
          <Metric
            label={t("totalYield")}
            value={formatSignedUsd(position.totalYield)}
            valueClass={yieldTone}
          />
          <Metric
            label={t("currentValue")}
            value={<MaskableValue>{formatUsd(position.currentValue)}</MaskableValue>}
          />
          {/* POO-653 [R1]: a closed position shows no rate (stale/uninformative), so the rate metric
              is dropped for a closed card — it falls back to Invested / Total yield / Current value.
              Active/paused cards keep the Rate metric. */}
          {isClosed ? null : (
            <Metric
              // POO-840 R3: the card body is pointer-events-none (the stretched link owns the
              // tap), which also made these tooltip triggers dead despite their cursor-help
              // affordance — the tap fell through to navigation. Re-enable pointer events on the
              // triggers above the z-0 overlay link (the ManagerLink precedent).
              label={
                <AprTooltip className="pointer-events-auto relative z-10">{t("rate")}</AprTooltip>
              }
              value={
                <>
                  {formatPercent(strategy.estReturn)}{" "}
                  <AprTooltip className="pointer-events-auto relative z-10 font-normal text-[10px] text-muted-foreground uppercase">
                    {strategy.rateType}
                  </AprTooltip>
                </>
              }
            />
          )}
        </div>
      </div>
      {/* Stretched overlay link: the whole card opens the position. Sibling to the manager link
          (never nested), so the manager name's own navigation wins. */}
      <PositionLink
        positionId={position.id}
        strategyId={strategy.id}
        from="portfolio"
        className="absolute inset-0 z-0"
        ariaLabel={strategy.name}
      />
    </div>
  );
}
