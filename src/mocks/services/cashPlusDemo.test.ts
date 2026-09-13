/** @id PP-CP-MCK-002 @name Cash+ simulated accounting rules @implements-rules-version v1 */
import { describe, expect, it } from "vitest";
import {
  advanceCashPlusDemoDay,
  createCashPlusDemoState,
  executeCashPlusDemo,
  prepareCashPlusDemo,
  restoreCashPlusDemo,
  serializeCashPlusDemo,
} from "./cashPlusDemo";

describe("Cash+ explicit simulation", () => {
  // @rule R1: a deposit exchanges cash for proportional shares, never counted as return.
  it("moves exact deposit principal from wallet to pool without creating profit", () => {
    const before = createCashPlusDemoState();
    const result = executeCashPlusDemo(before, prepareCashPlusDemo(before, "deposit", "1000"));
    expect(result.state.walletBalance).toBe(before.walletBalance - BigInt(1000000000));
    expect(result.state.snapshot.totalAssets).toBe(
      before.snapshot.totalAssets + BigInt(1000000000),
    );
    expect(result.state.snapshot.investedAssets).toBe(
      before.snapshot.investedAssets + BigInt(1000000000),
    );
    expect(result.state.snapshot.resultAssets - before.snapshot.resultAssets).toBeLessThanOrEqual(
      BigInt(0),
    );
    expect(result.receipt.hash).toBeUndefined();
    expect(result.receipt.simulated).toBe(true);
  });
  // @rule R2: only explicit simulated elapsed time produces new returns.
  it("adds one disclosed day of interest and gross conversion spread", () => {
    const before = createCashPlusDemoState();
    const after = advanceCashPlusDemoDay(before);
    const nav = before.snapshot.totalAssets;
    const interest = (nav * BigInt(95) * BigInt(4)) / BigInt(10000 * 365);
    const conversion = (nav * BigInt(40) * BigInt(5)) / BigInt(10000 * 365);
    expect(after.snapshot.totalAssets).toBe(nav + interest + conversion);
    expect(after.snapshot.interestAssets).toBe(before.snapshot.interestAssets + interest);
    expect(after.snapshot.conversionAssets).toBe(before.snapshot.conversionAssets + conversion);
    expect(after.snapshot.timestamp).toBe(before.snapshot.timestamp + 86400);
    expect(after.snapshot.history.at(-1)?.shareValueAssets).toBeGreaterThan(
      before.snapshot.history.at(-1)?.shareValueAssets ?? BigInt(0),
    );
  });
  // @rule R3: full exit credits the exact receipt amount and clears all user shares.
  it("redeems all shares after an advanced day", () => {
    const before = advanceCashPlusDemoDay(createCashPlusDemoState());
    const result = executeCashPlusDemo(before, prepareCashPlusDemo(before, "redeem", "all"));
    expect(result.state.snapshot.accountShares).toBe(BigInt(0));
    expect(result.state.snapshot.accountAssets).toBe(BigInt(0));
    expect(result.state.walletBalance).toBe(
      before.walletBalance + (result.receipt.assets ?? BigInt(0)),
    );
  });
  // @rule R4: proportional exit credits token components, not fictitious USDC proceeds.
  it("keeps receipt tokens separate from USDC on proportional exit", () => {
    const before = createCashPlusDemoState();
    const result = executeCashPlusDemo(before, prepareCashPlusDemo(before, "proportional", "all"));
    const usdc = result.receipt.tokens.find((t) => t.symbol === "USDC");
    expect(result.state.walletBalance).toBe(before.walletBalance + (usdc?.amount ?? BigInt(0)));
    expect(
      result.state.walletTokens.some((t) => t.symbol === "aUSDC" && t.amount > BigInt(0)),
    ).toBe(true);
    expect(result.state.snapshot.accountShares).toBe(BigInt(0));
  });
  // @rule R5: stale review and invalid amounts cannot mutate demo accounting.
  it("rejects a review after a simulated day", () => {
    const before = createCashPlusDemoState();
    expect(() =>
      executeCashPlusDemo(
        advanceCashPlusDemoDay(before),
        prepareCashPlusDemo(before, "deposit", "100"),
      ),
    ).toThrow("QUOTE_EXPIRED");
  });
  it.each([
    ["0.5", "AMOUNT_INVALID"],
    ["30000", "INSUFFICIENT_USDC"],
    ["0", "AMOUNT_INVALID"],
  ])("rejects invalid deposit %s", (amount, code) =>
    expect(() => prepareCashPlusDemo(createCashPlusDemoState(), "deposit", amount)).toThrow(code));
  it("enforces remaining capacity", () => {
    const state = createCashPlusDemoState();
    state.snapshot.capacityAssets = BigInt(1000000);
    expect(() => prepareCashPlusDemo(state, "deposit", "100")).toThrow("CAPACITY_FULL");
  });
  it("withdraws a partial amount without discarding remaining shares", () => {
    const before = createCashPlusDemoState();
    const result = executeCashPlusDemo(before, prepareCashPlusDemo(before, "redeem", "5000"));
    expect(result.state.walletBalance).toBe(before.walletBalance + BigInt(5000000000));
    expect(result.state.snapshot.accountShares).toBeGreaterThan(BigInt(0));
    expect(result.state.snapshot.accountShares).toBeLessThan(before.snapshot.accountShares);
    expect(result.state.snapshot.withdrawnAssets).toBe(BigInt(5000000000));
    // Ceil-rounded burned shares may leave at most one raw USDC unit of valuation dust.
    expect(before.snapshot.resultAssets - result.state.snapshot.resultAssets).toBeLessThanOrEqual(
      BigInt(1),
    );
    expect(result.state.snapshot.resultAssets).toBeLessThanOrEqual(before.snapshot.resultAssets);
  });
  it("round-trips exact integers and safely rejects broken session data", () => {
    const before = advanceCashPlusDemoDay(createCashPlusDemoState());
    expect(restoreCashPlusDemo(serializeCashPlusDemo(before))).toEqual(before);
    expect(restoreCashPlusDemo("{broken")).toBeNull();
    expect(restoreCashPlusDemo('{"version":1}')).toBeNull();
  });
});
