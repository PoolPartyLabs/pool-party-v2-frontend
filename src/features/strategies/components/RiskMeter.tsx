/**
 * @id PP-STR-CMP-001
 * @name RiskMeter
 * @implements-rules-version v1
 * The brand 5-segment risk meter (1 very conservative … 5 very aggressive). The first `level`
 * segments fill with that level's risk color; the rest stay muted. Decorative bars + an aria-label.
 */
import { cn } from "@/lib/utils/cn";

/** Risk-level → fill color token. Literal classes so Tailwind statically generates them. */
const RISK_FILL: Record<number, string> = {
  1: "bg-risk-1",
  2: "bg-risk-2",
  3: "bg-risk-3",
  4: "bg-risk-4",
  5: "bg-risk-5",
};

/** Public props for {@link RiskMeter}. */
export interface RiskMeterProps {
  /** Risk band 1–5. */
  level: number;
  /** Extra classes on the wrapper. */
  className?: string;
}

/** Five-segment risk indicator. */
export function RiskMeter({ level, className }: RiskMeterProps) {
  const fill = RISK_FILL[level] ?? RISK_FILL[3];
  return (
    <div
      role="img"
      aria-label={`Risk level ${level} of 5`}
      className={cn("flex items-center gap-1", className)}
    >
      {[1, 2, 3, 4, 5].map((segment) => (
        <span
          key={segment}
          className={cn("h-1.5 w-4 rounded-full", segment <= level ? fill : "bg-surface-raised")}
        />
      ))}
    </div>
  );
}
