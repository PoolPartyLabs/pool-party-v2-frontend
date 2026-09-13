/** @id PP-CP-LIB-010 @name Cash+ session pending journal @implements-rules-version v1 */
import type { Address, Hash } from "viem";
import type { CashPlusDeployment } from "./config/deployments";
import type { CashPlusTransaction } from "./types";
export interface CashPlusJournal {
  hash: Hash;
  stage: "approval" | "operation";
  transaction: CashPlusTransaction;
}
export function cashPlusJournalKey(deployment: CashPlusDeployment, owner: Address): string {
  return `cashplus:${deployment.mode}:${deployment.runId}:${deployment.chainId}:${deployment.vault.toLowerCase()}:${owner.toLowerCase()}`;
}
export function writeCashPlusJournal(key: string, value: CashPlusJournal | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else
      sessionStorage.setItem(
        key,
        JSON.stringify(value, (_, item) =>
          typeof item === "bigint" ? { $bigint: item.toString() } : item,
        ),
      );
  } catch {
    /* Memory state still protects the current mounted page if storage is unavailable. */
  }
}
export function readCashPlusJournal(key: string): CashPlusJournal | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw, (_, item) =>
      item &&
      typeof item === "object" &&
      typeof item.$bigint === "string" &&
      /^\d{1,78}$/.test(item.$bigint)
        ? BigInt(item.$bigint)
        : item,
    );
    if (
      !/^0x[0-9a-fA-F]{64}$/.test(value.hash) ||
      !["approval", "operation"].includes(value.stage) ||
      !value.transaction ||
      !["deposit", "redeem", "proportional"].includes(value.transaction.kind) ||
      value.transaction.phase !== "pending"
    )
      return null;
    return value as CashPlusJournal;
  } catch {
    return null;
  }
}
