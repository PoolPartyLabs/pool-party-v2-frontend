/**
 * @id PP-MGR-STO-002 (POO-2177)
 * @name launchJournal
 * @implements-rules-version v1 (POO-2222), preserves v3 (POO-2192)
 * Durable checkpoints: uncertain receipts always reconcile before rebuilding.
 */

import { V2DiscoveryPendingError } from "@/lib/api/v2/discovery";
import type { ChainLaunchStep as LaunchStep } from "./plan";

export interface Checkpoint {
  stepId: string;
  chain: LaunchStep["chain"];
  chainKind?: "evm" | "svm";
  status: "idle" | "building" | "signing" | "submitted" | "waiting" | "confirmed" | "failed";
  txHash?: string;
  submissionAttempted?: boolean;
  receiptStatus?: "success" | "reverted" | "unknown";
  error?: string;
  data?: Record<string, unknown>;
  waitReason?: "discovery";
  retryAt?: number;
  retryCount?: number;
  retryAfterSeconds?: number;
}
export interface LaunchJournal {
  version: 1;
  draftId: string;
  manager: string;
  frozen: unknown;
  steps: LaunchStep[];
  checkpoints: Record<string, Checkpoint>;
  addresses: Record<string, string>;
  principal?: string;
  arrival?: string;
  analyticsCompleted?: boolean;
}
export interface JournalStorage {
  // PP-INTEGRATION-POINT: browser checkpoint journal becomes a durable API launch-plan later.
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function journalKey(draftId: string, manager: string): string {
  return `pp:v2:launch:1:${manager.toLowerCase()}:${draftId}`;
}
export function saveJournal(storage: JournalStorage, journal: LaunchJournal): void {
  let previouslyCompleted = false;
  try {
    const previous = JSON.parse(
      storage.getItem(journalKey(journal.draftId, journal.manager)) ?? "null",
    ) as LaunchJournal | null;
    previouslyCompleted =
      !!previous?.steps.length &&
      previous.steps.every((step) => previous.checkpoints[step.id]?.status === "confirmed");
  } catch {}
  storage.setItem(journalKey(journal.draftId, journal.manager), JSON.stringify(journal));
  if (typeof window !== "undefined" && storage === window.localStorage)
    window.dispatchEvent(
      new CustomEvent("pp:v2:launch-changed", {
        detail: {
          completed:
            !previouslyCompleted &&
            journal.steps.length > 0 &&
            journal.steps.every((step) => journal.checkpoints[step.id]?.status === "confirmed"),
        },
      }),
    );
}
export function loadJournal(
  storage: JournalStorage,
  draftId: string,
  manager: string,
): LaunchJournal | null {
  const raw = storage.getItem(journalKey(draftId, manager));
  if (raw === null) return null;
  const journal: LaunchJournal = JSON.parse(raw);
  if (
    journal.version !== 1 ||
    journal.draftId !== draftId ||
    journal.manager !== manager.toLowerCase() ||
    !Array.isArray(journal.steps) ||
    !journal.checkpoints ||
    !journal.addresses
  )
    throw new Error("INVALID_JOURNAL");
  const ids = new Set(journal.steps.map((step) => step.id));
  if (
    journal.steps.length === 0 ||
    ids.size !== journal.steps.length ||
    journal.steps.some(
      (step) =>
        typeof step.id !== "string" ||
        ![42161, 4663, "solana:mainnet"].includes(step.chain) ||
        (step.chainKind !== undefined &&
          step.chainKind !== (step.chain === "solana:mainnet" ? "svm" : "evm")) ||
        (step.chain === "solana:mainnet" && step.chainKind !== "svm") ||
        ![
          "approve",
          "create",
          "discover",
          "spoke",
          "profile",
          "allocate",
          "report",
          "bridge",
          "arrival",
          "swap",
          "open",
          "bind-solana",
          "stage-solana-config",
          "seal-solana-config",
          "init-solana",
          "cctp-fast",
          "solana-arrival",
          "kamino-supply",
          "swap-to-ratio",
          "raydium-open",
        ].includes(step.kind) ||
        !Array.isArray(step.dependencies) ||
        step.dependencies.some((id) => !ids.has(id)),
    )
  )
    throw new Error("INVALID_JOURNAL");
  for (const [id, checkpoint] of Object.entries(journal.checkpoints)) {
    if (
      !checkpoint ||
      !ids.has(id) ||
      checkpoint.stepId !== id ||
      ![42161, 4663, "solana:mainnet"].includes(checkpoint.chain) ||
      (checkpoint.chainKind !== undefined &&
        checkpoint.chainKind !== (checkpoint.chain === "solana:mainnet" ? "svm" : "evm")) ||
      checkpoint.chain !== journal.steps.find((step) => step.id === id)?.chain ||
      (checkpoint.submissionAttempted !== undefined &&
        typeof checkpoint.submissionAttempted !== "boolean") ||
      (checkpoint.retryAt !== undefined &&
        (typeof checkpoint.retryAt !== "number" ||
          !Number.isFinite(checkpoint.retryAt) ||
          checkpoint.retryAt < 0)) ||
      (checkpoint.retryAfterSeconds !== undefined &&
        (typeof checkpoint.retryAfterSeconds !== "number" ||
          !Number.isFinite(checkpoint.retryAfterSeconds) ||
          checkpoint.retryAfterSeconds < 0)) ||
      (checkpoint.retryCount !== undefined &&
        (!Number.isSafeInteger(checkpoint.retryCount) || checkpoint.retryCount < 0)) ||
      (checkpoint.waitReason !== undefined && checkpoint.waitReason !== "discovery") ||
      !["idle", "building", "signing", "submitted", "waiting", "confirmed", "failed"].includes(
        checkpoint.status,
      )
    )
      throw new Error("INVALID_JOURNAL");
  }
  return journal;
}
export function createJournal(
  draftId: string,
  manager: string,
  frozen: unknown,
  steps: LaunchStep[],
): LaunchJournal {
  return {
    version: 1,
    draftId,
    manager: manager.toLowerCase(),
    frozen: structuredClone(frozen),
    steps,
    checkpoints: {},
    addresses: {},
  };
}

export interface LaunchDriver<Step extends LaunchStep = LaunchStep> {
  build(
    step: Step,
    journal: LaunchJournal,
  ): Promise<{ data?: Record<string, unknown>; transaction?: unknown; complete?: boolean }>;
  send(step: Step, transaction: unknown, onSubmitted?: (hash: string) => void): Promise<string>;
  receipt(
    chain: Step["chain"],
    hash: string,
  ): Promise<{ status: "success" | "reverted" | "unknown"; data?: Record<string, unknown> }>;
  reconcile(step: Step, checkpoint: Checkpoint, journal: LaunchJournal): Promise<boolean>;
  complete(step: Step, checkpoint: Checkpoint, journal: LaunchJournal): Promise<void>;
}

export function hasUnresolvedSubmission(step: LaunchStep, checkpoint: Checkpoint): boolean {
  return (
    !["profile", "discover", "report", "arrival", "bind-solana", "solana-arrival"].includes(
      step.kind,
    ) &&
    !checkpoint.txHash &&
    checkpoint.status !== "confirmed" &&
    (checkpoint.submissionAttempted === true ||
      checkpoint.status === "signing" ||
      checkpoint.status === "submitted" ||
      (checkpoint.status === "failed" && checkpoint.submissionAttempted !== false) ||
      checkpoint.error === "SUBMISSION_RECONCILIATION_REQUIRED")
  );
}

export async function runLaunch(
  journal: LaunchJournal,
  storage: JournalStorage,
  driver: LaunchDriver,
  onChange: (journal: LaunchJournal) => void = () => {},
  signal?: AbortSignal,
  maxSteps = Number.POSITIVE_INFINITY,
  readOnly = false,
): Promise<LaunchJournal> {
  const persist = () => {
    saveJournal(storage, journal);
    onChange(structuredClone(journal));
  };
  persist();
  let processed = 0;
  for (const step of journal.steps) {
    if (signal?.aborted) return journal;
    const checkpoint = journal.checkpoints[step.id] ?? {
      stepId: step.id,
      chain: step.chain,
      ...(step.chainKind ? { chainKind: step.chainKind } : {}),
      status: "idle" as const,
      submissionAttempted: false,
    };
    if (checkpoint.status === "confirmed") continue;
    if (checkpoint.retryAt && checkpoint.retryAt > Date.now()) continue;
    const unresolved = hasUnresolvedSubmission(step, checkpoint);
    if (readOnly && !checkpoint.txHash && checkpoint.status !== "waiting" && !unresolved) continue;
    if (readOnly && !checkpoint.txHash && ["profile", "bind-solana"].includes(step.kind)) continue;
    if (
      step.kind === "bridge" &&
      !checkpoint.txHash &&
      journal.steps.some(
        (sibling) =>
          sibling.chain === 42161 &&
          ["open", "swap"].includes(sibling.kind) &&
          journal.checkpoints[sibling.id]?.status !== "confirmed",
      )
    )
      continue;
    if (
      !checkpoint.txHash &&
      step.dependencies.some(
        (dependency) => journal.checkpoints[dependency]?.status !== "confirmed",
      )
    )
      continue;
    if (processed >= maxSteps) return journal;
    journal.checkpoints[step.id] = checkpoint;
    processed += 1;
    try {
      if (checkpoint.txHash && checkpoint.receiptStatus !== "reverted") {
        if (step.kind === "open" && checkpoint.receiptStatus === "success") {
          await driver.complete(step, checkpoint, journal);
          checkpoint.status = "confirmed";
          delete checkpoint.error;
          delete checkpoint.waitReason;
          delete checkpoint.retryAt;
          delete checkpoint.retryAfterSeconds;
          delete checkpoint.retryCount;
          persist();
          continue;
        }
        const receipt = await driver.receipt(step.chain, checkpoint.txHash);
        checkpoint.receiptStatus = receipt.status;
        checkpoint.data = { ...checkpoint.data, ...receipt.data };
        if (receipt.status === "unknown") {
          if (
            ["stage-solana-config", "seal-solana-config", "init-solana"].includes(step.kind) &&
            (await driver.reconcile(step, checkpoint, journal))
          ) {
            await driver.complete(step, checkpoint, journal);
            checkpoint.status = "confirmed";
            delete checkpoint.error;
            delete checkpoint.waitReason;
            delete checkpoint.retryAt;
            delete checkpoint.retryAfterSeconds;
            delete checkpoint.retryCount;
            persist();
            continue;
          }
          checkpoint.status = "waiting";
          delete checkpoint.retryAt;
          persist();
          continue;
        }
        if (receipt.status === "success") {
          await driver.complete(step, checkpoint, journal);
          checkpoint.status = "confirmed";
          delete checkpoint.error;
          delete checkpoint.waitReason;
          delete checkpoint.retryAt;
          delete checkpoint.retryAfterSeconds;
          delete checkpoint.retryCount;
          persist();
          continue;
        }
        checkpoint.status = "failed";
        checkpoint.error = "TRANSACTION_REVERTED";
        persist();
        if (readOnly) continue;
        return journal;
      }
      if (
        (unresolved || ["signing", "waiting", "failed"].includes(checkpoint.status)) &&
        (await driver.reconcile(step, checkpoint, journal))
      ) {
        checkpoint.status = "confirmed";
        delete checkpoint.error;
        persist();
        continue;
      }
      if (checkpoint.error === "SUBMISSION_RECONCILIATION_REQUIRED")
        throw new Error("SUBMISSION_RECONCILIATION_REQUIRED");
      if (unresolved) throw new Error("SUBMISSION_RECONCILIATION_REQUIRED");
      checkpoint.status = "building";
      checkpoint.submissionAttempted = false;
      delete checkpoint.error;
      persist();
      const built = await driver.build(step, journal);
      checkpoint.data = { ...checkpoint.data, ...built.data };
      persist();
      if (signal?.aborted) return journal;
      if (built.complete) {
        await driver.complete(step, checkpoint, journal);
        checkpoint.status = "confirmed";
        delete checkpoint.waitReason;
        delete checkpoint.retryAt;
        delete checkpoint.retryAfterSeconds;
        delete checkpoint.retryCount;
        persist();
        continue;
      }
      if (!built.transaction) {
        checkpoint.status = "waiting";
        delete checkpoint.retryAt;
        delete checkpoint.waitReason;
        persist();
        continue;
      }
      checkpoint.status = "signing";
      if (readOnly) {
        checkpoint.status = "idle";
        delete checkpoint.waitReason;
        delete checkpoint.retryAt;
        delete checkpoint.retryAfterSeconds;
        delete checkpoint.retryCount;
        persist();
        continue;
      }
      checkpoint.submissionAttempted = true;
      persist();
      const submitted = (hash: string) => {
        if (checkpoint.txHash === hash && checkpoint.status === "submitted") return;
        checkpoint.txHash = hash;
        checkpoint.receiptStatus = "unknown";
        checkpoint.status = "submitted";
        persist();
      };
      const hash = await driver.send(step, built.transaction, submitted);
      submitted(hash);
      if (signal?.aborted) return journal;
      const receipt = await driver.receipt(step.chain, hash);
      checkpoint.receiptStatus = receipt.status;
      checkpoint.data = { ...checkpoint.data, ...receipt.data };
      if (receipt.status === "success") {
        await driver.complete(step, checkpoint, journal);
        checkpoint.status = "confirmed";
      } else if (receipt.status === "reverted") throw new Error("TRANSACTION_REVERTED");
      else checkpoint.status = "waiting";
      delete checkpoint.error;
      persist();
    } catch (error) {
      if (
        error instanceof V2DiscoveryPendingError ||
        (error instanceof Error && error.message === "V2_DISCOVERY_PENDING")
      ) {
        const retryAfterSeconds = (error as V2DiscoveryPendingError).retryAfterSeconds;
        checkpoint.retryCount = (checkpoint.retryCount ?? 0) + 1;
        checkpoint.retryAfterSeconds = retryAfterSeconds;
        checkpoint.retryAt =
          Date.now() +
          Math.max(
            1000,
            (retryAfterSeconds ?? Math.min(30, 2 ** Math.min(checkpoint.retryCount, 5))) * 1000,
          );
        checkpoint.waitReason = "discovery";
        checkpoint.status = "waiting";
        delete checkpoint.error;
        persist();
        continue;
      }
      if (
        ["discover", "report", "arrival"].includes(step.kind) &&
        error instanceof Error &&
        ["V2_DEFERRED", "V2_RATE_LIMITED"].includes(error.message)
      ) {
        checkpoint.status = "waiting";
        delete checkpoint.error;
        persist();
        continue;
      }
      checkpoint.status = "failed";
      checkpoint.error =
        error instanceof Error && /^[A-Z][A-Z0-9_]*$/.test(error.message)
          ? error.message
          : "LAUNCH_STEP_FAILED";
      if (!checkpoint.txHash && ["USER_REJECTED", "LAUNCH_CANCELLED"].includes(checkpoint.error))
        checkpoint.submissionAttempted = false;
      persist();
      if (step.kind !== "report" && !readOnly) return journal;
    }
  }
  return journal;
}
