/**
 * @id PP-CP-LIB-001
 * @name Cash+ domain and page controller
 * @implements-rules-version v1
 */
import type { Address, Hash, Hex } from "viem";

export type CashPlusMode = "preview" | "fork" | "live";
export type CashPlusOperationKind = "deposit" | "redeem" | "proportional";

export interface CashPlusActivity {
  id: string;
  kind: "deposit" | "redeem" | "proportional" | "conversion" | "park" | "unpark";
  timestamp: number;
  transactionHash?: Hash;
  blockNumber: bigint;
  amountAssets: bigint | null;
  tokenSymbol: string;
  owner?: Address;
  tokenIn?: Address;
  tokenOut?: Address;
  amountIn?: bigint;
  amountOut?: bigint;
}

export interface CashPlusSnapshot {
  mode: CashPlusMode;
  deploymentId: string;
  runId: string;
  chainId: number;
  networkName: string;
  vault: Address | null;
  blockNumber: bigint;
  blockHash: Hash | null;
  timestamp: number;
  readAt: number;
  totalAssets: bigint | null;
  totalShares: bigint;
  accountShares: bigint;
  accountAssets: bigint | null;
  investedAssets: bigint;
  withdrawnAssets: bigint | null;
  resultAssets: bigint | null;
  withdrawableAssets: bigint | null;
  capacityAssets: bigint | null;
  depositCapAssets: bigint;
  minimumDepositAssets: bigint;
  interestAssets: bigint | null;
  conversionAssets: bigint | null;
  attributionComplete: boolean;
  depositsPaused: boolean;
  tradingPaused: boolean;
  oracleHealthy: boolean;
  policyVersion: bigint;
  composition: Array<{
    token: Address;
    symbol: string;
    decimals: number;
    walletRaw: bigint;
    lendingRaw: bigint;
    valueAssets: bigint | null;
    weightBps: number | null;
  }>;
  history: Array<{ timestamp: number; shareValueAssets: bigint }>;
  activity: CashPlusActivity[];
  historyPartial: boolean;
  explorerUrl: string | null;
}

export interface CashPlusReceipt {
  hash?: Hash;
  simulated?: boolean;
  blockNumber: bigint;
  kind: CashPlusOperationKind;
  assets: bigint | null;
  shares: bigint;
  tokens: Array<{ address: Address; symbol: string; decimals: number; amount: bigint }>;
}

export interface CashPlusTransaction {
  phase:
    | "idle"
    | "preflight"
    | "review"
    | "approval"
    | "signature"
    | "pending"
    | "success"
    | "error";
  kind: CashPlusOperationKind;
  amountAssets?: bigint;
  minAssets?: bigint;
  shares?: bigint;
  minShares?: bigint;
  deadline?: number;
  hash?: Hash;
  errorCode?: string;
  receipt?: CashPlusReceipt;
  outputs?: Array<{ address: Address; symbol: string; decimals: number; amount: bigint }>;
}

export interface CashPlusController {
  snapshot: CashPlusSnapshot | null;
  status: "loading" | "ready" | "stale" | "error";
  error?: string;
  wallet: {
    connected: boolean;
    address?: Address;
    correctChain: boolean;
    balanceAssets: bigint | null;
  };
  transaction: CashPlusTransaction;
  review(kind: CashPlusOperationKind, exactAmount: string): Promise<void>;
  confirm(): Promise<void>;
  resetTransaction(): void;
  refresh(): Promise<void>;
  loadEarlierHistory?(): Promise<void>;
  connect(): void;
  switchNetwork(): Promise<void>;
  demo?: {
    advanceDay(): Promise<void>;
    reset(): void;
    advancing: boolean;
    walletTokens: Array<{ address: Address; symbol: string; decimals: number; amount: bigint }>;
  };
}

export interface CashPlusIntent {
  version: 1;
  operationId: string;
  kind: CashPlusOperationKind | "approve";
  chainId: number;
  owner: Address;
  vault: Address;
  token: Address;
  amount: bigint;
  minOutput: bigint;
  deadline: bigint;
  policyVersion: bigint;
  redeemAll: boolean;
  minimumComponents: readonly bigint[];
}

export interface CashPlusUnsignedTransaction {
  chainId: number;
  from: Address;
  to: Address;
  data: Hex;
  value: bigint;
}
