import { isFeatureEnabled } from "@/lib/features";
import {
  type SolanaLifetime,
  type SolanaTransactionRpc,
  sendSolanaTransaction,
} from "@/lib/solana/transaction";
import type { Checkpoint, LaunchDriver, LaunchJournal } from "./journal";
import { isEvmLaunchStep, type LaunchStep, type SolanaLaunchStep } from "./plan";

export interface SolanaLaunchBackend {
  /** TODO(interface): authenticated API builders must pin programs, accounts and Fund amounts. */
  build(
    step: SolanaLaunchStep,
    journal: LaunchJournal,
    lifetime?: SolanaLifetime,
  ): Promise<Uint8Array | unknown>;
  /** DEC-191: true only after atomic receive-and-credit, not attestation or mint alone. */
  credited(journal: LaunchJournal): Promise<{ credited: boolean; amount?: string }>;
  /** DEC-192: verify finalized reports with consistency 32 and the shared max-age rule. */
  reportReady(journal: LaunchJournal): Promise<boolean>;
  /** TODO(interface): caller supplies the authenticated API's {message, attestation} endpoint. */
  attestation(journal: LaunchJournal): Promise<{ message: string; attestation: string }>;
  receiveAndCredit(
    journal: LaunchJournal,
    evidence: { message: string; attestation: string },
  ): Promise<void>;
  complete(step: SolanaLaunchStep, checkpoint: Checkpoint, journal: LaunchJournal): Promise<void>;
}

/** DEC-188: route a single durable journal across Hub, Robinhood and Solana. */
export function createChainLaunchDriver(input: {
  evm: LaunchDriver<LaunchStep>;
  solanaAddress: string;
  rpc: SolanaTransactionRpc;
  signTransaction: (bytes: Uint8Array) => Promise<Uint8Array>;
  backend: SolanaLaunchBackend;
  verifyBinding: (journal: LaunchJournal) => Promise<void>;
}): LaunchDriver {
  const routed = new Map<string, LaunchJournal>();
  const requireEnabled = () => {
    if (!isFeatureEnabled("solanaSpoke")) throw new Error("SOLANA_DISABLED");
  };
  return {
    async build(step, journal) {
      if (isEvmLaunchStep(step)) return input.evm.build(step, journal);
      requireEnabled();
      await input.verifyBinding(journal);
      routed.set(step.id, journal);
      if (step.kind === "bind-solana") return { complete: true };
      if (step.kind === "report") return { complete: await input.backend.reportReady(journal) };
      if (step.kind === "solana-arrival") {
        const arrival = await input.backend.credited(journal);
        if (arrival.credited && (!arrival.amount || !/^\d+$/.test(arrival.amount)))
          throw new Error("SOLANA_CREDIT_EVIDENCE_REQUIRED");
        return { complete: arrival.credited, data: { credited: arrival.amount } };
      }
      if (step.chainKind === "svm") return { transaction: { deferred: true } };
      const transaction = await input.backend.build(step, journal);
      return { transaction };
    },
    async send(step, transaction, onSubmitted) {
      if (isEvmLaunchStep(step)) return input.evm.send(step, transaction, onSubmitted);
      requireEnabled();
      const journal = routed.get(step.id);
      if (!journal) throw new Error("SOLANA_BUILD_REQUIRED");
      await input.verifyBinding(journal);
      if (step.chainKind === "evm") {
        return input.evm.send(
          { ...step, kind: "bridge", chain: 42161, group: undefined },
          transaction,
          onSubmitted,
        );
      }
      if (!onSubmitted) throw new Error("SOLANA_JOURNAL_REQUIRED");
      return sendSolanaTransaction({
        walletAddress: input.solanaAddress,
        rpc: input.rpc,
        build: async (lifetime) => {
          const bytes = await input.backend.build(step, journal, lifetime);
          if (!(bytes instanceof Uint8Array)) throw new Error("UNSAFE_SOLANA_TRANSACTION");
          return bytes;
        },
        sign: input.signTransaction,
        persist: onSubmitted,
      });
    },
    async receipt(chain, hash) {
      if (chain !== "solana:mainnet") return input.evm.receipt(chain, hash);
      requireEnabled();
      return { status: await input.rpc.status(hash) };
    },
    async reconcile(step, checkpoint, journal) {
      if (isEvmLaunchStep(step)) return input.evm.reconcile(step, checkpoint, journal);
      requireEnabled();
      if (step.kind === "bind-solana") {
        await input.verifyBinding(journal);
        return true;
      }
      if (step.kind === "report") return input.backend.reportReady(journal);
      if (step.kind === "solana-arrival") return false;
      return false;
    },
    async complete(step, checkpoint, journal) {
      if (isEvmLaunchStep(step)) return input.evm.complete(step, checkpoint, journal);
      requireEnabled();
      if (step.kind !== "bind-solana") await input.backend.complete(step, checkpoint, journal);
    },
  };
}

/** DEC-191: manual keeper fallback stays pending until independently observed credit. */
export async function retrySolanaReceive(
  backend: SolanaLaunchBackend,
  journal: LaunchJournal,
): Promise<void> {
  if (!isFeatureEnabled("solanaSpoke")) throw new Error("SOLANA_DISABLED");
  const evidence = await backend.attestation(journal);
  if (
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(evidence.message) ||
    !/^0x(?:[0-9a-fA-F]{2})+$/.test(evidence.attestation)
  )
    throw new Error("CCTP_ATTESTATION_REQUIRED");
  await backend.receiveAndCredit(journal, evidence);
}
