/**
 * @id PP-ACT (POO-212)
 * @name mapTransaction
 * @implements-rules-version v1
 *
 * Maps an analytics liquidity row to the FE Transaction. Analytics covers only
 * OAMS LiquidityAdded/Removed events; amounts are USDC-denominated.
 */
import type { Transaction, TransactionType } from "@/lib/schemas";
import { TRANSACTION_TYPES } from "@/lib/schemas";
import type { AnalyticsTransaction } from "./transactionsSchema";

/** Canonical USDC address on Arbitrum (the feed's settlement token). */
const USDC_ADDRESS = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";

/**
 * Backend OAMS event type → FE transaction kind (POO-226 R2): a liquidity add is a strategy
 * `invest` (not a cash-in `deposit`), a removal is a `withdraw`, and a rewards collection is `yield`.
 */
const TYPE_MAP: Record<string, TransactionType> = {
  LiquidityAdded: "invest",
  LiquidityRemoved: "withdraw",
  RewardsCollected: "yield",
};

/**
 * Resolve a backend event type to a canonical {@link TransactionType} (POO-226 R1). An unmapped
 * event whose lowercased name is itself a canonical kind passes through (forward-compat); anything
 * else settles as `deposit` so the row stays schema-valid instead of leaking a free-form string.
 */
function mapType(rawType: string): TransactionType {
  const mapped = TYPE_MAP[rawType];
  if (mapped) return mapped;
  const lowered = rawType.toLowerCase();
  return (TRANSACTION_TYPES as readonly string[]).includes(lowered)
    ? (lowered as TransactionType)
    : "deposit";
}

/** [R3] Parse a US-localized amount string ("1,030.81") to a number; "no data" → 0. */
function parseAmount(amount: string): number {
  if (amount === "no data") return 0;
  const parsed = Number(amount.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** [R4] Resolve the token field to a ticker. The feed is USDC-denominated. */
function resolveSymbol(token: string): string {
  if (token.toLowerCase() === USDC_ADDRESS || token === "USDC (Calc)" || token === "no data") {
    return "USDC";
  }
  // PP-MOCK: the analytics feed only settles USDC today; default unknown tokens to USDC.
  return "USDC";
}

/** Map one analytics liquidity row to a FE Transaction. */
export function mapTransaction(row: AnalyticsTransaction): Transaction {
  const tokenAmount = parseAmount(row.amount);
  return {
    id: row.id,
    type: mapType(row.type),
    tokenSymbol: resolveSymbol(row.token),
    tokenAmount,
    // PP-MOCK: no historical USD valuation in the indexer; USDC ≈ $1 (POO-212 / usdValueAtTime gap).
    usdValueAtTime: tokenAmount,
    status: "completed",
    timestamp: Date.parse(row.timestamp),
  };
}
