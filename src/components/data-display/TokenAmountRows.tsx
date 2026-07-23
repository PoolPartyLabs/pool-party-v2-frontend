/**
 * @id PP-CORE-CMP-051
 * @name TokenAmountRows
 * @implements-rules-version v1
 *
 * The shared per-token payout list (POO-573): an end-aligned `flex-col` stack of TokenAmountRow
 * (PP-CORE-CMP-042), one per `rows` entry in order. It centralizes the three concerns the
 * Withdraw / Collect / Remove payout renderers previously hand-rolled and duplicated: the
 * `flex flex-col items-end gap-1` wrapper, per-row logo resolution via `resolveTokenLogo`
 * (PP-CORE-LIB-021), and the optional per-row USD formatting via `formatUsd` (so callers pass a
 * raw number, or omit `usd` for the amounts-only Collect case). Pure and behavior-preserving: the
 * four adopting call sites keep their exact prior output and `data-testid`.
 *
 * PP-INTEGRATION-POINT (POO-482 R5): once the per-token payloads carry the token ADDRESS, the
 * logo resolution inside TokenAmountRow upgrades to the exact `findToken(network, address)` lookup.
 */
import { resolveTokenLogo } from "@/lib/tokens/tokenLogo";
import { cn } from "@/lib/utils/cn";
import { formatUsd } from "@/lib/utils/format";
import { TokenAmountRow } from "./TokenAmountRow";

/** One token payout entry: symbol + human amount, with an optional raw USD value. */
export interface TokenAmountRowEntry {
  /** Token symbol, e.g. "ETH". */
  symbol: string;
  /** Human token amount (already converted from base units to a decimal). */
  amount: number;
  /** Optional raw USD value; formatted here via {@link formatUsd}. Omit for amounts-only (Collect). */
  usd?: number;
}

/** Public props for {@link TokenAmountRows}. */
export interface TokenAmountRowsProps {
  /** The token rows to render, in order. */
  rows: TokenAmountRowEntry[];
  /** Network the tokens belong to; used by `resolveTokenLogo` for the non-major list fallback. */
  network: string | undefined;
  /** Test hook on the wrapper; distinguishes receive / amount-requested / fee splits per call site. */
  testId?: string;
  /** Extra classes on the wrapper. */
  className?: string;
}

/** An end-aligned stack of token payout lines (amount + optional USD + logo). */
export function TokenAmountRows({ rows, network, testId, className }: TokenAmountRowsProps) {
  return (
    <div data-testid={testId} className={cn("flex flex-col items-end gap-1", className)}>
      {rows.map((row) => (
        <TokenAmountRow
          key={row.symbol}
          symbol={row.symbol}
          amount={row.amount}
          usd={row.usd != null ? formatUsd(row.usd) : undefined}
          iconUrl={resolveTokenLogo(row.symbol, network)}
        />
      ))}
    </div>
  );
}
