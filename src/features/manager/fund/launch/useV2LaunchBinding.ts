/**
 * @id PP-MGR-HOK-019 (POO-2177)
 * @name useV2LaunchBinding
 * @implements-rules-version v1 (POO-2222), preserves v1 (POO-2203), v3 (POO-2192)
 * @analytics-events builder_launch_signature, builder_launch_completed, builder_launch_failed
 */
"use client";
import { useEffect, useRef, useState } from "react";
import { isAnalyticsErrorCodeShape } from "@/lib/analytics/events";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { isMockMode } from "@/lib/services";
import { createLaunchDriver, type FrozenLaunch, type LaunchWallet } from "./driver";
import {
  createJournal,
  hasUnresolvedSubmission,
  type JournalStorage,
  journalKey,
  type LaunchJournal,
  loadJournal,
  runLaunch,
  saveJournal,
} from "./journal";
import { withLaunchLock } from "./lock";
import {
  type CanvasPlan,
  deriveLaunchSteps,
  type ExecutionConfig,
  type LaunchStep,
  launchPlanError,
} from "./plan";

export interface V2LaunchOptions {
  draftId: string;
  manager: string | null;
  plan?: CanvasPlan;
  execution?: Record<string, ExecutionConfig>;
  spoke: boolean;
  frozen?: FrozenLaunch;
  prepare?: () => FrozenLaunch;
  wallet: LaunchWallet | null;
  storage?: JournalStorage;
  pollInterval?: number;
}
export interface V2LaunchError {
  code: string;
  messageKey:
    | "fundLaunch.partialFailure"
    | "fundLaunch.submissionReconciliation"
    | "fundLaunch.buildGap"
    | "fundLaunch.duplicateAaveReserve"
    | "fundLaunch.walletOrJournal"
    | "fundLaunch.realOnly";
}
export interface LaunchSignature {
  stepId: string;
  chain: 42161 | 4663;
  type: "transaction" | "message";
  status: string;
  conditional: boolean;
}
export function useV2LaunchBinding(options: V2LaunchOptions) {
  // PP-INTEGRATION-POINT: Murilo's Review page consumes headless launch state and explicit actions.
  const { isEnabled } = useFeatureFlags();
  const { track } = useAnalytics();
  const [journal, setJournal] = useState<LaunchJournal | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<V2LaunchError | null>(null);
  const running = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    setJournal(null);
    setHydrated(false);
    setError(null);
    setPaused(false);
    if (!options.manager) return;
    try {
      setJournal(loadJournal(options.storage ?? localStorage, options.draftId, options.manager));
      setHydrated(true);
    } catch {
      setError({ code: "INVALID_JOURNAL", messageKey: "fundLaunch.walletOrJournal" });
    }
    return () => {
      abort.current?.abort();
    };
  }, [options.draftId, options.manager, options.storage]);
  let steps: LaunchStep[] = [];
  let gap = false;
  let planError = launchPlanError(null);
  try {
    if (journal) steps = journal.steps;
    else if (options.plan)
      steps = deriveLaunchSteps(options.plan, options.execution ?? {}, true, options.spoke);
    else gap = true;
  } catch (error) {
    gap = true;
    planError = launchPlanError(error);
  }
  const execute = async (resume: boolean, once: boolean, readOnly = false) => {
    if (running.current) return;
    if (!readOnly) setPaused(false);
    if (isMockMode || !isEnabled("fundContracts")) {
      setError({ code: "V2_UNAVAILABLE", messageKey: "fundLaunch.realOnly" });
      return;
    }
    if (!hydrated || !options.manager || !options.wallet) {
      setError({ code: "INVALID_JOURNAL", messageKey: "fundLaunch.walletOrJournal" });
      return;
    }
    if (gap) {
      setError(planError);
      return;
    }
    const manager = options.manager;
    const wallet = options.wallet;
    const storage = options.storage ?? localStorage;
    const controller = new AbortController();
    abort.current = controller;
    running.current = true;
    setBusy(true);
    setError(null);
    let active = true;
    const changed = (value: LaunchJournal) => {
      if (active && !controller.signal.aborted) setJournal(value);
    };
    try {
      await withLaunchLock(journalKey(options.draftId, manager), async () => {
        let current = loadJournal(storage, options.draftId, manager);
        if (!current) {
          if (resume) throw new Error("INVALID_JOURNAL");
          const frozen = options.prepare ? options.prepare() : options.frozen;
          if (!frozen || frozen.request.manager.toLowerCase() !== manager.toLowerCase())
            throw new Error("INVALID_REVIEW");
          current = createJournal(options.draftId, manager, frozen, steps);
        }
        const driver = createLaunchDriver(
          {
            send: async (transaction, onSubmitted) => {
              if (readOnly) throw new Error("READ_ONLY_RECONCILIATION");
              if (controller.signal.aborted) throw new Error("LAUNCH_CANCELLED");
              return wallet.send(transaction, onSubmitted, controller.signal);
            },
            sign: async (message) => {
              if (readOnly) throw new Error("READ_ONLY_RECONCILIATION");
              if (controller.signal.aborted) throw new Error("LAUNCH_CANCELLED");
              return wallet.sign(message);
            },
            receipt: (chain, hash) => wallet.receipt(chain, hash),
            ...(wallet.blockNumber ? { blockNumber: wallet.blockNumber.bind(wallet) } : {}),
            ...(wallet.transaction ? { transaction: wallet.transaction.bind(wallet) } : {}),
          },
          (step) => {
            if (!controller.signal.aborted)
              track("builder_launch_signature", { chain_id: step.chain, step_kind: step.kind });
          },
        );
        const singleStepId = once
          ? current.steps.find(
              (step) =>
                current.checkpoints[step.id]?.status !== "confirmed" &&
                step.dependencies.every(
                  (dependency) => current.checkpoints[dependency]?.status === "confirmed",
                ),
            )?.id
          : undefined;
        do {
          await runLaunch(
            current,
            storage,
            driver,
            changed,
            controller.signal,
            once ? 1 : Number.POSITIVE_INFINITY,
            readOnly,
          );
          if (controller.signal.aborted) break;
          const failed = Object.values(current.checkpoints).find(
            (checkpoint) => checkpoint.status === "failed",
          );
          if (readOnly) {
            if (failed)
              setError({
                code: failed.error ?? "LAUNCH_STEP_FAILED",
                messageKey:
                  failed.error === "SUBMISSION_RECONCILIATION_REQUIRED"
                    ? "fundLaunch.submissionReconciliation"
                    : "fundLaunch.partialFailure",
              });
            break;
          }
          if (failed) {
            const code =
              failed.error && isAnalyticsErrorCodeShape(failed.error)
                ? failed.error
                : "LAUNCH_STEP_FAILED";
            track("builder_launch_failed", {
              step_kind: current.steps.find((step) => step.id === failed.stepId)?.kind,
              error_code: code,
              error_origin: code === "USER_REJECTED" ? "user" : "app",
            });
            setError({
              code: failed.error ?? "LAUNCH_STEP_FAILED",
              messageKey:
                failed.error === "SUBMISSION_RECONCILIATION_REQUIRED"
                  ? "fundLaunch.submissionReconciliation"
                  : "fundLaunch.partialFailure",
            });
            break;
          }
          if (
            (once && (!singleStepId || current.checkpoints[singleStepId]?.status !== "waiting")) ||
            current.steps.every((step) => current?.checkpoints[step.id]?.status === "confirmed")
          )
            break;
          await new Promise<void>((resolve) => {
            const finish = () => {
              clearTimeout(timeout);
              controller.signal.removeEventListener("abort", finish);
              resolve();
            };
            const timeout = setTimeout(finish, options.pollInterval ?? 10_000);
            controller.signal.addEventListener("abort", finish, { once: true });
            if (controller.signal.aborted) finish();
          });
        } while (!controller.signal.aborted);
        if (
          !controller.signal.aborted &&
          current.steps.length > 0 &&
          current.steps.every((step) => current?.checkpoints[step.id]?.status === "confirmed") &&
          !current.analyticsCompleted
        ) {
          current.analyticsCompleted = true;
          saveJournal(storage, current);
          track("builder_launch_completed");
          changed(structuredClone(current));
        }
      });
    } catch (failure) {
      if (!controller.signal.aborted) {
        const code =
          failure instanceof Error && isAnalyticsErrorCodeShape(failure.message)
            ? failure.message
            : "LAUNCH_STEP_FAILED";
        track("builder_launch_failed", {
          step_kind: steps.find((step) => journal?.checkpoints[step.id]?.status !== "confirmed")
            ?.kind,
          error_code: code,
          error_origin: "app",
        });
        setError({
          code:
            failure instanceof Error && /^[A-Z][A-Z0-9_]*$/.test(failure.message)
              ? failure.message
              : "LAUNCH_STEP_FAILED",
          messageKey:
            failure instanceof Error && failure.message === "SUBMISSION_RECONCILIATION_REQUIRED"
              ? "fundLaunch.submissionReconciliation"
              : "fundLaunch.partialFailure",
        });
      }
    } finally {
      active = false;
      running.current = false;
      setBusy(false);
    }
  };
  const executeRef = useRef(execute);
  useEffect(() => {
    executeRef.current = execute;
  });
  useEffect(() => {
    if (!hydrated || busy || paused || !journal || !options.wallet) return;
    const pending = Object.values(journal.checkpoints).filter(
      (checkpoint) =>
        journal.steps.some(
          (step) =>
            step.id === checkpoint.stepId &&
            (checkpoint.txHash ||
              (step.kind !== "profile" &&
                step.dependencies.every(
                  (dependency) => journal.checkpoints[dependency]?.status === "confirmed",
                ) &&
                (step.kind !== "bridge" ||
                  !journal.steps.some(
                    (sibling) =>
                      sibling.chain === 42161 &&
                      ["open", "swap"].includes(sibling.kind) &&
                      journal.checkpoints[sibling.id]?.status !== "confirmed",
                  )))),
        ) &&
        checkpoint.status !== "confirmed" &&
        checkpoint.receiptStatus !== "reverted" &&
        (checkpoint.status === "waiting" ||
          checkpoint.status === "submitted" ||
          journal.steps.some(
            (step) => step.id === checkpoint.stepId && hasUnresolvedSubmission(step, checkpoint),
          ) ||
          (checkpoint.txHash && checkpoint.receiptStatus === "unknown")),
    );
    if (!pending.length) return;
    const nextRetry = Math.min(
      ...pending.map(
        (checkpoint) => checkpoint.retryAt ?? Date.now() + (options.pollInterval ?? 10_000),
      ),
    );
    const timeout = setTimeout(
      () => void executeRef.current(true, false, true),
      Math.min(2_147_483_647, Math.max(1, nextRetry - Date.now())),
    );
    return () => clearTimeout(timeout);
  }, [hydrated, busy, paused, journal, options.wallet, options.pollInterval]);
  const currentStep =
    steps.find((step) => journal?.checkpoints[step.id]?.status !== "confirmed") ?? null;
  const signatures: LaunchSignature[] = steps
    .filter((step) => !["discover", "report", "arrival"].includes(step.kind))
    .map((step) => ({
      stepId: step.id,
      chain: step.chain,
      type: step.kind === "profile" ? "message" : "transaction",
      status: journal?.checkpoints[step.id]?.status ?? "idle",
      conditional: ["approve", "swap", "profile"].includes(step.kind),
    }));
  return {
    journal,
    hydrated,
    busy,
    gap,
    error,
    steps,
    currentStep,
    signatures,
    checkpoints: journal?.checkpoints ?? {},
    addresses: journal?.addresses ?? {},
    status: busy
      ? "running"
      : error
        ? "failed"
        : journal && !currentStep
          ? "complete"
          : journal
            ? "paused"
            : "idle",
    launch: () => execute(false, false),
    resume: () => execute(true, false),
    retry: () => execute(true, false),
    next: () => execute(journal !== null, true),
    // Explicit consent starts serial continuation; every prerequisite settles before its dependent.
    sign: () => execute(journal !== null, false),
    pause: () => {
      setPaused(true);
      abort.current?.abort();
    },
  };
}
export type V2LaunchBinding = ReturnType<typeof useV2LaunchBinding>;
