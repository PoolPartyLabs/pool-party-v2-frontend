/**
 * @id PP-CORE-LIB-043 (POO-810)
 * @name receivedAmounts
 * @implements-rules-version v1 (POO-810) · POO-844 rules v1 (unpriced-leg raw row)
 *
 * The pure presentation mapper for the truthful invest/collect/withdraw receipts (POO-810 R3/R5/R6):
 * given the decoded receipt legs each paired with its resolved `{ symbol, decimals }`, it produces
 * the per-token display rows (the shape `TokenAmountRows` consumes) and the USDC total in USD.
 *
 * Per R3: a USDC leg carries both its human amount AND a USD value (rendered as USD, 1:1); a
 * non-USDC leg carries only its human token amount (no client USD price source). `usdcUsd` is the
 * summed USDC received — the invest `deployed = requested − usdcUsd`, and the collect/withdraw USD
 * body when the whole payout is USDC.
 *
 * POO-844 (money-truth): an unpriced non-USDC leg (its meta did not resolve, so there is no
 * `decimals` to scale it and no USD) is NO LONGER dropped. Dropping it made a real X/USDC pair
 * withdraw look "all-USDC" and collapsed the receipt to the USDC leg alone, understating the total
 * (the POO-844 review gap). Instead the leg is kept as a RAW-value row — the base-unit amount + a
 * short address-derived label, carrying NO `usd` — and `hasUnpricedLeg` is set. The receipt then
 * shows the per-token raw amount (base units are the honest raw value, so R9 still holds — never a
 * wrong-scale HUMAN amount) and the consumer's "all-USDC verbatim USD" gate stays off (product
 * decision: "show raw values if the non-USD leg comes with no price").
 *
 * Raw→human conversion goes through viem `formatUnits` (exact, no float scaling), matching the
 * money-precision rule.
 */
import { formatUnits } from "viem";
import type { TokenAmountRowEntry } from "@/components/data-display/TokenAmountRows";
import type { DecodedTransfer } from "./decodeExecutedAmounts";
import type { TokenMeta } from "./resolveTokenMeta";

/** A decoded leg paired with its resolved metadata (undefined when resolution failed → raw row). */
export interface ResolvedLeg {
  leg: DecodedTransfer;
  meta: TokenMeta | undefined;
}

/** The receipt's display legs + the USDC total (USD). */
export interface ReceivedLegsResult {
  /** Per-token rows for {@link TokenAmountRows}: USDC leg carries `usd`, others amount-only (R3). */
  rows: TokenAmountRowEntry[];
  /** Summed USDC received in USD (drives invest `deployed = requested − usdcUsd` + USD bodies). */
  usdcUsd: number;
  /**
   * POO-844: at least one leg is present but UNPRICED with unknown scale (its meta did not resolve),
   * so it renders as a raw base-unit amount. The consumer must NOT collapse the receipt to a single
   * all-USDC USD total when this is true — that total would omit the unpriced leg and understate the
   * payout. Optional so existing decoded literals stay valid; absent is treated as `false`.
   */
  hasUnpricedLeg?: boolean;
}

/** A short `0x1234…cdef` label for an unpriced leg whose symbol did not resolve (POO-844). */
function shortTokenLabel(address: `0x${string}`): string {
  return address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** Map resolved receipt legs to per-token display rows + the USDC USD total (POO-810 R3/R5/R6). */
export function buildReceivedLegs(resolved: ResolvedLeg[]): ReceivedLegsResult {
  const rows: TokenAmountRowEntry[] = [];
  let usdcUsd = 0;
  let hasUnpricedLeg = false;

  for (const { leg, meta } of resolved) {
    if (!meta) {
      // POO-844: no meta → unknown scale + no USD. Keep the leg as a RAW row (base-unit amount +
      // short address label, no `usd`) instead of dropping it — dropping understated a pair payout
      // by making it look all-USDC. Base units are the honest raw value (never a wrong HUMAN scale).
      hasUnpricedLeg = true;
      rows.push({
        symbol: shortTokenLabel(leg.address),
        amount: Number(formatUnits(leg.rawValue, 0)),
      });
      continue;
    }
    const amount = Number(formatUnits(leg.rawValue, meta.decimals));
    if (leg.isUsdc) {
      // USDC renders as USD 1:1 (R3): the row carries both the amount and its USD value.
      usdcUsd += amount;
      rows.push({ symbol: meta.symbol, amount, usd: amount });
    } else {
      // Non-USDC: token amount only — the FE has no client price source (R3).
      rows.push({ symbol: meta.symbol, amount });
    }
  }

  return { rows, usdcUsd, hasUnpricedLeg };
}
