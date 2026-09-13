/**
 * @id PP-CORE-LIB-053 (POO-1031, extracted POO-1137)
 * @name toBaseUnits
 * @implements-rules-version v3
 *
 * A holding's balance in base units, as a decimal string.
 *
 * Extracted from `fundingInventory.ts` because that module is `server-only` (it reads holdings and
 * calls Uniswap), while this conversion is pure string-and-bigint math with no I/O. The standalone
 * on-ramp plan (POO-1137) runs on the CLIENT and needs it, and importing it from the server-only
 * module broke the client bundle at build time with "You're importing a component that needs
 * server-only". `pnpm typecheck` and `pnpm test` do not bundle, so only `pnpm build` catches that.
 *
 * `fundingInventory` re-exports this so its own callers are unchanged, and there is still exactly one
 * implementation of the truncation rule.
 */

import { parseUnits } from "viem";
import type { TokenBalance } from "@/lib/balances/types";

/** A decimal with no sign, exponent or separators: anything else is rejected rather than guessed at. */
const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;

/**
 * A holding's balance in base units, as a decimal string, or `null` when it cannot be expressed
 * exactly ([R2]).
 *
 * Two safety properties, both about never claiming more than the wallet holds:
 *
 *   - the EXACT decimal string is preferred over the float beside it. `Number("1.234567890123456789")`
 *     rounds UP, and a swap sized from that reverts for insufficient balance;
 *   - a fraction longer than the token's decimals is TRUNCATED, not rounded, because `parseUnits`
 *     rounds and rounding up one base unit has the same effect.
 *
 * The float path remains for the degraded USDC-only read, where the balance was a number to begin
 * with. `toFixed` there mirrors the shipped precedent in `seedAmounts.ts:110`; anything it cannot
 * render as a plain decimal (a value past 1e21, an infinity) is rejected rather than guessed at.
 *
 * Typed on the three fields it reads rather than on the whole {@link TokenBalance}, so an on-ramp
 * `TokenDelta` (POO-1137), which is the same amount/exact/decimals triple describing a CHANGE rather
 * than a holding, converts through this one implementation instead of a second copy of the truncation
 * rule. Every existing caller still passes a full holding.
 */
export function toBaseUnits(
  holding: Pick<TokenBalance, "amount" | "amountExact" | "decimals">,
): string | null {
  const decimal = (holding.amountExact ?? holding.amount.toFixed(holding.decimals)).trim();
  if (!PLAIN_DECIMAL.test(decimal)) return null;

  const [whole, fraction = ""] = decimal.split(".");
  const truncated =
    fraction.length > holding.decimals
      ? `${whole}.${fraction.slice(0, holding.decimals)}`
      : decimal;

  try {
    const raw = parseUnits(truncated, holding.decimals);
    return raw > BigInt(0) ? raw.toString() : null;
  } catch {
    return null;
  }
}
