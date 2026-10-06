"use client";

import { useRef, useState } from "react";
import type { Address } from "viem";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import type { BindingCodec, ManagerSolanaBinding } from "@/lib/solana/binding";
import { checkSolanaPrelaunch, type SolanaStepCost } from "@/lib/solana/preflight";
import { createManagerSolanaRpc } from "@/lib/solana/rpc";
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
import type { LaunchStep } from "./plan";
import {
  createChainLaunchDriver,
  retrySolanaReceive,
  type SolanaLaunchBackend,
} from "./solanaDriver";
import { type SolanaLaunchSelection, withSolanaLaunchSteps } from "./solanaPlan";

export interface SolanaLaunchIntegrationOptions {
  draftId: string;
  manager: Address;
  binding: ManagerSolanaBinding;
  codec: BindingCodec;
  costs: readonly SolanaStepCost[];
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
  const [preflight, setPreflight] = useState<{
    requiredLamports: bigint;
    balanceLamports: bigint;
  } | null>(null);
  const verify = async () => {
    if (!enabled) throw new Error("SOLANA_DISABLED");
    const checked = await checkSolanaPrelaunch({
      manager: options.manager,
      fundContext: options.draftId,
      connectedAddress: addressRef.current,
      binding: options.binding,
      codec: options.codec,
      costs: options.costs,
      balance: readManagerSolanaBalance,
      evmCode: options.evmCode,
    });
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
        if (!current) {
          const steps = withSolanaLaunchSteps(options.evmSteps, options.selection);
          current = createJournal(
            options.draftId,
            options.manager,
            {
              ...options.frozen,
              solanaBinding: options.binding,
              solanaSelection: options.selection,
            },
            steps,
          );
          saveJournal(storage, current);
        }
        const snapshot = current.frozen as { solanaBinding?: ManagerSolanaBinding };
        if (JSON.stringify(snapshot.solanaBinding) !== JSON.stringify(options.binding))
          throw new Error("SOLANA_BINDING_MISMATCH");
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
