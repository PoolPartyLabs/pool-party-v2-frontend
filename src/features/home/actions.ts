/**
 * @id PP-DASH-SCR-001 (POO-430, POO-990)
 * @name Home server actions
 * @implements-rules-version v3
 *
 * Server Action for the connected wallet's C1 `/financials` payload (POO-932 endpoint), feeding Home
 * "Earned today" / "Last 30 days" / Invested / Total Yield / hero total. The wallet is derived
 * server-side from the SIWE session (POO-270), never trusted from the client. Not signed in → null
 * (no read). Never throws: the fetcher coalesces empty/missing/outage/parse-fail to null so the caller
 * renders the money KPIs as "not available yet", never a fabricated number and never a legacy figure.
 *
 * PP-CORE-LIB-048 (POO-990, legacy excision): `getWalletMetricsAction` (the legacy `/metrics` reader)
 * was removed. The C1 `/financials` action below is the sole money-data server action for Home.
 */
"use server";

import { getSessionWallet } from "@/lib/auth/session";
import { fetchWalletFinancials } from "@/lib/financials/fetchWalletFinancials";
import type { WalletFinancials } from "@/lib/financials/financialsSchema";

/**
 * POO-932 / PP-CORE-LIB-048: fetch the signed-in wallet's C1 ledger financials. Not signed in → null
 * (no read). Unavailable/outage/parse-failure → null (the caller renders "not available yet", never a
 * legacy figure). The read is wallet-scoped, so the client loader (which reads the connected wallet)
 * invokes this action, mirroring getInvestorPortfolioSeriesAction.
 *
 * PP-INTEGRATION-POINT: investor financials ← analytics `/wallets/:addr/financials` (POO-932).
 */
export async function getWalletFinancialsAction(): Promise<WalletFinancials | null> {
  const wallet = await getSessionWallet();
  if (!wallet) return null;
  return fetchWalletFinancials(wallet);
}
