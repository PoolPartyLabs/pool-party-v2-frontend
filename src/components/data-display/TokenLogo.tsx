/**
 * @id PP-CORE-CMP-057
 * @name TokenLogo
 * @implements-rules-version v1
 *
 * A single token's circular logo, resolved by symbol (+ optional network slug) via
 * {@link resolveTokenLogo} (PP-CORE-LIB-021): a committed major under `public/tokens/`, else the
 * network token-list `iconUrl`, else a symbol-initial chip. Decorative (empty alt + aria-hidden); the
 * adjacent token symbol carries the a11y meaning, matching {@link NetworkLogo} / {@link StrategyLogo}.
 * Sizing + typography come from `className`, e.g. `size-5 text-[10px]`. Server-safe (no hooks). Added
 * for the Investment-mandate + Allocation card logos (POO-739).
 */
import { resolveTokenLogo } from "@/lib/tokens/tokenLogo";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link TokenLogo}. */
export interface TokenLogoProps {
  /** Token symbol, e.g. "ETH" | "USDC". Case-insensitive. */
  symbol: string;
  /** Network slug for the non-major list fallback; majors resolve network-free. */
  network?: string | null;
  /** Extra classes — pass the size + text size, e.g. `size-5 text-[10px]`. */
  className?: string;
}

/** A token's circular logo; symbol-initial chip fallback when the logo is unresolved. */
export function TokenLogo({ symbol, network, className }: TokenLogoProps) {
  const url = resolveTokenLogo(symbol, network ?? undefined);
  if (url) {
    return (
      // Decorative; the adjacent token symbol carries the meaning.
      <img
        src={url}
        alt=""
        aria-hidden="true"
        className={cn("shrink-0 rounded-full object-cover", className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-surface-raised font-medium text-muted-foreground",
        className,
      )}
    >
      {symbol.charAt(0).toUpperCase()}
    </span>
  );
}
