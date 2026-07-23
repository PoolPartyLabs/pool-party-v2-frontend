/**
 * @id PP-MGR-LIB-007 (POO-563)
 * @name buildManagerAllocation
 * @implements-rules-version v1
 *
 * Pure builder for the manage-detail Allocation card (POO-563), derived CLIENT-SIDE from a strategy's
 * single Uniswap v3 position — no backend or indexer needed for V1. In the current product a strategy
 * IS one Uniswap position, so:
 *
 * [R1] `tokens` = the position's percent-of-value split (from {@link positionTokenSplit},
 *      PP-CORE-LIB-022, over `totalSupply0/1` at `tickCurrent`), and `protocols` = a single 100%
 *      Uniswap v3 row. "Uniswap v3" is the product's protocol, a product noun kept verbatim across
 *      locales (like USDC/APY), so it is not translated.
 * [R2] Single-sided / out-of-range positions carry a 0 or 100 value share, so the split renders
 *      0/100 or 100/0 truthfully (`positionTokenSplit` yields `share0 ∈ {0, 1}` in those cases).
 * [R5] Any missing reserve field, a non-finite numeric, or a zero/zero position returns `undefined`
 *      (the card hides) — the honest behavior is preserved, never placeholder percentages. A missing
 *      token symbol is likewise not fabricated.
 *
 * PP-INTEGRATION-POINT (POO-380): the FUTURE multi-protocol / real-balance version replaces this
 * client estimate with the indexer's per-position balances joined with the mandate (multiple protocol
 * rows). Until then a strategy has exactly one Uniswap position and this pure split is the truth.
 */
import type { ManagerAllocation } from "@/lib/schemas";
import { type PositionSplitInput, positionTokenSplit } from "@/lib/uniswap/positionSplit";

/** The pool's two token symbols plus the position's raw reserve block (the split inputs). */
export interface ManagerAllocationInput extends PositionSplitInput {
  /** token0 symbol (e.g. "ETH"). */
  token0?: string;
  /** token1 symbol (e.g. "USDC"). */
  token1?: string;
}

/** The strategy's single Uniswap v3 protocol row (V1: a strategy is one position). */
const UNISWAP_PROTOCOL_LABEL = "Uniswap v3";

/**
 * Build the manage-detail Allocation from a position's token symbols + raw reserves. Returns
 * `undefined` when the split cannot be derived honestly (R5) or a symbol is missing.
 */
export function buildManagerAllocation(
  input: ManagerAllocationInput,
): ManagerAllocation | undefined {
  const { token0, token1 } = input;
  if (!token0 || !token1) return undefined;

  const split = positionTokenSplit(input);
  if (!split) return undefined;

  return {
    protocols: [{ label: UNISWAP_PROTOCOL_LABEL, pct: 100 }],
    tokens: [
      { label: token0, pct: split.share0 * 100 },
      { label: token1, pct: split.share1 * 100 },
    ],
  };
}
