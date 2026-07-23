/**
 * @id PP-ACT (POO-212)
 * @name Analytics transactions response schema
 * @implements-rules-version v1
 *
 * Zod for GET /analytics/wallets/:a/transactions. Only the fields the mapper
 * consumes are required; the row carries more (blockNumber, transactionHash,
 * withdrawal_type, data, network) which we ignore. The amount is a US-localized
 * string or "no data"; token is an address / "USDC (Calc)" / "no data"; timestamp
 * is an ISO string.
 *
 * PP-INTEGRATION-POINT: response contract for the Data_Analytics activity feed.
 */
import { z } from "zod";

/** One analytics transaction row (OAMS liquidity event). */
export const analyticsTransactionSchema = z.object({
  id: z.string(),
  type: z.string(),
  amount: z.string(),
  token: z.string(),
  timestamp: z.string(),
});
export type AnalyticsTransaction = z.infer<typeof analyticsTransactionSchema>;

/** The `{ data, meta }` envelope returned by the transactions endpoint. */
export const analyticsTransactionsResponseSchema = z.object({
  data: z.array(analyticsTransactionSchema),
  meta: z
    .object({
      total: z.number(),
      page: z.number(),
      limit: z.number(),
      totalPages: z.number(),
    })
    .optional(),
});
export type AnalyticsTransactionsResponse = z.infer<typeof analyticsTransactionsResponseSchema>;
