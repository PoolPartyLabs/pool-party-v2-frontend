/** @id PP-CP-LIB-005 @name Cash+ transaction intent rules @implements-rules-version v1 */
import { decodeFunctionData, encodeFunctionData, erc20Abi } from "viem";
import { describe, expect, it } from "vitest";
import { cashPlusVaultAbi } from "./abi/CashPlusVault";
import { buildCashPlusTransaction, validateCashPlusTransaction } from "./buildTransaction";
import type { CashPlusIntent } from "./types";

const intent: CashPlusIntent = {
  version: 1,
  operationId: "test-operation",
  kind: "deposit",
  chainId: 31337,
  owner: "0x000000000000000000000000000000000000000a",
  vault: "0x000000000000000000000000000000000000000b",
  token: "0x000000000000000000000000000000000000000c",
  amount: BigInt("100000000"),
  minOutput: BigInt("99900000000000000000"),
  deadline: BigInt("2000"),
  policyVersion: BigInt("1"),
  redeemAll: false,
  minimumComponents: [],
};

describe("Cash+ transaction semantic validation", () => {
  // @rule R7: locally built calldata binds all reviewed quantities and the actual chain/account.
  it("encodes the exact deposit intent", () => {
    const tx = buildCashPlusTransaction(intent);
    expect(decodeFunctionData({ abi: cashPlusVaultAbi, data: tx.data })).toMatchObject({
      functionName: "deposit",
      args: [intent.amount, intent.minOutput, BigInt("2000"), BigInt("1")],
    });
    expect(() => validateCashPlusTransaction(tx, intent, BigInt("1000"))).not.toThrow();
  });
  it("approves exactly the USDC amount to this vault", () => {
    const approval = { ...intent, kind: "approve" as const };
    const tx = buildCashPlusTransaction(approval);
    expect(tx.to).toBe(intent.token);
    expect(decodeFunctionData({ abi: erc20Abi, data: tx.data })).toMatchObject({
      functionName: "approve",
      args: [intent.vault, intent.amount],
    });
  });
  it.each(["redeem", "proportional"] as const)("encodes %s including minimums", (kind) => {
    const next = {
      ...intent,
      kind,
      minimumComponents: [BigInt("1"), BigInt("2"), BigInt("3"), BigInt("4")],
    };
    const tx = buildCashPlusTransaction(next);
    const decoded = decodeFunctionData({ abi: cashPlusVaultAbi, data: tx.data });
    expect(decoded.functionName).toBe(kind === "proportional" ? "redeemProportional" : "redeem");
    expect(() => validateCashPlusTransaction(tx, next, BigInt("1000"))).not.toThrow();
  });
  it("uses redeemAll without a stale share quantity", () => {
    const tx = buildCashPlusTransaction({ ...intent, kind: "redeem", redeemAll: true });
    expect(decodeFunctionData({ abi: cashPlusVaultAbi, data: tx.data }).functionName).toBe(
      "redeemAll",
    );
  });
  // @rule R8: shape-valid but changed transactions are not signable.
  it.each([
    { chainId: 42161 },
    { from: intent.token },
    { to: intent.token },
    { value: BigInt("1") },
    { data: "0x12345678" as const },
    {
      data: encodeFunctionData({
        abi: cashPlusVaultAbi,
        functionName: "deposit",
        args: [intent.amount, BigInt("0"), BigInt("2000"), BigInt("1")],
      }),
    },
  ])("rejects mutated reviewed intent %#", (change) => {
    expect(() =>
      validateCashPlusTransaction(
        { ...buildCashPlusTransaction(intent), ...change },
        intent,
        BigInt("1000"),
      ),
    ).toThrow("TX_INTENT_MISMATCH");
  });
  it("rejects expired intent and unknown trailing calldata", () => {
    const tx = buildCashPlusTransaction(intent);
    expect(() => validateCashPlusTransaction(tx, intent, BigInt("2001"))).toThrow("QUOTE_EXPIRED");
    expect(() =>
      validateCashPlusTransaction({ ...tx, data: `${tx.data}00` }, intent, BigInt("1000")),
    ).toThrow("TX_INTENT_MISMATCH");
  });
});
