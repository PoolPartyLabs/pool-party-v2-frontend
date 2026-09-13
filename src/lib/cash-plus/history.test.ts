/** @id PP-CP-LIB-011 @name Cash+ observed history rules @implements-rules-version v1 */
import { describe, expect, it } from "vitest";
import { accruedLendingAssets, dedupeCashPlusLogs } from "./history";

const hash = `0x${"a".repeat(64)}`;
describe("Cash+ bounded observed history", () => {
  it("sorts and deduplicates real block/hash/log identity", () => {
    const a = {
      blockNumber: BigInt(2),
      blockHash: hash,
      transactionHash: hash,
      logIndex: 1,
      removed: false,
    };
    const b = { ...a, blockNumber: BigInt(1), logIndex: 0 };
    expect(dedupeCashPlusLogs([a, a, b, { ...a, removed: true }] as never)).toEqual([b, a]);
  });
  it("counts lending principal once and preserves withdrawn interest", () => {
    expect(accruedLendingAssets(BigInt(910), BigInt(1000), BigInt(100), BigInt(0), false)).toBe(
      BigInt(10),
    );
  });
  it("does not turn unsolicited receipt tokens into earned yield", () => {
    expect(accruedLendingAssets(BigInt(1500), BigInt(1000), BigInt(0), BigInt(0), true)).toBeNull();
  });
  it("tolerates bounded Aave raw-unit rounding and refuses large accounting gaps", () => {
    expect(accruedLendingAssets(BigInt(999), BigInt(1000), BigInt(0), BigInt(0), false, 1)).toBe(
      BigInt(0),
    );
    expect(
      accruedLendingAssets(BigInt(990), BigInt(1000), BigInt(0), BigInt(0), false, 1),
    ).toBeNull();
  });
});
