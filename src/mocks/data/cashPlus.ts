/**
 * @id PP-CP-MCK-001
 * @name Cash+ explicit visual preview
 * @implements-rules-version v1
 * PP-MOCK: deterministic $1m pool and $100k investor, never substituted for a failed chain read.
 */
import type { CashPlusSnapshot } from "@/lib/cash-plus/types";

const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const SECONDARY = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";
export const CASH_PLUS_PREVIEW_OWNER = "0x1000000000000000000000000000000000000001";
const START = 1789300000;
export const CASH_PLUS_PREVIEW_SNAPSHOT: CashPlusSnapshot = {
  mode: "preview",
  deploymentId: "mock-cash-plus",
  runId: "mock-preview-v1",
  chainId: 42161,
  networkName: "Arbitrum",
  vault: null,
  blockNumber: BigInt(0),
  blockHash: null,
  timestamp: START + 3600,
  readAt: (START + 3600) * 1000,
  totalAssets: BigInt("1000123400000"),
  totalShares: BigInt("1000000000000000000000000"),
  accountShares: BigInt("100000000000000000000000"),
  accountAssets: BigInt("100012340000"),
  investedAssets: BigInt("100000000000"),
  withdrawnAssets: BigInt(0),
  resultAssets: BigInt("12340000"),
  withdrawableAssets: BigInt("100012340000"),
  capacityAssets: BigInt("299876600000"),
  depositCapAssets: BigInt("1300000000000"),
  minimumDepositAssets: BigInt("1000000"),
  interestAssets: BigInt("73400000"),
  conversionAssets: BigInt("50000000"),
  attributionComplete: true,
  depositsPaused: false,
  tradingPaused: false,
  oracleHealthy: true,
  policyVersion: BigInt(1),
  composition: [
    {
      token: USDC,
      symbol: "USDC",
      decimals: 6,
      walletRaw: BigInt("50000000000"),
      lendingRaw: BigInt("850111060000"),
      valueAssets: BigInt("900111060000"),
      weightBps: 9000,
    },
    {
      token: SECONDARY,
      symbol: "USD₮0",
      decimals: 6,
      walletRaw: BigInt(0),
      lendingRaw: BigInt("100012340000"),
      valueAssets: BigInt("100012340000"),
      weightBps: 1000,
    },
  ],
  history: [0, 1000, 1800, 2800, 7900, 9000, 12340].map((gain, index) => ({
    timestamp: START + index * 600,
    shareValueAssets: BigInt(100000000 + gain),
  })),
  activity: [
    {
      id: "mock-conversion",
      kind: "conversion",
      timestamp: START + 2400,
      blockNumber: BigInt(0),
      amountAssets: BigInt("50000000"),
      tokenSymbol: "USDC",
    },
    {
      id: "mock-park",
      kind: "park",
      timestamp: START + 60,
      blockNumber: BigInt(0),
      amountAssets: BigInt("950000000000"),
      tokenSymbol: "USDC",
    },
    {
      id: "mock-deposit",
      kind: "deposit",
      timestamp: START,
      blockNumber: BigInt(0),
      amountAssets: BigInt("100000000000"),
      tokenSymbol: "USDC",
      owner: CASH_PLUS_PREVIEW_OWNER,
    },
  ],
  historyPartial: false,
  explorerUrl: null,
};

export function createCashPlusPreviewSnapshot(): CashPlusSnapshot {
  const snapshot = structuredClone(CASH_PLUS_PREVIEW_SNAPSHOT);
  const offset = Math.floor(Date.now() / 1000) - snapshot.timestamp;
  snapshot.timestamp += offset;
  snapshot.readAt = Date.now();
  snapshot.history = snapshot.history.map((point) => ({
    ...point,
    timestamp: point.timestamp + offset,
  }));
  snapshot.activity = snapshot.activity.map((item) => ({
    ...item,
    timestamp: item.timestamp + offset,
  }));
  return snapshot;
}
