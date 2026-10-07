"use client";

import { useRef, useState } from "react";
import type { Address } from "viem";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import type { BindingCodec, ManagerSolanaBinding } from "@/lib/solana/binding";
import { bootstrapChunks, type SolanaBootstrapManifest } from "@/lib/solana/bootstrap";
import {
  estimateSolanaPlanCosts,
  type SolanaComputedStepCost,
  type SolanaPlanCostEstimator,
} from "@/lib/solana/costs";
import { requireSolanaLpChoice } from "@/lib/solana/lpChoices";
import { requireSolanaOracleReference } from "@/lib/solana/oracle";
import { checkSolanaPrelaunch } from "@/lib/solana/preflight";
import { createManagerSolanaRpc, createSolanaCostRpc } from "@/lib/solana/rpc";
import {
  readManagerSolanaBalance,
  useManagerSolanaWallet,
} from "@/lib/solana/useManagerSolanaWallet";
import {
  createJournal,
  type JournalStorage,
  journalKey,
  type LaunchDriver,
  type LaunchJournal,
  loadJournal,
  runLaunch,
  saveJournal,
} from "./journal";
import { withLaunchLock } from "./lock";
import type { LaunchStep, SolanaLaunchStep } from "./plan";
import {
  createChainLaunchDriver,
  retrySolanaReceive,
  type SolanaLaunchBackend,
} from "./solanaDriver";
import {
  normalizeSolanaLaunchSelection,
  type SolanaLaunchSelection,
  withSolanaLaunchSteps,
} from "./solanaPlan";

export interface SolanaLaunchIntegrationOptions {
  draftId: string;
  manager: Address;
  binding: ManagerSolanaBinding;
  bootstrap: SolanaBootstrapManifest;
  codec: BindingCodec;
  costEstimator: SolanaPlanCostEstimator;
  evmCode: (manager: Address) => Promise<string | undefined>;
  evmSteps: LaunchStep[];
  selection: SolanaLaunchSelection;
  frozen: Record<string, unknown>;
  evmDriver: LaunchDriver<LaunchStep>;
  backend: SolanaLaunchBackend;
  storage?: JournalStorage;
}

