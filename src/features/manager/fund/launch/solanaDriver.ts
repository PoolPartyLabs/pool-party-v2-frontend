import { isFeatureEnabled } from "@/lib/features";
import { type ManagerSolanaBinding, solanaBootstrapDigest } from "@/lib/solana/binding";
import {
  bootstrapChunks,
  type SolanaBootstrapManifest,
  validateBootstrapTransaction,
} from "@/lib/solana/bootstrap";
import { requireSolanaLpChoice } from "@/lib/solana/lpChoices";
import { requireSolanaOracleReference, type SolanaOracleReference } from "@/lib/solana/oracle";
import {
  resolveMaxPriceImpactBps,
  type SolanaApiSignedQuote,
  type SolanaSwapQuoteRequest,
  validateSolanaApiQuote,
} from "@/lib/solana/swap";
import {
  type SolanaLifetime,
  type SolanaTransactionRpc,
  sendSolanaTransaction,
} from "@/lib/solana/transaction";
import type { Checkpoint, LaunchDriver, LaunchJournal } from "./journal";
import { isEvmLaunchStep, type LaunchStep, type SolanaLaunchStep } from "./plan";
import type { SolanaLaunchSelection } from "./solanaPlan";

export interface SolanaLaunchBackend {
  /** TODO(interface): independent pinned decoder validates exact operation/accounts/data before signing. */
  validateTransactionIntent?(
    bytes: Uint8Array,
    step: SolanaLaunchStep,
    journal: LaunchJournal,
  ): Promise<boolean>;
  /** TODO(interface): read owner/PDA-verified accounts, never infer success from a submitted signature. */
  bootstrapState?(journal: LaunchJournal): Promise<{
    policyHash: string;
    fundPda: string;
    managerSolana: string;
    totalLength: number;
    payload: string;
    sealed: boolean;
    initialized: boolean;
    bootstrapDigest?: string;
  } | null>;
  referencePrice?(poolId: string): Promise<SolanaOracleReference>;
  /** TODO(interface): authenticated API builders must pin programs, accounts and Fund amounts. */
  build(
    step: SolanaLaunchStep,
    journal: LaunchJournal,
    lifetime?: SolanaLifetime,
    quote?: SolanaApiSignedQuote,
  ): Promise<Uint8Array | unknown>;
  /** DEC-197: OUR authenticated/rate-limited API; never browser calls to Jupiter. */
  quoteSwap?(request: SolanaSwapQuoteRequest, journal: LaunchJournal): Promise<unknown>;
  /** TODO(interface): verify signature with pinned API signer over ALL DTO fields/payload. */
  verifySwapQuote?(quote: SolanaApiSignedQuote, request: SolanaSwapQuoteRequest): Promise<boolean>;
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
  const bootstrapEvidence = async (step: SolanaLaunchStep, journal: LaunchJournal) => {
    if (!input.backend.bootstrapState) throw new Error("SOLANA_BOOTSTRAP_READER_REQUIRED");
    const frozen = journal.frozen as {
      solanaBootstrap?: SolanaBootstrapManifest;
      solanaBinding?: ManagerSolanaBinding;
    };
    const manifest = frozen.solanaBootstrap;
    const binding = frozen.solanaBinding;
    if (!manifest || !binding?.bootstrapAuthorization || !binding.bootstrapSignature)
      throw new Error("SOLANA_BOOTSTRAP_REQUIRED");
    const chunks = bootstrapChunks(manifest);
    const authorization = binding.bootstrapAuthorization;
    if (
      manifest.policyHash !== authorization.policyHash ||
      binding.solanaAddress !== input.solanaAddress
    )
      throw new Error("SOLANA_BOOTSTRAP_MISMATCH");
    const chunk = step.bootstrapChunk;
    if (
      step.kind !== "init-solana" &&
      (!chunk || !chunks.some((entry) => JSON.stringify(entry) === JSON.stringify(chunk)))
    )
      throw new Error("SOLANA_BOOTSTRAP_MISMATCH");
    const state = await input.backend.bootstrapState(journal);
    if (!state) return { ready: false, state };
    if (
      state.policyHash !== manifest.policyHash ||
      state.fundPda !== authorization.fundPda ||
      state.managerSolana !== input.solanaAddress
    )
      throw new Error("SOLANA_BOOTSTRAP_MISMATCH");
    if (state.initialized) {
      if (state.bootstrapDigest !== solanaBootstrapDigest(input.solanaAddress, authorization))
        throw new Error("SOLANA_BOOTSTRAP_MISMATCH");
      return { ready: true, state };
    }
    if (
      state.totalLength !== (manifest.payload.length - 2) / 2 ||
      !/^0x(?:[0-9a-fA-F]{2})*$/.test(state.payload) ||
      !manifest.payload.toLowerCase().startsWith(state.payload.toLowerCase()) ||
      ![0, ...chunks.map((entry) => entry.offset + (entry.chunk.length - 2) / 2)].includes(
        (state.payload.length - 2) / 2,
      ) ||
      (state.sealed && state.payload.length !== manifest.payload.length)
    )
      throw new Error("SOLANA_BOOTSTRAP_MISMATCH");
    if (step.kind === "init-solana") return { ready: false, state };
    if (!chunk) throw new Error("SOLANA_BOOTSTRAP_MISMATCH");
    const end = (chunk.offset + (chunk.chunk.length - 2) / 2) * 2 + 2;
    return { ready: state.payload.length >= end && (!chunk.seal || state.sealed), state };
  };
  const bootstrapReady = async (step: SolanaLaunchStep, journal: LaunchJournal) =>
    (await bootstrapEvidence(step, journal)).ready;
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
      if (["stage-solana-config", "seal-solana-config", "init-solana"].includes(step.kind)) {
        if (await bootstrapReady(step, journal)) return { complete: true };
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
      if (["stage-solana-config", "seal-solana-config", "init-solana"].includes(step.kind)) {
        const { ready, state } = await bootstrapEvidence(step, journal);
        if (ready) throw new Error("SOLANA_BOOTSTRAP_ALREADY_APPLIED");
        if (
          (step.kind === "init-solana" && !state?.sealed) ||
          (step.bootstrapChunk &&
            (state ? (state.payload.length - 2) / 2 : 0) !== step.bootstrapChunk.offset)
        )
          throw new Error("SOLANA_BOOTSTRAP_ORDER_REQUIRED");
      }
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
          let quote: SolanaApiSignedQuote | undefined;
          let request: SolanaSwapQuoteRequest | undefined;
          if (step.kind === "swap-to-ratio" || step.kind === "raydium-open") {
            const choice = requireSolanaLpChoice(step.config?.poolId ?? "");
            requireSolanaOracleReference(
              await input.backend.referencePrice?.(choice.poolId),
              choice.stockMarketHoursRequired,
            );
            const frozen = journal.frozen as {
              solanaBinding?: ManagerSolanaBinding;
              solanaSelection?: SolanaLaunchSelection;
            };
            const binding = frozen.solanaBinding;
            if (
              !binding ||
              binding.solanaAddress !== input.solanaAddress ||
              binding.manager.toLowerCase() !== journal.manager ||
              !step.config?.poolId ||
              step.config.maxPriceImpactBps === undefined ||
              frozen.solanaSelection?.raydiumPool !== step.config.poolId ||
              frozen.solanaSelection?.maxPriceImpactBps !== step.config.maxPriceImpactBps
            )
              throw new Error("SOLANA_API_QUOTE_REQUIRED");
            request = {
              poolId: step.config.poolId,
              fund: binding.authorization.fund,
              solanaAddress: input.solanaAddress,
              maxPriceImpactBps: resolveMaxPriceImpactBps(step.config.maxPriceImpactBps),
            };
            if (step.kind === "swap-to-ratio") {
              if (!input.backend.quoteSwap || !input.backend.verifySwapQuote)
                throw new Error("SOLANA_API_QUOTE_REQUIRED");
              quote = validateSolanaApiQuote(
                await input.backend.quoteSwap(request, journal),
                request,
              );
              if (!(await input.backend.verifySwapQuote(quote, request)))
                throw new Error("SOLANA_API_QUOTE_SIGNATURE_INVALID");
            }
          }
          const bytes = await input.backend.build(step, journal, lifetime, quote);
          if (quote && request) validateSolanaApiQuote(quote, request);
          if (!(bytes instanceof Uint8Array)) throw new Error("UNSAFE_SOLANA_TRANSACTION");
          if (["stage-solana-config", "seal-solana-config", "init-solana"].includes(step.kind)) {
            const binding = (journal.frozen as { solanaBinding?: ManagerSolanaBinding })
              .solanaBinding;
            if (!binding?.bootstrapAuthorization) throw new Error("SOLANA_BOOTSTRAP_REQUIRED");
            await validateBootstrapTransaction({
              bytes,
              manager: input.solanaAddress,
              authorization: binding.bootstrapAuthorization,
              chunk: step.bootstrapChunk,
            });
          }
          await input.verifyBinding(journal);
          if (
            !input.backend.validateTransactionIntent ||
            !(await input.backend.validateTransactionIntent(bytes, step, journal))
          )
            throw new Error("UNSAFE_SOLANA_TRANSACTION");
          return bytes;
        },
        sign: input.signTransaction,
        persist: onSubmitted,
      });
    },
    async receipt(chain, hash) {
      if (chain !== "solana:mainnet") return input.evm.receipt(chain, hash);
      requireEnabled();
      if ((await input.rpc.genesisHash()) !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")
        throw new Error("SOLANA_CLUSTER_MISMATCH");
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
      if (["stage-solana-config", "seal-solana-config", "init-solana"].includes(step.kind)) {
        await input.verifyBinding(journal);
        return bootstrapReady(step, journal);
      }
      return false;
    },
    async complete(step, checkpoint, journal) {
      if (isEvmLaunchStep(step)) return input.evm.complete(step, checkpoint, journal);
      requireEnabled();
      if (["stage-solana-config", "seal-solana-config", "init-solana"].includes(step.kind)) {
        if (!(await bootstrapReady(step, journal))) throw new Error("SOLANA_BOOTSTRAP_NOT_APPLIED");
      }
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
