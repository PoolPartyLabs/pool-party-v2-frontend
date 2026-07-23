/**
 * @id PP-STR-CMP-001
 * @name StrategyCard (Investment Card)
 * @implements-rules-version v1
 *
 * The risk-themed strategy card used in discovery surfaces (Home carousel, Strategies list). Shows
 * the name, manager + verified badge (info blue), the manager's description as a subtitle when set
 * (POO-235, clamped to two lines), risk meter + label, minimum, and estimated return with its
 * APR/APY unit tag. Whole footer offers "View details" + a gold "Invest" — both route to the
 * strategy detail (the invest flow opens there). Token-driven; safe to server-render.
 *
 * POO-771 R6: the verified badge is gated on `strategy.managerVerified` (backend-derived, embedded via
 * POO-758) — the single badge source across investor surfaces, so an unverified manager never shows a
 * false badge and a verified one shows it in real mode too (superseding the old detail-gated check).
 */
import { BadgeCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { StrategyLogo } from "@/components/data-display/StrategyLogo";
import { AprTooltip } from "@/components/ui/AprTooltip";
import { ManagerLink } from "@/features/manager/components/ManagerLink";
import { Link } from "@/i18n/navigation";
import type { Strategy } from "@/lib/schemas";
import { cn } from "@/lib/utils/cn";
import { formatPercent, formatUsd } from "@/lib/utils/format";
import { RiskMeter } from "./RiskMeter";

/** Risk-level → top accent-bar color. Literal classes so Tailwind generates them. */
const RISK_ACCENT: Record<number, string> = {
  1: "bg-risk-1",
  2: "bg-risk-2",
  3: "bg-risk-3",
  4: "bg-risk-4",
  5: "bg-risk-5",
};

/** Public props for {@link StrategyCard}. */
export interface StrategyCardProps {
  /** The strategy to render. */
  strategy: Strategy;
  /** Extra classes on the card. */
  className?: string;
}

/** A single strategy discovery card. */
export function StrategyCard({ strategy, className }: StrategyCardProps) {
  const t = useTranslations("strategies");
  // Literal t() calls (not dynamic keys) so the i18n used-key scan resolves every risk label.
  const riskLabels: Record<number, string> = {
    1: t("risk.level1"),
    2: t("risk.level2"),
    3: t("risk.level3"),
    4: t("risk.level4"),
    5: t("risk.level5"),
  };
  const href = `/strategies/${strategy.id}`;
  const accent = RISK_ACCENT[strategy.riskLevel] ?? RISK_ACCENT[3];

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-border bg-surface",
        className,
      )}
    >
      <span className={cn("h-1 w-full", accent)} aria-hidden="true" />
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="flex items-start gap-3">
          {/* POO-713: the manager-uploaded strategy logo, with an initials monogram fallback. */}
          <StrategyLogo
            url={strategy.logoUrl}
            name={strategy.name}
            className="size-10 shrink-0 text-sm"
          />
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-base text-foreground">{strategy.name}</h3>
            <p className="mt-0.5 flex items-center gap-1 text-muted-foreground text-sm">
              <ManagerLink
                handle={strategy.managerHandle}
                address={strategy.managerAddress}
                className="truncate"
              >
                {t("card.by", { manager: strategy.manager })}
              </ManagerLink>
              {/* POO-771 R6: gate the verified badge on the backend-derived `managerVerified` (the
                  single badge source, embedded via POO-758), replacing the old prospectus-gated
                  `detail?.managerVerified` so the badge renders in real mode too. An unverified
                  manager (e.g. the dev manager on strat-delta-neutral) still shows no badge. */}
              {strategy.managerVerified === true ? (
                <BadgeCheck
                  className="size-4 shrink-0 text-info"
                  aria-label={t("detail.managerVerified")}
                />
              ) : null}
            </p>
            {/* POO-235 [R3]: the manager's description as a subtitle (optional, clamped to 2 lines). */}
            {strategy.description ? (
              <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
                {strategy.description}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <RiskMeter level={strategy.riskLevel} />
          <span className="text-muted-foreground text-xs">{riskLabels[strategy.riskLevel]}</span>
        </div>

        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-muted-foreground text-xs">{t("card.min")}</p>
            <p className="font-medium text-foreground text-sm">
              {formatUsd(strategy.minInvestment)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-muted-foreground text-xs">{t("card.estReturn")}</p>
            <p className="font-semibold text-success">
              {formatPercent(strategy.estReturn)}{" "}
              <AprTooltip className="font-normal text-[10px] text-muted-foreground uppercase">
                {strategy.rateType}
              </AprTooltip>
            </p>
          </div>
        </div>

        <div className="mt-auto flex items-center gap-2 pt-1">
          <Link
            href={href}
            className="flex-1 rounded-md border border-border px-3 py-2 text-center font-medium text-foreground text-sm transition-colors hover:bg-surface-raised"
          >
            {t("card.viewDetails")}
          </Link>
          <Link
            href={href}
            className="flex-1 rounded-md bg-primary px-3 py-2 text-center font-semibold text-primary-foreground text-sm transition-colors hover:bg-primary/90"
          >
            {t("card.invest")}
          </Link>
        </div>
      </div>
    </div>
  );
}
