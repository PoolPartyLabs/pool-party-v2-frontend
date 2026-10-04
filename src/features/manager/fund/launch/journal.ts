/**
 * @id PP-MGR-STO-002 (POO-2177)
 * @name launchJournal
 * @implements-rules-version v3 (POO-2192)
 * Durable checkpoints: uncertain receipts always reconcile before rebuilding.
 */
import type { LaunchStep } from "./plan";

export interface Checkpoint {
  stepId: string;
  chain: 42161 | 4663;
  status: "idle" | "building" | "signing" | "submitted" | "waiting" | "confirmed" | "failed";
  txHash?: string;
  receiptStatus?: "success" | "reverted" | "unknown";
  error?: string;
  data?: Record<string, unknown>;
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
        ![42161, 4663].includes(step.chain) ||
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
      ![42161, 4663].includes(checkpoint.chain) ||
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

export interface LaunchDriver {
  build(
    step: LaunchStep,
    journal: LaunchJournal,
  ): Promise<{ data?: Record<string, unknown>; transaction?: unknown; complete?: boolean }>;
  send(step: LaunchStep, transaction: unknown): Promise<string>;
  receipt(
    chain: LaunchStep["chain"],
    hash: string,
  ): Promise<{ status: "success" | "reverted" | "unknown"; data?: Record<string, unknown> }>;
  reconcile(step: LaunchStep, checkpoint: Checkpoint, journal: LaunchJournal): Promise<boolean>;
  complete(step: LaunchStep, checkpoint: Checkpoint, journal: LaunchJournal): Promise<void>;
}

export async function runLaunch(
  journal: LaunchJournal,
  storage: JournalStorage,
  driver: LaunchDriver,
  onChange: (journal: LaunchJournal) => void = () => {},
  signal?: AbortSignal,
  maxSteps = Number.POSITIVE_INFINITY,
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
      status: "idle" as const,
    };
    if (checkpoint.status === "confirmed") continue;
    if (
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
        const receipt = await driver.receipt(step.chain, checkpoint.txHash);
        checkpoint.receiptStatus = receipt.status;
        checkpoint.data = { ...checkpoint.data, ...receipt.data };
        if (receipt.status === "unknown") {
          checkpoint.status = "waiting";
          persist();
          continue;
        }
        if (receipt.status === "success") {
          await driver.complete(step, checkpoint, journal);
          checkpoint.status = "confirmed";
          delete checkpoint.error;
          persist();
          continue;
        }
        checkpoint.status = "failed";
        checkpoint.error = "TRANSACTION_REVERTED";
        persist();
        return journal;
      }
      if (
        ["signing", "waiting", "failed"].includes(checkpoint.status) &&
        (await driver.reconcile(step, checkpoint, journal))
      ) {
        checkpoint.status = "confirmed";
        persist();
        continue;
      }
      if (checkpoint.error === "SUBMISSION_RECONCILIATION_REQUIRED")
        throw new Error("SUBMISSION_RECONCILIATION_REQUIRED");
      if (checkpoint.status === "signing" && step.kind !== "profile")
        throw new Error("SUBMISSION_RECONCILIATION_REQUIRED");
      checkpoint.status = "building";
      delete checkpoint.error;
      persist();
      const built = await driver.build(step, journal);
      checkpoint.data = { ...checkpoint.data, ...built.data };
      persist();
      if (signal?.aborted) return journal;
      if (built.complete) {
        await driver.complete(step, checkpoint, journal);
        checkpoint.status = "confirmed";
        persist();
        continue;
      }
      if (!built.transaction) {
        checkpoint.status = "waiting";
        persist();
        continue;
      }
      checkpoint.status = "signing";
      persist();
      checkpoint.txHash = await driver.send(step, built.transaction);
      checkpoint.receiptStatus = "unknown";
      checkpoint.status = "submitted";
      persist();
      const receipt = await driver.receipt(step.chain, checkpoint.txHash);
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
      persist();
      if (step.kind !== "report") return journal;
    }
  }
  return journal;
}
