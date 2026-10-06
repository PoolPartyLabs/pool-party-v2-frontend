/** @id PP-STR-LIB-039 @name fundInvestJournal @implements-rules-version v1 (POO-2248) @analytics-events none, local transaction recovery */
import type { FundTransactionRecord } from "./fundTransactions";
export interface FundInvestJournal {
  core: string;
  wallet: string;
  budget: string;
  kind: "approve" | "deposit";
  record?: FundTransactionRecord;
  state: "signing" | "pending" | "unknown" | "confirmed" | "reverted";
}
const key = (core: string, wallet: string) =>
  `pp:v2:invest:1:${wallet.toLowerCase()}:${core.toLowerCase()}`;
export function readFundInvestJournal(core: string, wallet: string): FundInvestJournal | null {
  const raw = localStorage.getItem(key(core, wallet));
  if (!raw) return null;
  const value = JSON.parse(raw) as FundInvestJournal;
  if (
    !value ||
    typeof value.core !== "string" ||
    typeof value.wallet !== "string" ||
    (value.record &&
      (value.record.chainId !== 42161 ||
        !/^0x[0-9a-fA-F]{64}$/.test(value.record.hash) ||
        !["pending", "confirmed", "reverted"].includes(value.record.status))) ||
    value.core.toLowerCase() !== core.toLowerCase() ||
    value.wallet.toLowerCase() !== wallet.toLowerCase() ||
    !/^\d+$/.test(value.budget) ||
    !["approve", "deposit"].includes(value.kind) ||
    !["signing", "pending", "unknown", "confirmed", "reverted"].includes(value.state)
  )
    throw new Error("V2_RECOVERY_UNAVAILABLE");
  return value;
}
export function writeFundInvestJournal(value: FundInvestJournal) {
  localStorage.setItem(key(value.core, value.wallet), JSON.stringify(value));
}
export function clearFundInvestJournal(core: string, wallet: string) {
  localStorage.removeItem(key(core, wallet));
}
