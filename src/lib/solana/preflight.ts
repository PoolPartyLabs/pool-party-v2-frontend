import type { Address } from "viem";
import {
  type BindingCodec,
  type ManagerSolanaBinding,
  verifyManagerSolanaBinding,
} from "./binding";

export interface SolanaStepCost {
  stepId: string;
  rentLamports: bigint;
  feeLamports: bigint;
}

/** DEC-195: Manager pays fees/rent, keeper relays are excluded and the Fund holds no SOL. */
export function requiredManagerLamports(costs: readonly SolanaStepCost[]): bigint {
  if (!costs.length || new Set(costs.map((cost) => cost.stepId)).size !== costs.length)
    throw new Error("SOLANA_COST_ESTIMATE_REQUIRED");
  return costs.reduce((total, cost) => {
    if (!cost.stepId || cost.rentLamports < BigInt(0) || cost.feeLamports <= BigInt(0))
      throw new Error("SOLANA_COST_ESTIMATE_REQUIRED");
    return total + cost.rentLamports + cost.feeLamports;
  }, BigInt(0));
}

/** DEC-190: run before creating a journal or starting any launch transaction. */
export async function checkSolanaPrelaunch(input: {
  manager: Address;
  fundContext: string;
  connectedAddress: string | null;
  binding: ManagerSolanaBinding;
  codec: BindingCodec;
  costs: readonly SolanaStepCost[];
  balance: (address: string) => Promise<bigint>;
  evmCode: (manager: Address) => Promise<string | undefined>;
}): Promise<{ requiredLamports: bigint; balanceLamports: bigint }> {
  if (!input.connectedAddress) throw new Error("SOLANA_WALLET_REQUIRED");
  if (
    input.connectedAddress !== input.binding.solanaAddress ||
    input.manager.toLowerCase() !== input.binding.manager.toLowerCase() ||
    input.fundContext !== input.binding.fundContext
  )
    throw new Error("SOLANA_BINDING_MISMATCH");
  const code = await input.evmCode(input.manager);
  if (code !== undefined && code !== "0x") throw new Error("SOLANA_MANAGER_EOA_REQUIRED");
  if (BigInt(input.binding.authorization.expiry) < BigInt(Math.floor(Date.now() / 1000)))
    throw new Error("SOLANA_BINDING_EXPIRED");
  if (!(await verifyManagerSolanaBinding(input.binding, input.codec)))
    throw new Error("SOLANA_BINDING_INVALID");
  const requiredLamports = requiredManagerLamports(input.costs);
  const balanceLamports = await input.balance(input.connectedAddress);
  if (balanceLamports < requiredLamports) throw new Error("SOLANA_INSUFFICIENT_SOL");
  return { requiredLamports, balanceLamports };
}
