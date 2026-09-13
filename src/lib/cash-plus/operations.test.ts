/** @id PP-CP-LIB-009 @name Cash+ operation safety rules @implements-rules-version v1 */

import type { PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";
import { CASH_PLUS_PREVIEW_SNAPSHOT } from "@/mocks/data/cashPlus";
import { parseCashPlusDeployment } from "./config/deployments";
import { manifestFixture } from "./config/testFixture";
import { assertCashPlusWallet, decodeCashPlusReceipt, prepareCashPlusIntent } from "./operations";

const deployment = parseCashPlusDeployment(manifestFixture);
const owner = "0x3333333333333333333333333333333333333333";
const snapshot = {
  ...CASH_PLUS_PREVIEW_SNAPSHOT,
  mode: "fork" as const,
  minimumDepositAssets: BigInt(1),
  capacityAssets: BigInt(1000000000),
  timestamp: 2000,
  readAt: 2000000,
};
const client = () => ({
  readContract: vi.fn().mockResolvedValue(BigInt("1000000000000000000")),
  simulateContract: vi.fn().mockResolvedValue({ result: BigInt(1000000) }),
});
describe("Cash+ exact reviewed operations", () => {
  it("binds deposit to owner, chain, policy and bounded deadline", async () => {
    const prepared = await prepareCashPlusIntent(
      client() as unknown as PublicClient,
      deployment,
      snapshot,
      owner,
      BigInt(2000000),
      "deposit",
      "1",
    );
    expect(prepared.intent).toMatchObject({
      owner,
      chainId: 31337,
      amount: BigInt(1000000),
      deadline: BigInt(2120),
      minOutput: BigInt("999000000000000000"),
    });
  });
  it("fails closed on unknown wallet balance and capacity", async () => {
    await expect(
      prepareCashPlusIntent(
        client() as unknown as PublicClient,
        deployment,
        snapshot,
        owner,
        null,
        "deposit",
        "1",
      ),
    ).rejects.toThrow("READ_UNAVAILABLE");
    await expect(
      prepareCashPlusIntent(
        client() as unknown as PublicClient,
        deployment,
        { ...snapshot, capacityAssets: null },
        owner,
        BigInt(2000000),
        "deposit",
        "1",
      ),
    ).rejects.toThrow();
  });
  it("permits oracle-free all-shares proportional review with explicit assets", async () => {
    const c = client();
    c.readContract.mockImplementation(async ({ functionName }: { functionName: string }) =>
      functionName === "componentTokens"
        ? [
            deployment.usdc.address,
            deployment.secondary.address,
            deployment.usdcAToken,
            deployment.secondaryAToken,
          ]
        : [BigInt(5), BigInt(6), BigInt(7), BigInt(8)],
    );
    c.simulateContract.mockResolvedValue({
      result: [BigInt(5), BigInt(6), BigInt(7), BigInt(8)],
    } as never);
    const result = await prepareCashPlusIntent(
      c as unknown as PublicClient,
      deployment,
      { ...snapshot, oracleHealthy: false, totalAssets: null, accountAssets: null },
      owner,
      null,
      "proportional",
      "all",
    );
    expect(result.intent.amount).toBe(snapshot.accountShares);
    expect(result.transaction.outputs).toHaveLength(4);
  });
  it("refuses partial withdrawals without a usable valuation", async () => {
    await expect(
      prepareCashPlusIntent(
        client() as unknown as PublicClient,
        deployment,
        { ...snapshot, totalAssets: null },
        owner,
        null,
        "redeem",
        "1",
      ),
    ).rejects.toThrow("ORACLE_INVALID");
  });
  it("requires a readable exact active account and chain before every signature", async () => {
    const provider = {
      request: vi
        .fn()
        .mockImplementation(async ({ method }: { method: string }) =>
          method === "eth_accounts" ? [owner] : "0x7a69",
        ),
    };
    await expect(assertCashPlusWallet(provider, owner, 31337)).resolves.toBeUndefined();
    provider.request.mockResolvedValue([]);
    await expect(assertCashPlusWallet(provider, owner, 31337)).rejects.toThrow("WALLET_CHANGED");
  });
  it("does not invent a receipt from logs without the expected vault operation", () => {
    expect(() =>
      decodeCashPlusReceipt(
        {
          logs: [],
          transactionHash: `0x${"a".repeat(64)}`,
          blockNumber: BigInt(1),
          status: "success",
        } as never,
        deployment,
        owner,
        "deposit",
      ),
    ).toThrow("RECEIPT_UNAVAILABLE");
  });
});
