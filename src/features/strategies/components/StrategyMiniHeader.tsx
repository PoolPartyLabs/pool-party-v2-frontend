/**
 * @id PP-STR-CMP-005
 * @name StrategyMiniHeader
 * @implements-rules-version v1
 *
 * Compact strategy identity used at the top of the transactional sheets (invest / collect /
 * withdraw): a risk-tinted initial avatar, the strategy name + verified badge, and a
 * "risk · est. return" sub-line. Keeps every flow anchored to the strategy it acts on.
 */
import { useTranslations } from "next-intl";
import { StrategyLogo } from "@/components/data-display/StrategyLogo";
import type { Strategy } from "@/lib/schemas";
import { cn } from "@/lib/utils/cn";

/** Risk band → soft avatar tint (bg + text). Literal classes so Tailwind generates them. */
const RISK_TINT: Record<number, string> = {
  1: "bg-risk-1/15 text-risk-1",
  2: "bg-risk-2/15 text-risk-2",
  3: "bg-risk-3/15 text-risk-3",
  4: "bg-risk-4/15 text-risk-4",
  5: "bg-risk-5/15 text-risk-5",
};

/** Public props for {@link StrategyMiniHeader}. */
export interface StrategyMiniHeaderProps {
  /** The strategy to identify. */
  strategy: Strategy;
}

/** Avatar + name + verified badge + "risk · return" sub-line. */
export function StrategyMiniHeader({ strategy }: StrategyMiniHeaderProps) {
  const t = useTranslations("strategies");
  const riskLabels: Record<number, string> = {
    1: t("risk.level1"),
    2: t("risk.level2"),
    3: t("risk.level3"),
    4: t("risk.level4"),
    5: t("risk.level5"),
  };
  const tint = RISK_TINT[strategy.riskLevel] ?? RISK_TINT[3];

  return (
    <div className="flex items-center gap-3 text-left">
      {/* POO-846 R2: show the strategy PHOTO like the detail hero (POO-740) via the shared
          StrategyLogo; the risk-tinted initials monogram stays as the no-image fallback. Covers
          every mini-header consumer (invest / collect / withdraw) at once. */}
      <StrategyLogo
        url={strategy.logoUrl}
        name={strategy.name}
        // font-semibold keeps the fallback monogram at the header's original weight (matches the
        // detail hero, POO-740); tint is the risk-band bg+text for the no-image case.
        className={cn("size-10 font-semibold text-sm", tint)}
      />
      <div className="min-w-0">
        {/* POO-280 R4 / Product Rules 11: the verified badge belongs next to the MANAGER name
            only — never next to a strategy name. This header has no manager name, so no badge. */}
        <p className="font-semibold text-foreground">
          <span className="block truncate">{strategy.name}</span>
        </p>
        <p className="text-muted-foreground text-sm">{riskLabels[strategy.riskLevel]}</p>
      </div>
    </div>
  );
}