/** DEC-190: unstyled integration contract; preflight occurs before any launch/journal creation. */
export function useSolanaLaunchIntegration(options: SolanaLaunchIntegrationOptions) {
  const { isEnabled } = useFeatureFlags();
  const enabled = isEnabled("solanaSpoke");
  const wallet = useManagerSolanaWallet(options.binding.solanaAddress);
  const addressRef = useRef(wallet.address);
  addressRef.current = wallet.address;
  const active = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const [journal, setJournal] = useState<LaunchJournal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [costBreakdown, setCostBreakdown] = useState<readonly SolanaComputedStepCost[] | null>(
    null,
  );
  const [preflight, setPreflight] = useState<{
    requiredLamports: bigint;
    balanceLamports: bigint;
  } | null>(null);
  const verify = async () => {
    setPreflight(null);
    setCostBreakdown(null);
    if (!enabled) throw new Error("SOLANA_DISABLED");
    if (!options.binding.bootstrapAuthorization || !options.binding.bootstrapSignature)
      throw new Error("SOLANA_BOOTSTRAP_REQUIRED");
    bootstrapChunks(options.bootstrap);
    if (options.bootstrap.policyHash !== options.binding.bootstrapAuthorization.policyHash)
      throw new Error("SOLANA_BOOTSTRAP_MISMATCH");
    const bootstrapSnapshot = JSON.stringify(options.bootstrap);
    const selectionSnapshot = JSON.stringify(normalizeSolanaLaunchSelection(options.selection));
    const bindingSnapshot = JSON.stringify(options.binding);
    const steps = withSolanaLaunchSteps(options.evmSteps, options.selection, options.bootstrap);
    if (options.selection.raydiumPool) {
      const choice = requireSolanaLpChoice(options.selection.raydiumPool);
      requireSolanaOracleReference(
        await options.backend.referencePrice?.(choice.poolId),
        choice.stockMarketHoursRequired,
      );
    }
    const costs = await estimateSolanaPlanCosts(
      steps.filter((step): step is SolanaLaunchStep => step.group === "solana"),
      options.costEstimator,
      options.costEstimator.rpc ?? createSolanaCostRpc(),
    );
    setCostBreakdown(costs);
    const checked = await checkSolanaPrelaunch({
      manager: options.manager,
      fundContext: options.draftId,
      connectedAddress: addressRef.current,
      binding: options.binding,
      codec: options.codec,
      costs,
      balance: readManagerSolanaBalance,
      evmCode: options.evmCode,
    });
    if (
      addressRef.current !== options.binding.solanaAddress ||
      JSON.stringify(options.binding) !== bindingSnapshot
    )
      throw new Error("SOLANA_BINDING_MISMATCH");
    if (JSON.stringify(normalizeSolanaLaunchSelection(options.selection)) !== selectionSnapshot)
      throw new Error("SOLANA_SELECTION_MISMATCH");
    if (JSON.stringify(options.bootstrap) !== bootstrapSnapshot)
      throw new Error("SOLANA_BOOTSTRAP_MISMATCH");
    setPreflight(checked);
    return checked;
  };
  const execute = async () => {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      await verify();
      const storage = options.storage ?? localStorage;
      await withLaunchLock(journalKey(options.draftId, options.manager), async () => {
        let current = loadJournal(storage, options.draftId, options.manager);
        const selection = normalizeSolanaLaunchSelection(options.selection);
        if (!current) {
          const steps = withSolanaLaunchSteps(options.evmSteps, selection, options.bootstrap);
          current = createJournal(
            options.draftId,
            options.manager,
            {
              ...options.frozen,
              solanaBinding: options.binding,
              solanaSelection: selection,
              solanaBootstrap: options.bootstrap,
            },
            steps,
          );
          saveJournal(storage, current);
        }
        const snapshot = current.frozen as {
          solanaBinding?: ManagerSolanaBinding;
          solanaSelection?: SolanaLaunchSelection;
          solanaBootstrap?: SolanaBootstrapManifest;
        };
        if (JSON.stringify(snapshot.solanaBinding) !== JSON.stringify(options.binding))
          throw new Error("SOLANA_BINDING_MISMATCH");
        if (JSON.stringify(snapshot.solanaSelection) !== JSON.stringify(selection))
          throw new Error("SOLANA_SELECTION_MISMATCH");
        if (JSON.stringify(snapshot.solanaBootstrap) !== JSON.stringify(options.bootstrap))
          throw new Error("SOLANA_BOOTSTRAP_MISMATCH");
        const driver = createChainLaunchDriver({
          evm: options.evmDriver,
          solanaAddress: options.binding.solanaAddress,
          rpc: createManagerSolanaRpc(),
          signTransaction: async (bytes) => {
            if (controller.signal.aborted) throw new Error("LAUNCH_CANCELLED");
            if (addressRef.current !== options.binding.solanaAddress)
              throw new Error("SOLANA_BINDING_MISMATCH");
            const signed = await wallet.signTransaction(bytes);
            if (controller.signal.aborted) throw new Error("LAUNCH_CANCELLED");
            return signed;
          },
          backend: options.backend,
          verifyBinding: async () => {
            if (addressRef.current !== options.binding.solanaAddress)
              throw new Error("SOLANA_BINDING_MISMATCH");
            if (JSON.stringify(snapshot.solanaBinding) !== JSON.stringify(options.binding))
              throw new Error("SOLANA_BINDING_MISMATCH");
            if (JSON.stringify(snapshot.solanaBootstrap) !== JSON.stringify(options.bootstrap))
              throw new Error("SOLANA_BOOTSTRAP_MISMATCH");
          },
        });
        await runLaunch(current, storage, driver, setJournal, controller.signal);
        setJournal(structuredClone(current));
      });
    } catch (failure) {
      setError(
        failure instanceof Error && /^[A-Z][A-Z0-9_]*$/.test(failure.message)
          ? failure.message
          : "SOLANA_LAUNCH_FAILED",
      );
    } finally {
      active.current = false;
      setBusy(false);
    }
  };
  return {
    enabled,
    wallet,
    preflight,
    costBreakdown,
    journal,
    busy,
    error,
    check: verify,
    launch: execute,
    resume: execute,
    pause: () => abort.current?.abort(),
    retryReceive: async () => {
      if (!journal) throw new Error("SOLANA_JOURNAL_REQUIRED");
      await retrySolanaReceive(options.backend, journal);
    },
  };
}
