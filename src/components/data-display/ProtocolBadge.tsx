/**
 * @id PP-CORE-CMP-030
 * @name ProtocolBadge
 * @implements-rules-version v1
 *
 * The DEX protocol a strategy runs on, shown as a brand logo + label. V1 is Uniswap v3 (the only
 * protocol), so the label is a brand literal (not translated), matching the strategy-detail chip.
 * The logo is decorative (aria-hidden); the text carries the meaning.
 */
import { cn } from "@/lib/utils/cn";

/** Public props for {@link ProtocolBadge}. */
export interface ProtocolBadgeProps {
  /** Extra classes on the wrapper. */
  className?: string;
  /** Logo edge size in px. Defaults to 16. */
  size?: number;
}

/** A small protocol logo + name (V1: Uniswap v3). */
export function ProtocolBadge({ className, size = 16 }: ProtocolBadgeProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {/* Decorative; the "Uniswap v3" text carries the meaning. */}
      <img
        src="/protocols/uniswap.svg"
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        className="shrink-0"
      />
      <span>Uniswap v3</span>
    </span>
  );
}
