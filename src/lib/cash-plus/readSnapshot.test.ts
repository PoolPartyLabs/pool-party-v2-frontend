/** @id PP-CP-LIB-008 @name Cash+ snapshot isolation rules @implements-rules-version v1 */
import type { PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";
import { parseCashPlusDeployment } from "./config/deployments";
import { manifestFixture } from "./config/testFixture";
import { readCashPlusSnapshot } from "./readSnapshot";

const owner = "0x3333333333333333333333333333333333333333";
const ok = (result: unknown) => ({ status: "success", result });
function setup(overrides: Record<string, unknown> = {}) {
  const status = {
    initialized: true,
    depositsPaused: false,
    tradingPaused: false,
    emergencyMode: false,
    valuationAvailable: true,
    assetsUsdc: BigInt("200000000"),
    shares: BigInt("200") * BigInt("10") ** BigInt("18"),
    depositCap: BigInt("1000000000"),
    minDeposit: BigInt("1000000"),
    policyVersion: BigInt("1"),
  };
  const inventory = [
    {
      token: manifestFixture.usdc.address,
      adapter: manifestFixture.usdcAdapter,
      receiptToken: manifestFixture.usdcAToken,
      decimals: 6,
      walletBalance: BigInt("10000000"),
      adapterIdleBalance: BigInt("0"),
      lendingBalance: BigInt("190000000"),
      valueUsdc: BigInt("200000000"),
    },
  ];
  const client = {
    getBlock: vi.fn().mockResolvedValue({
      number: BigInt("125"),
      hash: `0x${"b".repeat(64)}`,
      timestamp: BigInt("2000"),
    }),
    multicall: vi
      .fn()
      .mockResolvedValue([
        ok(status),
        ok(inventory),
        ok(BigInt("100") * BigInt("10") ** BigInt("18")),
        ok([BigInt("90000000"), BigInt("0"), false]),
        ok(BigInt("50000000")),
      ]),
    simulateContract: vi.fn().mockResolvedValue({ result: BigInt("100000000") }),
    ...overrides,
  };
  return client;
}

describe("Cash+ chain snapshots", () => {
  // @rule R10: account ownership, price and cashflows share one pinned block and are not duplicated.
  it("maps a proportional claim and lifetime result at one block", async () => {
    const client = setup();
    const { snapshot, walletBalanceAssets } = await readCashPlusSnapshot(
      client as unknown as PublicClient,
      parseCashPlusDeployment(manifestFixture),
      owner,
    );
    expect(snapshot.accountAssets).toBe(BigInt("100000000"));
    expect(snapshot.resultAssets).toBe(BigInt("10000000"));
    expect(snapshot.capacityAssets).toBe(BigInt("800000000"));
    expect(snapshot.withdrawableAssets).toBe(BigInt("100000000"));
    expect(walletBalanceAssets).toBe(BigInt("50000000"));
    expect(client.multicall.mock.calls[0]![0].blockNumber).toBe(BigInt("125"));
  });
  // @rule R11: a failed balance read never turns into a usable zero or capacity fallback.
  it("retains unknown wallet balance and unknown cash liquidity", async () => {
    const client = setup({
      simulateContract: vi.fn().mockRejectedValue(new Error("LIQUIDITY_INSUFFICIENT")),
    });
    const results = await client.multicall();
    results[4] = { status: "failure", error: new Error("429") };
    client.multicall.mockResolvedValue(results);
    const result = await readCashPlusSnapshot(
      client as unknown as PublicClient,
      parseCashPlusDeployment(manifestFixture),
      owner,
    );
    expect(result.walletBalanceAssets).toBeNull();
    expect(result.snapshot.withdrawableAssets).toBeNull();
  });
  it("does not display a claim from failed private-account reads", async () => {
    const client = setup();
    const results = await client.multicall();
    results[2] = { status: "failure", error: new Error("RPC") };
    client.multicall.mockResolvedValue(results);
    await expect(
      readCashPlusSnapshot(
        client as unknown as PublicClient,
        parseCashPlusDeployment(manifestFixture),
        owner,
      ),
    ).rejects.toThrow("READ_UNAVAILABLE");
  });
});
