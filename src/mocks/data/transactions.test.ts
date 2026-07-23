import { describe, expect, it } from "vitest";
import { transactionSchema } from "@/lib/schemas";
import { transactions } from "./transactions";

describe("transactions mock data", () => {
  it("has every entry pass the Transaction schema parse", () => {
    for (const transaction of transactions) {
      expect(() => transactionSchema.parse(transaction)).not.toThrow();
    }
  });

  it("is ordered most-recent-first by timestamp", () => {
    const times = transactions.map((transaction) => transaction.timestamp);
    const descending = [...times].sort((a, b) => b - a);
    expect(times).toEqual(descending);
  });

  it("has unique ids across all entries", () => {
    const ids = transactions.map((transaction) => transaction.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
