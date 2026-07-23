/**
 * @id PP-CORE-CMP-042
 * @name TokenAmountRow
 * @implements-rules-version v1
 *
 * One token line for the collect / remove payout breakdowns (POO-417 R3, POO-324 item 2): a token
 * avatar (logo when known, the symbol initial otherwise) + the human amount with its symbol, and an
 * optional de-emphasized USD value in parentheses. ReceiptRows (PP-CORE-CMP-027) has no logo slot,
 * so this small row is reused across Collect and Remove. Collect shows amounts only — the backend
 * exposes no per-token USD — so `usd` is normally omitted; Remove can pass it once available.
 *
 * POO-482 R2: consumers resolve `iconUrl` via `resolveTokenLogo` (PP-CORE-LIB-021, symbol-keyed:
 * committed majors + network token-list fallback); the initial avatar remains the unresolved case.
 * PP-INTEGRATION-POINT (POO-482 R5): once the per-token payloads carry the token ADDRESS, the
 * resolution upgrades to the exact `findToken(network, address)` lookup.
 */
import { cn } from "@/lib/utils/cn";
import { formatTokenAmount } from "@/lib/utils/format";

/** Crypto amounts can be sub-cent (e.g. BTC), so show more precision than the 4dp display default. */
const TOKEN_AMOUNT_PRECISION = 8;

/** Public props for {@link TokenAmountRow}. */
export interface TokenAmountRowProps {
  /** Token symbol, e.g. "ETH". */
  symbol: string;
  /** Human token amount (already converted from base units to a decimal). */
  amount: number;
  /** Token logo URL; falls back to the symbol initial when absent. */
  iconUrl?: string;
  /** Optional de-emphasized USD value, pre-formatted (POO-324). Omitted for collect (amounts-only). */
  usd?: string;
  /** Extra classes on the wrapper. */
  className?: string;
}

/** A token avatar + amount (+ optional USD) line. */
export function TokenAmountRow({ symbol, amount, iconUrl, usd, className }: TokenAmountRowProps) {
  return (
    // POO-839 R7: flex-wrap + justify-end lets the row break BETWEEN the amount and the USD span
    // (never mid-token) and min-w-0 lets it shrink inside a narrow cell instead of overflowing.
    <span
      className={cn("inline-flex min-w-0 flex-wrap items-center justify-end gap-1.5", className)}
    >
      {iconUrl ? (
        // Decorative; the amount text carries the symbol meaning.
        <img
          src={iconUrl}
          alt=""
          aria-hidden="true"
          className="size-5 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-raised font-semibold text-[10px] text-foreground"
        >
          {symbol.charAt(0)}
        </span>
      )}
      <span className="whitespace-nowrap">
        {formatTokenAmount(amount, symbol, TOKEN_AMOUNT_PRECISION)}
      </span>
      {usd ? <span className="text-muted-foreground text-xs">({usd})</span> : null}
    </span>
  );
}
