/**
 * @id PP-PORT-CMP-003
 * @name AllocationByRisk
 * @implements-rules-version v1
 *
 * A proportional stacked bar of the portfolio's allocation across risk bands, with a legend (risk
 * label + share %). Segment colors come from the risk tokens. Risk labels are reused from the
 * strategies namespace.
 */
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";
import { formatPercent } from "@/lib/utils/format";

/** Risk-level → fill color token. Literal classes so Tailwind generates them. */
const RISK_BG: Record<number, string> = {
  1: "bg-risk-1",
  2: "bg-risk-2",
  3: "bg-risk-3",
  4: "bg-risk-4",
  5: "bg-risk-5",
};

/** The five risk bands, always rendered in the legend (POO-92 R1). */
const RISK_LEVELS = [1, 2, 3, 4, 5] as const;

/** Total value allocated to a given risk band. */
export interface AllocationSegment {
  level: number;
  value: number;
}

/** Public props for {@link AllocationByRisk}. */
export interface AllocationByRiskProps {
  /** Allocation totals per risk band (any order; absent/zero bands render in the legend at 0%). */
  allocation: AllocationSegment[];
  /** Extra classes on the wrapper. */
  className?: string;
}

/** Proportional risk-allocation bar + legend. */
export function AllocationByRisk({ allocation, className }: AllocationByRiskProps) {
  const t = useTranslations("strategies");
  // POO-555 R7: the bar's aria-label is translated copy (it was hardcoded English).
  const tPortfolio = useTranslations("portfolio");
  const riskLabels: Record<number, string> = {
    1: t("risk.level1"),
    2: t("risk.level2"),
    3: t("risk.level3"),
    4: t("risk.level4"),
    5: t("risk.level5"),
  };
  const total = allocation.reduce((sum, segment) => sum + segment.value, 0) || 1;
  const valueByLevel = allocation.reduce<Map<number, number>>(
    (acc, segment) => acc.set(segment.level, (acc.get(segment.level) ?? 0) + segment.value),
    new Map(),
  );
  // All 5 bands, always (POO-92 R1): absent/zero bands stay in the legend at 0%.
  const segments = RISK_LEVELS.map((level) => ({ level, value: valueByLevel.get(level) ?? 0 }));

  return (
    <div className={className}>
      <div
        role="img"
        aria-label={tPortfolio("allocationByRisk")}
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-raised"
      >
        {segments
          .filter((segment) => segment.value > 0)
          .map((segment) => (
            <span
              key={segment.level}
              className={cn("h-full", RISK_BG[segment.level] ?? RISK_BG[3])}
              style={{ width: `${(segment.value / total) * 100}%` }}
            />
          ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((segment) => (
          <li key={segment.level} className="flex items-center gap-1.5 text-xs">
            <span
              className={cn("size-2 rounded-full", RISK_BG[segment.level] ?? RISK_BG[3])}
              aria-hidden="true"
            />
            <span className="text-muted-foreground">{riskLabels[segment.level]}</span>
            <span className="font-medium text-foreground">
              {formatPercent((segment.value / total) * 100)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
