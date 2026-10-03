/**
 * @id PP-STR-LIB-029 (POO-2175)
 * @name v2FundsFixtures
 * @implements-rules-version v2
 * PP-MOCK: isolated diversified fund, holder, simulated preview and history fixtures.
 */

import { estimateDeposit } from "@/features/funds/fundModel";
import type { FundBuild, FundHolder, FundPositionDetail, FundView } from "@/lib/api/v2/fundSchemas";
export const mockWallet = `0x${"1".repeat(40)}`;
const core = `0x${"2".repeat(40)}`;
const positionKey = `0x${"3".repeat(64)}`;
const version = { protocolVersion: "v2" as const };
const token = { ...version, address: mockWallet, symbol: "USDC", decimals: 6 };
const position = {
  ...version,
  chainId: "42161",
  positionKey,
  adapterKind: "aave-v3",
  status: "open",
  tokens: [token],
  valueUsd: "250000",
  currentValueUsd: "250000",
  uncollectedIncomeUsd: "312.45",
  shareOfNav: "25",
  uniswap: null,
  aave: {
    ...version,
    currentBalance: { ...version, raw: "250000000000", decimal: "250000" },
    supplyApy: "4.21",
  },
  holderExposure: { ...version, valueUsd: "2500", amount0: "2500" },
};
export const mockFund: FundView = {
  ...version,
  creationNumber: "1",
  fundId: positionKey,
  manager: mockWallet,
  mandateHash: positionKey,
  coreVault: core,
  shareToken: mockWallet,
  valueReportReceiver: mockWallet,
  profile: {
    ...version,
    name: "Balanced Income",
    description: "Diversified lending and liquidity across Arbitrum and Robinhood.",
    spokeCapPercent: 60,
  },
  chains: [42161, 4663].map((chain) => ({
    ...version,
    chainId: String(chain) as "42161" | "4663",
    spokeVault: core,
    uniswapV3SwapAdapter: mockWallet,
    status: "created" as const,
  })),
  mandate: {
    ...version,
    manager: mockWallet,
    hubChainId: "42161",
    hubWormholeChainId: 23,
    usdc: mockWallet,
    tokens: [],
    adapters: [],
    swapAdapters: [],
    pools: [],
    bridgeAdapters: [],
    operatingCash: [],
    spokes: [
      {
        ...version,
        chainId: "4663",
        wormholeChainId: 72,
        spokeVault: positionKey,
        spokeToken: mockWallet,
        spokeCap: "1000000000000",
        maxReportAge: 1588,
      },
    ],
    payoutFeeBps: 200,
    minFirstDeposit: "2000000",
    performanceFeeBps: 2000,
    managementFeeBps: 0,
  },
  state: "Open",
  fundState: 0,
  sharePrice: "1000000000000000000000000",
  shareAssets: "1000000000000",
  grossAssets: "1002500000000",
  idle: "200000000000",
  freeIdle: "190000000000",
  payoutReserve: "10000000000",
  inFlightValue: "100000000000",
  totalSupply: "1000000000000000000000000",
  lastReport: {
    ...version,
    ageSeconds: 120,
    report: { ...version, sequence: "42", timestamp: String(Math.floor(Date.now() / 1000) - 120) },
  },
  positionsSummary: { ...version, positions: [position] },
  limits: { ...version, spokeCapEnforcedOnChain: false },
  limitsUsage: { ...version, network: [{ ...version, currentPercent: "40", percent: 60 }] },
  fees: {
    ...version,
    flowFeeBps: 25,
    payoutFeeBps: 200,
    performanceFeeBps: 2000,
    managementFeeBps: 0,
    standardPayoutTermSeconds: 259200,
  },
};
export const mockHolder: FundHolder = {
  ...version,
  shares: "10000000000000000000000",
  value: "10000000000",
  incomeOwed: "325000000",
  incomeWithdrawal: ["0", false],
  claimable: false,
  payout: {
    ...version,
    open: false,
    usdcOutstanding: "0",
    termEndsAt: "0",
    awaitingSettlement: false,
  },
  positionsSummary: { ...version, positions: [position] },
  positions: [position],
};
export const mockPositionDetail: FundPositionDetail = {
  ...version,
  position,
  history: {
    ...version,
    complete: true,
    events: [
      {
        ...version,
        type: "opened",
        timestamp: "2026-10-03T12:00:00Z",
        transactionHash: positionKey,
      },
    ],
  },
};
export function mockFundBuild(intent: { action: string; amount?: string }): FundBuild {
  const gross = BigInt(intent.amount ?? "0");
  const flowFee = (gross * BigInt(25)) / BigInt(10000);
  const payoutFee = (gross * BigInt(200)) / BigInt(10000);
  return {
    ...version,
    transactions: [
      { ...version, to: core, from: mockWallet, data: "0x", value: "0", chainId: 42161 },
    ],
    preview:
      intent.action === "deposit"
        ? {
            ...version,
            ...estimateDeposit(intent.amount ?? "2000000", mockFund.sharePrice),
            sharePrice: mockFund.sharePrice,
          }
        : {
            ...version,
            usdcGross: intent.amount ?? "0",
            payoutFee: payoutFee.toString(),
            flowFee: flowFee.toString(),
            usdcPaid: (gross - flowFee - payoutFee).toString(),
          },
  };
}
