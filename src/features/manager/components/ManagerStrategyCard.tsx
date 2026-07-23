/**
 * @id PP-MGR-CMP-015
 * @name ManagerStrategyCard
 * @implements-rules-version v2
 *
 * One strategy on the Manage-strategies list (PP-MGR-SCR-003): identity (avatar + name + status +
 * auto-derived risk·category), the out-of-range "Rebalance suggested" alert, the KPI row
 * (AUM / investors / net APY / the manager's 30d fees) with a 30d sparkline, and the manage action.
 *
 * POO-753 R2: a CLOSED strategy opens a READ-ONLY detail, so its card is fully clickable and its
 * action reads "View" (not "Manage"). The whole-card click is a mouse-only hit-area enlargement; the
 * card onClick IGNORES clicks that land on an interactive descendant (the "View" button, the APY
 * tooltip trigger) so those controls act normally and a card click never double-fires or hijacks them.
 * Keyboard users reach the action via the focusable button. Active/paused cards are unchanged.
 */
"use client";

import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import type { MouseEvent } from "react";
import { MaskableValue } from "@/components/data-display/MaskableValue";
import { StrategyLogo } from "@/components/data-display/StrategyLogo";
import { AprTooltip } from "@/components/ui/AprTooltip";
import { Button } from "@/components/ui/Button";
import type { ManagerStrategy } from "@/lib/schemas";
import { cn } from "@/lib/utils/cn";
import { formatPercent, formatUsd } from "@/lib/utils/format";
import { Sparkline } from "./Sparkline";
import { StrategyStatusChip } from "./StrategyStatusChip";

/** i18n keys for the auto-derived risk levels (1–5), reused from the builder. */
const RISK_KEYS = [
  "mandate.risk.veryConservative",
  "mandate.risk.conservative",
  "mandate.risk.moderate",
  "mandate.risk.aggressive",
  "mandate.risk.veryAggressive",
] as const;

/** Public props for {@link ManagerStrategyCard}. */
export interface ManagerStrategyCardProps {
  /** The strategy row to render. */
  strategy: ManagerStrategy;
  /** Opens the manage detail for this strategy. */
  onManage: (strategyId: string) => void;
}

/** One manageable strategy card. */
export function ManagerStrategyCard({ strategy, onManage }: ManagerStrategyCardProps) {
  const t = useTranslations("manager");
  const riskLabel = t(RISK_KEYS[strategy.riskLevel - 1] ?? RISK_KEYS[2]);
  const showRebalance = strategy.status === "active" && !strategy.inRange;
  // POO-753 R2: a closed strategy opens read-only; make its whole card a click target + label "View".
  const isClosed = strategy.status === "closed";
  const open = () => onManage(strategy.id);
  // Ignore clicks that land on an interactive descendant (the "View" button, the APY tooltip trigger):
  // those own their own click, so a whole-card navigation must not fire on top of them.
  const handleCardClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button, a, [role='button']")) return;
    open();
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the "View" button inside is the real, keyboard-focusable control; this card onClick only enlarges the mouse hit area for a closed strategy.
    <article
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-border bg-surface p-4",
        isClosed && "cursor-pointer transition-colors hover:border-input",
      )}
      onClick={isClosed ? handleCardClick : undefined}
    >
      <div className="flex items-start gap-3">
        <StrategyLogo
          url={strategy.logoUrl}
          name={strategy.name}
          initials={strategy.initials}
          className="size-10 text-sm"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-foreground">{strategy.name}</h3>
            <StrategyStatusChip status={strategy.status} />
          </div>
          <p className="truncate text-muted-foreground text-xs">
            {riskLabel} · {strategy.category}
          </p>
          {showRebalance ? (
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 font-medium text-warning text-xs">
              <TriangleAlert className="size-3" aria-hidden="true" />
              {t("strategies.rebalance")}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex items-end justify-between gap-3">
        <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <div className="flex flex-col">
            <dt className="text-muted-foreground text-xs">{t("strategies.card.aum")}</dt>
            <dd className="font-medium text-foreground text-sm">
              <MaskableValue>{formatUsd(strategy.aum)}</MaskableValue>
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-muted-foreground text-xs">{t("strategies.card.investors")}</dt>
            <dd className="font-medium text-foreground text-sm">
              {strategy.investors.toLocaleString("en-US")}
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-muted-foreground text-xs">
              <AprTooltip net>{t("strategies.card.netApy")}</AprTooltip>
            </dt>
            <dd className="font-medium text-foreground text-sm">{formatPercent(strategy.apy)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-muted-foreground text-xs">{t("strategies.card.fees30d")}</dt>
            {/* POO-559 R4: the manager 30d-fee figure has no windowable source yet (PP-MOCK, POO-369);
                a $0 placeholder renders as a neutral dash so it never reads as a measured "$0.00". The
                dash mirrors the pool-TVL zero/missing convention (formatPoolTvl, POO-390 R5). */}
            <dd className="font-medium text-foreground text-sm">
              {strategy.fees30d ? formatUsd(strategy.fees30d) : "-"}
            </dd>
          </div>
        </dl>
        {/* POO-559 R2: only a real measured series is drawn. An uncovered / <2-point pool carries a
            not-measured flat placeholder, so the spark is hidden rather than presented as a real
            zero-movement 30d trend. `sparkMeasured` absent (mock rows) counts as measured. */}
        {strategy.sparkMeasured !== false ? (
          <Sparkline data={strategy.spark} className="hidden sm:block" />
        ) : null}
      </div>

      <Button variant="secondary" size="sm" onClick={open}>
        {isClosed ? t("strategies.card.view") : t("strategies.card.manage")}
      </Button>
    </article>
  );
}
