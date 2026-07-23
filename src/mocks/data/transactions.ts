/**
 * @id PP-CORE-MCK-003
 * @name transaction mock data
 * @implements-rules-version v1
 *
 * Static, in-memory activity feed for the mocks, most-recent-first (the service convention).
 * Follows the transaction-display rule: each entry carries the per-token amount and the USD value
 * at the moment of the transaction (price-at-time). Timestamps are fixed epoch-ms constants (not
 * `Date.now()`) so the data is deterministic for SSR/SSG and tests. Replace with the indexer feed.
 */
import type { Transaction } from "@/lib/schemas";

/** PP-MOCK: the connected investor's recent transactions, newest first. Outflows are negative. */
export const transactions: Transaction[] = [
  {
    id: "tx-yield-2",
    type: "yield",
    tokenSymbol: "USDC",
    tokenAmount: 12.85,
    usdValueAtTime: 12.85,
    status: "completed",
    timestamp: 1_780_300_000_000,
  },
  {
    id: "tx-invest-1",
    type: "invest",
    tokenSymbol: "USDC",
    tokenAmount: -500,
    usdValueAtTime: 500,
    status: "completed",
    timestamp: 1_780_120_000_000,
  },
  {
    id: "tx-deposit-2",
    type: "deposit",
    tokenSymbol: "USDC",
    tokenAmount: 1000,
    usdValueAtTime: 1000,
    status: "completed",
    timestamp: 1_779_900_000_000,
  },
  {
    id: "tx-yield-1",
    type: "yield",
    tokenSymbol: "USDC",
    tokenAmount: 9.4,
    usdValueAtTime: 9.4,
    status: "completed",
    timestamp: 1_779_600_000_000,
  },
  {
    id: "tx-deposit-1",
    type: "deposit",
    tokenSymbol: "USDC",
    tokenAmount: 200,
    usdValueAtTime: 200,
    status: "pending",
    timestamp: 1_779_500_000_000,
  },
];
