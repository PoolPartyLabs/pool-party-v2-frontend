/** @id PP-CP-LIB-023 @name Cash+ signer journal locks @implements-rules-version v1 */
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
export type SignerLock = { descriptor: number; path: string };
/** Recover only a lock owned by a process proven absent; a live owner is never displaced. */
export function acquireSignerLock(path: string): SignerLock {
  try {
    const descriptor = openSync(path, "wx");
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid }));
    return { descriptor, path };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const prior = JSON.parse(readFileSync(path, "utf8")) as { pid?: number };
    if (!Number.isSafeInteger(prior.pid) || (prior.pid ?? 0) <= 0)
      throw new Error("INVALID_SIGNER_LOCK");
    try {
      process.kill(prior.pid as number, 0);
    } catch (probeError) {
      if ((probeError as NodeJS.ErrnoException).code !== "ESRCH")
        throw new Error("SIGNER_ALREADY_RUNNING");
      unlinkSync(path);
      return acquireSignerLock(path);
    }
    throw new Error("SIGNER_ALREADY_RUNNING");
  }
}
export function releaseSignerLock(lock: SignerLock): void {
  closeSync(lock.descriptor);
  unlinkSync(lock.path);
}
export type Pending = { hash: `0x${string}`; label: string };
/** Never sends a transaction; timeout/replacement ambiguity preserves the caller's pending journal. */
export async function reconcilePending<T extends { status: string }>(
  pending: Pending | undefined,
  waitReceipt: (hash: `0x${string}`) => Promise<T>,
): Promise<T | undefined> {
  if (!pending) return undefined;
  const receipt = await waitReceipt(pending.hash);
  if (receipt.status !== "success") throw new Error(`PENDING_TRANSACTION_REVERTED ${pending.hash}`);
  return receipt;
}
