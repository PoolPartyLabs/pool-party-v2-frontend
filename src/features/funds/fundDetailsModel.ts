/** @id PP-STR-LIB-036 @implements-rules-version v1 (POO-2216) */
import type { FundHolder, FundView } from "@/lib/api/v2/fundSchemas";
export type PersonalFundState =
  | { status: "loading" | "disconnected" }
  | { status: "error"; code: string }
  | { status: "ready"; holder: FundHolder; wallet: string };
export function hasFundInterest(holder: FundHolder) {
  return (
    BigInt(holder.shares) > BigInt(0) ||
    BigInt(holder.incomeOwed) > BigInt(0) ||
    holder.payout.open ||
    BigInt(holder.incomeWithdrawal[0]) > BigInt(0)
  );
}
export function detailedCoverage(fund: FundView) {
  const positions = fund.positionsSummary?.positions ?? [];
  if (!positions.length || positions.some((p) => p.shareOfNav === null)) return null;
  const value = positions.reduce((sum, p) => sum + Number(p.shareOfNav), 0);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/** Funding returns restore an amount only for the verified account that started them. */
export function fundResumeAmount(
  query: { get: (key: string) => string | null },
  personal: PersonalFundState,
): number | null {
  if (
    personal.status !== "ready" ||
    query.get("account")?.toLowerCase() !== personal.wallet.toLowerCase()
  )
    return null;
  const amount = query.get("invest");
  if (!amount || !/^\d{1,9}(\.\d{1,6})?$/.test(amount)) return null;
  return Number(amount) > 0 ? Number(amount) : null;
}
