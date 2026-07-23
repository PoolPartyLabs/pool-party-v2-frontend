/**
 * @id PP-ACT (POO-212)
 * @name mapTransaction tests
 * @implements-rules-version v1
 *
 * [R2..R6] Maps an analytics liquidity row to the FE Transaction shape.
 */
import { describe, expect, it } from "vitest";
import { transactionSchema } from "@/lib/schemas";
import { mapTransaction } from "./mapTransaction";

const row = (over: Partial<Parameters<typeof mapTransaction>[0]> = {}) => ({
  id: "tx-1",
  type: "LiquidityAdded",
  amount: "1,030.814779",
  token: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  timestamp: "2026-04-19T14:30:09.000Z",
  ...over,
});

describe("mapTransaction", () => {
  // POO-226 R2: strategy entry is an `invest`, not a cash-in `deposit`.
  it("[R2] maps LiquidityAdded -> invest and LiquidityRemoved -> withdraw", () => {
    expect(mapTransaction(row({ type: "LiquidityAdded" })).type).toBe("invest");
    expect(mapTransaction(row({ type: "LiquidityRemoved" })).type).toBe("withdraw");
  });

  // POO-226 R2: rewards collection maps to `yield` when the indexer emits it.
  it("[R2] maps RewardsCollected -> yield", () => {
    expect(mapTransaction(row({ type: "RewardsCollected" })).type).toBe("yield");
  });

  // POO-226 R1/R2: an unmapped OAMS event still yields a schema-valid enum type.
  it("[R2] maps an unmapped event type to a schema-valid transaction type", () => {
    const tx = mapTransaction(row({ type: "SomethingNew" }));
    expect(transactionSchema.safeParse(tx).success).toBe(true);
  });

  it("[R3] parses a US-localized amount string into a number", () => {
    expect(mapTransaction(row({ amount: "1,030.814779" })).tokenAmount).toBeCloseTo(1030.814779, 6);
    expect(mapTransaction(row({ amount: "6,055.197582" })).tokenAmount).toBeCloseTo(6055.197582, 6);
  });

  it("[R3] maps a 'no data' amount to 0", () => {
    expect(mapTransaction(row({ amount: "no data" })).tokenAmount).toBe(0);
  });

  it("[R4] resolves the USDC address, 'USDC (Calc)' and 'no data' to USDC", () => {
    expect(
      mapTransaction(row({ token: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" })).tokenSymbol,
    ).toBe("USDC");
    expect(mapTransaction(row({ token: "USDC (Calc)" })).tokenSymbol).toBe("USDC");
    expect(mapTransaction(row({ token: "no data" })).tokenSymbol).toBe("USDC");
  });

  it("[R5] sets usdValueAtTime to the token amount (USDC 1:1)", () => {
    expect(mapTransaction(row({ amount: "100.5" })).usdValueAtTime).toBeCloseTo(100.5, 6);
  });

  it("[R6] status is always completed and timestamp is ms epoch", () => {
    const tx = mapTransaction(row({ timestamp: "2026-04-19T14:30:09.000Z" }));
    expect(tx.status).toBe("completed");
    expect(tx.timestamp).toBe(Date.parse("2026-04-19T14:30:09.000Z"));
  });

  it("passes id through and produces a schema-valid Transaction", () => {
    const tx = mapTransaction(row({ id: "abc-123" }));
    expect(tx.id).toBe("abc-123");
    expect(transactionSchema.safeParse(tx).success).toBe(true);
  });
});
