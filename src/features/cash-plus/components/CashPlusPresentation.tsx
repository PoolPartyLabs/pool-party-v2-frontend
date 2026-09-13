/** @id PP-CP-CMP-001 @name Cash+ presentation primitives @implements-rules-version v1 */
import type { ReactNode } from "react";
import { formatUnits } from "viem";
import { MaskableValue } from "@/components/data-display/MaskableValue";
import { cn } from "@/lib/utils/cn";
import { formatSignedUsd, formatUsd, formatUsdTile } from "@/lib/utils/format";

/** Converts exact base units only at the display boundary. No output returns to transaction code. */
export function cashPlusMoney(
  value: bigint | null | undefined,
  unavailable: string,
  signed = false,
  compact = false,
): string {
  if (value === null || value === undefined) return unavailable;
  const decimal = formatUnits(value, 6);
  const display = Number(decimal);
  if (!Number.isFinite(display)) return unavailable;
  if (value !== BigInt("0") && value > -BigInt("10000") && value < BigInt("10000"))
    return `${value < BigInt("0") ? "-" : signed ? "+" : ""}$${decimal.replace("-", "")}`;
  return signed ? formatSignedUsd(display) : compact ? formatUsdTile(display) : formatUsd(display);
}

/** Reusable label/value row with optional investor privacy masking. */
export function CashPlusRow({
  label,
  children,
  personal = false,
  className,
}: {
  /** Localized label. */ label: string;
  /** Rendered display value. */ children: ReactNode;
  /** Respect the shared investor privacy choice. */ personal?: boolean;
  /** Additional container styling. */ className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 text-sm", className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right font-medium tabular-nums">
        {personal ? <MaskableValue>{children}</MaskableValue> : children}
      </span>
    </div>
  );
}
