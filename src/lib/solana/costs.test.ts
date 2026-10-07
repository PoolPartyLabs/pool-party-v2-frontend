import { expect, it, vi } from "vitest";
import type { SolanaLaunchStep } from "@/features/manager/fund/launch/plan";
import {
  estimateSolanaPlanCosts,
  SOLANA_ACCOUNT_SPACES,
  type SolanaCostRpc,
  type SolanaPlanCostEstimator,
} from "./costs";

const step = (
  id: string,
  kind: SolanaLaunchStep["kind"],
  chainKind: "evm" | "svm" = "svm",
): SolanaLaunchStep => ({
  id,
  kind,
  chainKind,
  chain: chainKind === "svm" ? "solana:mainnet" : 42161,
  dependencies: [],
  group: "solana",
});
function fixture() {
  const rpc: SolanaCostRpc = {
    accountExists: vi.fn(async () => false),
    minimumBalanceForRentExemption: vi.fn(async (bytes) => BigInt(bytes * 10)),
    feeForMessage: vi.fn(async () => BigInt(5000)),
    recentPriorityFees: vi.fn(async () => [BigInt(500), BigInt(1000)]),
  };
  const estimator: SolanaPlanCostEstimator = {
    priorityFeeMarginBps: 2000,
    transactions: vi.fn(async () => [
      {
        message: "base64-message",
        computeUnitLimit: 100000,
        createdAccounts: [
          {
            address: "fund",
            label: "Fund state",
            layout: { kind: "spoke" as const, name: "FundState" as const },
          },
        ],
      },
    ]),
  };
  return { rpc, estimator };
}
it("queries program account rent plus transaction and priority fees, excluding keeper steps", async () => {
  const { rpc, estimator } = fixture();
  const result = await estimateSolanaPlanCosts(
    [
      step("solana:init", "init-solana"),
      step("solana:arrival", "solana-arrival"),
      step("solana:send", "cctp-fast", "evm"),
    ],
    estimator,
    rpc,
  );
  expect(estimator.transactions).toHaveBeenCalledTimes(1);
  expect(rpc.minimumBalanceForRentExemption).toHaveBeenCalledWith(SOLANA_ACCOUNT_SPACES.FundState);
  expect(result[0]).toMatchObject({
    rentLamports: BigInt(54620),
    baseFeeLamports: BigInt(5000),
    priorityFeeLamports: BigInt(100),
    priorityMarginLamports: BigInt(1020),
    feeLamports: BigInt(6120),
    transactionCount: 1,
  });
  expect(result[0]?.accounts[0]).toMatchObject({ bytes: 5462, rentLamports: BigInt(54620) });
});
it("changes the budget with selected steps without charging shared or existing account rent twice", async () => {
  const { rpc, estimator } = fixture();
  vi.mocked(rpc.accountExists).mockImplementation(async (key) => key === "existing");
  vi.mocked(estimator.transactions).mockImplementation(async (entry) => [
    {
      message: entry.id,
      computeUnitLimit: 100000,
      createdAccounts: [
        { address: "fund", label: "Fund state", layout: { kind: "spoke", name: "FundState" } },
        {
          address: entry.id === "solana:init" ? "existing" : "position",
          label: "Position",
          layout: { kind: "spoke", name: "RaydiumPosition" },
        },
      ],
    },
  ]);
  const costs = await estimateSolanaPlanCosts(
    [step("solana:init", "init-solana"), step("solana:open", "raydium-open")],
    estimator,
    rpc,
  );
  expect(costs.map((cost) => cost.rentLamports)).toEqual([BigInt(54620), BigInt(2100)]);
  expect(rpc.accountExists).toHaveBeenCalledTimes(3);
  expect(costs[1]?.feeLamports).toBe(BigInt(6120));
});
it("queries extension-aware external account sizes supplied by the actual builder", async () => {
  const { rpc, estimator } = fixture();
  vi.mocked(estimator.transactions).mockResolvedValue([
    {
      message: "message",
      computeUnitLimit: 1,
      createdAccounts: [
        {
          address: "ata",
          label: "Token-2022 ATA",
          layout: { kind: "external", bytes: 182, source: "Token-2022 mint-extension decoder" },
        },
      ],
    },
  ]);
  await estimateSolanaPlanCosts([step("init", "init-solana")], estimator, rpc);
  expect(rpc.minimumBalanceForRentExemption).toHaveBeenCalledWith(182);
});
it.each([
  "missing-transactions",
  "missing-fee",
  "empty-priority",
  "missing-margin",
  "negative-rent",
  "layout-mismatch",
])("fails closed on %s", async (failure) => {
  const { rpc, estimator } = fixture();
  if (failure === "missing-transactions") vi.mocked(estimator.transactions).mockResolvedValue([]);
  if (failure === "missing-fee") vi.mocked(rpc.feeForMessage).mockResolvedValue(null);
  if (failure === "empty-priority") vi.mocked(rpc.recentPriorityFees).mockResolvedValue([]);
  if (failure === "missing-margin") estimator.priorityFeeMarginBps = 0;
  if (failure === "negative-rent")
    vi.mocked(rpc.minimumBalanceForRentExemption).mockResolvedValue(BigInt(-1));
  if (failure === "layout-mismatch")
    vi.mocked(estimator.transactions).mockImplementation(async (entry) => [
      {
        message: "message",
        computeUnitLimit: 1,
        createdAccounts: [
          {
            address: "same",
            label: "Account",
            layout: { kind: "external", bytes: entry.id === "init" ? 165 : 182, source: "IDL" },
          },
        ],
      },
    ]);
  await expect(
    estimateSolanaPlanCosts(
      [step("init", "init-solana"), step("open", "raydium-open")],
      estimator,
      rpc,
    ),
  ).rejects.toThrow();
});
