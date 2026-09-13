/** @id PP-CP-LIB-010 @name Cash+ pending identity rules @implements-rules-version v1 */
import { describe, expect, it } from "vitest";
import { parseCashPlusDeployment } from "./config/deployments";
import { manifestFixture } from "./config/testFixture";
import { cashPlusJournalKey, readCashPlusJournal, writeCashPlusJournal } from "./journal";

describe("Cash+ pending journal", () => {
  it("isolates wallet, run and vault, preserving bigint intent without secrets", () => {
    const d = parseCashPlusDeployment(manifestFixture),
      owner = "0x3333333333333333333333333333333333333333";
    const key = cashPlusJournalKey(d, owner),
      other = cashPlusJournalKey({ ...d, runId: "new" }, owner);
    writeCashPlusJournal(key, {
      hash: `0x${"a".repeat(64)}`,
      stage: "operation",
      transaction: { phase: "pending", kind: "redeem", shares: BigInt(123) },
    });
    expect(readCashPlusJournal(key)?.transaction.shares).toBe(BigInt(123));
    expect(readCashPlusJournal(other)).toBeNull();
  });
  it("ignores malformed or forged stored records", () => {
    sessionStorage.setItem("bad", '{"hash":"fake","stage":"operation","transaction":{}}');
    expect(readCashPlusJournal("bad")).toBeNull();
  });
});
