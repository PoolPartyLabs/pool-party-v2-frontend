import type { SolanaLaunchStep } from "@/features/manager/fund/launch/plan";

export const SOLANA_ACCOUNT_SPACES = Object.freeze({
  CctpLedger: 80,
  CctpRoute: 109,
  FundState: 5105,
  KaminoPosition: 161,
  RaydiumLedger: 104,
  RaydiumPolicy: 113,
  RaydiumPosition: 210,
  TokenLedger: 105,
  Transit: 250,
});

export interface SolanaCreatedAccount {
  address: string;
  label: string;
  layout:
    | { kind: "spoke"; name: keyof typeof SOLANA_ACCOUNT_SPACES }
    | { kind: "external"; bytes: number; source: string };
}

export interface SolanaCostTransaction {
  message: string;
  computeUnitLimit: number;
  createdAccounts: readonly SolanaCreatedAccount[];
}

export interface SolanaCostRpc {
  accountExists(address: string): Promise<boolean>;
  minimumBalanceForRentExemption(bytes: number): Promise<bigint>;
  feeForMessage(message: string): Promise<bigint | null>;
  recentPriorityFees(): Promise<readonly bigint[]>;
}

export interface SolanaPlanCostEstimator {
  transactions(step: SolanaLaunchStep): Promise<readonly SolanaCostTransaction[]>;
  priorityFeeMarginBps: number;
  rpc?: SolanaCostRpc;
}

export interface SolanaComputedStepCost {
  stepId: string;
  rentLamports: bigint;
  feeLamports: bigint;
  baseFeeLamports: bigint;
  priorityFeeLamports: bigint;
  priorityMarginLamports: bigint;
  accounts: readonly { address: string; label: string; bytes: number; rentLamports: bigint }[];
  transactionCount: number;
}

export function isManagerSolanaTransaction(step: SolanaLaunchStep): boolean {
  return step.chainKind === "svm" && step.kind !== "solana-arrival";
}

/** DEC-195: estimate only actual Manager transactions; keeper relays never spend Fund SOL. */
export async function estimateSolanaPlanCosts(
  steps: readonly SolanaLaunchStep[],
  estimator: SolanaPlanCostEstimator,
  rpc: SolanaCostRpc,
): Promise<SolanaComputedStepCost[]> {
  if (!Number.isSafeInteger(estimator.priorityFeeMarginBps) || estimator.priorityFeeMarginBps <= 0)
    throw new Error("SOLANA_PRIORITY_MARGIN_REQUIRED");
  const managerSteps = steps.filter(isManagerSolanaTransaction);
  if (
    !managerSteps.length ||
    new Set(managerSteps.map((step) => step.id)).size !== managerSteps.length
  )
    throw new Error("SOLANA_COST_ESTIMATE_REQUIRED");
  const samples = await rpc.recentPriorityFees();
  if (!samples.length || samples.some((fee) => fee < BigInt(0)))
    throw new Error("SOLANA_PRIORITY_ESTIMATE_REQUIRED");
  const priorityPrice = samples.reduce(
    (maximum, fee) => (fee > maximum ? fee : maximum),
    BigInt(0),
  );
  const counted = new Map<string, number>();
  const costs: SolanaComputedStepCost[] = [];
  for (const step of managerSteps) {
    const transactions = await estimator.transactions(step);
    if (!transactions.length) throw new Error("SOLANA_COST_ESTIMATE_REQUIRED");
    const cost: SolanaComputedStepCost = {
      stepId: step.id,
      rentLamports: BigInt(0),
      feeLamports: BigInt(0),
      baseFeeLamports: BigInt(0),
      priorityFeeLamports: BigInt(0),
      priorityMarginLamports: BigInt(0),
      accounts: [],
      transactionCount: transactions.length,
    };
    const accounts: { address: string; label: string; bytes: number; rentLamports: bigint }[] = [];
    for (const transaction of transactions) {
      if (
        !transaction.message ||
        !Number.isSafeInteger(transaction.computeUnitLimit) ||
        transaction.computeUnitLimit <= 0 ||
        transaction.computeUnitLimit > 1400000
      )
        throw new Error("SOLANA_COST_ESTIMATE_REQUIRED");
      const baseFee = await rpc.feeForMessage(transaction.message);
      if (baseFee === null || baseFee <= BigInt(0)) throw new Error("SOLANA_FEE_ESTIMATE_REQUIRED");
      const priorityFee =
        (priorityPrice * BigInt(transaction.computeUnitLimit) + BigInt(999999)) / BigInt(1000000);
      const margin =
        ((baseFee + priorityFee) * BigInt(estimator.priorityFeeMarginBps) + BigInt(9999)) /
        BigInt(10000);
      cost.baseFeeLamports += baseFee;
      cost.priorityFeeLamports += priorityFee;
      cost.priorityMarginLamports += margin;
      for (const account of transaction.createdAccounts) {
        const bytes =
          account.layout.kind === "spoke"
            ? SOLANA_ACCOUNT_SPACES[account.layout.name]
            : account.layout.bytes;
        if (
          !account.address ||
          !account.label ||
          !Number.isSafeInteger(bytes) ||
          bytes <= 0 ||
          (account.layout.kind === "external" && !account.layout.source)
        )
          throw new Error("SOLANA_ACCOUNT_LAYOUT_REQUIRED");
        const previous = counted.get(account.address);
        if (previous !== undefined && previous !== bytes)
          throw new Error("SOLANA_ACCOUNT_LAYOUT_MISMATCH");
        if (previous !== undefined) continue;
        counted.set(account.address, bytes);
        if (await rpc.accountExists(account.address)) continue;
        const rentLamports = await rpc.minimumBalanceForRentExemption(bytes);
        if (rentLamports <= BigInt(0)) throw new Error("SOLANA_RENT_ESTIMATE_REQUIRED");
        accounts.push({ address: account.address, label: account.label, bytes, rentLamports });
        cost.rentLamports += rentLamports;
      }
    }
    cost.accounts = accounts;
    cost.feeLamports =
      cost.baseFeeLamports + cost.priorityFeeLamports + cost.priorityMarginLamports;
    costs.push(cost);
  }
  return costs;
}
