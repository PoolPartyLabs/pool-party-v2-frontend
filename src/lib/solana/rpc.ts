import {
  address,
  createSolanaRpc,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  signature,
  type TransactionMessageBytesBase64,
} from "@solana/kit";
import type { SolanaCostRpc } from "./costs";
import { solanaRpcUrl } from "./rpcEndpoint";
import type { SolanaTransactionRpc } from "./transaction";

export function createSolanaCostRpc(): SolanaCostRpc {
  const rpc = createSolanaRpc(solanaRpcUrl());
  return {
    accountExists: async (key) =>
      (
        await rpc
          .getAccountInfo(address(key), { encoding: "base64", commitment: "finalized" })
          .send()
      ).value !== null,
    minimumBalanceForRentExemption: (bytes) =>
      rpc.getMinimumBalanceForRentExemption(BigInt(bytes), { commitment: "finalized" }).send(),
    feeForMessage: async (message) =>
      (
        await rpc
          .getFeeForMessage(message as TransactionMessageBytesBase64, { commitment: "finalized" })
          .send()
      ).value,
    recentPriorityFees: async () =>
      (await rpc.getRecentPrioritizationFees().send()).map((sample) => sample.prioritizationFee),
  };
}

/** DEC-190, DEC-192: explicit finalized confirmation and historical signature reconciliation. */
export function createManagerSolanaRpc(): SolanaTransactionRpc {
  const rpc = createSolanaRpc(solanaRpcUrl());
  return {
    genesisHash: () => rpc.getGenesisHash().send(),
    blockHeight: () => rpc.getBlockHeight({ commitment: "confirmed" }).send(),
    send: (bytes) =>
      rpc
        .sendTransaction(getBase64EncodedWireTransaction(getTransactionDecoder().decode(bytes)), {
          encoding: "base64",
          skipPreflight: false,
          preflightCommitment: "finalized",
          maxRetries: BigInt(3),
        })
        .send(),
    status: async (hash) => {
      const result = await rpc
        .getSignatureStatuses([signature(hash)], { searchTransactionHistory: true })
        .send();
      const receipt = result.value[0];
      if (!receipt) return "unknown";
      if (receipt.err) return "reverted";
      return receipt.confirmationStatus === "finalized" ? "success" : "unknown";
    },
  };
}

/** The commitment a signature reached, `failed` when it landed with an error, `unknown` otherwise. */
export async function readSolanaConfirmation(
  hash: string,
): Promise<"finalized" | "confirmed" | "processed" | "failed" | "unknown"> {
  const result = await createSolanaRpc(solanaRpcUrl())
    .getSignatureStatuses([signature(hash)], { searchTransactionHistory: true })
    .send();
  const receipt = result.value[0];
  if (!receipt) return "unknown";
  if (receipt.err) return "failed";
  return receipt.confirmationStatus ?? "unknown";
}
