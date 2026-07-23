/**
 * @id PP-ACT (POO-212)
 * @name Activity server actions
 * @implements-rules-version v1
 *
 * Server Action for the activity feed. The future Activity screen (PP-ACT-SCR-001,
 * not yet built) calls this with the connected wallet; the analytics read runs
 * server-side in fetchTransactions, so the browser never calls the indexer directly.
 *
 * PP-INTEGRATION-POINT: wallet address is client-supplied (server-trusted identity: POO-270).
 */
"use server";

import { fetchTransactions } from "@/lib/activity/fetchTransactions";
import type { Transaction } from "@/lib/schemas";

/** Fetch the activity feed for the connected wallet. No wallet → empty list. */
export async function getTransactionsAction(address?: string): Promise<Transaction[]> {
  return fetchTransactions(address);
}
